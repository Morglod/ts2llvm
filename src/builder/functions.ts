import ts from "typescript";
import llvm from "llvm-bindings";
import { ScopeContext } from "../context";
import { codeBlock } from "../builder/expressions";
import { findTypeFromType, parseTypeNode } from "../builder/types";
import { createObjectType } from "./objects";
import { Types } from "../types";

export function parseFunctionType(ctx: ScopeContext, node: ts.FunctionDeclaration | ts.ArrowFunction) {
    const returnType = parseTypeNode(ctx, node.type);
    const paramTypes = node.parameters.map((param) => ({
        name: param.name.getText(),
        type: parseTypeNode(ctx, param.type),
    }));
    const funcType = createFunctionType(ctx, returnType, paramTypes);
    return { funcType, returnType, paramTypes };
}

export function parseFunction(ctx: ScopeContext, node: ts.FunctionDeclaration | ts.ArrowFunction) {
    const funcName = node.name?.getText() || "func_" + Math.random().toString().replace(".", "_");
    const { funcType, paramTypes } = parseFunctionType(ctx, node);
    if (node.body) {
        const { func, funcScopeCtx, funcCallFrameScopeCtx } = createFunction(ctx, funcName, funcType, paramTypes);

        funcCallFrameScopeCtx.unsafe_setTsNode(node.parent);
        funcScopeCtx.unsafe_setTsNode(node.body);

        codeBlock(funcScopeCtx, node.body, funcName, func, () => {
            funcScopeCtx.appendDefferedCodeBlock();
        });

        let isPureFunc = funcCallFrameScopeCtx.countScopeValues() === 0;
        let hasThisArg = !!funcCallFrameScopeCtx.findScopeValue("this", { noProxy: true, noRecursive: true });
        if (funcCallFrameScopeCtx.countScopeValues() === 1 && hasThisArg) {
            isPureFunc = true;
        }

        if (isPureFunc) {
            return func;
        }

        return createFunctionObject(ctx, funcName, funcCallFrameScopeCtx, func, paramTypes);
    } else {
        const func = llvm.Function.Create(funcType, llvm.Function.LinkageTypes.ExternalLinkage, funcName, ctx.module);
        return func;
    }
}

export function createFunctionType(ctx: ScopeContext, returnType: llvm.Type, args: { type: llvm.Type }[]) {
    const paramTypes = [
        // call frame object pointer
        ctx.builder.getInt8PtrTy(),
        // args
        ...args.map((x) => x.type),
    ];
    const functionType = llvm.FunctionType.get(returnType, paramTypes, false);

    return functionType;
}

export function parseFunctionTypeFromSignature(ctx: ScopeContext, node: ts.CallLikeExpression) {
    const signature = ctx.checker.getResolvedSignature(node)!;
    const tsReturnType = signature.getReturnType();
    const tsArgs = signature.getParameters();

    const returnType = findTypeFromType(ctx, tsReturnType);
    const args = tsArgs.map((x) => ({
        type: findTypeFromType(ctx, ctx.checker.getTypeOfSymbolAtLocation(x, node)),
    }));

    const funcType = createFunctionType(ctx, returnType, args);
    return funcType;
}

export function createFunction(
    ctx: ScopeContext,
    funcName: string | undefined,
    funcType: llvm.FunctionType,
    args: { name: string; type: llvm.Type }[]
) {
    const func = llvm.Function.Create(funcType, llvm.Function.LinkageTypes.ExternalLinkage, funcName, ctx.module);
    const callFrameObjArg = func.getArg(0);

    // set variables here for callframe
    const funcCallFrameScopeCtx = ctx.createChildScope(undefined);
    funcCallFrameScopeCtx.scopeProxy = {
        scopeValueNotFound: (ctx, name) => {
            const foundParent = ctx.parentScope?.findScopeValue(name);
            // pass functions as global
            if (foundParent && foundParent instanceof llvm.Function) {
                return foundParent;
            }

            // TODO: find type of scope object
            const callFrameTypeId = ctx.types.findObjTypeId_byLLVMType(func.getType());
            const callFrameObj = ctx.types.getByTypeId(callFrameTypeId!);
            const { fieldPtr } = callFrameObj.getField(ctx, callFrameObjArg, name as string);
            ctx.setScopeValue(name, fieldPtr);
            return fieldPtr;
        },
    };

    const funcScopeCtx = funcCallFrameScopeCtx.createChildScope(undefined);

    const funcArgs = args.map((param, argi) => {
        const llvmArgIndex = argi + 1;
        // +1 because arg0 is callframe
        const funcArg = func.getArg(llvmArgIndex);
        funcScopeCtx.setScopeValue(param.name, funcArg);

        const found = funcScopeCtx.types.findObjTypeId_byLLVMType(param.type);
        if (found) {
            funcScopeCtx.pushDeferredCodeBlockCode((ctx) => {
                const typeDesc = ctx.types.getByTypeId(found)!;
                typeDesc.decRefCounter(ctx, funcArg);
            });
        }

        return {
            arg: funcArg,
            llvmArgIndex,
            name: param.name,
        };
    });

    return {
        funcType,
        func,
        funcCallFrameScopeCtx,
        funcScopeCtx,
        funcArgs,
    };
}

export function callFunction(
    ctx: ScopeContext,
    funcType: llvm.FunctionType,
    funcValue: llvm.Value,
    args: llvm.Value[]
) {
    let func: llvm.Function;

    // resolve function pointer
    if (funcValue instanceof llvm.Function) {
        // its pure function
        func = funcValue;
    } else {
        // check if funcValue is pointer to FUNC_OBJECT_TYPE
        const found = ctx.types.find_byName(Types.FUNC_OBJECT_TYPE);
        if (!found) {
            throw new Error(`FUNC_OBJECT_TYPE not found; call createFunctionObjectType`);
        }

        // unref all pointer types to compare with FUNC_OBJECT_TYPE
        let valueType = funcValue.getType();
        try {
            while (valueType.isPointerTy()) valueType = valueType.getPointerElementType();
        } catch {}

        if (llvm.Type.isSameType(found.typeMeta.llvmType, valueType)) {
            // funcValue is FunctionObject
            const { fieldPtr } = found.typeMeta.getField(ctx, funcValue, "funcPtr");
            func = ctx.builder.CreateBitOrPointerCast(fieldPtr, funcType) as llvm.Function;
        } else {
            console.error(valueType);
            throw new Error(`unknown callee type`);
        }
    }

    const callArgs = [
        // call frame pointer
        // TODO: pass valid object here
        llvm.Constant.getNullValue(ctx.builder.getInt8PtrTy()),

        // other args
        ...args.map((argExp, argi) => {
            const foundTypeId = ctx.types.findObjTypeId_byLLVMType(argExp.getType());
            if (foundTypeId) {
                ctx.types.getByTypeId(foundTypeId).incRefCounter(ctx, argExp);
            }

            // !! only cast structs !!
            const expType = argExp.getType();
            if (foundTypeId || (expType.isPointerTy() && expType.getPointerElementType().isStructTy())) {
                argExp = ctx.builder.CreateBitOrPointerCast(argExp, func.getArg(argi + 1).getType(), `arg${argi}`);
            }
            return argExp;
        }),
    ];

    return ctx.builder.CreateCall(func, callArgs);
}

/** should be one per module */
export function createFunctionObjectType(ctx: ScopeContext) {
    return createObjectType(ctx, Types.FUNC_OBJECT_TYPE, [
        { type: ctx.builder.getInt8PtrTy(), name: "funcPtr" },
        { type: ctx.builder.getInt8PtrTy(), name: "scopeObjPtr" },
        { type: ctx.builder.getInt8PtrTy(), name: "thisObjPtr" },
    ]);
}

export function createFunctionObject(
    ctx: ScopeContext,
    funcName: string | undefined,
    funcCallFrameScopeCtx: ScopeContext,
    func: llvm.Function,
    args: { name: string; type: llvm.Type }[]
) {
    const found = ctx.types.find_byName(Types.FUNC_OBJECT_TYPE);
    if (!found) {
        throw new Error(`FUNC_OBJECT_TYPE not found; call createFunctionObjectType`);
    }
    const { typeMeta } = found;

    const funcObj = typeMeta.create(ctx);
    typeMeta.setField(ctx, funcObj, "funcPtr", func);
    typeMeta.setField(ctx, funcObj, "scopeObjPtr", llvm.Constant.getNullValue(ctx.builder.getInt8PtrTy()));
    typeMeta.setField(ctx, funcObj, "thisObjPtr", llvm.Constant.getNullValue(ctx.builder.getInt8PtrTy()));

    return funcObj;
}

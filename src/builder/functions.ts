import ts from "typescript";
import llvm from "llvm-bindings";
import { findScopeContextByDeclarationId, ScopeContext } from "../context";
import { codeBlock } from "../builder/expressions";
import { resolveTypeByName, resolveTypeFromType, parseTypeNode } from "../builder/types";
import { createObjectType } from "./objects";
import { Types } from "../types";
import { mapSymbolsTable } from "../utils";
import { ContainerNode, StopSymbol, walkUp } from "../ts-utils";
import { getVarsContainer, hasVarsContainer, ScopeObjectVarsContainer } from "./vars";
import { IRObjectInstance, IRValue } from "../ir/value";
import { IRFunc } from "../ir";

export function parseFunctionType(ctx: ScopeContext, node: ts.FunctionLikeDeclaration) {
    const returnType = parseTypeNode(ctx, node.type);
    const paramTypes = node.parameters.map((param) => ({
        name: param.name.getText(),
        type: parseTypeNode(ctx, param.type),
    }));
    const funcType = createFunctionType(ctx, returnType, paramTypes);
    return { funcType, returnType, paramTypes };
}

export function parseFunction(ctx: ScopeContext, node: ts.FunctionLikeDeclaration) {
    const funcName = node.name?.getText() || "func_" + Math.random().toString().replace(".", "_");
    const { funcType, paramTypes } = parseFunctionType(ctx, node);
    if (node.body) {
        const { func, funcScopeCtx } = createFunction(ctx, funcName, funcType, paramTypes, node.parent, node.body);

        let irfunc: IRFunc;
        if (!!ctx.builder.GetInsertBlock()) {
            const { typeMeta: funcObjectTypeMeta, funcObj } = createFunctionObject(
                ctx,
                funcName,
                // TODO: pass funcScopeCtx?
                undefined!,
                func,
                paramTypes
            );
            irfunc = new IRFunc(funcName, func, funcType, funcObj, funcObjectTypeMeta, node, ctx, paramTypes);
        } else {
            irfunc = new IRFunc(funcName, func, funcType, undefined, undefined, node, ctx, paramTypes);
        }

        // we need to assign var before parsing code, coz otherwise no recursion possible
        node.name && ctx.findVarContainer(node.name.getText())?.storeVariable(ctx, node.name.getText(), irfunc);

        for (let i = 0; i < paramTypes.length; ++i) {
            const param = paramTypes[i];
            funcScopeCtx
                .findVarContainer(param.name, { noRecursive: true })
                ?.storeVariable(ctx, param.name, new IRValue(func.getArg(i + 1)));
        }

        codeBlock(funcScopeCtx, node.body, funcName, func, () => {
            funcScopeCtx.deferred_runAndClear();
        });

        return irfunc;
    } else {
        const func = llvm.Function.Create(funcType, llvm.Function.LinkageTypes.ExternalLinkage, funcName, ctx.module);
        const irfunc = new IRFunc(funcName, func, funcType, undefined, undefined, node, ctx, paramTypes);
        node.name && ctx.findVarContainer(node.name.getText())?.storeVariable(ctx, node.name.getText(), irfunc);

        return irfunc;
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

    const returnType = resolveTypeFromType(ctx, tsReturnType);
    const args = tsArgs.map((x) => ({
        type: resolveTypeFromType(ctx, ctx.checker.getTypeOfSymbolAtLocation(x, node)),
    }));

    const funcType = createFunctionType(ctx, returnType, args);
    return funcType;
}

export function createFunction(
    ctx: ScopeContext,
    funcName: string | undefined,
    funcType: llvm.FunctionType,
    args: { name: string; type: llvm.Type }[],
    callFrameScopeNode: ts.Node,
    functionBodyScopeNode: ts.Node
) {
    const func = llvm.Function.Create(funcType, llvm.Function.LinkageTypes.ExternalLinkage, funcName, ctx.module);
    const callFrameObjArg = func.getArg(0);

    const funcScopeCtx = ctx.createChildScope({ tsNode: functionBodyScopeNode });
    funcScopeCtx.hooks = {
        varNotFound: (ctx, name) => {
            // const foundParent = ctx.parentScope?.findScopeValue(name);
            // // pass functions as global
            // if (foundParent && foundParent instanceof llvm.Function) {
            //     return foundParent;
            // }

            // const scope = findScopeContextByDeclarationId(ctx, name.toString());
            // if (!scope) {
            //     console.error(name);
            //     throw new Error(`scope with declaration not found`);
            // }
            // if (!scope._scopeObject) {
            //     console.error(name, scope);
            //     throw new Error(`scope without scope object`);
            // }

            // // walk N times up _scopeObject.parent
            // // same N times that we walk when searching for declarartion

            // const callFrameObj = ctx.types.getByTypeId(scope._scopeObject.typeId);
            // const { fieldPtr } = callFrameObj.getField(ctx, callFrameObjArg, name as string);
            // ctx.setScopeValue(name, fieldPtr);
            // return fieldPtr;

            return undefined!;
        },
    };

    const funcArgs = args.map((param, argi) => {
        const llvmArgIndex = argi + 1;
        // +1 because arg0 is callframe
        const funcArg = func.getArg(llvmArgIndex);
        // funcScopeCtx.findVarContainer(param.name).setScopeValue(param.name, funcArg);

        const found = funcScopeCtx.types.findObjTypeId_byLLVMType(param.type);
        if (found) {
            funcScopeCtx.deferred_push((ctx) => {
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
    // coz there are no other way to get arg types from llvm.FunctionType
    const tempFuncForArgs = llvm.Function.Create(funcType, llvm.Function.LinkageTypes.PrivateLinkage);
    let func: llvm.Value;
    let scopeObject: IRObjectInstance | undefined = undefined;

    // resolve function pointer
    if (funcValue instanceof llvm.Function) {
        // its pure function
        func = funcValue;
    } else {
        walkUp(ctx.tsNode!, (x) => {
            const vc = getVarsContainer(ctx, x);
            if (vc && vc instanceof ScopeObjectVarsContainer) {
                scopeObject = vc.scopeObject;
                return StopSymbol;
            }
        });

        if (!scopeObject) {
            throw new Error(`failed pick scope object for function call`);
        }

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
            const funcPtr = ctx.builder.CreateLoad(fieldPtr.getType().getPointerElementType(), fieldPtr, "funcPtr");
            func = ctx.builder.CreateBitOrPointerCast(funcPtr, funcType, "funcPtrCasted");
        } else {
            console.error(valueType);
            throw new Error(`unknown callee type`);
        }
    }

    const nullptr = ctx.null_i8ptr();

    const callArgs = [
        // call frame pointer
        // TODO: pass valid object here
        scopeObject || nullptr,

        // other args
        ...args.map((argExp, argi) => {
            const foundTypeId = ctx.types.findObjTypeId_byLLVMType(argExp.getType());
            if (foundTypeId) {
                ctx.types.getByTypeId(foundTypeId).incRefCounter(ctx, argExp);
            }

            // !! only cast structs !!
            const expType = argExp.getType();
            if (foundTypeId || (expType.isPointerTy() && expType.getPointerElementType().isStructTy())) {
                argExp = ctx.builder.CreateBitOrPointerCast(
                    argExp,
                    tempFuncForArgs.getArg(argi + 1).getType(),
                    `arg${argi}`
                );
            }
            return argExp;
        }),
    ];

    // tempFuncForArgs.removeFromParent();
    // tempFuncForArgs.deleteValue();

    if (callArgs[0] === nullptr) {
        return ctx.builder.CreateCall(func as llvm.Function, callArgs);
    }
    return ctx.builder.CreateCall(funcType, func, callArgs);
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

    const funcPtr = ctx.builder.CreateBitOrPointerCast(func, ctx.builder.getInt8PtrTy());

    typeMeta.setField(ctx, funcObj, "funcPtr", funcPtr);
    typeMeta.setField(ctx, funcObj, "scopeObjPtr", ctx.null_i8ptr());
    typeMeta.setField(ctx, funcObj, "thisObjPtr", ctx.null_i8ptr());

    return { funcObj, typeMeta };
}

export function createCodeBlockScopeObject(
    ctx: ScopeContext,
    container: ContainerNode,
    parentScopeObjectPtr: llvm.Value
) {
    const { typeId, typeMeta } = createObjectType(ctx, undefined, [
        {
            name: Types.CODEBLOCK_SCOPE_OBJECT_PARENT_FIELD,
            type: parentScopeObjectPtr.getType(),
        },
        ...(container.locals
            ? mapSymbolsTable<{ type: llvm.Type; name: string }>(container.locals, (symb, key) => {
                  const tsType = ctx.checker.getTypeOfSymbolAtLocation(symb, symb.valueDeclaration!);
                  const t = resolveTypeFromType(ctx, tsType);
                  const typeName = ctx.checker.typeToString(tsType);
                  if (!t) {
                      console.error(symb);
                      throw new Error(`failed find type by name ${typeName}`);
                  }
                  return {
                      type: t,
                      name: key.toString(),
                  };
              })
            : []),
    ]);

    return { typeId, typeMeta };
}

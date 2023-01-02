import ts from "typescript";
import llvm from "llvm-bindings";
import { findScopeContextByDeclarationId, DeclScope } from "../context";
import { funcBodyCodeBlock } from "../builder/expressions";
import { resolveTypeByName, resolveTypeFromType, parseTypeNode } from "../builder/types";
import { mapSymbolsTable, nextUUID } from "../utils";
import { ContainerNode, isContainerNode, StopSymbol, walkNodeTree, walkUp } from "../ts-utils";
import { CombileVarsContainer, DictVarsContainer, ReferencedVarsContainer, ScopeObjectVarsContainer } from "./vars";
import { IRFuncValue, _setIRFuncToNode } from "../ir/func";
import { MetaFuncObjectType, MetaScopeObjectType } from "../llvm-meta-cache/obj";
import { createStructTypeForMeta, isPointerTy, isStructTy, LLVMBuilder, LLVMModule } from "../ir/builder";

export function parseFunctionType(ctx: DeclScope, node: ts.FunctionLikeDeclaration) {
    const returnType = parseTypeNode(ctx, node.type);
    const paramTypes = node.parameters.map((param) => ({
        name: param.name.getText(),
        type: parseTypeNode(ctx, param.type),
    }));
    const funcType = createFunctionType(ctx.m, returnType, paramTypes);
    return { funcType, returnType, paramTypes };
}

export function parseFunction(ctx: DeclScope, node: ts.FunctionLikeDeclaration) {
    const funcName = node.name?.getText() || nextUUID("func");
    const { funcType, paramTypes } = parseFunctionType(ctx, node);

    const { func, funcArgs } = createFunction(ctx, funcName, funcType, paramTypes);
    const irfunc = new IRFuncValue(funcName, func, funcArgs, ctx, paramTypes);
    _setIRFuncToNode(node, irfunc);

    if (node.body) {
        funcBodyCodeBlock(ctx, node.body, funcName, irfunc);
    }
    return irfunc;
}

export function createFunctionType(m: LLVMModule, returnType: llvm.Type, args: { type: llvm.Type }[]) {
    const paramTypes = [
        // call frame object pointer
        m.c.i8ptrTy,
        // args
        ...args.map((x) => {
            try {
                if (x.type.isStructTy()) {
                    return llvm.PointerType.getUnqual(x.type);
                }
            } catch {}
            return x.type;
        }),
    ];
    const functionType = llvm.FunctionType.get(returnType, paramTypes, false);
    return functionType;
}

export function parseFunctionTypeFromSignature(ctx: DeclScope, signature: ts.Signature) {
    const tsReturnType = signature.getReturnType();
    const tsArgs = signature.getParameters();

    const returnType = resolveTypeFromType(ctx, tsReturnType);
    const args = tsArgs.map((x) => ({
        type: resolveTypeFromType(ctx, ctx.checker.getTypeOfSymbolAtLocation(x, x.getDeclarations()?.[0]!)),
    }));

    const funcType = createFunctionType(ctx.m, returnType, args);
    return funcType;
}

export function parseFunctionTypeFromCallLikeExpr(ctx: DeclScope, node: ts.CallLikeExpression) {
    const signature = ctx.checker.getResolvedSignature(node)!;
    const tsReturnType = signature.getReturnType();
    const tsArgs = signature.getParameters();

    const returnType = resolveTypeFromType(ctx, tsReturnType);
    const args = tsArgs.map((x) => ({
        type: resolveTypeFromType(ctx, ctx.checker.getTypeOfSymbolAtLocation(x, node)),
    }));

    const funcType = createFunctionType(ctx.m, returnType, args);
    return funcType;
}

export function createFunction(
    ctx: DeclScope,
    funcName: string | undefined,
    funcType: llvm.FunctionType,
    args: { name: string; type: llvm.Type }[]
) {
    const func = llvm.Function.Create(funcType, llvm.Function.LinkageTypes.ExternalLinkage, funcName, ctx.m);

    const isGlobalDeclFunc = !ctx.parentScope;
    let boundScopeObject = undefined;

    if (!isGlobalDeclFunc) {
        boundScopeObject = func.getArg(0);
    }

    const funcArgs = args.map((param, argi) => {
        const llvmArgIndex = argi + 1;
        // +1 because arg0 is callframe
        const funcArg = func.getArg(llvmArgIndex);

        return {
            arg: funcArg,
            llvmArgIndex,
            name: param.name,
        };
    });

    return {
        funcType,
        func,
        funcArgs,
    };
}

/** should be one per module */
export function createFunctionObjectType(
    b: LLVMBuilder,
    name: string | symbol | undefined,
    funcType: llvm.FunctionType,
    scopeObject: { meta: MetaScopeObjectType; type: llvm.Type } | undefined
) {
    const meta = new MetaFuncObjectType(b.c, name || nextUUID("funcObjType"), scopeObject?.meta, [
        { type: funcType, name: MetaFuncObjectType.funcPtrField },
        {
            type: scopeObject?.type ? b.createPointerToType(scopeObject.type) : b.c.i8ptrTy,
            name: MetaFuncObjectType.scopeObjPtrField,
        },
        { type: b.c.i8ptrTy, name: MetaFuncObjectType.thisObjPtrField },
    ]);

    const type = createStructTypeForMeta(b.c, meta);

    return { meta, type };
}

export function createFunctionObject(
    b: LLVMBuilder,
    funcName: string | undefined,
    scopeObject: { meta: MetaScopeObjectType; type: llvm.Type; ptr: llvm.Value } | undefined,
    func: llvm.Function
) {
    const funcObjTy = createFunctionObjectType(b, funcName, func.getFunctionType(), scopeObject);
    const funcObjPtr = b.createHeapVariable(funcObjTy.type, "funcObj");

    const funcPtrF = b.createPointerToField(funcObjPtr, [MetaFuncObjectType.funcPtrField]);
    b.createStore(funcPtrF, func);

    const scopeObjF = b.createPointerToField(funcObjPtr, [MetaFuncObjectType.scopeObjPtrField]);
    b.createStore(scopeObjF, scopeObject?.ptr || b.null_i8ptr());

    const thisF = b.createPointerToField(funcObjPtr, [MetaFuncObjectType.thisObjPtrField]);
    b.createStore(thisF, b.null_i8ptr());

    return {
        funcObjTy,
        funcObjPtr,
    };
}

export function createScopeObjectType(
    ctx: DeclScope,
    container: ContainerNode,
    parentScopeType: MetaScopeObjectType | undefined
) {
    const meta = new MetaScopeObjectType(ctx.c, "scopeObject", parentScopeType, [
        ...(container.locals
            ? mapSymbolsTable<{ type: llvm.Type; name: string }>(container.locals, (symb, key) => {
                  const tsType = ctx.checker.getTypeOfSymbolAtLocation(symb, symb.valueDeclaration!);
                  if (tsType.getCallSignatures().length !== 0) {
                      return {
                          name: key.toString(),
                          type: ctx.c.i8ptrTy,
                      };
                  }
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
    const type = createStructTypeForMeta(ctx.c, meta);
    return { type, meta };
}

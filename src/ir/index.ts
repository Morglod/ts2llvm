import ts from "typescript";
import { callFunction, parseFunction } from "../builder/functions";
import { ScopeContext } from "../context";
import { ObjTypeDesc } from "../types";
import { AnyIRValue, IRInstruction } from "./value";

export class IRFunc extends AnyIRValue {
    constructor(
        public readonly tsName: string | undefined,

        public readonly func: llvm.Function,
        public readonly funcType: llvm.FunctionType,

        public readonly boundScopeObject: llvm.Value | undefined,
        public readonly boundScopeObjectTypeDesc: ObjTypeDesc | undefined,

        public readonly node: ts.Node,
        public readonly originCtx: ScopeContext,

        public readonly paramTypes: {
            name: string;
            type: llvm.Type;
        }[]
    ) {
        super();
    }

    getValueLLVM(): llvm.Value {
        return this.func;
    }

    createCastBoundScopeObjectToI8Ptr(ctx: ScopeContext) {
        if (this.boundScopeObject) {
            return ctx.builder.CreateBitOrPointerCast(this.boundScopeObject, ctx.builder.getInt8PtrTy());
        }
        return ctx.null_i8ptr();
    }

    // TODO: helpers here

    createCallLLVM(ctx: ScopeContext, args: AnyIRValue[]) {
        if (this.boundScopeObject && ctx !== this.originCtx) {
            console.log(this);
            console.warn(`probably wrong call context`);
        }
        return new IRInstruction(
            ctx.builder.CreateCall(this.func, [
                this.createCastBoundScopeObjectToI8Ptr(ctx),
                ...args.map((x) => x.getValueLLVM()),
            ])
        );
    }

    static createCall(ctx: ScopeContext, funcType: llvm.FunctionType, callee: AnyIRValue, args: AnyIRValue[]) {
        if (callee instanceof IRFunc) {
            return callee.createCallLLVM(ctx, args);
        }
        return new IRInstruction(
            callFunction(
                ctx,
                funcType,
                callee.getValueLLVM(),
                args.map((x) => x.getValueLLVM())
            )
        );
    }
}

const irFuncSymb = Symbol("IRFunc");

/** use resolveIRFunc instead !! */
function _getIRFuncFromNode(node: ts.FunctionLikeDeclaration): IRFunc | undefined {
    return (node as any)[irFuncSymb];
}

function _setIRFuncToNode(node: ts.FunctionLikeDeclaration, pf: IRFunc) {
    (node as any)[irFuncSymb] = pf;
}

export function resolveIRFunc(ctx: ScopeContext, node: ts.FunctionLikeDeclaration): IRFunc {
    {
        const x = _getIRFuncFromNode(node);
        if (x) return x;
    }

    const tsName = node.name?.getText();
    const { func, funcType, paramTypes } = parseFunction(ctx, node);

    const irfunc = new IRFunc(tsName, func, funcType, undefined, undefined, node, ctx, paramTypes);
    _setIRFuncToNode(node, irfunc);

    return irfunc;
}

export function isFunctionLikeDeclaration(node: ts.Node): node is ts.FunctionLikeDeclaration {
    return (
        ts.isArrowFunction(node) ||
        ts.isFunctionExpression(node) ||
        ts.isFunctionDeclaration(node) ||
        ts.isMethodDeclaration(node) ||
        ts.isGetAccessorDeclaration(node) ||
        ts.isSetAccessorDeclaration(node) ||
        ts.isConstructorDeclaration(node)
    );
}

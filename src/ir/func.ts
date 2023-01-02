import ts from "typescript";
import { parseFunction } from "../builder/functions";
import { IVarsContainer } from "../builder/vars";
import { DeclScope } from "../context";
import { MetaScopeObjectType } from "../llvm-meta-cache/obj";

const irFuncSymb = Symbol("IRFunc");

export class IRFuncValue {
    constructor(
        public readonly tsName: string | undefined,

        public readonly funcLLVM: llvm.Function,

        public readonly funcArgs: {
            arg: llvm.Argument;
            llvmArgIndex: number;
            name: string;
        }[],

        public readonly originCtx: DeclScope | undefined,

        public readonly paramTypes: {
            name: string;
            type: llvm.Type;
        }[]
    ) {}
}

/** use resolveIRFunc instead !! */
export function getIRFuncFromNode(node: ts.FunctionLikeDeclaration): IRFuncValue | undefined {
    return (node as any)[irFuncSymb];
}

export function _setIRFuncToNode(node: ts.FunctionLikeDeclaration, pf: IRFuncValue) {
    (node as any)[irFuncSymb] = pf;
}

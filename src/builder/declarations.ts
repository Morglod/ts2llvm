import ts from "typescript";
import { DeclScope } from "../context";
import { IRFuncValue } from "../ir/func";
import { debugTypeLLVM } from "../llvm-meta-cache/types-meta-cache";
import { assignObjLiteralExpression, rhsExpression } from "./expressions";
import { parseFunction } from "./functions";
import { parseTypeNode } from "./types";

export function parseDeclaration(ctx: DeclScope, node: ts.Node) {
    if (ts.isFunctionDeclaration(node)) {
        const func = parseFunction(ctx, node);
        return func;
    }

    if (ts.isTypeAliasDeclaration(node)) {
        const typeName = node.name.getText();
        const t = parseTypeNode(ctx, node.type, typeName);
        ctx.setScopeType(typeName, t);
        // TODO: scope our types not just llvm
        return t;
    }

    if (ts.isVariableStatement(node)) {
        for (const declNode of node.declarationList.declarations) {
            const varName = declNode.name.getText();

            // TODO: (1) temp constant builtin names; remove this later
            const builtins = ["_i32_symbol", "_i8_symbol", "_i8ptr_symbol", "i32", "i8", "i8ptr"];
            if (builtins.includes(varName)) {
                return ctx.c.voidTy;
            }

            if (declNode.initializer) {
                const tsType = declNode.type
                    ? ctx.checker.getTypeFromTypeNode(declNode.type)
                    : ctx.checker.getTypeAtLocation(declNode);
                const varPtr = ctx.createVarPtr(varName);

                if (ts.isObjectLiteralExpression(declNode.initializer)) {
                    const node = declNode.initializer;
                    assignObjLiteralExpression(ctx, varPtr, node);
                } else {
                    const expr = rhsExpression(ctx, declNode.initializer, tsType);
                    if (expr instanceof IRFuncValue) {
                        // TODO
                        throw new Error("qwe");
                    }

                    ctx.b.createStore(varPtr, expr);
                }
                return varPtr;
            } else {
                throw new Error(`declaration without .initializer not yet supported`);
                // ctx.setScopeValue(varName, undefined);
            }
        }
    }

    return undefined;
}

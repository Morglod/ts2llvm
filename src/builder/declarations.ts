import ts from "typescript";
import { ScopeContext } from "../context";
import { rhsExpression } from "./expressions";
import { parseFunction } from "./functions";
import { parseTypeNode } from "./types";

export function parseDeclaration(ctx: ScopeContext, node: ts.Node) {
    if (ts.isFunctionDeclaration(node)) {
        const func = parseFunction(ctx, node);
        node.name && ctx.setScopeValue(node.name.getText(), func);
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
                return ctx.builder.getVoidTy();
            }

            if (declNode.initializer) {
                const tsType = declNode.type
                    ? ctx.checker.getTypeFromTypeNode(declNode.type)
                    : ctx.checker.getTypeAtLocation(declNode);

                const expr = rhsExpression(ctx, declNode.initializer, tsType);
                try {
                    expr.setName(varName);
                } catch {}

                ctx.setScopeValue(varName, expr);
                return expr;
            } else {
                throw new Error(`declaration without .initializer not yet supported`);
                // ctx.setScopeValue(varName, undefined);
            }
        }
    }

    return undefined;
}

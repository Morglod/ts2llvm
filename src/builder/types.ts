import ts from "typescript";
import llvm from "llvm-bindings";
import { ScopeContext } from "../context";
import { createObjectType } from "./objects";
import { filterUndefined } from "../utils";

export function parseTypeNode(ctx: ScopeContext, node: ts.TypeNode | undefined, name: string | undefined = undefined) {
    if (node === undefined) return ctx.builder.getVoidTy();

    const typeName = node.getText();

    const byName = findTypeByName(ctx, typeName);
    if (byName) return byName;

    if (ts.isTypeLiteralNode(node)) {
        const fields = filterUndefined(
            node.members
                .map((m) => {
                    if (ts.isPropertySignature(m)) {
                        return {
                            type: parseTypeNode(ctx, m.type),
                            name: m.name.getText(),
                        };
                    }
                })
                .filter(Boolean)
        );

        const tsType = ctx.checker.getTypeFromTypeNode(node);
        const objt = createObjectType(ctx, name, fields);
        objt.typeMeta.tsType = tsType;
        return objt.typeMeta.llvmType;
    }

    const found = ctx.findScopeType(node.getText());
    if (found) {
        if (found.isStructTy()) {
            return llvm.PointerType.get(found, 0);
        }
        return found;
    }

    console.error(`cannot resolve llvm type from this; resolving as 'void':`);
    console.error(node.getText() + "\n");

    return ctx.builder.getVoidTy();
}

export function findTypeByName(ctx: ScopeContext, name: string): llvm.Type | undefined {
    if (name === "number") {
        return ctx.builder.getDoubleTy();
    }
    if (name === "void") {
        return ctx.builder.getVoidTy();
    }
    if (name === "string") {
        return ctx.builder.getInt8PtrTy();
    }
    if (name === "i32") {
        return ctx.builder.getInt32Ty();
    }
    if (name === "i8") {
        return ctx.builder.getInt8Ty();
    }
    if (name === "i8ptr") {
        return ctx.builder.getInt8PtrTy();
    }
    if (name === "never") {
        console.warn("something goes wrong if we trying to get type for 'never'");
        return ctx.builder.getVoidTy();
    }
    if (name === "boolean") {
        return ctx.builder.getInt1Ty();
    }
    if (name === "undefined") {
        console.warn("'undefined' type not fully supported");
        return ctx.builder.getInt8PtrTy();
    }
    if (name === "null") {
        console.warn("'null' type not fully supported");
        return ctx.builder.getInt8PtrTy();
    }
    if (name === "any") {
        console.warn("'any' type not supported; resolved as 'void'");
        return ctx.builder.getVoidTy();
    }

    const found = ctx.findScopeType(name);
    if (found) {
        if (found.isStructTy()) {
            return llvm.PointerType.get(found, 0);
        }
        return found;
    }
}

export function findTypeFromType(ctx: ScopeContext, type: ts.Type) {
    const str = ctx.checker.typeToString(type);
    const found = findTypeByName(ctx, str);
    if (!found) {
        console.error(type);
        throw new Error(`failed find llvm type`);
    }
    return found;
}

import ts from "typescript";
import llvm from "llvm-bindings";
import { ScopeContext } from "../context";
import { createObjectType } from "./objects";
import { filterUndefined } from "../utils";

export function parseTypeNode(ctx: ScopeContext, node: ts.TypeNode | undefined, name: string | undefined = undefined) {
    if (node === undefined) return ctx.builder.getVoidTy();

    const typeName = node.getText();

    const byName = resolveTypeByName(ctx, typeName);
    if (byName) return byName;

    if (ts.isTypeLiteralNode(node)) {
        const rslvdType = resolveTypeFromType(ctx, ctx.checker.getTypeFromTypeNode(node));
        if (rslvdType) {
            return rslvdType;
        }
    }

    console.error(`cannot resolve llvm type from this; resolving as 'void':`);
    console.error(node.getText() + "\n");

    return ctx.builder.getVoidTy();
}

export function resolveTypeByName(ctx: ScopeContext, name: string): llvm.Type | undefined {
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
        console.warn("'any' type not supported, resolving as 'void'");
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

export function resolveTypeFromType(ctx: ScopeContext, type: ts.Type): llvm.Type {
    const typeName = type.getSymbol()?.name || ctx.checker.typeToString(type);
    const found = resolveTypeByName(ctx, typeName);
    if (found) return found;

    const props = type.getProperties();
    if (props.length) {
        const fields = filterUndefined(
            props
                .map((m) => {
                    let fieldTsType: ts.Type;
                    if (m.valueDeclaration) fieldTsType = ctx.checker.getTypeAtLocation(m.valueDeclaration);
                    else if (m.declarations && m.declarations.length) {
                        if (m.declarations.length !== 1) {
                            console.error(m);
                            throw new Error(`dont know what to do with 2+ declarations of symbol`);
                        }
                        fieldTsType = ctx.checker.getTypeAtLocation(m.declarations[0]);
                    } else {
                        console.error(m);
                        throw new Error(`dont know how to get type of symbol`);
                    }

                    return {
                        type: resolveTypeFromType(ctx, fieldTsType),
                        name: m.name,
                    };
                })
                .filter(Boolean)
        );

        const objt = createObjectType(ctx, typeName, fields);
        objt.typeMeta.tsType = type;

        ctx.setScopeType(typeName, objt.typeMeta.llvmType);

        return objt.typeMeta.llvmType;
    }

    console.error(type);
    throw new Error(`failed resolve llvm type`);
}

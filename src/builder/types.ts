import ts from "typescript";
import llvm from "llvm-bindings";
import { DeclScope } from "../context";
import { filterUndefined } from "../utils";
import { MetaObjectRcType, MetaStructType } from "../llvm-meta-cache/obj";
import { createStructTypeForMeta, pickStructNameTsType } from "../ir/builder";

export function parseTypeNode(ctx: DeclScope, node: ts.TypeNode | undefined, name: string | undefined = undefined) {
    if (node === undefined) return ctx.c.voidTy;

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

    return ctx.c.voidTy;
}

export function resolveTypeByName(ctx: DeclScope, name: string): llvm.Type | undefined {
    if (name === "__type") {
        throw new Error('resolveTypeByName: could not resolve by name "__type"; handle this case in calling code');
    }
    if (name === "number") {
        return ctx.c.numberTy;
    }
    if (name === "void") {
        return ctx.c.voidTy;
    }
    if (name === "string") {
        return ctx.c.i8ptrTy;
    }
    if (name === "i32") {
        return ctx.c.i32Ty;
    }
    if (name === "i8") {
        return ctx.c.i8Ty;
    }
    if (name === "i8ptr") {
        return ctx.c.i8ptrTy;
    }
    if (name === "never") {
        console.warn("something goes wrong if we trying to get type for 'never'");
        return ctx.c.voidTy;
    }
    if (name === "boolean") {
        return ctx.c.booleanTy;
    }
    if (name === "undefined") {
        console.warn("'undefined' type not fully supported");
        return ctx.c.i8ptrTy;
    }
    if (name === "null") {
        console.warn("'null' type not fully supported");
        return ctx.c.i8ptrTy;
    }
    if (name === "any") {
        console.warn("'any' type not supported, resolving as 'void'");
        return ctx.c.voidTy;
    }

    const found = ctx.findScopeType(name);
    if (found) {
        return found;
    }
}

const CACHED_TYPE = Symbol("cachedLLVMType");

export function resolveTypeFromType(ctx: DeclScope, type: ts.Type): llvm.Type {
    if ((type as any)[CACHED_TYPE]) {
        return (type as any)[CACHED_TYPE];
    }

    const typeName = type.getSymbol()?.name || ctx.checker.typeToString(type);

    if (typeName !== "__type") {
        const found = resolveTypeByName(ctx, typeName);
        if (found) {
            (type as any)[CACHED_TYPE] = found;
            return found;
        }
    }

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

        const metaStruct = new MetaObjectRcType(ctx.c, pickStructNameTsType(type), fields);
        const objt = createStructTypeForMeta(ctx.c, metaStruct);

        // TODO: assign objt to type[llvmTypeSymbol]
        // type[llvmTypeSymbol] = objt;

        ctx.setScopeType(typeName, objt);

        (type as any)[CACHED_TYPE] = objt;
        return objt;
    }

    if (type.getCallSignatures().length !== 0) {
        console.error(type);
        throw new Error(`failed resolve function type`);
        // return parseFunctionTypeFromSignature(ctx, type.getCallSignatures()[0]);
    }

    console.error(type);
    throw new Error(`failed resolve llvm type`);
}

import ts from "typescript";
import llvm from "llvm-bindings";
import { ScopeContext } from "./context";

export type ObjTypeFieldDesc = {
    type: llvm.Type;
    name: string | number | symbol;
    structIndex: number;
};

export type ObjTypeDesc = {
    name: string | symbol | undefined;
    llvmType: llvm.Type;
    tsType: ts.Type | undefined;
    create: (ctx: ScopeContext) => llvm.Value;
    incRefCounter: (ctx: ScopeContext, obj: llvm.Value) => void;
    decRefCounter: (ctx: ScopeContext, obj: llvm.Value) => void;
    getField: (
        ctx: ScopeContext,
        obj: llvm.Value,
        field: string | number | symbol
    ) => { fieldPtr: llvm.Value; fieldDesc: ObjTypeFieldDesc };
    setField: (ctx: ScopeContext, obj: llvm.Value, field: string | number | symbol, newValue: llvm.Value) => void;
    fields: {
        type: llvm.Type;
        name: string | number | symbol;
        structIndex: number;
    }[];
};

export class Types {
    typeIdCounter = 1;

    static FUNC_OBJECT_TYPE = Symbol("FUNC_OBJECT_TYPE");

    // typeId -> desc
    private objTypes: Record<number, ObjTypeDesc> = {};

    getByTypeId(typeId: number): ObjTypeDesc {
        const found = this.objTypes[typeId];
        if (!found) {
            throw new Error(`typeId "${typeId}" not found`);
        }
        return found;
    }

    allocType(): { typeMeta: ObjTypeDesc; typeId: number } {
        const typeId = ++this.typeIdCounter;
        this.objTypes[typeId] = {} as any;
        const typeMeta = this.objTypes[typeId];
        return { typeMeta, typeId };
    }

    findObjTypeId_byLLVMType(llvmType: llvm.Type) {
        try {
            while (llvmType.isPointerTy()) llvmType = llvmType.getPointerElementType();
        } catch {}

        for (const typeId in this.objTypes) {
            if (llvm.Type.isSameType(this.objTypes[typeId].llvmType, llvmType)) {
                return +typeId;
            }
        }
        return null;
    }

    findObjTypeId_byTsType(tsType: ts.Type) {
        for (const typeId in this.objTypes) {
            if (this.objTypes[typeId].tsType?.getSymbol() === tsType.getSymbol() && tsType.getSymbol() !== undefined) {
                return +typeId;
            }
        }
        return null;
    }

    find_byName(name: string | symbol) {
        for (const typeId in this.objTypes) {
            if (this.objTypes[typeId].name === name) {
                return { typeId: +typeId, typeMeta: this.objTypes[typeId] };
            }
        }
        return null;
    }
}

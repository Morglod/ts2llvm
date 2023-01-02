import llvm from "llvm-bindings";
import { LLVMContext } from "../builtin/llvm-context";
import { LLVMBuilder } from "../ir/builder";

type MetaStructType_Field_Initial = {
    type: llvm.Type;
    name: string | symbol;
};

function sortFieldsInplace<T extends { name: string | symbol }>(fields: T[]): T[] {
    return fields.sort((a, b) => {
        if (typeof a.name === "string" && typeof b.name === "string") {
            return a.name.localeCompare(b.name);
        }
        if (typeof a === "symbol") return 1;
        return -1;
    });
}

export type MetaStructType_Field = MetaStructType_Field_Initial & {
    structIndex: number;
};

export class MetaStructType {
    static structIdField = Symbol("structId");
    private static structIdCounter = 1;

    readonly structId = ++MetaStructType.structIdCounter;

    fields: MetaStructType_Field[] = [];

    hasField(name: string | symbol) {
        return this.fields.some((x) => x.name === name);
    }

    getField(name: string | symbol) {
        return this.fields.find((x) => x.name === name);
    }

    getFieldOrThrow(name: string | symbol): MetaStructType_Field {
        const f = this.fields.find((x) => x.name === name);
        if (!f) throw new Error(`field should exist ${name.toString()}`);
        return f;
    }

    createInitVariable(b: LLVMBuilder, type: llvm.Type, valuePtr: llvm.Value) {
        const structIdPtr = b.createPointerToField(valuePtr, [MetaStructType.structIdField]);
        b.createStore(structIdPtr, b.const_i32(this.structId));
    }

    constructor(c: LLVMContext, public readonly name: string | symbol, fieldsInit: MetaStructType_Field_Initial[]) {
        this.fields = sortFieldsInplace([...fieldsInit]).map((x, i) => ({
            name: x.name,
            type: x.type,
            structIndex: i + 1,
        }));

        this.fields.unshift({
            name: MetaStructType.structIdField,
            type: c.i32Ty,
            structIndex: 0,
        });
    }
}

export class MetaObjectRcType extends MetaStructType {
    static refCounterField = Symbol("refCounter");

    createInitVariable(b: LLVMBuilder, type: llvm.Type, valuePtr: llvm.Value) {
        super.createInitVariable(b, type, valuePtr);

        const refCounterPtr = b.createPointerToField(valuePtr, [MetaObjectRcType.refCounterField]);
        b.createStore(refCounterPtr, b.const_i16(1));
    }

    constructor(c: LLVMContext, name: string | symbol, fields: MetaStructType_Field_Initial[]) {
        super(c, name, [
            {
                name: MetaObjectRcType.refCounterField,
                type: c.i16Ty,
            },
            ...fields,
        ]);
    }
}

export class MetaFuncObjectType extends MetaObjectRcType {
    static funcPtrField = Symbol("funcPtr");
    static scopeObjPtrField = Symbol("scopeObj");
    static thisObjPtrField = Symbol("thisPtr");

    scopeObjectType: MetaScopeObjectType | undefined;

    constructor(
        c: LLVMContext,
        name: string | symbol,
        scopeObjectType: MetaScopeObjectType | undefined,
        fields: MetaStructType_Field_Initial[]
    ) {
        super(c, name, [
            {
                name: MetaFuncObjectType.funcPtrField,
                type: c.anyptrTy,
            },
            {
                name: MetaFuncObjectType.scopeObjPtrField,
                type: c.anyptrTy,
            },
            ...fields,
        ]);

        this.scopeObjectType = scopeObjectType;
    }
}

export class MetaScopeObjectType extends MetaObjectRcType {
    static parentScopeField = Symbol("parentScope");

    parentScopeType: MetaScopeObjectType | undefined;

    constructor(
        c: LLVMContext,
        name: string | symbol,
        parentScopeType: MetaScopeObjectType | undefined,
        fields: MetaStructType_Field_Initial[]
    ) {
        super(c, name, [
            {
                name: MetaScopeObjectType.parentScopeField,
                type: c.anyptrTy,
            },
            ...fields,
        ]);

        this.parentScopeType = parentScopeType;
    }
}

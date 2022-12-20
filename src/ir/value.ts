import { ScopeContext } from "../context";
import { ObjTypeDesc, ObjTypeFieldDesc } from "../types";

export abstract class AnyIRValue {
    abstract getValueLLVM(): llvm.Value;
}

export class IRInstruction extends AnyIRValue {
    constructor(public readonly v: llvm.Value) {
        super();
    }

    getValueLLVM(): llvm.Value {
        return this.v;
    }
}

export class IRValue extends AnyIRValue {
    constructor(public readonly valueLLVM: llvm.Value) {
        super();
    }

    getValueLLVM(): llvm.Value {
        return this.valueLLVM;
    }
}

export class IRValuePtr extends AnyIRValue {
    static null_i8ptr(ctx: ScopeContext) {
        return new IRValuePtr(ctx.null_i8ptr());
    }

    constructor(public readonly valuePtrLLVM: llvm.Value) {
        super();
    }

    getValueLLVM(): llvm.Value {
        return this.valuePtrLLVM;
    }

    createLoad(ctx: ScopeContext): AnyIRValue {
        return new IRValue(
            ctx.builder.CreateLoad(this.valuePtrLLVM.getType().getPointerElementType(), this.valuePtrLLVM)
        );
    }

    createStore(ctx: ScopeContext, newValue: AnyIRValue) {
        return new IRInstruction(ctx.builder.CreateStore(newValue.getValueLLVM(), this.valuePtrLLVM));
    }
}

export class IRObjectInstance extends AnyIRValue {
    constructor(public readonly objectPtr: llvm.Value, public readonly objectDesc: ObjTypeDesc) {
        super();
    }

    getValueLLVM(): llvm.Value {
        return this.objectPtr;
    }

    hasVariable(name: string | symbol): boolean {
        return !!this.objectDesc.fields.find((x) => x.name === name);
    }

    createVariablePtr(ctx: ScopeContext, name: string | symbol): IRObjectFieldPtr {
        const { fieldDesc, fieldPtr } = this.objectDesc.getField(ctx, this.objectPtr, name);
        return new IRObjectFieldPtr(fieldPtr, fieldDesc);
    }

    loadVariable(ctx: ScopeContext, name: string | symbol): AnyIRValue {
        const ptr = this.createVariablePtr(ctx, name);
        return ptr.createLoad(ctx);
    }

    storeVariable(ctx: ScopeContext, name: string | symbol, newValue: AnyIRValue): void {
        this.objectDesc.setField(ctx, this.objectPtr, name, newValue.getValueLLVM());
    }
}

export class IRObjectFieldPtr extends IRValuePtr {
    constructor(public readonly fieldPtr: llvm.Value, public readonly fieldDesc: ObjTypeFieldDesc) {
        super(fieldPtr);
    }
}

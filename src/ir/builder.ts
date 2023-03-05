import llvm from "llvm-bindings";
import ts from "typescript";
import { resolveTypeFromType } from "../builder/types";
import { createVarsContainer, ReferencedVarsContainer, ScopeObjectVarsContainer } from "../builder/vars";
import { createGcMarkRelease } from "../builtin/gc";
import { LLVMContext } from "../builtin/llvm-context";
import { createMalloc } from "../builtin/memory";
import { DeclScope, ModuleEntryPoint } from "../context";
import { MetaObjectRcType, MetaStructType, MetaStructType_Field } from "../llvm-meta-cache/obj";
import {
    debugTypeLLVM,
    getTypeMeta,
    getTypeMetaExact,
    getTypeMetaExactOrThrow,
    setTypeMeta,
} from "../llvm-meta-cache/types-meta-cache";
import { hasNameIdentifier } from "../ts-utils";
import { nameToStr, nextUUID } from "../utils";
import { IRFuncValue } from "./func";

export class LLVMModule extends llvm.Module {
    constructor(moduleID: string, public readonly c: LLVMContext) {
        super(moduleID, c);

        this.mallocFunc = createMalloc(this);
        this.gcMarkReleaseFunc = createGcMarkRelease(this);
    }

    /** initialized after LLVMBuilder init */
    entryPoint!: ModuleEntryPoint;

    mallocFunc: IRFuncValue;
    gcMarkReleaseFunc: IRFuncValue;
}

export class LLVMBuilder {
    readonly b: llvm.IRBuilder;
    readonly c: LLVMContext;

    constructor(public readonly m: LLVMModule) {
        this.c = m.c;
        this.b = new llvm.IRBuilder(m.c);
    }

    const_iN(t: llvm.Type, value: number) {
        return llvm.ConstantInt.get(t, value);
    }

    const_i16(value: number) {
        return this.const_iN(this.c.i16Ty, value);
    }

    const_i32(value: number) {
        return this.const_iN(this.c.i32Ty, value);
    }

    null_i8ptr() {
        return llvm.ConstantPointerNull.get(this.c.i8ptrTy);
    }

    createPointerToType(t: llvm.Type) {
        return llvm.PointerType.getUnqual(t);
    }

    private createInitVariable(type: llvm.Type, valuePtr: llvm.Value) {
        const typeMeta = getTypeMeta(type);
        if (typeMeta instanceof MetaStructType) {
            typeMeta.createInitVariable(this, type, valuePtr);
        }
    }

    createStackVariable(type: llvm.Type, name?: string) {
        const v = this.b.CreateAlloca(type, null, "var_" + name);
        this.createInitVariable(type, v);
        return v;
    }

    createHeapVariable(type: llvm.Type, name: string) {
        const ptrType = this.createPointerToType(type);
        const typeAllocSize = getTypeAllocSize(this.m, type);
        const memPtr = this.createCall(
            this.m.mallocFunc,
            [this.const_i32(typeAllocSize)],
            "mem_var_" + name || "mem_var"
        );
        const castedPtr = this.b.CreatePointerCast(memPtr, ptrType, "var_" + name || "var");
        this.createInitVariable(type, castedPtr);
        return castedPtr;
    }

    createGlobalStringPtr(value: string) {
        return this.b.CreateGlobalStringPtr(value);
    }

    createStore(dstPtr: llvm.Value, valueToStore: llvm.Value) {
        assertPtrLLVM(dstPtr);
        return this.b.CreateStore(valueToStore, dstPtr);
    }

    createLoad(fromPtr: llvm.Value) {
        const ptrType = fromPtr.getType();
        assertPtrLLVM(fromPtr, ptrType);
        return this.b.CreateLoad(ptrType.getPointerElementType(), fromPtr);
    }

    createCall(func: IRFuncValue, args: llvm.Value[], name?: string) {
        // if (func.boundScopeObject && ctx !== func.originCtx) {
        //     console.log(func);
        //     console.warn(`probably wrong call context`);
        // }

        const callArgs: llvm.Value[] = [
            // TODO: pass scopeObject
            // func.boundScopeObject ? this.moveValueAsArgument(func.boundScopeObject.ptr) : this.null_i8ptr(),
            this.null_i8ptr(),
            ...args.map((x) => {
                return this.moveValueAsArgument(x);
            }),
        ];

        return this.b.CreateCall(func.funcLLVM, callArgs, name || "");
    }

    createPointerToField(objPtr: llvm.Value, fieldsIdx: (string | symbol)[]) {
        assertPtrLLVM(objPtr);
        if (fieldsIdx.length === 0) throw new Error("empty fields");

        const idxs: llvm.Value[] = [
            // deref objPtr pointer
            this.const_i32(0),
        ];

        const objType = objPtr.getType().getPointerElementType();

        if (isPointerTy(objType)) {
            console.error("failed createPointerToField of pointer struct type, deref first: ", debugTypeLLVM(objType));
            throw new Error("smth goes wrong");
        }
        // try {
        //     // objType is dereffed ahead here for 1 iteration
        //     // so objPtr will be always ptr
        //     while (objType.isPointerTy()) {
        //         objPtr = this.createLoad(objPtr);
        //         objType = objPtr.getType().getPointerElementType();
        //     }
        // } catch {}
        const typeMeta = getTypeMetaExactOrThrow(objType, MetaStructType, "metaShouldExist");

        let lastFieldType: llvm.Type | undefined;
        let nextObj: MetaStructType | undefined = typeMeta;
        for (const f of fieldsIdx) {
            if (!nextObj) {
                throw new Error("smth goes wrong");
            }
            const fieldMeta: MetaStructType_Field | undefined = nextObj.getField(f);
            if (!fieldMeta) {
                console.error(`not found field "${f.toString()}"`);
                console.log("in object ", debugTypeLLVM(objType));
                if (lastFieldType) console.log("in object's field ", debugTypeLLVM(lastFieldType));
                debugger;
                throw new Error(`field not found "${f.toString()}"`);
            }
            idxs.push(this.const_i32(fieldMeta.structIndex));
            lastFieldType = fieldMeta.type;

            // TODO: auto deref value here ??
            let fieldType = fieldMeta.type;
            try {
                while (fieldType.isPointerTy()) {
                    idxs.push(this.const_i32(0));
                    fieldType = fieldType.getPointerElementType();
                }
            } catch {}

            nextObj = getTypeMetaExact(fieldMeta.type, MetaStructType);
        }

        const llvmPtr = this.b.CreateGEP(objType, objPtr, idxs);
        return llvmPtr;
    }

    createAddByPtr(valuePtr: llvm.Value, rhsValue: llvm.Value) {
        const lhs = this.createLoad(valuePtr);
        const resultLLVM = this.b.CreateAdd(lhs, rhsValue);
        this.createStore(valuePtr, resultLLVM);
        return resultLLVM;
    }

    createAddByPtr_const(valuePtr: llvm.Value, value: number) {
        const lhs = this.createLoad(valuePtr);
        const valuePtrTy = valuePtr.getType();
        assertPtrLLVM(valuePtr, valuePtrTy);
        const rhsValue = this.const_iN(valuePtrTy.getPointerElementType(), value);
        const resultLLVM = this.b.CreateAdd(lhs, rhsValue);
        this.createStore(valuePtr, resultLLVM);
        return resultLLVM;
    }

    createSubByPtr(valuePtr: llvm.Value, rhsValue: llvm.Value) {
        const lhs = this.createLoad(valuePtr);
        const resultLLVM = this.b.CreateSub(lhs, rhsValue);
        this.b.CreateStore(resultLLVM, valuePtr);
        return resultLLVM;
    }

    createSubByPtr_const(valuePtr: llvm.Value, value: number) {
        const lhs = this.createLoad(valuePtr);
        const valuePtrTy = valuePtr.getType();
        assertPtrLLVM(valuePtr, valuePtrTy);
        const rhsValue = this.const_iN(valuePtrTy.getPointerElementType(), value);
        const resultLLVM = this.b.CreateSub(lhs, rhsValue);
        this.b.CreateStore(resultLLVM, valuePtr);
        return resultLLVM;
    }

    createPointerCast(ptr: llvm.Value, dstElementType: llvm.Type) {
        assertPtrLLVM(ptr);
        const dstPtrType = this.createPointerToType(dstElementType);
        return this.b.CreatePointerCast(ptr, dstPtrType);
    }

    moveValueAsArgument(value: llvm.Value) {
        // we should not care about argument type, coz typescript validated it for us
        // here we could increase ref counter
        const t = derefTypeLLVM(value.getType());
        const rcType = getTypeMetaExact(t, MetaObjectRcType);
        if (rcType) {
            if (!isPointerTy(value.getType())) {
                console.log(this.m.print());
                throw new Error("passing rc object directly");
            }
            const refCounterPtr = this.createPointerToField(value, [MetaObjectRcType.refCounterField]);
            this.createAddByPtr_const(refCounterPtr, 1);
        }

        return value;
    }

    valueEntersScope(ctx: DeclScope, value: llvm.Value) {
        // here we could add defer of decreasing ref counter
        const t = derefTypeLLVM(value.getType());
        const rcType = getTypeMetaExact(t, MetaObjectRcType);
        if (rcType) {
            if (!value.getType().isPointerTy()) throw new Error("passing rc object directly");
            ctx.deferred_push((ctx) => {
                const refCounterPtr = this.createPointerToField(value, [MetaObjectRcType.refCounterField]);
                const newVal = this.createSubByPtr_const(refCounterPtr, 1);

                // TODO: not well tested code

                const parentFunc = ctx.b.b.GetInsertBlock()!.getParent() || undefined;

                const callReleaseBB = llvm.BasicBlock.Create(ctx.c, undefined, parentFunc);
                const thenBB = llvm.BasicBlock.Create(ctx.c, undefined, parentFunc);
                ctx.b.b.CreateCondBr(ctx.b.b.CreateICmpSLE(newVal, this.const_i32(0)), callReleaseBB, thenBB);

                ctx.b.b.SetInsertPoint(callReleaseBB);
                const objVoidPtr = ctx.b.b.CreateBitOrPointerCast(value, ctx.b.b.getInt8PtrTy());
                ctx.b.b.CreateCall(ctx.m.gcMarkReleaseFunc.funcLLVM, [objVoidPtr]);
                ctx.b.b.CreateBr(thenBB);

                ctx.b.b.SetInsertPoint(thenBB);

                // ------ end not tested code ------
            });
        }
    }

    createInitScope(scope: DeclScope, parentScopePtr: llvm.Value | undefined) {
        const container = scope.getTsContainerNode();
        if (container && (!scope.parentScope?._vars || scope.parentScope?._vars instanceof ScopeObjectVarsContainer)) {
            const vars = (scope._vars = createVarsContainer(scope, container, !!parentScopePtr));
        } else {
            scope._vars = new ReferencedVarsContainer(() => scope.parentScope!._vars!);
        }
    }

    saveAndClearInsertPoint(): llvm.IRBuilder.InsertPoint | undefined {
        if (!this.b.GetInsertBlock()) {
            return undefined;
        }
        return this.b.saveAndClearIP();
    }

    restoreInsertPoint(ip: llvm.IRBuilder.InsertPoint | undefined) {
        try {
            if (ip) {
                this.b.restoreIP(ip);
            }
        } catch (err) {
            console.error("failed restore ip");
            debugger;
            console.error(err);
        }
    }

    setInsertPoint(ip: llvm.BasicBlock | llvm.Instruction) {
        if (ip instanceof llvm.BasicBlock) {
            this.b.SetInsertPoint(ip);
        } else {
            this.b.SetInsertPoint(ip);
        }
    }

    createRetVoid() {
        return this.b.CreateRetVoid();
    }

    createRet(value: llvm.Value) {
        return this.b.CreateRet(value);
    }
}

export function getTypeAllocSize(m: llvm.Module, t: llvm.Type) {
    return m.getDataLayout().getTypeAllocSize(t);
}

export function assertPtrLLVM(value: llvm.Value, t?: llvm.Type) {
    try {
        t = t || value.getType();
        if (!t.isPointerTy()) {
            throw new Error("typeof value is not pointer");
        }
    } catch (err) {
        console.error(err);
        throw new Error("exception in assertPtrLLVM");
    }
}

export function derefTypeLLVM(t: llvm.Type): llvm.Type {
    try {
        while (t.isPointerTy()) t = t.getPointerElementType();
    } catch (err) {
        console.warn("error while derefTypeLLVM:");
        console.warn(err);
        console.warn(debugTypeLLVM(t));
    }
    return t;
}

export function createStructTypeForMeta(c: LLVMContext, meta: MetaStructType) {
    const t = llvm.StructType.create(
        c,
        meta.fields.map((x) => x.type),
        nameToStr(meta.name)
    );
    setTypeMeta(t, meta);
    return t;
}

export function generateStructTypeForTsType(ctx: DeclScope, node: ts.Node, objType: ts.Type) {
    const fields = objType.getProperties().map((prop) => {
        const type = ctx.checker.getTypeOfSymbolAtLocation(prop, node);
        const llvmType = resolveTypeFromType(ctx, type)!;

        return {
            name: prop.escapedName.toString(),
            type: llvmType,
        };
    });

    let name = pickStructNameTsType(objType, node);

    const structMeta = new MetaObjectRcType(ctx.c, name, fields);
    return {
        type: createStructTypeForMeta(ctx.c, structMeta),
        meta: structMeta,
    };
}

export function pickStructNameTsType(t: ts.Type, node?: ts.Node) {
    let name = t.aliasSymbol?.getName() || t.getSymbol()?.getName();
    if (!name) {
        if (node && hasNameIdentifier(node)) {
            name = nextUUID("struct_" + node.name.getText());
        } else {
            name = nextUUID("struct");
        }
    }
    return name;
}

export function isPointerTy(t: llvm.Type) {
    try {
        return t.isPointerTy();
    } catch {}
    return false;
}

export function isStructTy(t: llvm.Type) {
    try {
        return t.isStructTy();
    } catch {}
    return false;
}

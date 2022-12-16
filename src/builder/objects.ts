import ts from "typescript";
import llvm from "llvm-bindings";
import { ScopeContext } from "../context";
import { findTypeFromType } from "./types";

export function createObjectType(
    ctx: ScopeContext,
    objectTypeName: string | symbol | undefined,
    fields_: {
        type: llvm.Type;
        name: string;
    }[]
) {
    const { typeId, typeMeta } = ctx.types.allocType();
    typeMeta.name = objectTypeName;

    const fields = [...fields_]
        // !! first sort, than calc structIndex !!
        .sort((a, b) => {
            return a.name.localeCompare(b.name);
        })
        .map((f, fi) => ({
            ...f,
            structIndex: fi + 2,
        }));

    typeMeta.fields = fields;

    const t = llvm.StructType.create(
        ctx.llvmContext,
        [
            // ref counter
            llvm.IntegerType.getInt32Ty(ctx.llvmContext),
            // typeid
            llvm.IntegerType.getInt32Ty(ctx.llvmContext),

            // fields
            ...fields.map((x) => x.type),
        ],
        objectTypeName?.toString() || ""
    );
    typeMeta.llvmType = t;

    const typeSize = ctx.module.getDataLayout().getTypeAllocSize(t);
    const tPtrType = llvm.PointerType.get(t, 0);

    typeMeta.create = (ctx: ScopeContext) => {
        const mallocFunc = ctx.findScopeValue(ScopeContext.GLOBAL_MALLOC_FUNC)!;
        const allocMem = ctx.builder.CreateCall(mallocFunc as llvm.Function, [ctx.const_int32(typeSize)]);
        const allocObj = ctx.builder.CreateBitOrPointerCast(allocMem, tPtrType);

        // init obj

        const refCounterFieldPtr = ctx.builder.CreateGEP(t, allocObj, [ctx.const_int32(0), ctx.const_int32(0)]);
        const typeIdPtr = ctx.builder.CreateGEP(t, allocObj, [ctx.const_int32(0), ctx.const_int32(1)]);

        ctx.builder.CreateStore(ctx.const_int32(1), refCounterFieldPtr);
        ctx.builder.CreateStore(ctx.const_int32(typeId), typeIdPtr);

        // TODO: init fields by default value

        return allocObj;
    };

    typeMeta.getField = (ctx: ScopeContext, obj: llvm.Value, field: string | number | symbol) => {
        const fieldDesc =
            typeof field === "number" ? typeMeta.fields[field] : typeMeta.fields.find((x) => x.name === field)!;

        const fieldPtr = ctx.builder.CreateGEP(t, obj, [ctx.const_int32(0), ctx.const_int32(fieldDesc.structIndex)]);
        return { fieldPtr, fieldDesc };
    };

    typeMeta.setField = (ctx: ScopeContext, obj: llvm.Value, field: string | number | symbol, newValue: llvm.Value) => {
        const fieldDesc =
            typeof field === "number" ? typeMeta.fields[field] : typeMeta.fields.find((x) => x.name === field)!;

        const fieldPtr = ctx.builder.CreateGEP(t, obj, [ctx.const_int32(0), ctx.const_int32(fieldDesc.structIndex)]);

        const fieldValue = ctx.builder.CreateStore(newValue, fieldPtr);

        const foundTypeId = ctx.types.findObjTypeId_byLLVMType(fieldValue.getType());
        if (foundTypeId) {
            ctx.types.getByTypeId(foundTypeId)!.incRefCounter(ctx, fieldValue);
        }

        return fieldValue;
    };

    typeMeta.incRefCounter = (ctx: ScopeContext, obj: llvm.Value) => {
        const objPtr = ctx.builder.CreateBitOrPointerCast(obj, tPtrType, "objPtr.incRef");
        const fieldPtr = ctx.builder.CreateGEP(t, objPtr, [ctx.const_int32(0), ctx.const_int32(0)], "refCounter");

        const oldVal = ctx.builder.CreateLoad(fieldPtr.getType().getPointerElementType(), fieldPtr);
        const newVal = ctx.builder.CreateAdd(oldVal, ctx.const_int32(1));
        ctx.builder.CreateStore(newVal, fieldPtr);
    };

    typeMeta.decRefCounter = (ctx: ScopeContext, obj: llvm.Value) => {
        const objPtr = ctx.builder.CreateBitOrPointerCast(obj, tPtrType, "objPtr.decRef");
        const fieldPtr = ctx.builder.CreateGEP(t, objPtr, [ctx.const_int32(0), ctx.const_int32(0)], "refCounter");

        const oldVal = ctx.builder.CreateLoad(fieldPtr.getType().getPointerElementType(), fieldPtr);
        const newVal = ctx.builder.CreateSub(oldVal, ctx.const_int32(1));
        ctx.builder.CreateStore(newVal, fieldPtr);

        const parentFunc = ctx.builder.GetInsertBlock()!.getParent() || undefined;

        const callReleaseBB = llvm.BasicBlock.Create(ctx.llvmContext, undefined, parentFunc);
        const thenBB = llvm.BasicBlock.Create(ctx.llvmContext, undefined, parentFunc);
        ctx.builder.CreateCondBr(ctx.builder.CreateICmpSLE(newVal, ctx.const_int32(0)), callReleaseBB, thenBB);

        ctx.builder.SetInsertPoint(callReleaseBB);
        const objVoidPtr = ctx.builder.CreateBitOrPointerCast(obj, ctx.builder.getInt8PtrTy());
        ctx.builder.CreateCall(ctx.findScopeValue(ScopeContext.GLOBAL_GC_MARK_RELEASE) as llvm.Function, [objVoidPtr]);
        ctx.builder.CreateBr(thenBB);

        ctx.builder.SetInsertPoint(thenBB);
    };

    return { typeId, typeMeta };
}

export function generateObjectTypeForTsType(ctx: ScopeContext, node: ts.Node, objType: ts.Type) {
    const fields = objType.getProperties().map((prop) => {
        const type = ctx.checker.getTypeOfSymbolAtLocation(prop, node);
        const llvmType = findTypeFromType(ctx, type)!;

        return {
            name: prop.escapedName.toString(),
            type: llvmType,
        };
    });
    return createObjectType(ctx, undefined, fields);
}

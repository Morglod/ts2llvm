import llvm from "llvm-bindings";
import { ModuleContext, ScopeContext } from "../context";
import { IRFunc } from "../ir";

export function createMalloc(ctx: ScopeContext) {
    const mallocFuncType = llvm.FunctionType.get(
        llvm.Type.getInt8PtrTy(ctx.llvmContext),
        [llvm.Type.getInt32Ty(ctx.llvmContext)],
        false
    );

    const func = llvm.Function.Create(
        mallocFuncType,
        llvm.Function.LinkageTypes.ExternalWeakLinkage,
        `malloc`,
        ctx.module
    );

    ctx.moduleCtx.mallocFunc = new IRFunc("malloc", func, mallocFuncType, undefined, undefined, undefined!, ctx, [
        { name: "_", type: llvm.Type.getInt8PtrTy(ctx.llvmContext) },
        { name: "size", type: llvm.Type.getInt32Ty(ctx.llvmContext) },
    ]);
    return func;
}

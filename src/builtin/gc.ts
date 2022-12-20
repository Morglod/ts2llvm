import llvm from "llvm-bindings";
import { ModuleContext, ScopeContext } from "../context";
import { IRFunc } from "../ir";

export function createGcMarkRelease(ctx: ScopeContext) {
    const funcType = llvm.FunctionType.get(
        llvm.Type.getVoidTy(ctx.llvmContext),
        [llvm.Type.getInt8PtrTy(ctx.llvmContext)],
        false
    );

    const func = llvm.Function.Create(
        funcType,
        llvm.Function.LinkageTypes.ExternalWeakLinkage,
        `gc_mark_release`,
        ctx.module
    );

    ctx.moduleCtx.gcMarkReleaseFunc = new IRFunc(
        "gc_mark_release",
        func,
        funcType,
        undefined,
        undefined,
        undefined!,
        ctx,
        [
            { name: "_", type: llvm.Type.getInt8PtrTy(ctx.llvmContext) },
            { name: "size", type: llvm.Type.getInt32Ty(ctx.llvmContext) },
        ]
    );
    return func;
}

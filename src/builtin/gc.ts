import llvm from "llvm-bindings";
import { ModuleContext } from "../context";

export function createGcMarkRelease(ctx: ModuleContext) {
    const funcType = llvm.FunctionType.get(
        llvm.Type.getVoidTy(ctx.programCtx.llvmContext),
        [llvm.Type.getInt8PtrTy(ctx.programCtx.llvmContext)],
        false
    );

    const func = llvm.Function.Create(
        funcType,
        llvm.Function.LinkageTypes.ExternalWeakLinkage,
        `gc_mark_release`,
        ctx.module
    );

    ctx.gcMarkReleaseFunc = func;
    return func;
}

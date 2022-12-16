import llvm from "llvm-bindings";
import { ScopeContext } from "../context";

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

    ctx.setScopeValue(ScopeContext.GLOBAL_GC_MARK_RELEASE, func);

    return func;
}

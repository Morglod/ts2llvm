import llvm from "llvm-bindings";
import { ScopeContext } from "../context";

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

    ctx.setScopeValue(ScopeContext.GLOBAL_MALLOC_FUNC, func);

    return func;
}

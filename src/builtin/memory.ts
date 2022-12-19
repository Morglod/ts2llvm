import llvm from "llvm-bindings";
import { ModuleContext } from "../context";

export function createMalloc(ctx: ModuleContext) {
    const mallocFuncType = llvm.FunctionType.get(
        llvm.Type.getInt8PtrTy(ctx.programCtx.llvmContext),
        [llvm.Type.getInt32Ty(ctx.programCtx.llvmContext)],
        false
    );

    const func = llvm.Function.Create(
        mallocFuncType,
        llvm.Function.LinkageTypes.ExternalWeakLinkage,
        `malloc`,
        ctx.module
    );

    ctx.mallocFunc = func;
    return func;
}

import llvm from "llvm-bindings";
import { DictVarsContainer } from "../builder/vars";
import { LLVMModule } from "../ir/builder";
import { IRFuncValue } from "../ir/func";

export function createGcMarkRelease(m: LLVMModule) {
    const funcType = llvm.FunctionType.get(m.c.voidTy, [m.c.i8ptrTy], false);

    const func = llvm.Function.Create(funcType, llvm.Function.LinkageTypes.ExternalWeakLinkage, `gc_mark_release`, m);

    const irfunc = new IRFuncValue("gc_mark_release", func, [], undefined, [
        { name: "_", type: m.c.i8ptrTy },
        { name: "size", type: m.c.i32Ty },
    ]);
    return irfunc;
}

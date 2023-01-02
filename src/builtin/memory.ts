import llvm from "llvm-bindings";
import { DictVarsContainer } from "../builder/vars";
import { LLVMModule } from "../ir/builder";
import { IRFuncValue } from "../ir/func";

export function createMalloc(m: LLVMModule) {
    const mallocFuncType = llvm.FunctionType.get(m.c.i8ptrTy, [m.c.i8ptrTy, m.c.i32Ty], false);
    const func = llvm.Function.Create(mallocFuncType, llvm.Function.LinkageTypes.ExternalWeakLinkage, `std_malloc`, m);

    const irfunc = new IRFuncValue("std_malloc", func, [], undefined, [
        { name: "_", type: m.c.i8ptrTy },
        { name: "size", type: m.c.i32Ty },
    ]);
    return irfunc;
}

import llvm from "llvm-bindings";

export class LLVMContext extends llvm.LLVMContext {
    i32Ty: llvm.Type;
    i16Ty: llvm.Type;
    i8Ty: llvm.Type;
    booleanTy: llvm.Type;
    voidTy: llvm.Type;
    i8ptrTy: llvm.Type;
    numberTy: llvm.Type;
    anyptrTy: llvm.Type;

    constructor() {
        super();

        this.i32Ty = llvm.Type.getInt32Ty(this);
        this.i16Ty = llvm.Type.getInt16Ty(this);
        this.i8Ty = llvm.Type.getInt8Ty(this);
        this.booleanTy = llvm.Type.getInt1Ty(this);
        this.voidTy = llvm.Type.getVoidTy(this);
        this.i8ptrTy = llvm.Type.getInt8PtrTy(this);
        this.numberTy = llvm.Type.getDoubleTy(this);
        this.anyptrTy = llvm.Type.getInt8PtrTy(this);
    }
}

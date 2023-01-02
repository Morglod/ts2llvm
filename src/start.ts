import ts from "typescript";
import { writeFileSync } from "fs";
import { ProgramScope } from "./context";
import { parseSourceFile } from "./builder/module";
import { LLVMContext } from "./builtin/llvm-context";
import { LLVMBuilder } from "./ir/builder";

async function dojob(rootNames: string[], options: ts.CompilerOptions, host?: ts.CompilerHost) {
    debugger;

    // await new Promise<void>((r) => {
    //     setTimeout(() => r(), 4000);
    // });

    const program = ts.createProgram(rootNames, options, host);
    const checker = program.getTypeChecker();

    const llvmCtx = new LLVMContext();
    const ctx = new ProgramScope(llvmCtx, program, checker);

    for (const sourceFile of program.getSourceFiles()) {
        if (sourceFile.fileName.includes("node_modules/@types/")) continue;
        if (sourceFile.fileName.includes("main.ts")) {
            const result = parseSourceFile(ctx, sourceFile);
            const llresult = result.module.print();
            console.log(llresult);
            writeFileSync("./example/main.ll", llresult);
        }
    }
}

(function () {
    dojob(["./example/main.ts"], {
        rootDir: "./example",
        target: ts.ScriptTarget.ES5,
        module: ts.ModuleKind.CommonJS,
        noLib: true,
        skipDefaultLibCheck: true,
    });
})();

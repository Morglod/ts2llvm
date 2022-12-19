import ts from "typescript";
import llvm from "llvm-bindings";
import { writeFileSync } from "fs";
import { ModuleContext, ProgramContext, ScopeContext } from "./context";
import { Types } from "./types";
import { parseSourceFile } from "./builder/module";
import { parseModuleContainers } from "./ts-utils";
import { createVarsContainer } from "./builder/vars";
import { createMalloc } from "./builtin/memory";
import { createGcMarkRelease } from "./builtin/gc";

async function dojob(rootNames: string[], options: ts.CompilerOptions, host?: ts.CompilerHost) {
    debugger;

    // await new Promise<void>((r) => {
    //     setTimeout(() => r(), 4000);
    // });

    const program = ts.createProgram(rootNames, options, host);
    const checker = program.getTypeChecker();

    const llvmCtx = new llvm.LLVMContext();
    const builder = new llvm.IRBuilder(llvmCtx);
    const ctx = new ProgramContext(llvmCtx, builder, program, checker, new Types());

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

import ts from "typescript";
import { ModuleScope, ProgramScope, DeclScope } from "../context";
import { createFunctionObjectType } from "./functions";
import { parseDeclaration } from "./declarations";
import { LLVMModule } from "../ir/builder";

export function parseSourceFile(ctx: ProgramScope, node: ts.SourceFile) {
    const module = new LLVMModule(node.fileName, ctx.llvmContext);
    const moduleCtx = new ModuleScope(ctx, module, node);
    const scopeCtx = new DeclScope(moduleCtx, undefined, node);

    // createFunctionObjectType(scopeCtx);

    // TODO: create global module init function

    ts.forEachChild(node, (node) => {
        parseDeclaration(scopeCtx, node);
    });

    module.entryPoint.finish(moduleCtx.builder);

    return {
        scopeCtx,
        module,
    };
}

import ts from "typescript";
import llvm from "llvm-bindings";
import { writeFileSync } from "fs";
import { filterUndefined } from "../utils";
import { ModuleContext, ProgramContext, ScopeContext } from "../context";
import { createObjectType } from "../builder/objects";
import { createMalloc } from "../builtin/memory";
import { createGcMarkRelease } from "../builtin/gc";
import { codeBlock } from "../builder/expressions";
import { Types } from "../types";
import { createFunctionObjectType, parseFunction } from "./functions";
import { parseDeclaration } from "./declarations";
import { parseModuleContainers } from "../ts-utils";
import { createVarsContainer, getVarsContainer } from "./vars";

export function parseSourceFile(ctx: ProgramContext, node: ts.SourceFile) {
    const module = new llvm.Module("moduleNameHere", ctx.llvmContext);
    const moduleCtx = new ModuleContext(ctx, module, node);
    const scopeCtx = new ScopeContext(moduleCtx, module, undefined, node);

    createMalloc(moduleCtx);
    createGcMarkRelease(moduleCtx);
    createFunctionObjectType(scopeCtx);

    ts.forEachChild(node, (node) => {
        parseDeclaration(scopeCtx, node);
    });

    return {
        scopeCtx,
        module,
    };
}

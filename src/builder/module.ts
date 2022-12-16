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

export function parseSourceFile(ctx: ProgramContext, node: ts.SourceFile) {
    const module = new llvm.Module("moduleNameHere", ctx.llvmContext);
    const moduleCtx = new ModuleContext(ctx, module, node);
    const scopeCtx = new ScopeContext(moduleCtx, module, undefined, node);

    createMalloc(scopeCtx);
    createGcMarkRelease(scopeCtx);
    createFunctionObjectType(scopeCtx);

    const moduleContainer = moduleCtx.findContainerNode(node);
    const localDelcs: ts.Declaration[] = [];
    moduleContainer?.locals.forEach((v, k) => {
        v.declarations && localDelcs.push(...v.declarations);
    });
    console.log(localDelcs.map((x) => x.getText()));
    localDelcs.forEach((d) => parseDeclaration(scopeCtx, d));

    return {
        scopeCtx,
        module,
    };
}

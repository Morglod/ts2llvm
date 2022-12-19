import ts from "typescript";
import llvm from "llvm-bindings";
import { Types, ObjTypeDesc } from "./types";
import { ContainerNode, parseModuleContainers } from "./ts-utils";
import { getVarsContainer, IVarsContainer, ScopeObjectVarsContainer } from "./builder/vars";

export class ProgramContext {
    constructor(
        public readonly llvmContext: llvm.LLVMContext,
        public readonly builder: llvm.IRBuilder,
        public readonly program: ts.Program,
        public readonly checker: ts.TypeChecker,
        public readonly types: Types
    ) {}
}

export class ModuleContext {
    constructor(
        public readonly programCtx: ProgramContext,
        public readonly module: llvm.Module,
        sourceFileNode: ts.SourceFileLike
    ) {
        this._containers = parseModuleContainers(sourceFileNode);
    }

    mallocFunc!: llvm.Value;
    gcMarkReleaseFunc!: llvm.Value;

    /** all module containers */
    private readonly _containers: ContainerNode[];

    findContainerNode(node: ts.Node, searchScopeOfNode = true): ContainerNode | null {
        if (this._containers.includes(node as any)) return node as any;
        if (searchScopeOfNode) {
            while (node.parent) {
                node = node.parent;
                if (this._containers.includes(node as any)) return node as any;
            }
        }
        return null;
    }
}

type ScopeHooks = {
    varNotFound?: (ctx: ScopeContext, name: string | symbol) => IVarsContainer | undefined;
};

export class ScopeContext {
    constructor(
        public readonly moduleCtx: ModuleContext,
        public readonly module: llvm.Module,
        public readonly parentScope: ScopeContext | undefined,
        public readonly tsNode: ts.Node | undefined
    ) {
        if (tsNode && this.getTsContainerNode()) {
            this._vars = getVarsContainer(this.getTsContainerNode()!);
        }
    }

    createChildScope(params: { tsNode?: ts.Node } = {}) {
        return new ScopeContext(this.moduleCtx, this.module, this, params.tsNode);
    }

    get llvmContext(): llvm.LLVMContext {
        return this.moduleCtx.programCtx.llvmContext;
    }
    get builder(): llvm.IRBuilder {
        return this.moduleCtx.programCtx.builder;
    }
    get program(): ts.Program {
        return this.moduleCtx.programCtx.program;
    }
    get checker(): ts.TypeChecker {
        return this.moduleCtx.programCtx.checker;
    }
    get types() {
        return this.moduleCtx.programCtx.types;
    }

    // container node

    private _tsContainerNode: ContainerNode | null | undefined = undefined;

    getTsContainerNode(): ContainerNode | undefined {
        if (this._tsContainerNode) return this._tsContainerNode;
        if (this._tsContainerNode === null) return undefined;
        this._tsContainerNode = (this.tsNode && this.moduleCtx.findContainerNode(this.tsNode, true)) || null;
        return this._tsContainerNode || undefined;
    }

    // helpers

    const_int32(x: number) {
        return llvm.ConstantInt.get(llvm.Type.getInt32Ty(this.llvmContext), x);
    }

    null_i8ptr() {
        return llvm.Constant.getNullValue(llvm.Type.getInt8PtrTy(this.llvmContext));
    }

    // vars

    _vars: IVarsContainer | undefined = undefined;

    hooks: ScopeHooks | undefined = undefined;

    findVarContainer(
        name: string | symbol,
        params: { noRecursive?: boolean; noHooks?: boolean } = {}
    ): IVarsContainer | undefined {
        const x = this._vars?.hasVariable(name);
        if (x) return this._vars;
        if (!params.noHooks && this.hooks && this.hooks.varNotFound) {
            const y = this.hooks.varNotFound(this, name);
            if (y) return y;
        }
        if (!params.noRecursive && this.parentScope) return this.parentScope.findVarContainer(name);
        return undefined;
    }

    findTopScopeObjectVarsContainer(): ScopeObjectVarsContainer | undefined {
        if (this._vars && this._vars instanceof ScopeObjectVarsContainer) return this._vars;
        return this.parentScope?.findTopScopeObjectVarsContainer();
    }

    // scope types

    protected scopeTypes: Record<string | symbol, llvm.Type> = {};

    setScopeType(name: string | symbol, value: llvm.Type) {
        this.scopeTypes[name] = value;
    }

    findScopeType(name: string | symbol, params: { noRecursive?: boolean } = {}): llvm.Type | undefined {
        const x = this.scopeTypes[name];
        if (x) return x;
        if (!params.noRecursive && this.parentScope) return this.parentScope.findScopeType(name);
        return undefined;
    }

    // deferred code building
    // use it to create destructors or some deferred functions

    _deferred: ((ctx: ScopeContext) => void)[] | undefined = undefined;

    deferred_push(cb: (ctx: ScopeContext) => void) {
        if (!this._deferred) this._deferred = [];
        this._deferred.push(cb);
    }

    deferred_runAndClear() {
        if (!this._deferred) return;
        for (const d of this._deferred) {
            d(this);
        }
        this._deferred = undefined;
    }
}

export function findScopeContextByDeclarationId(ctx: ScopeContext, id: string) {
    do {
        if (ctx.getTsContainerNode()?.locals?.has(id as ts.__String)) {
            return ctx;
        }
        ctx = ctx.parentScope!;
    } while (!!ctx);
    return undefined;
}

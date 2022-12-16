import ts from "typescript";
import llvm from "llvm-bindings";
import { Types } from "./types";
import { ModuleContainer, parseModuleContainers } from "./ts-utils/scopes";

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

    readonly _containers: ModuleContainer[];

    findContainerNode(node: ts.Node, searchScopeOfNode = true): ModuleContainer | null {
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

type ScopeProxy = {
    scopeValueNotFound?: (ctx: ScopeContext, name: string | symbol) => llvm.Value | undefined;
};

export class ScopeContext {
    constructor(
        public readonly moduleCtx: ModuleContext,
        public readonly module: llvm.Module,
        public readonly parentScope: ScopeContext | undefined,
        private tsNode_: ts.Node | undefined
    ) {
        this._scopeContainer = (tsNode_ && this.moduleCtx.findContainerNode(tsNode_, true)) || undefined;
    }

    private _scopeContainer: ModuleContainer | undefined = undefined;

    get scopeContainer() {
        return this._scopeContainer;
    }

    get tsNode() {
        return this.tsNode_;
    }

    unsafe_setTsNode(node: ts.Node | undefined) {
        this.tsNode_ = node;
        this._scopeContainer = (node && this.moduleCtx.findContainerNode(node, true)) || undefined;
    }

    createChildScope(tsNode: ts.Node | undefined) {
        return new ScopeContext(this.moduleCtx, this.module, this, tsNode);
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

    const_int32(x: number) {
        return llvm.ConstantInt.get(llvm.Type.getInt32Ty(this.llvmContext), x);
    }

    static GLOBAL_MALLOC_FUNC = Symbol("malloc_func");
    static GLOBAL_GC_MARK_RELEASE = Symbol("gc_mark_release");

    protected scopeValues: Record<string | symbol, llvm.Value | undefined> = {};
    protected scopeTypes: Record<string | symbol, llvm.Type> = {};

    scopeProxy: ScopeProxy | undefined = undefined;

    setScopeValue(name: string | symbol, value: llvm.Value | undefined) {
        this.scopeValues[name] = value;
    }

    findScopeValue(
        name: string | symbol,
        params: { noRecursive?: boolean; noProxy?: boolean } = {}
    ): llvm.Value | undefined {
        const x = this.scopeValues[name];
        if (x) return x;
        if (!params.noProxy && this.scopeProxy && this.scopeProxy.scopeValueNotFound) {
            const y = this.scopeProxy.scopeValueNotFound(this, name);
            if (y) return y;
        }
        if (!params.noRecursive && this.parentScope) return this.parentScope.findScopeValue(name);
        return undefined;
    }

    setScopeType(name: string | symbol, value: llvm.Type) {
        this.scopeTypes[name] = value;
    }

    findScopeType(name: string | symbol): llvm.Type | undefined {
        const x = this.scopeTypes[name];
        if (x) return x;
        if (this.parentScope) return this.parentScope.findScopeType(name);
        return undefined;
    }

    countScopeValues(): number {
        return Object.values(this.scopeValues).length;
    }

    // deferred code

    _deferredCodeBlockCode: ((ctx: ScopeContext) => void)[] = [];

    pushDeferredCodeBlockCode(cb: (ctx: ScopeContext) => void) {
        this._deferredCodeBlockCode.push(cb);
    }

    appendDefferedCodeBlock() {
        for (const d of this._deferredCodeBlockCode) {
            d(this);
        }
        this._deferredCodeBlockCode = [];
    }
}

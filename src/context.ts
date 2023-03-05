import ts from "typescript";
import llvm from "llvm-bindings";
import { ContainerNode, parseModuleContainers } from "./ts-utils";
import { analyzeVarContainers, getVarsContainer, IVarsContainer, ScopeObjectVarsContainer } from "./builder/vars";
import { LLVMContext } from "./builtin/llvm-context";
import { LLVMBuilder, LLVMModule } from "./ir/builder";

export class ProgramScope {
    constructor(
        public readonly llvmContext: LLVMContext,
        public readonly program: ts.Program,
        public readonly checker: ts.TypeChecker
    ) {}
}

export class ModuleEntryPoint {
    constructor(readonly module: LLVMModule) {
        const funcType = llvm.FunctionType.get(this.module.c.voidTy, [], false);
        const func = (this.entryFunc = llvm.Function.Create(
            funcType,
            llvm.Function.LinkageTypes.ExternalLinkage,
            `_module_entry_point_`,
            this.module
        ));
        this.entryFuncBB = llvm.BasicBlock.Create(this.module.c, "entry", func);
    }

    protected entryFunc: llvm.Function;
    protected entryFuncBB: llvm.BasicBlock;

    appendEntryPoint(b: LLVMBuilder, func: () => void | llvm.BasicBlock) {
        const ib = b.b.GetInsertBlock();
        b.b.SetInsertPoint(this.entryFuncBB);

        const r = func();
        if (r !== undefined) {
            this.entryFuncBB = r;
        }

        if (ib) b.b.SetInsertPoint(ib);
    }

    finish(b: LLVMBuilder) {
        this.appendEntryPoint(b, () => {
            b.createRetVoid();
        });
    }
}

export class ModuleScope {
    constructor(
        public readonly programCtx: ProgramScope,
        public readonly module: LLVMModule,
        sourceFileNode: ts.SourceFileLike
    ) {
        this.builder = new LLVMBuilder(module);
        this._containers = parseModuleContainers(sourceFileNode);
        analyzeVarContainers(programCtx.checker, this._containers);
        this.module.entryPoint = new ModuleEntryPoint(module);
    }

    readonly builder: LLVMBuilder;

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
    varNotFound?: (ctx: DeclScope, name: string | symbol) => IVarsContainer | undefined;
};

export class DeclScope {
    constructor(
        public readonly moduleScope: ModuleScope,
        public readonly parentScope: DeclScope | undefined,
        public readonly tsNode: ts.Node | undefined
    ) {
        this.c = moduleScope.programCtx.llvmContext;
        this.b = moduleScope.builder;
        this.m = moduleScope.module;
    }

    unsafe_createChildScope(params: { tsNode?: ts.Node } = {}) {
        const child = new DeclScope(this.moduleScope, this, params.tsNode);
        return child;
    }

    c: LLVMContext;
    b: LLVMBuilder;
    m: LLVMModule;

    get programTs(): ts.Program {
        return this.moduleScope.programCtx.program;
    }
    get checker(): ts.TypeChecker {
        return this.moduleScope.programCtx.checker;
    }

    // container node

    private _tsContainerNode: ContainerNode | null | undefined = undefined;
    getTsContainerNode(): ContainerNode | undefined {
        if (this._tsContainerNode) return this._tsContainerNode;
        if (this._tsContainerNode === null) return undefined;
        this._tsContainerNode = (this.tsNode && this.moduleScope.findContainerNode(this.tsNode, true)) || null;
        return this._tsContainerNode || undefined;
    }

    // vars

    _vars: IVarsContainer | undefined = undefined;
    hooks: ScopeHooks | undefined = undefined;

    createVarPtr(name: string | symbol) {
        return this._vars!.createVarPtr(this, name)!;
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

    _firstCodeBlock: (() => void)[] = [];
    firstCodeBlock_runAndClear() {
        for (const d of this._firstCodeBlock) d();
        this._firstCodeBlock = [];
    }

    _deferred: ((ctx: DeclScope) => void)[] | undefined = undefined;

    deferred_push(cb: (ctx: DeclScope) => void) {
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

export function findScopeContextByDeclarationId(ctx: DeclScope, id: string) {
    do {
        if (ctx.getTsContainerNode()?.locals?.has(id as ts.__String)) {
            return ctx;
        }
        ctx = ctx.parentScope!;
    } while (!!ctx);
    return undefined;
}

import ts from "typescript";
import llvm from "llvm-bindings";
import { DeclScope } from "../context";
import { MetaStructType } from "../llvm-meta-cache/obj";
import {
    ContainerNode,
    filterNodeTreeAsTree,
    isContainerNode,
    isFunctionLikeDeclaration,
    StopSymbol,
    walkNodeTree,
    walkUp,
} from "../ts-utils";
import { filterUndefined, mapSymbolsTable } from "../utils";
import { createScopeObjectType } from "./functions";
import { resolveTypeFromType } from "./types";

export interface IVarsContainer {
    hasVariable(name: string | symbol): boolean;
    getVariableType(name: string | symbol): llvm.Type;
    createVarPtr(ctx: DeclScope, name: string | symbol): llvm.Value | undefined;
    createLoadVar(ctx: DeclScope, name: string | symbol): llvm.Value;
    createStoreToVar(ctx: DeclScope, name: string | symbol, newValue: llvm.Value): void;
}

export class ReferencedVarsContainer implements IVarsContainer {
    constructor(public readonly accessor: () => IVarsContainer) {}

    hasVariable(name: string | symbol): boolean {
        return this.accessor().hasVariable(name);
    }
    getVariableType(name: string | symbol): llvm.Type {
        return this.accessor().getVariableType(name);
    }

    createVarPtr(ctx: DeclScope, name: string | symbol): llvm.Value | undefined {
        return this.accessor().createVarPtr(ctx, name);
    }

    createLoadVar(ctx: DeclScope, name: string | symbol): llvm.Value {
        return this.accessor().createLoadVar(ctx, name);
    }

    createStoreToVar(ctx: DeclScope, name: string | symbol, newValue: llvm.Value): void {
        return this.accessor().createStoreToVar(ctx, name, newValue);
    }
}

export class DictVarsContainer implements IVarsContainer {
    vars: Record<string | symbol, { mutable: false; value: llvm.Value } | { mutable: true; valuePtr: llvm.Value }> = {};

    constructor(vars: typeof DictVarsContainer.prototype.vars) {
        this.vars = vars;
    }

    hasVariable(name: string | symbol): boolean {
        return name in this.vars;
    }

    createVarPtr(ctx: DeclScope, name: string | symbol): llvm.Value | undefined {
        const v = this.vars[name];
        if (v.mutable) return v.valuePtr;
        console.warn("create varptr for not mutable");
        return v.value;
        // throw new Error(`not var ptr for ${name.toString()}`);
    }

    createLoadVar(ctx: DeclScope, name: string | symbol): llvm.Value {
        const v = this.vars[name];
        if (!v.mutable) return v.value;
        return ctx.b.createLoad(v.valuePtr);
    }

    createStoreToVar(ctx: DeclScope, name: string | symbol, newValue: llvm.Value): void {
        const v = this.vars[name];
        if (!v.mutable) {
            console.warn(`assign value to constant var; swapping by name`);
            this.vars[name] = { ...v, value: newValue };
            return;
        }

        ctx.b.createStore(v.valuePtr, newValue);
    }

    getVariableType(name: string | symbol): llvm.Type {
        const v = this.vars[name];
        if (v.mutable) {
            return v.valuePtr.getType().getPointerElementType();
        }
        return v.value.getType();
    }
}

export class ScopeObjectVarsContainer implements IVarsContainer {
    constructor(public readonly scopeObjectPtr: llvm.Value, public readonly scopeObjectMeta: MetaStructType) {}

    hasVariable(name: string | symbol): boolean {
        return this.scopeObjectMeta.hasField(name);
    }

    getVariableType(name: string | symbol): llvm.Type {
        return this.scopeObjectMeta.getFieldOrThrow(name).type;
    }

    createVarPtr(ctx: DeclScope, name: string | symbol): llvm.Value {
        return ctx.b.createPointerToField(this.scopeObjectPtr, [name]);
    }

    createLoadVar(ctx: DeclScope, name: string | symbol): llvm.Value {
        const fieldPtr = ctx.b.createPointerToField(this.scopeObjectPtr, [name]);
        return ctx.b.createLoad(fieldPtr);
    }

    createStoreToVar(ctx: DeclScope, name: string | symbol, newValue: llvm.Value): void {
        const fieldPtr = ctx.b.createPointerToField(this.scopeObjectPtr, [name]);
        ctx.b.createStore(fieldPtr, newValue);
    }
}

export class CombileVarsContainer implements IVarsContainer {
    constructor(public readonly second: IVarsContainer, public readonly first: IVarsContainer) {}

    hasVariable(name: string | symbol): boolean {
        return this.first.hasVariable(name) || this.second.hasVariable(name);
    }
    getVariableType(name: string | symbol): llvm.Type {
        if (this.first.hasVariable(name)) return this.first.getVariableType(name);
        if (this.second.hasVariable(name)) return this.second.getVariableType(name);
        console.error(name);
        throw new Error("no variable found");
    }

    createVarPtr(ctx: DeclScope, name: string | symbol): llvm.Value | undefined {
        if (this.first.hasVariable(name)) return this.first.createVarPtr(ctx, name);
        if (this.second.hasVariable(name)) return this.second.createVarPtr(ctx, name);
        console.error(name);
        throw new Error("no variable found");
    }

    createLoadVar(ctx: DeclScope, name: string | symbol): llvm.Value {
        if (this.first.hasVariable(name)) return this.first.createLoadVar(ctx, name);
        if (this.second.hasVariable(name)) return this.second.createLoadVar(ctx, name);
        console.error(name);
        throw new Error("no variable found");
    }

    createStoreToVar(ctx: DeclScope, name: string | symbol, newValue: llvm.Value): void {
        if (this.first.hasVariable(name)) return this.first.createStoreToVar(ctx, name, newValue);
        if (this.second.hasVariable(name)) return this.second.createStoreToVar(ctx, name, newValue);
        console.error(name);
        throw new Error("no variable found");
    }
}

export function createVarsContainer(
    ctx: DeclScope,
    tsContainer: ContainerNode,
    shouldCreateScopeObject: boolean = false
) {
    // check if any of var is referred in any non-root function body
    // it will mean that we should create scope object

    shouldCreateScopeObject = accessVarContainerAnalyze(tsContainer, true).shouldCreateScopeObject;

    let varsContainer: IVarsContainer = undefined!;

    if (shouldCreateScopeObject) {
        if (varsContainer) return varsContainer;
        // TODO: find parent scope type
        const parentScopeMeta = undefined;
        const { type: scopeType, meta } = createScopeObjectType(ctx, tsContainer, parentScopeMeta);
        const objPtr = ctx.b.createHeapVariable(scopeType, "scopeObj");
        varsContainer = new ScopeObjectVarsContainer(objPtr, meta);
        return varsContainer;
    } else {
        const localSymbols =
            (tsContainer.locals &&
                filterUndefined(
                    mapSymbolsTable(tsContainer.locals, (s, k) => {
                        if (s.valueDeclaration?.kind === ts.SyntaxKind.Parameter) {
                            // filter out func arguments
                            return undefined;
                        }
                        return {
                            symbol: s,
                            key: k,
                            type: s.valueDeclaration && ctx.checker.getTypeOfSymbolAtLocation(s, s.valueDeclaration),
                        };
                    })
                )) ||
            [];

        const entires: [key: string, value: ConstructorParameters<typeof DictVarsContainer>[0][string]][] =
            localSymbols.map(({ symbol, key, type }) => {
                if (!type) {
                    throw new Error("failed resolve var type");
                }
                const typeLLVM = resolveTypeFromType(ctx, type);
                const varPtr = ctx.b.createStackVariable(typeLLVM, key.toString());
                const varDesc = {
                    mutable: false,
                    value: varPtr,
                } as const;
                return [key.toString(), varDesc];
            });
        varsContainer = new DictVarsContainer(Object.fromEntries(entires));
    }

    _setVarsContainer(tsContainer, varsContainer);

    return varsContainer;
}

// --------

const VARS_CONTAINER_IN_NODE = Symbol("vars container in node");

function _setVarsContainer(node: ts.Node, vc: IVarsContainer) {
    (node as any)[VARS_CONTAINER_IN_NODE] = vc;
}

export function getVarsContainer(node: ts.Node): IVarsContainer | undefined {
    const x = (node as any)[VARS_CONTAINER_IN_NODE];
    if (x) return x;

    if (!isContainerNode(node)) {
        console.error(node);
        throw new Error(`failed resolve varscontainer for not container node`);
    }
    throw new Error(`varscontainer not set on container node`);
}

export function hasVarsContainer(node: ts.Node): boolean {
    return !!(node as any)[VARS_CONTAINER_IN_NODE];
}

// --------

export type VarContainerAnalyze = {
    shouldCreateScopeObject: boolean;
    parent: ContainerNode | undefined;
    parentInfo: VarContainerAnalyze | undefined;
};

const _accessVarContainerAnalyzeSymbol = Symbol("accessVarContainerAnalyze");
function accessVarContainerAnalyze(node: ContainerNode, throwIfNone = false): VarContainerAnalyze {
    if (!(node as any)[_accessVarContainerAnalyzeSymbol]) {
        if (throwIfNone) {
            throw new Error("no container data found");
        }
        const defualtVCA: VarContainerAnalyze = {
            shouldCreateScopeObject: false,
            parent: undefined,
            parentInfo: undefined,
        };
        (node as any)[_accessVarContainerAnalyzeSymbol] = defualtVCA;
    }
    return (node as any)[_accessVarContainerAnalyzeSymbol] as VarContainerAnalyze;
}

export function analyzeVarContainers(checker: ts.TypeChecker, moduleContainers: ContainerNode[]) {
    // find parents
    for (const mc of moduleContainers) {
        walkUp(mc, (node) => {
            if (isContainerNode(node)) {
                const mcInfo = accessVarContainerAnalyze(mc);
                mcInfo.parent = node;
                mcInfo.parentInfo = accessVarContainerAnalyze(node);
                mcInfo.shouldCreateScopeObject = !!mcInfo.parentInfo?.shouldCreateScopeObject;

                return StopSymbol;
            }
        });
    }

    // sort roots to top
    moduleContainers.sort((a, b) => {
        if (accessVarContainerAnalyze(a).parent) return -1;
        return 1;
    });

    // analyze
    for (const mc of moduleContainers) {
        const mcInfo = accessVarContainerAnalyze(mc);
        let shouldCreateScopeObject = mcInfo.parentInfo?.shouldCreateScopeObject;

        !shouldCreateScopeObject &&
            walkNodeTree(mc, (node) => {
                if (ts.isIdentifier(node)) {
                    const symbol = checker.getSymbolAtLocation(node);

                    const isFuncSymbol =
                        symbol?.valueDeclaration && isFunctionLikeDeclaration(symbol?.valueDeclaration);
                    if (isFuncSymbol) {
                        // skip function references, as it is passed globally
                        // ?? TODO: somehow detect if we pass it by FunctionObject
                        return;
                    }
                    if (!symbol?.valueDeclaration) {
                        return;
                    }

                    walkUp(node, (x) => {
                        if (isFunctionLikeDeclaration(x) && isContainerNode(x)) {
                            if (x !== mc) {
                                shouldCreateScopeObject = true;
                                return StopSymbol;
                            }
                        }
                    });
                    if (shouldCreateScopeObject) return StopSymbol;
                }
            });

        if (shouldCreateScopeObject) {
            mcInfo.shouldCreateScopeObject = shouldCreateScopeObject;
        }
    }
}

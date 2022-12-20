import ts from "typescript";
import { ScopeContext } from "../context";
import { AnyIRValue, IRObjectFieldPtr, IRObjectInstance, IRValue, IRValuePtr } from "../ir/value";
import { ContainerNode, filterNodeTreeAsTree, isContainerNode, StopSymbol, walkNodeTree, walkUp } from "../ts-utils";
import { ObjTypeDesc } from "../types";
import { mapSymbolsTable } from "../utils";
import { createCodeBlockScopeObject } from "./functions";

export interface IVarsContainer {
    hasVariable(name: string | symbol): boolean;
    getVariablePtr(ctx: ScopeContext, name: string | symbol): IRValuePtr | undefined;
    loadVariable(ctx: ScopeContext, name: string | symbol): AnyIRValue;
    storeVariable(ctx: ScopeContext, name: string | symbol, newValue: AnyIRValue): void;
}

export class DictVarsContainer implements IVarsContainer {
    vars: Record<
        string | symbol,
        | { mutable: false; value: AnyIRValue; symbol: ts.Symbol }
        | { mutable: true; valuePtr: IRValuePtr; symbol: ts.Symbol }
    > = {};

    constructor(vars: typeof DictVarsContainer.prototype.vars) {
        this.vars = vars;
    }

    hasVariable(name: string | symbol): boolean {
        return name in this.vars;
    }

    getVariablePtr(ctx: ScopeContext, name: string | symbol): IRValuePtr | undefined {
        const v = this.vars[name];
        if (v.mutable) return v.valuePtr;
        console.warn(`not var ptr for ${name.toString()}`);
        return undefined;
    }

    loadVariable(ctx: ScopeContext, name: string | symbol): AnyIRValue {
        const v = this.vars[name];
        if (!v.mutable) return v.value;
        return v.valuePtr.createLoad(ctx);
    }

    storeVariable(ctx: ScopeContext, name: string | symbol, newValue: AnyIRValue): void {
        const v = this.vars[name];
        if (!v.mutable) {
            console.warn(`assign value to constant var; swapping by name`);
            this.vars[name] = { ...v, value: newValue };
            return;
        }

        v.valuePtr.createStore(ctx, newValue);
    }
}

export class ScopeObjectVarsContainer implements IVarsContainer {
    constructor(public readonly scopeObject: IRObjectInstance) {}

    hasVariable(name: string | symbol): boolean {
        return this.scopeObject.hasVariable(name);
    }

    getVariablePtr(ctx: ScopeContext, name: string | symbol): IRObjectFieldPtr {
        return this.scopeObject.createVariablePtr(ctx, name);
    }

    loadVariable(ctx: ScopeContext, name: string | symbol): AnyIRValue {
        return this.scopeObject.loadVariable(ctx, name);
    }

    storeVariable(ctx: ScopeContext, name: string | symbol, newValue: AnyIRValue): void {
        this.scopeObject.storeVariable(ctx, name, newValue);
    }
}

export function createVarsContainer(ctx: ScopeContext, tsContainer: ContainerNode) {
    const localSymbols =
        (tsContainer.locals &&
            mapSymbolsTable(tsContainer.locals, (s, k) => {
                return { symbol: s, key: k };
            })) ||
        [];

    if (localSymbols.length === 0) {
        return undefined;
    }

    // check if any of var is referred in any non-root function body
    // it will mean that we should create scope object
    let shouldCreateScopeObject = false;

    if (!ts.isSourceFile(tsContainer)) {
        // find any reference that is outside of inner scopes
        walkNodeTree(tsContainer, (node) => {
            if (ts.isIdentifier(node)) {
                const symbol = ctx.checker.getSymbolAtLocation(node);

                const isFuncSymbol = symbol?.valueDeclaration && ts.isFunctionDeclaration(symbol?.valueDeclaration);
                if (isFuncSymbol) {
                    // skip function references, as it is passed globally
                    // ?? TODO: somehow detect if we pass it by FunctionObject
                    return;
                }
                if (!symbol?.valueDeclaration) {
                    return;
                }

                let declContainer: ContainerNode | undefined = undefined;
                walkUp(symbol.valueDeclaration, (x) => {
                    if (isContainerNode(x)) {
                        declContainer = x;
                        return StopSymbol;
                    }
                });

                if (!declContainer) {
                    throw new Error(`container node not found for ${node.getText()}`);
                }

                if (declContainer === tsContainer) {
                    console.log("decl scope same", node.getText(), " \n", node.parent?.getText());
                    return;
                }

                let declScopeIsParent = false;
                walkUp(tsContainer, (x) => {
                    if (x === declContainer) {
                        declScopeIsParent = true;
                        return StopSymbol;
                    }
                });

                if (declScopeIsParent) {
                    shouldCreateScopeObject = true;
                    return StopSymbol;
                }
            }
        });
    }
    let varsContainer: IVarsContainer;

    if (shouldCreateScopeObject) {
        const r = createCodeBlockScopeObject(ctx, tsContainer, ctx.null_i8ptr());
        const scopeObject = r.typeMeta.create(ctx);
        varsContainer = new ScopeObjectVarsContainer(new IRObjectInstance(scopeObject, r.typeMeta));
        console.log("varsContainer", varsContainer);
    } else {
        const entires: [key: string, value: ConstructorParameters<typeof DictVarsContainer>[0][string]][] =
            localSymbols.map(({ symbol, key }) => {
                // TODO: if not const declaration
                const varDesc = {
                    mutable: false,
                    value: undefined!,
                    symbol,
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

export function getVarsContainer(ctx: ScopeContext, node: ts.Node): IVarsContainer | undefined {
    const x = (node as any)[VARS_CONTAINER_IN_NODE];
    if (x) return x;

    if (!isContainerNode(node)) {
        console.error(node);
        throw new Error(`failed create varscontainer for not container node`);
    }

    const y = createVarsContainer(ctx, node)!;
    _setVarsContainer(node, y);
    return y;
}

export function hasVarsContainer(node: ts.Node): boolean {
    return !!(node as any)[VARS_CONTAINER_IN_NODE];
}

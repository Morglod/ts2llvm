import ts from "typescript";
import { ScopeContext } from "../context";
import { ContainerNode, filterNodeTreeAsTree, isContainerNode, StopSymbol, walkNodeTree, walkUp } from "../ts-utils";
import { ObjTypeDesc } from "../types";
import { mapSymbolsTable } from "../utils";
import { createCodeBlockScopeObject } from "./functions";

export interface IVarsContainer {
    hasVariable(name: string | symbol): boolean;
    getVariablePtr(ctx: ScopeContext, name: string | symbol): llvm.Value | undefined;
    loadVariable(ctx: ScopeContext, name: string | symbol): llvm.Value;
    storeVariable(ctx: ScopeContext, name: string | symbol, newValue: llvm.Value): void;
}

export class DictVarsContainer implements IVarsContainer {
    vars: Record<
        string | symbol,
        | { mutable: false; value: llvm.Value; symbol: ts.Symbol }
        | { mutable: true; valuePtr: llvm.Value; symbol: ts.Symbol }
    > = {};

    constructor(vars: typeof DictVarsContainer.prototype.vars) {
        this.vars = vars;
    }

    hasVariable(name: string | symbol): boolean {
        return name in this.vars;
    }

    getVariablePtr(ctx: ScopeContext, name: string | symbol): llvm.Value | undefined {
        const v = this.vars[name];
        if (v.mutable) return v.valuePtr;
        console.warn(`not var ptr for ${name.toString()}`);
        return undefined;
    }

    loadVariable(ctx: ScopeContext, name: string | symbol): llvm.Value {
        const v = this.vars[name];
        if (!v.mutable) return v.value;
        return ctx.builder.CreateLoad(v.valuePtr.getType().getPointerElementType(), v.valuePtr);
    }

    storeVariable(ctx: ScopeContext, name: string | symbol, newValue: llvm.Value): void {
        const v = this.vars[name];
        if (!v.mutable) {
            console.warn(`assign value to constant var; swapping by name`);
            this.vars[name] = { ...v, value: newValue };
            return;
        }
        ctx.builder.CreateStore(newValue, v.valuePtr);
    }
}

export class ScopeObjectVarsContainer implements IVarsContainer {
    constructor(
        public readonly scopeObject: llvm.Value,
        public readonly scopeObjectDesc: { typeId: number; typeMeta: ObjTypeDesc }
    ) {}

    hasVariable(name: string | symbol): boolean {
        return !!this.scopeObjectDesc.typeMeta.fields.find((x) => x.name === name);
    }

    getVariablePtr(ctx: ScopeContext, name: string | symbol): llvm.Value {
        return this.scopeObjectDesc.typeMeta.getField(ctx, this.scopeObject, name).fieldPtr;
    }

    loadVariable(ctx: ScopeContext, name: string | symbol): llvm.Value {
        const ptr = this.scopeObjectDesc.typeMeta.getField(ctx, this.scopeObject, name).fieldPtr;
        return ctx.builder.CreateLoad(ptr.getType().getPointerElementType(), ptr);
    }

    storeVariable(ctx: ScopeContext, name: string | symbol, newValue: llvm.Value): void {
        this.scopeObjectDesc.typeMeta.setField(ctx, this.scopeObject, name, newValue);
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

    let varsContainer: IVarsContainer;

    if (shouldCreateScopeObject) {
        const r = createCodeBlockScopeObject(ctx, tsContainer, ctx.null_i8ptr());
        const scopeObject = r.typeMeta.create(ctx);
        varsContainer = new ScopeObjectVarsContainer(scopeObject, r);
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

export function getVarsContainer(node: ts.Node): IVarsContainer | undefined {
    return (node as any)[VARS_CONTAINER_IN_NODE];
}

export function hasVarsContainer(node: ts.Node): boolean {
    return !!(node as any)[VARS_CONTAINER_IN_NODE];
}

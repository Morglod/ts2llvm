import ts from "typescript";
import { analyzeVarContainers } from "../builder/vars";

export function hasNameIdentifier(node: ts.Node): node is ts.Node & { name: ts.Identifier } {
    if (
        "name" in node &&
        node.name &&
        "kind" in (node as any).name &&
        (node.name as any).kind === ts.SyntaxKind.Identifier
    ) {
        return true;
    }
    return false;
}

export function isContainerNode(node: ts.Node): node is ContainerNode {
    if ("locals" in node && !!node.locals && "forEach" in (node as any).locals) {
        return true;
    }
    return false;
}

export function hasIdentifiers(node: ts.Node): node is ts.Node & { identifiers: ts.ESMap<string, ts.Identifier> } {
    if ("identifiers" in node && !!node.identifiers && "forEach" in (node as any).identifiers) {
        return true;
    }
    return false;
}

export function isFunctionBlock(node: ts.Node): node is ts.Block {
    return ts.isBlock(node) && ts.isFunctionLike(node.parent);
}

export type ContainerNode = ts.Node & {
    locals: ts.SymbolTable | undefined;
};

export function parseModuleContainers(sourceFile: ts.SourceFileLike): ContainerNode[] {
    const arr: ContainerNode[] = [];

    let nextContainer: any = sourceFile;
    while (nextContainer) {
        arr.push(nextContainer);
        nextContainer = nextContainer.nextContainer;
    }

    return arr;
}

export function findContainerNodeByDeclarationId(startFrom: ts.Node, id: string): ContainerNode | undefined {
    do {
        if (isContainerNode(startFrom)) {
            if (startFrom.locals?.has(id as ts.__String)) {
                return startFrom;
            }
        }
        startFrom = startFrom.parent;
    } while (!!startFrom);

    return undefined;
}

export function filterNodeTree(node: ts.Node, predicate: (node: ts.Node) => boolean | StopSymbol): ts.Node[] {
    const result: ts.Node[] = [];
    const eachChild = (node: ts.Node): any => {
        const p = predicate(node);
        if (p) {
            result.push(node);
            if (p === StopSymbol) return StopSymbol;
        }
        return ts.forEachChild(node, eachChild);
    };
    eachChild(node);
    return result;
}

type FilterTreeResult = {
    node: ts.Node;
    children: FilterTreeResult[];
};

export const StopSymbol = Symbol("StopSymbol");
type StopSymbol = typeof StopSymbol;

function filterNodeTreeAsTree_recursion(
    node: ts.Node,
    predicate: (node: ts.Node) => boolean | StopSymbol,
    outResult: FilterTreeResult[]
): void {
    const eachChild = (node: ts.Node): any => {
        const p = predicate(node);
        if (p) {
            const r = {
                node,
                children: [],
            };
            outResult.push(r);
            if (p === StopSymbol) return StopSymbol;
            return ts.forEachChild(node, (child) => filterNodeTreeAsTree_recursion(child, predicate, r.children));
        } else {
            return ts.forEachChild(node, eachChild);
        }
    };
    return eachChild(node);
}

export function filterNodeTreeAsTree(
    node: ts.Node,
    predicate: (node: ts.Node) => boolean | StopSymbol
): FilterTreeResult[] {
    const result: FilterTreeResult[] = [];
    filterNodeTreeAsTree_recursion(node, predicate, result);
    return result;
}

export function walkNodeTree(node: ts.Node, walker: (node: ts.Node) => void | StopSymbol): void {
    const eachChild = (node: ts.Node): any => {
        if (walker(node) === StopSymbol) return StopSymbol;
        return ts.forEachChild(node, eachChild);
    };
    eachChild(node);
}

export function walkUp(node: ts.Node, walker: (node: ts.Node) => void | StopSymbol) {
    while (node) {
        if (walker(node) === StopSymbol) return;
        node = node.parent;
    }
}

export function isFunctionLikeDeclaration(node: ts.Node): node is ts.FunctionLikeDeclaration {
    return (
        ts.isArrowFunction(node) ||
        ts.isFunctionExpression(node) ||
        ts.isFunctionDeclaration(node) ||
        ts.isMethodDeclaration(node) ||
        ts.isGetAccessorDeclaration(node) ||
        ts.isSetAccessorDeclaration(node) ||
        ts.isConstructorDeclaration(node)
    );
}

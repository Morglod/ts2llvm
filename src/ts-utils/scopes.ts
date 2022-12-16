import ts from "typescript";

// function getIfNamedDeclaration(node: ts.Node) {
//     if (
//         "name" in node &&
//         node.name &&
//         "kind" in (node as any).name &&
//         (node.name as any).kind === ts.SyntaxKind.Identifier
//     ) {
//         return node.name as ts.Identifier;
//     }
//     return undefined;
// }

export type ModuleContainer = ts.Node & {
    locals: ts.SymbolTable;
};

export function parseModuleContainers(sourceFile: ts.SourceFileLike): ModuleContainer[] {
    const arr: ModuleContainer[] = [];

    let nextContainer: any = sourceFile;
    while (nextContainer) {
        arr.push(nextContainer);
        nextContainer = nextContainer.nextContainer;
    }

    return arr;
}

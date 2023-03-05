// NOT WORKING

import { writeFileSync } from "fs";
import ts from "typescript";
import { pickStructNameTsType } from "../ir/builder";
import { filterUndefined, nextUUID } from "../utils";

class Writer {
    header: string[] = [];
    body: string[] = [];
    footer: string[] = [];

    appendHeader(s: string) {
        this.header.push(s);
    }
    appendBody(s: string) {
        this.body.push(s);
    }
    appendFooter(s: string) {
        this.footer.push(s);
    }

    compile() {
        return this.header.join("\n") + "\n" + this.body.join("\n") + "\n" + this.footer.join("\n");
    }
}

class Ctx {
    constructor(public readonly w: Writer, public readonly checker: ts.TypeChecker) {}

    appendHeader(s: string) {
        this.w.appendHeader(s);
    }
    appendBody(s: string) {
        this.w.appendBody(s);
    }
    appendFooter(s: string) {
        this.w.appendFooter(s);
    }

    typesByName: Record<string, string> = {};
}

export function compileTsToCpp(rootNames: string[], options: ts.CompilerOptions, host?: ts.CompilerHost) {
    const program = ts.createProgram(rootNames, options, host);
    const checker = program.getTypeChecker();
    const writer = new Writer();
    const ctx = new Ctx(writer, checker);

    // builtins
    writer.appendHeader(`
        #include <memory>
        #include <string>

        enum class __builtin_typeof : uint8_t {
            unknown = 0,
            number = 1,
            string = 2,
            function = 3,
            object = 4, // typeof null === 'object'
            symbol = 5,
            undefined = 6,
            boolean = 7,
            bigint = 8
        };

        typedef std::string __builtin_string;

        class __builtin_any_base : private std::enable_shared_from_this<__builtin_any_base> {
        public:
            std::shared_ptr<__builtin_any_base> get_ptr() {
                return shared_from_this();
            }

            virtual __builtin_typeof get_typeof_index() const {
                return __builtin_typeof::unknown;
            }
        };

        class __builtin_object_base : public __builtin_any_base {
        public:
            __builtin_typeof get_typeof_index() const override {
                return __builtin_typeof::object;
            }
        };

        template<typename FuncT>
        class __builtin_function_base : public __builtin_any_base {
        public:
            std::function<FuncT> func;

            std::shared_ptr<__builtin_any_base> get_ptr() {
                return shared_from_this();
            }

            __builtin_typeof get_typeof_index() const override {
                return __builtin_typeof::function;
            }
        };
    `);

    for (const sourceFile of program.getSourceFiles()) {
        if (sourceFile.fileName.includes("node_modules/@types/")) continue;
        if (sourceFile.fileName.includes("main.ts")) {
            const result = pSourceFile(ctx, sourceFile);
        }
    }

    writeFileSync("./example/generated.cpp", ctx.w.compile());
}

function pSourceFile(ctx: Ctx, src: ts.SourceFile) {
    ts.forEachChild(src, (node) => {
        pDeclaration(ctx, node);
    });
}

function pDeclaration(ctx: Ctx, node: ts.Node) {
    if (ts.isFunctionDeclaration(node)) {
        const func = pFunction(ctx, node);
        return func;
    }

    if (ts.isTypeAliasDeclaration(node)) {
        const typeName = node.name.getText();
        const t = pTypeNode(ctx, node.type, typeName);
        ctx.typesByName[typeName] = t;
        // TODO: scope our types not just llvm
        return t;
    }

    if (ts.isVariableStatement(node)) {
        for (const declNode of node.declarationList.declarations) {
            const varName = declNode.name.getText();

            // TODO: (1) temp constant builtin names; remove this later
            const builtins = ["_i32_symbol", "_i8_symbol", "_i8ptr_symbol", "i32", "i8", "i8ptr"];
            if (builtins.includes(varName)) {
                return "void";
            }

            if (declNode.initializer) {
                const tsType = declNode.type
                    ? ctx.checker.getTypeFromTypeNode(declNode.type)
                    : ctx.checker.getTypeAtLocation(declNode);

                const varPtr = `${varName}`;

                if (ts.isObjectLiteralExpression(declNode.initializer)) {
                    const node = declNode.initializer;
                    assignObjLiteralExpression(ctx, varPtr, node);
                } else {
                    const expr = rhsExpression(ctx, declNode.initializer, tsType);
                    if (expr instanceof IRFuncValue) {
                        // TODO
                        throw new Error("qwe");
                    }

                    ctx.b.createStore(varPtr, expr);
                }
                return varPtr;
            } else {
                throw new Error(`declaration without .initializer not yet supported`);
                // ctx.setScopeValue(varName, undefined);
            }
        }
    }

    return undefined;
}

function pFunctionType(ctx: Ctx, node: ts.FunctionLikeDeclaration) {
    const returnType = pTypeNode(ctx, node.type);
    const paramTypes = node.parameters.map((param) => ({
        name: param.name.getText(),
        type: pTypeNode(ctx, param.type),
    }));
    return { returnType, paramTypes };
}

function pFunction(ctx: Ctx, node: ts.FunctionLikeDeclaration) {
    const funcName = node.name?.getText() || nextUUID("func");
    const { returnType, paramTypes } = pFunctionType(ctx, node);

    const funcDecl = `${returnType} ${funcName}(${paramTypes.map((x) => `${x.type} ${x.name}`).join(", ")})`;

    let out: string;

    let bodyCode: string | undefined = undefined;
    if (node.body) {
        bodyCode = pFuncBodyCodeBlock(ctx, node.body);
        out = `${funcDecl} {\n${bodyCode}\n}`;
        ctx.appendBody(out);
    } else {
        out = `${funcDecl};`;
        ctx.appendBody(out);
    }

    return funcName;
}

function pFuncBodyCodeBlock(ctx: Ctx, block: ts.FunctionBody | ts.ConciseBody): string {}

function pTypeNode(ctx: Ctx, node: ts.TypeNode | undefined, name: string | undefined = undefined) {
    if (node === undefined) return "void";

    const typeName = node.getText();

    const byName = resolveTypeByName(ctx, typeName);
    if (byName) return byName;

    if (ts.isTypeLiteralNode(node)) {
        const rslvdType = resolveTypeFromType(ctx, ctx.checker.getTypeFromTypeNode(node));
        if (rslvdType) {
            return rslvdType;
        }
    }

    console.error(`cannot resolve llvm type from this; resolving as 'void':`);
    console.error(node.getText() + "\n");

    return "void";
}

function resolveTypeByName(ctx: Ctx, name: string): string | undefined {
    if (name === "__type") {
        throw new Error('resolveTypeByName: could not resolve by name "__type"; handle this case in calling code');
    }
    if (name === "number") {
        return "double";
    }
    if (name === "void") {
        return "void";
    }
    if (name === "string") {
        return "__builtin_string";
    }
    if (name === "i32") {
        return "i32_t";
    }
    if (name === "i8") {
        return "i8_t";
    }
    if (name === "i8ptr") {
        return "i8_t*";
    }
    if (name === "never") {
        console.warn("something goes wrong if we trying to get type for 'never'");
        return "void";
    }
    if (name === "boolean") {
        return "bool";
    }
    if (name === "undefined") {
        console.warn("'undefined' type not fully supported");
        return "void*";
    }
    if (name === "null") {
        console.warn("'null' type not fully supported");
        return "void*";
    }
    if (name === "any") {
        console.warn("'any' type not supported, resolving as 'void'");
        return "void*";
    }

    if (name in ctx.typesByName) {
        return ctx.typesByName[name];
    }
}

const CACHED_TYPE = Symbol("cachedLLVMType");

export function resolveTypeFromType(ctx: Ctx, type: ts.Type): string {
    if ((type as any)[CACHED_TYPE]) {
        return (type as any)[CACHED_TYPE];
    }

    const typeName = type.getSymbol()?.name || ctx.checker.typeToString(type);

    if (typeName !== "__type") {
        const found = resolveTypeByName(ctx, typeName);
        if (found) {
            (type as any)[CACHED_TYPE] = found;
            return found;
        }
    }

    const props = type.getProperties();
    if (props.length) {
        const fields = filterUndefined(
            props
                .map((m) => {
                    let fieldTsType: ts.Type;
                    if (m.valueDeclaration) fieldTsType = ctx.checker.getTypeAtLocation(m.valueDeclaration);
                    else if (m.declarations && m.declarations.length) {
                        if (m.declarations.length !== 1) {
                            console.error(m);
                            throw new Error(`dont know what to do with 2+ declarations of symbol`);
                        }
                        fieldTsType = ctx.checker.getTypeAtLocation(m.declarations[0]);
                    } else {
                        console.error(m);
                        throw new Error(`dont know how to get type of symbol`);
                    }

                    return {
                        type: resolveTypeFromType(ctx, fieldTsType),
                        name: m.name,
                    };
                })
                .filter(Boolean)
        );

        const typeName = pickStructNameTsType(type);

        const structCode = `
            class ${typeName} : public __builtin_object_base {
            public:
                struct Fields {
                    ${fields.map((x) => `${x.type} ${x.name}`).join(";\n")}
                };
                Fields fields;
            };
        `;

        ctx.appendBody(structCode);

        const exportType = `std::shared_ptr<${typeName}>`;

        ctx.typesByName[typeName] = exportType;
        (type as any)[CACHED_TYPE] = exportType;
        return exportType;
    }

    if (type.getCallSignatures().length !== 0) {
        console.error(type);
        throw new Error(`failed resolve function type`);
        // return parseFunctionTypeFromSignature(ctx, type.getCallSignatures()[0]);
    }

    console.error(type);
    throw new Error(`failed resolve llvm type`);
}

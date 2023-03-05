import ts from "typescript";
import llvm from "llvm-bindings";
import { ModuleScope, ProgramScope, DeclScope } from "../context";
import { parseDeclaration } from "./declarations";
import { createFunctionType, parseFunction, parseFunctionType, parseFunctionTypeFromCallLikeExpr } from "./functions";
import { ContainerNode, isContainerNode, isFunctionLikeDeclaration } from "../ts-utils";
import { getIRFuncFromNode, IRFuncValue } from "../ir/func";
import { getTypeMetaExact } from "../llvm-meta-cache/types-meta-cache";
import { generateStructTypeForTsType, isPointerTy, LLVMBuilder } from "../ir/builder";
import { CombileVarsContainer, DictVarsContainer, IVarsContainer, ReferencedVarsContainer } from "./vars";

function createFuncArgVars(
    b: LLVMBuilder,
    funcArgs: {
        arg: llvm.Argument;
        llvmArgIndex: number;
        name: string;
    }[]
): DictVarsContainer {
    const funcArgsContainer = new DictVarsContainer(
        funcArgs.reduce((sum, x, xi) => {
            let varPtr: llvm.Value = x.arg;
            if (!isPointerTy(x.arg.getType())) {
                varPtr = b.createStackVariable(x.arg.getType(), "arg" + xi);
                b.createStore(varPtr, x.arg);
            }

            sum[x.name] = {
                mutable: true,
                valuePtr: varPtr,
            };
            return sum;
        }, {} as ConstructorParameters<typeof DictVarsContainer>[0])
    );
    return funcArgsContainer;
}

// TODO: create different func for inner blocks
export function funcBodyCodeBlock(
    funcDeclCtx: DeclScope,
    node: ts.Block | ts.ConciseBody,
    name: string | undefined,
    parentFunc: IRFuncValue,
    appendBlockBeforeReturn?: () => void
) {
    const ctx = funcDeclCtx.unsafe_createChildScope({ tsNode: node });

    const prevIp = ctx.b.saveAndClearInsertPoint();

    const bb = llvm.BasicBlock.Create(ctx.c, name, parentFunc?.funcLLVM);
    ctx.b.setInsertPoint(bb);

    const funcArgsContainer = createFuncArgVars(ctx.b, parentFunc.funcArgs);

    ctx.b.createInitScope(ctx, undefined);
    ctx._vars = new CombileVarsContainer(funcArgsContainer, ctx._vars!);

    ts.forEachChild(node, (node) => {
        if (parseDeclaration(ctx, node)) {
            return; // continue
        }

        if (ts.isExpressionStatement(node)) {
            if (ts.isCallExpression(node.expression)) {
                rhsExpression(ctx, node.expression);
            }

            // assigment
            if (
                ts.isBinaryExpression(node.expression) &&
                node.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken
            ) {
                const propertyPtr = lhsExpression(ctx, node.expression.left)!;
                const value = rhsExpression(ctx, node.expression.right);

                if (propertyPtr instanceof IRFuncValue) {
                    // TODO: support ctx.b.createStore(propertyPtr, value);
                    throw new Error("qwe");
                }

                if (value instanceof IRFuncValue) {
                    // TODO: support ctx.b.createStore(propertyPtr, value);
                    throw new Error("qwe");
                } else {
                    ctx.b.createStore(propertyPtr, value);
                }
            }
        }
    });

    ctx.deferred_runAndClear();
    appendBlockBeforeReturn && appendBlockBeforeReturn();
    ctx.b.createRetVoid();

    ctx.b.restoreInsertPoint(prevIp);
}

export function rhsExpression(
    ctx: DeclScope,
    node: ts.Expression,
    exprType: ts.Type | undefined = undefined
): llvm.Value | IRFuncValue {
    if (ts.isIdentifier(node)) {
        // TODO: undefined or null should be special type?
        if (node.getText() === "undefined") {
            return ctx.b.null_i8ptr();
        }
        if (node.getText() === "null") {
            return ctx.b.null_i8ptr();
        }

        const decl = ctx.checker.getSymbolAtLocation(node)?.getDeclarations()?.[0];
        if (decl) {
            if (isFunctionLikeDeclaration(decl)) {
                const irfunc = getIRFuncFromNode(decl);
                if (!irfunc) throw new Error("qwe");
                return irfunc;
            }
        }

        const found = ctx.createVarPtr(node.getText());
        if (!found) {
            throw new Error(
                `failed resolve rhsExpression; identifier '${node.getText()}' not found in scope\nparent:\n ${node.parent.getText()}`
            );
        }
        return found;
    }

    if (ts.isArrowFunction(node)) {
        // TODO: support get function as value
        throw new Error("not yet supported");
    }

    if (ts.isCallExpression(node)) {
        const funcType = parseFunctionTypeFromCallLikeExpr(ctx, node);
        const callOf = rhsExpression(ctx, node.expression);

        const args = node.arguments.map((expr, argI) => {
            let exp = rhsExpression(ctx, expr);
            if (exp instanceof IRFuncValue) {
                // TODO
                throw new Error("dont know how to pass func arg");
            }
            return exp;
        });

        if (callOf instanceof IRFuncValue) {
            return ctx.b.createCall(callOf, args);
        } else {
            // TODO
            throw new Error("dont know how to call not func");
        }
    }

    if (ts.isNumericLiteral(node)) {
        const num = +node.getText();
        const doubleTy = llvm.Type.getDoubleTy(ctx.c);
        const value = llvm.ConstantFP.get(doubleTy, num);
        return value;
    }

    if (ts.isStringLiteral(node)) {
        const text = node.text;
        const value = ctx.b.createGlobalStringPtr(text);
        return value;
    }

    if (ts.isPropertyAccessExpression(node)) {
        // TODO: move this code to IRObjectInstance
        const fieldName = node.name.getText();
        const objName = node.expression.getText();
        const obj = ctx.createVarPtr(objName);
        const fieldPtr = ctx.b.createPointerToField(obj, [fieldName]);
        return ctx.b.createLoad(fieldPtr);
    }

    if (ts.isObjectLiteralExpression(node)) {
        const tsType = exprType || ctx.checker.getTypeAtLocation(node);

        const { type: structType, meta: structMeta } = generateStructTypeForTsType(ctx, node, tsType);
        const objValuePtr = ctx.b.createHeapVariable(structType, "expr");

        assignObjLiteralExpression(ctx, objValuePtr, node);

        ctx.deferred_push((ctx) => {
            // TODO: gc
            // typeDesc.decRefCounter(ctx, objValue);
        });

        return objValuePtr;
    }

    throw new Error(`failed resolve rhsExpression at:\n  ${node.getText()}\nfrom:\n  ${node.parent.getText()}\n`);
}

export function lhsExpression(ctx: DeclScope, node: ts.Expression): llvm.Value | IRFuncValue {
    if (ts.isIdentifier(node)) {
        const found = ctx.createVarPtr(node.getText());
        // TODO: pointer to this value
        if (!found) {
            throw new Error(`failed resolve lhsExpression; identifier '${node.getText()}' not found in scope`);
        }
        return found;
    }

    if (ts.isPropertyAccessExpression(node)) {
        // TODO: move this code to IRObjectInstance
        const fieldName = node.name.getText();
        const objName = node.expression.getText();
        const obj = ctx.createVarPtr(objName);
        const fieldPtr = ctx.b.createPointerToField(obj, [fieldName]);
        return fieldPtr;
    }

    return rhsExpression(ctx, node);
}

export function assignObjLiteralExpression(ctx: DeclScope, varPtr: llvm.Value, node: ts.ObjectLiteralExpression) {
    for (const initProp of node.properties) {
        if (ts.isPropertyAssignment(initProp)) {
            const newFieldValue = rhsExpression(ctx, initProp.initializer);
            const fieldPtr = ctx.b.createPointerToField(varPtr, [initProp.name.getText()]);
            if (newFieldValue instanceof IRFuncValue) {
                // TODO
                throw new Error("qwe");
            } else {
                ctx.b.createStore(fieldPtr, newFieldValue);
            }
        } else {
            console.error("unsupported initProp");
            console.error(initProp);
        }
    }
}

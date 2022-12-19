import ts from "typescript";
import llvm from "llvm-bindings";
import { ModuleContext, ProgramContext, ScopeContext } from "../context";
import { ObjTypeDesc } from "../types";
import { parseDeclaration } from "./declarations";
import {
    callFunction,
    createCodeBlockScopeObject,
    createFunctionType,
    parseFunction,
    parseFunctionType,
    parseFunctionTypeFromSignature,
} from "./functions";
import { generateObjectTypeForTsType } from "./objects";
import { ContainerNode } from "../ts-utils";

export function codeBlock(
    ctx: ScopeContext,
    node: ts.Block | ts.ConciseBody,
    name: string | undefined,
    parentFunc: llvm.Function | undefined,
    appendBlockBeforeReturn?: () => void
) {
    ctx = ctx.createChildScope({ tsNode: node });
    createCodeBlockScopeObject(ctx, node as any as ContainerNode, ctx.null_i8ptr()); // TODO: move scope objects to specialized ScopeContexts

    const prevIp = ctx.builder.saveAndClearIP();
    {
        const bb = llvm.BasicBlock.Create(ctx.llvmContext, name, parentFunc);
        ctx.builder.SetInsertPoint(bb);
    }

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
                const property = lhsExpression(ctx, node.expression.left)!;
                const value = rhsExpression(ctx, node.expression.right);
                ctx.builder.CreateStore(value, property);
            }
        }
    });

    ctx.deferred_runAndClear();
    appendBlockBeforeReturn && appendBlockBeforeReturn();
    ctx.builder.CreateRetVoid();

    try {
        ctx.builder.restoreIP(prevIp);
    } catch {}
}

export function rhsExpression(
    ctx: ScopeContext,
    node: ts.Expression,
    exprType: ts.Type | undefined = undefined
): llvm.Value {
    if (ts.isIdentifier(node)) {
        // TODO: undefined or null should be special type?
        if (node.getText() === "undefined") {
            return ctx.null_i8ptr();
        }
        if (node.getText() === "null") {
            return ctx.null_i8ptr();
        }

        const found = ctx.findVarContainer(node.getText())?.loadVariable(ctx, node.getText());
        if (!found) {
            throw new Error(
                `failed resolve rhsExpression; identifier '${node.getText()}' not found in scope\nparent:\n ${node.parent.getText()}`
            );
        }
        return found;
    }

    if (ts.isArrowFunction(node)) {
        return parseFunction(ctx, node);
    }

    if (ts.isCallExpression(node)) {
        const funcType = parseFunctionTypeFromSignature(ctx, node);
        const callOf = rhsExpression(ctx, node.expression);

        const args = node.arguments.map((expr, argI) => {
            let exp = rhsExpression(ctx, expr);
            return exp;
        });

        return callFunction(ctx, funcType, callOf, args);
    }

    if (ts.isNumericLiteral(node)) {
        const num = +node.getText();
        const doubleTy = llvm.Type.getDoubleTy(ctx.llvmContext);
        const value = llvm.ConstantFP.get(doubleTy, num);
        return value;
    }

    if (ts.isStringLiteral(node)) {
        const text = node.text;
        const value = ctx.builder.CreateGlobalStringPtr(text);
        return value;
    }

    if (ts.isPropertyAccessExpression(node)) {
        const fieldName = node.name.getText();
        const objName = node.expression.getText();
        const obj = ctx.findVarContainer(objName)?.loadVariable(ctx, objName)!;
        const tsType = ctx.checker.getTypeAtLocation(node.expression);
        const foundTypeId = ctx.types.findObjTypeId_byTsType(tsType)!;
        const { fieldPtr, fieldDesc } = ctx.types.getByTypeId(foundTypeId).getField(ctx, obj, fieldName);
        return ctx.builder.CreateLoad(fieldDesc.type, fieldPtr);
    }

    if (ts.isObjectLiteralExpression(node)) {
        const tsType = exprType || ctx.checker.getTypeAtLocation(node);

        let typeId = ctx.types.findObjTypeId_byTsType(tsType);
        let typeDesc: ObjTypeDesc;

        if (!typeId) {
            const r = generateObjectTypeForTsType(ctx, node, tsType);
            typeId = r.typeId;
            typeDesc = r.typeMeta;
        } else {
            typeDesc = ctx.types.getByTypeId(typeId);
        }

        const objValue = typeDesc.create(ctx);

        for (const initProp of node.properties) {
            if (ts.isPropertyAssignment(initProp)) {
                const newFieldValue = rhsExpression(ctx, initProp.initializer);
                typeDesc.setField(ctx, objValue, initProp.name.getText(), newFieldValue);
            } else {
                console.error("unsupported initProp");
                console.error(initProp);
            }
        }

        ctx.deferred_push((ctx) => {
            typeDesc.decRefCounter(ctx, objValue);
        });

        return objValue;
    }

    throw new Error(`failed resolve rhsExpression at:\n  ${node.getText()}\nfrom:\n  ${node.parent.getText()}\n`);
}

export function lhsExpression(ctx: ScopeContext, node: ts.Expression): llvm.Value {
    if (ts.isIdentifier(node)) {
        const found = ctx.findVarContainer(node.getText())?.getVariablePtr(ctx, node.getText());
        // TODO: pointer to this value
        if (!found) {
            throw new Error(`failed resolve lhsExpression; identifier '${node.getText()}' not found in scope`);
        }
        return found;
    }

    if (ts.isPropertyAccessExpression(node)) {
        const fieldName = node.name.getText();
        const objName = node.expression.getText();
        const obj = ctx.findVarContainer(objName)?.loadVariable(ctx, objName)!;
        const tsType = ctx.checker.getTypeAtLocation(node.expression);
        const foundTypeId = ctx.types.findObjTypeId_byTsType(tsType)!;
        const { fieldPtr } = ctx.types.getByTypeId(foundTypeId).getField(ctx, obj, fieldName);
        return fieldPtr;
    }

    return rhsExpression(ctx, node);
}

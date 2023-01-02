//
//
// Idea is to somehow store additional info about types and attach it to llvm.Type
//
//

import llvm from "llvm-bindings";
import { derefTypeLLVM } from "../ir/builder";
import { MetaFuncObjectType, MetaObjectRcType, MetaScopeObjectType, MetaStructType } from "./obj";

type MetaEntity = MetaStructType | MetaObjectRcType | MetaFuncObjectType | MetaScopeObjectType;

class TypesMetaCache {
    cache: { type: llvm.Type; meta: MetaEntity }[] = [];
}

/** singletone instance */
const typesMetaCache = new TypesMetaCache();

export function getTypeMeta(t: llvm.Type, shouldExist: false | "metaShouldExist" = false): MetaEntity | undefined {
    // TODO: error smell if we pass pointer to searching type instead type
    t = derefTypeLLVM(t);

    const m = typesMetaCache.cache.find((x) => llvm.Type.isSameType(x.type, t));
    if (!m && shouldExist) throw new Error("meta should exist for this type");
    return m?.meta;
}

export function getTypeMetaExact<T extends new (...args: any) => MetaEntity>(
    t: llvm.Type,
    classOf: T,
    shouldExist: false | "metaShouldExist" = false
): InstanceType<T> | undefined {
    const m = getTypeMeta(t, shouldExist);
    if (m && m instanceof classOf) {
        return m as any;
    }
    return undefined;
}

export function getTypeMetaExactOrThrow<T extends new (...args: any) => MetaEntity>(
    t: llvm.Type,
    classOf: T,
    shouldExist: false | "metaShouldExist" = false
): InstanceType<T> {
    const m = getTypeMeta(t, shouldExist);
    if (m && m instanceof classOf) {
        return m as any;
    }
    console.error(debugTypeLLVM(t));
    throw new Error("exact meta of class not found");
}

export function setTypeMeta(t: llvm.Type, m: MetaEntity) {
    debugger;
    typesMetaCache.cache.push({ type: t, meta: m });
}

export function debugTypeLLVM(t: llvm.Type) {
    let dbgInfo = {} as any;
    dbgInfo.typeId = t.getTypeID();
    dbgInfo.type = t;

    let isStruct = false;
    try {
        dbgInfo.isStruct = isStruct = t.isStructTy();
    } catch {}

    let isPointer = false;
    try {
        dbgInfo.isPointer = isPointer = t.isPointerTy();
    } catch {}

    if (isStruct) {
        const st = t as llvm.StructType;
        dbgInfo.name = st.getName();
        dbgInfo.elements = Array.from({ length: st.getNumElements() }).map((_, i) => {
            const elt = st.getElementType(i);
            return debugTypeLLVM(elt);
        });
    } else if (isPointer) {
        dbgInfo.pointerElement = debugTypeLLVM(t.getPointerElementType());
    }

    return dbgInfo;
}

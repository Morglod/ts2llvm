import ts from "typescript";

export function filterUndefined<T>(arr: (T | undefined | null)[]): Exclude<T, undefined | null>[] {
    return arr.filter(Boolean) as any[];
}

export function mapSymbolsTable<T>(st: ts.SymbolTable, mapper: (symbol: ts.Symbol, key: ts.__String) => T): T[] {
    const entries: T[] = [];
    st.forEach((s, k) => {
        entries.push(mapper(s, k));
    });
    return entries;
}

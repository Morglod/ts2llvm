export function filterUndefined<T>(arr: (T | undefined | null)[]): Exclude<T, undefined | null>[] {
    return arr.filter(Boolean) as any[];
}

```

// Example

function foo(a: { x: number } | ((x: number) => number) | number) {
    if (typeof a === "function") {
        a(10);
    }
    if (typeof a === "object") {
        a.x += 10;
    }
    if (typeof a === "number") {
    }
}

function boo() {
    foo(20);
}

// 1 We need to determine at runtime typeof 'a'

vtables = [
    // here we statically store all vtables for all types
    // "vtable id" is just index in this array
]

struct vtable {
    // return "typeof" enum
    typeof: *(value: *BaseNotPod) -> u8
}

struct BaseNotPod {
    type flags,
    vtable id,
}

struct TypeA {
    ... BaseNotPod

    memory_placeholder[]
}

struct TypeA_number {
    ... BaseNotPod

    value: number

    memory_placeholder[]
}

getVtable = (value: *BaseNotPod) {
    vtable_id = value."vtable id";
    return &vtables[vtable_id];
}

typeof_not_pod = (value: *BaseNotPod) {
    vtable = getVtable(value);
    return vtable.typeof();
}

typeof_not_pod_str = (value: *BaseNotPod) {
    typeof_ind = typeof_not_pod(value);
    switch (typeof_ind) {
        case 0: return "number";
        case 1: return "string";
        case 2: return "object";
        ... etc
    }
}

// 2 we need to pack number to TypeA

pack_number_to_TypeA = (value: number) {
}

```

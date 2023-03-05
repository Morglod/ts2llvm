```
pure function -> function pointer

pure object method with this -> function pointer, first arg 'this'

non pure function -> pointer to struct ObjFunction {
    refCounter
    typeId

    function pointer (ObjFunction*, ...args)
    scopeObject
    thisObject
};
```

to check if function is pure, we run trough all nodes, trying to find any function declaration inside current scope;
if there are any variable inside, than our function is not pure

## Compilation of non pure functions

```
function foo() {
    let a = 123;

    function boo(x) {
        a = 4 + x;
    }

    function boo2(y) {
        a = 6 + y;
    }
}
```

becomes

```
function booFunc(ObjFunction* of, x) {
    ptra = of->scope->a;
    *ptra = 4 + x;
}

function boo2Func(ObjFunction* of, y) {
    ptra = of->scope->a;
    *ptra = 6 + y;
}

function foo() {
    %scopeObject = {
        a = 123
        boo = ObjFunction { %scopeObject, booFunc }
        boo2 = ObjFunction { %scopeObject, boo2Func }
        parent = %parentScopeObject
    }
}
```

##################

```
function forEach(arr, cb) {
    for (let i = 0; i < arr.length; ++i) {
        cb(arr[i], i);
    }
}

function main() {
    const arr1 = [1,2,3];

    forEach(arr1, (x,i) => x + arr[i]);
}
```

->

```
struct FuncAsArg_variant0 {
    variant: 0 - pure func
    funcPtr: (void* bf, ...args)
    scopePtr: null
}
struct FuncAsArg_variant1 {
    variant: 1 - lambda
    funcPtr: (T* bf, ...args)
    scopePtr: T*
}

function forEach(arr, cb: ) {
    for (let i = 0; i < arr.length; ++i) {
        cb(arr[i], i);
    }
}
```

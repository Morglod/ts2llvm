Any object's type structure:

```
struct Obj1 {
    refCounter
    typeId

    // ... fields ...

    i32 posX;
    i32 posY;

}
```

## GC

When passing object's value as argument:

```
obj->refCounter++;
```

When create obj:

```
deferred(() => {
    obj->refCounter--;
    if (obj->refCounter <= 0) gc_mark_release(obj);
})
```

When function scope ends (for each object argument):

```
deferred(() => {
    obj->refCounter--;
    if (obj->refCounter <= 0) gc_mark_release(obj);
})
```

## Equal types

Fields are always sorted by name inside struct,  
so two different struct types with reordered fields in typescript will be the same in llvm

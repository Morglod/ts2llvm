```
void -> void
never -> void
boolean -> i1
i32 -> i32
i8 -> i8
number -> double
i8ptr -> i8*

null -> i8*
undefined -> i8*
string -> i8*
array -> struct?

object reference -> pointer to struct {
    ref counter
    type id

    ... fields ...
}

function -> pointer to struct {
    call frame object

    this object

    function pointer (arg0: call frame pointer, ...args)
}

call scope object -> struct {
    ref counter
    typeid

    ... scope fields ...

    parentScope = *call scope object
}

```

any type should be accessed with helper functions 'interface like'
so for union or 'non default' or indexed types, we could tweak this methods

```
Global scope functions does not have scope-objects!!

1 start parsing function

2 check if we should create scope-object

conditions for scope-object creation:
    if function has any outside reference
        or
    if function's local variable is referenced by inner scope of function defined in inner scope

2.1     mark this function node as parsed in ModuleCtx scope

3 if we should create scope-object, than we should:

3.1     create scope object type { [parentScope], ...[localFields] }

3.2     map outside references as [parentScope]

3.3     map inside references as [localFields]

4 else - make first argument dangling

```

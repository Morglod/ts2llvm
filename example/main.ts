const _i32_symbol = Symbol("i32");
const _i8_symbol = Symbol("i8");
const _i8ptr_symbol = Symbol("i8ptr");
type i32 = typeof _i32_symbol | number;
type i8 = typeof _i8_symbol | number;
type i8ptr = typeof _i8ptr_symbol | number;
// declare function scheduler_step(): void;
// declare function gc_step(): void;

type Pos2 = {
    x: number;
    y: number;
};

declare function stdlib_sum(a: number, b: number): number;
declare function stdlib_log_number(a: number): void;

declare function print_string(x: string): i32;

function letsgo(pos: Pos2) {
    pos.x = stdlib_sum(pos.x, pos.x);
    stdlib_log_number(pos.x);
}

function entry() {
    const pos2: Pos2 = { x: 123, y: 10 };

    // function boo(pos: Pos2) {
    //     print_string("boo called");
    //     letsgo({
    //         x: pos2.x,
    //         y: pos.y,
    //     });
    // }
    // boo(pos2);

    const pos: Pos2 = {
        x: 20,
        y: 40,
    };
    const smth = {
        aaa: 123,
    };
    letsgo(pos);
    // boo(pos);
    // boo({
    //     y: 30,
    //     x: 40,
    // });

    print_string("hello world from typescript!");
    print_string("hello 2!");
}

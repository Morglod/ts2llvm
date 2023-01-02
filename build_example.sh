# npm run build_example
cd example

rm a.out
rm linked.ll
rm linked.s

export LLVM_SYMBOLIZER_PATH="/usr/local/opt/llvm/bin/llvm-symbolizer"
export PATH=$PATH:/usr/local/opt/llvm/bin

clang -debug-ir -gfull -glldb -std=c++17 -S -emit-llvm stdlib.cpp
/usr/local/opt/llvm/bin/llvm-link -S -v -o linked.ll *.ll
# /usr/local/opt/llvm/bin/lli -jit-kind=mcjit ./linked.ll
/usr/local/opt/llvm/bin/llc ./linked.ll
clang -debug-ir -gfull -glldb -lc++ ./linked.s

echo "running"
./a.out
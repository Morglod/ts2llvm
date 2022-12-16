# npm run build_example
cd example

rm a.out
rm linked.ll
rm linked.s

clang -std=c++17 -S -emit-llvm stdlib.cpp
/usr/local/opt/llvm/bin/llvm-link -S -v -o linked.ll *.ll
/usr/local/opt/llvm/bin/llc ./linked.ll
clang -lc++ ./linked.s

echo "running"
./a.out
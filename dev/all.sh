#!/bin/sh
# 모든 시험 묶음을 채점해 묶음별 정확도를 한 줄씩 적는다(dev 폴더에서 실행): sh all.sh
T=${TMPDIR:-/tmp}
for x in A B C D E F G H S T KH KL P1 P2 P3 PH1 PH2; do
  [ -d cases/$x ] || continue
  printf "%s  " $x; node score.cjs cases/$x > $T/s_$x.txt 2>&1; tail -2 $T/s_$x.txt | head -1
done

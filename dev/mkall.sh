#!/bin/sh
# 시험 묶음을 모두 새로 만든다(dev 폴더에서 실행, 몇 분 걸림): sh mkall.sh
for x in A B C D E F G H S T KH; do node mkcases.mjs $x; done
python3 lowres.py
python3 degrade.py
python3 degrade.py H

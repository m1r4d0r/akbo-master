// 펴기 전후의 오선 기울기를 눈으로 보기: 흑백 이미지를 가로로 1/4 눌러 저장
const { load } = require('./dbg.cjs'); const OMR = require('../omr.js'); const { PNG } = require('pngjs'); const fs = require('fs');
const P = OMR.prepare(load(process.argv[2]));
console.log('skew', P.skew, 'bend', P.bend, 'staves', P.staves.length, P.staves.map(s => Math.round(s.xR - s.xL)).join(','));
const w = Math.floor(P.W / 4), h = P.H; const p = new PNG({ width: w, height: h });
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let v = 0; for (let k = 0; k < 4; k++) v += P.bin[y * P.W + x * 4 + k]; const o = (y * w + x) * 4; p.data[o] = p.data[o + 1] = p.data[o + 2] = 255 - v * 63; p.data[o + 3] = 255; }
fs.writeFileSync(process.argv[3], PNG.sync.write(p));

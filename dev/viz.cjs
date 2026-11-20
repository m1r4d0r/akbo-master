// 검출 결과를 색으로 덧그려 저장: node viz.cjs in.png out.png [x0 y0 x1 y1 확대]
const { load } = require('./dbg.cjs'); const OMR = require('../omr.js'); const { PNG } = require('pngjs'); const fs = require('fs');
const A = OMR.analyze(load(process.argv[2])); const { W, H } = A; const { bin, sym } = A.P; const SP = OMR.SP;
const img = new Uint8Array(W * H * 3);
for (let i = 0; i < W * H; i++) { const v = sym[i] ? 60 : bin[i] ? 215 : 255; img[i * 3] = v; img[i * 3 + 1] = bin[i] && !sym[i] ? 190 : v; img[i * 3 + 2] = bin[i] && !sym[i] ? 190 : v; }
const px = (x, y, c) => { x = Math.round(x); y = Math.round(y); if (x < 0 || y < 0 || x >= W || y >= H) return; img[(y * W + x) * 3] = c[0]; img[(y * W + x) * 3 + 1] = c[1]; img[(y * W + x) * 3 + 2] = c[2]; };
const box = (x0, y0, x1, y1, c) => { for (let x = x0; x <= x1; x++) { px(x, y0, c); px(x, y1, c); } for (let y = y0; y <= y1; y++) { px(x0, y, c); px(x1, y, c); } };
const disk = (x, y, r, c) => { for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r) px(x + dx, y + dy, c); };
const vl = (x, y0, y1, c) => { for (let y = y0; y <= y1; y++) px(x, y, c); };
for (const v of A.vlines) if (v.kind !== 'none') vl(v.x, v.y0, v.y1, v.isStem ? [0, 110, 255] : v.inAcc ? [170, 0, 255] : v.barlike ? [0, 170, 0] : [255, 120, 200]);
for (const h of A.holes) box(Math.round(h.x - h.w / 2), Math.round(h.y - h.h / 2), Math.round(h.x + h.w / 2), Math.round(h.y + h.h / 2), [230, 200, 0]);
for (const S of A.per) {
  for (const s of S.stems) { for (const h of s.heads) disk(h.x, h.y, 3, h.filled ? [255, 0, 0] : [255, 150, 0]); for (let k = 0; k < s.flags; k++) disk(s.v.x + 5 + k * 5, s.dir > 0 ? s.v.y0 - 5 : s.v.y1 + 5, 2, [0, 110, 255]); }
  for (const a of S.accs.concat(S.keyAccs)) box(Math.round(a.x0), Math.round(a.y0), Math.round(a.x1), Math.round(a.y1), a.type === 'sharp' ? [255, 0, 0] : a.type === 'flat' ? [0, 0, 255] : [0, 160, 0]);
  for (const r of S.rests) box(r.c.x0 - 1, r.c.y0 - 1, r.c.x1 + 1, r.c.y1 + 1, r.kind === 'rest4' ? [0, 200, 200] : r.kind === 'rest8' ? [0, 120, 120] : r.kind === 'rest16' ? [120, 0, 120] : [200, 120, 0]);
  for (const d of S.dots) disk(d.x, d.y, 2, [255, 0, 255]);
  for (const w of S.wholes) disk(w.x, w.y, 4, [255, 150, 0]);
  vl(S.xStart, S.st.top - 20, S.st.bottom + 20, [255, 0, 255]);
}
let [x0, y0, x1, y1] = process.argv.slice(4, 8).map(Number); if (!(x1 > 0)) { x0 = 0; y0 = 0; x1 = W - 1; y1 = H - 1; }
const z = +(process.argv[8] || 1); const w2 = (x1 - x0 + 1) * z, h2 = (y1 - y0 + 1) * z; const p = new PNG({ width: w2, height: h2 });
for (let y = 0; y < h2; y++) for (let x = 0; x < w2; x++) { const sx = x0 + Math.floor(x / z), sy = y0 + Math.floor(y / z); const o = (y * w2 + x) * 4, i = (sy * W + sx) * 3; p.data[o] = img[i]; p.data[o + 1] = img[i + 1]; p.data[o + 2] = img[i + 2]; p.data[o + 3] = 255; }
fs.writeFileSync(process.argv[3], PNG.sync.write(p)); console.log('W', W, 'H', H);

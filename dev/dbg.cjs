// 단계별 결과를 그림으로 떠서 눈으로 확인
const fs = require('fs'); const { PNG } = require('pngjs');
const OMR = require('../omr.js');
function load(f) { const p = PNG.sync.read(fs.readFileSync(f)); return { width: p.width, height: p.height, data: p.data }; }
function save(f, W, H, fn) { const p = new PNG({ width: W, height: H }); for (let i = 0; i < W * H; i++) { const [r, g, b] = fn(i); p.data[i * 4] = r; p.data[i * 4 + 1] = g; p.data[i * 4 + 2] = b; p.data[i * 4 + 3] = 255; } fs.writeFileSync(f, PNG.sync.write(p)); }
module.exports = { load, save };
if (require.main === module) {
  const f = process.argv[2]; const t0 = Date.now();
  const r = OMR.prepare(load(f));
  console.log(f, 'sp0', r.sp0 && r.sp0.toFixed(2), 'scale', r.scale && r.scale.toFixed(3), 'skew', r.skew, 'size', r.W, r.H, 'staves', r.staves && r.staves.length, (Date.now() - t0) + 'ms');
  for (const s of r.staves || []) console.log('  staff top', s.top.toFixed(1), 'sp', s.sp.toFixed(2), 't', s.t, 'x', s.xL, s.xR);
  if (process.argv[3]) save(process.argv[3], r.W, r.H, i => r.sym[i] ? [0, 0, 0] : r.bin[i] ? [255, 170, 170] : [255, 255, 255]);
}

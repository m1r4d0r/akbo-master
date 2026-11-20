const { load } = require('./dbg.cjs'); const OMR = require('../omr.js');
const NAMES = ['도', '레', '미', '파', '솔', '라', '시'];
function tok(e) {
  const d = e.d === 1 ? '' : e.d === 0.5 ? '/' : e.d === 0.25 ? '//' : String(e.d);
  if (e.rest) return '쉼' + d;
  const one = n => { const pc = ((n.s % 7) + 7) % 7, o = Math.floor(n.s / 7); return NAMES[pc] + (n.alt > 0 ? '#' : n.alt < 0 ? 'b' : '') + (o > 0 ? "'".repeat(o) : ','.repeat(-o)); };
  return (e.chord ? '[' + e.chord.map(one).join('') + ']' : one(e)) + d + (e.tie ? '~' : '');
}
function show(res) {
  const out = [];
  res.parts.forEach((p, i) => {
    out.push(`# 성부 ${i + 1} (${p.clef}) 박자 ${res.meter.join('/')} 조표 ${res.fifths}`);
    out.push(p.bars.map(b => (b.repStart ? '|: ' : '') + (b.ending ? '[' + b.ending + ' ' : '') + b.ev.map(tok).join(' ') + (b.ok ? '' : ' (!' + b.sum + ')') + (b.repEnd ? ' :|' : '')).join(' | '));
  });
  return out.join('\n');
}
module.exports = { tok, show };
if (require.main === module) {
  const t0 = Date.now(); const res = OMR.recognize(load(process.argv[2]));
  if (res.error) { console.log(res.error); process.exit(); }
  console.log(show(res)); console.log((Date.now() - t0) + 'ms', res.warnings.join('; '));
}

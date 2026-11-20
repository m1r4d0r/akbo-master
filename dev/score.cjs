// 시험 묶음 채점: 정답과 토큰 단위로 맞춰 본다
const fs = require('fs'); const path = require('path');
const { load } = require('./dbg.cjs'); const OMR = require('../omr.js'); const { tok } = require('./run1.cjs');
const dir = process.argv[2] || 'cases/A'; const filt = process.argv[3] && !process.argv[3].startsWith('-') ? process.argv[3] : null; const verbose = process.argv.includes('-v');
function align(a, b) { // 편집 거리 정렬
  const n = a.length, m = b.length; const D = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = 0; i <= n; i++) D[i][0] = i; for (let j = 0; j <= m; j++) D[0][j] = j;
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) D[i][j] = Math.min(D[i - 1][j] + 1, D[i][j - 1] + 1, D[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  const ops = []; let i = n, j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && D[i][j] === D[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)) { ops.push([a[i - 1] === b[j - 1] ? '=' : 'S', i - 1, j - 1]); i--; j--; }
    else if (i > 0 && D[i][j] === D[i - 1][j] + 1) { ops.push(['D', i - 1, -1]); i--; }
    else { ops.push(['I', -1, j - 1]); j--; }
  }
  return ops.reverse();
}
const tot = { tokens: 0, ok: 0, sub: 0, del: 0, ins: 0, bars: 0, barsOk: 0, cases: 0, perfect: 0, pitch: 0, dur: 0, tie: 0, kind: 0 };
const cats = {};
const files = fs.readdirSync(dir).filter(f => f.endsWith('.png') && (!filt || f.includes(filt))).sort();
for (const f of files) {
  const exp = JSON.parse(fs.readFileSync(path.join(dir, f.replace('.png', '.json'))));
  let res; const t0 = Date.now();
  try { res = OMR.recognize(load(path.join(dir, f))); } catch (e) { console.log(f, '예외', e.stack.split('\n').slice(0, 3).join(' | ')); tot.cases++; continue; }
  const ms = Date.now() - t0;
  tot.cases++;
  if (res.error) { console.log(f, res.error); continue; }
  let cTok = 0, cOk = 0, notes = [];
  if (res.parts.length !== exp.parts.length) notes.push(`성부 수 ${res.parts.length}≠${exp.parts.length}`);
  if (res.fifths !== exp.fifths) notes.push(`조표 ${res.fifths}≠${exp.fifths}`);
  if (res.meter.join('/') !== exp.meter.join('/')) notes.push(`박자 ${res.meter.join('/')}≠${exp.meter.join('/')}`);
  for (let p = 0; p < exp.parts.length; p++) {
    const eb = exp.parts[p].bars, gb = (res.parts[p] || { bars: [] }).bars;
    const flat = bars => bars.flatMap((b, i) => [...(b.ev || []).map(e => tok(e)), '|' + (b.repEnd ? ':' : '') + (i + 1 < bars.length && bars[i + 1].repStart ? 's' : '') + (i + 1 < bars.length && bars[i + 1].ending ? 'e' + bars[i + 1].ending : '')]);
    const a = flat(eb), b = flat(gb);
    const ops = align(a, b);
    for (const [op, i, j] of ops) {
      const isBar = (i >= 0 && a[i][0] === '|') || (j >= 0 && b[j][0] === '|');
      if (!isBar) { tot.tokens += op === 'I' ? 0 : 1; cTok += op === 'I' ? 0 : 1; }
      if (op === '=') { if (!isBar) { tot.ok++; cOk++; } continue; }
      const key = op === 'S' ? `${a[i]} → ${b[j]}` : op === 'D' ? `${a[i]} 빠짐` : `${b[j]} 덧`;
      let cat = op === 'D' ? '빠짐' : op === 'I' ? '덧' : '바뀜';
      if (op === 'S' && !isBar) {
        const pa = a[i].replace(/[0-9./~]+$/, ''), pb = b[j].replace(/[0-9./~]+$/, '');
        const da = a[i].slice(pa.length).replace('~', ''), db = b[j].slice(pb.length).replace('~', '');
        const ta = a[i].endsWith('~'), tb = b[j].endsWith('~');
        cat = pa !== pb && da !== db ? '높이+길이' : pa !== pb ? ((pa === '쉼') !== (pb === '쉼') ? '쉼↔음' : '높이') : da !== db ? '길이' : ta !== tb ? '붙임줄' : '기타';
      }
      if (isBar) cat = '마디줄:' + cat;
      cats[cat] = (cats[cat] || 0) + 1;
      if (verbose) notes.push(`[${cat}] ${key}`);
      if (op === 'S') tot.sub++; else if (op === 'D') tot.del++; else tot.ins++;
    }
    tot.bars += eb.length;
  }
  const acc = cTok ? cOk / cTok : 0;
  if (acc === 1 && !notes.length) tot.perfect++;
  console.log(`${acc === 1 && !notes.length ? 'OK ' : '   '}${(acc * 100).toFixed(1).padStart(5)}% ${String(ms).padStart(4)}ms ${f.replace('.png', '')}${notes.length ? '  ' + notes.slice(0, verbose ? 60 : 3).join(' ; ') : ''}`);
}
console.log(`\n합계: ${tot.cases}개 중 완벽 ${tot.perfect}개, 토큰 정확도 ${(tot.ok / Math.max(1, tot.tokens) * 100).toFixed(2)}% (${tot.ok}/${tot.tokens})`);
console.log('오류 종류:', Object.entries(cats).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', '));

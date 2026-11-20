// 시험 악보 생성기: 악보 명세 → MEI → (verovio) SVG → (Chrome) PNG + 정답 JSON
import createVerovioModule from 'verovio/wasm';
import { VerovioToolkit } from 'verovio/esm';
import { createRequire } from 'module';
import fs from 'fs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

/* ---------- 난수 ---------- */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------- 조표 ---------- */
const SHARP_ORDER = [3, 0, 4, 1, 5, 2, 6]; // F C G D A E B (음이름 색인: C=0)
const FLAT_ORDER = [6, 2, 5, 1, 4, 0, 3];
export function keyAlter(fifths) {
  const alt = [0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < Math.abs(fifths); i++) {
    if (fifths > 0) alt[SHARP_ORDER[i]] = 1; else alt[FLAT_ORDER[i]] = -1;
  }
  return alt;
}

/* ---------- 리듬 꼴 ---------- */
const BEAT_PATTERNS = {
  easy: [[1], [1], [1], [0.5, 0.5], [0.5, 0.5]],
  mid: [[1], [1], [0.5, 0.5], [0.5, 0.5], [0.75, 0.25], [0.25, 0.25, 0.5], [0.5, 0.25, 0.25], [0.25, 0.25, 0.25, 0.25]],
};
const TWO_BEAT = [[2], [2], [1.5, 0.5], [1.5, 0.5], [1, 1], [0.5, 1, 0.5]];

function fillBar(r, beats, opt) {
  // beats: 4분음표 단위 마디 길이
  const out = [];
  let left = beats;
  if (r() < (opt.pWhole || 0.08)) {
    if (beats === 4) return [4];
    if (beats === 3) return [3];
    if (beats === 2) return [2];
  }
  while (left > 1e-9) {
    if (left >= 3 && beats === 3 && r() < 0.12) { out.push(3); left -= 3; continue; }
    if (left >= 2 && Number.isInteger(left) && (beats - left) % 2 === 0 && r() < (opt.pLong || 0.35)) {
      const p = TWO_BEAT[Math.floor(r() * TWO_BEAT.length)];
      out.push(...p); left -= 2; continue;
    }
    const pats = BEAT_PATTERNS[opt.level || 'easy'];
    const p = pats[Math.floor(r() * pats.length)];
    out.push(...p); left -= 1;
  }
  return out;
}

function fillBar68(r) {
  const half = () => {
    const c = [[1.5], [1, 0.5], [0.5, 0.5, 0.5], [0.5, 1], [1.5]];
    return c[Math.floor(r() * c.length)];
  };
  if (r() < 0.1) return [3];
  return [...half(), ...half()];
}

/* ---------- 무작위 악보 ---------- */
export function randomScore(seed, opt = {}) {
  const r = rng(seed);
  const meter = opt.meter || [[4, 4], [3, 4], [2, 4], [6, 8]][Math.floor(r() * 4)];
  const beats = meter[0] * 4 / meter[1];
  const fifths = opt.fifths != null ? opt.fifths : [0, 0, 0, 1, -1, 2, -2, 3, -3][Math.floor(r() * 9)];
  const kalt = keyAlter(fifths);
  const nBars = opt.bars || 12;
  const nParts = opt.parts || 1;
  const parts = [];
  for (let p = 0; p < nParts; p++) {
    const lo = opt.lo != null ? opt.lo : (p === 0 ? -1 : -3);
    const hi = opt.hi != null ? opt.hi : (p === 0 ? 10 : 7);
    let s = Math.floor((lo + hi) / 2);
    const bars = [];
    for (let b = 0; b < nBars; b++) {
      const durs = meter[1] === 8 ? fillBar68(r) : fillBar(r, beats, opt);
      const mk = () => durs.map(d => {
        if (r() < (opt.pRest != null ? opt.pRest : 0.1) && d <= 2 && d !== 0.75) return { rest: true, d };
        s += Math.floor(r() * 5) - 2;
        if (s < lo) s = lo + 1; if (s > hi) s = hi - 1;
        let alt = kalt[((s % 7) + 7) % 7];
        if (r() < (opt.pAcc != null ? opt.pAcc : 0.06)) alt = alt === 0 ? (r() < 0.5 ? 1 : -1) : 0;
        return { s, alt, d };
      });
      const ev = mk();
      // 붙임줄: 같은 높이 음이 이어질 때 일부
      bars.push({ ev });
    }
    // 붙임줄 넣기 (마디 안·마디 사이)
    const flat = bars.flatMap(b => b.ev);
    for (let i = 0; i + 1 < flat.length; i++) {
      const a = flat[i], c = flat[i + 1];
      if (a.rest || c.rest) continue;
      if (r() < (opt.pTie != null ? opt.pTie : 0.1)) {
        c.s = a.s; c.alt = a.alt; a.tie = true;
      }
    }
    parts.push({ bars });
  }
  // 도돌이·끝 마디
  if (opt.repeats && nBars >= 8) {
    const a = 1 + Math.floor(r() * 2), z = nBars - 3;
    for (const p of parts) {
      p.bars[a].repStart = true;
      p.bars[z - 1].ending = 1; p.bars[z - 1].repEnd = true;
      p.bars[z].ending = 2;
    }
  }
  return { meter, fifths, parts };
}

/* ---------- 두 음씩 붙은 악보(한 기둥에 두 머리) ---------- */
export function dyadScore(seed, opt = {}) {
  const base = randomScore(seed, { ...opt, parts: 1, pTie: 0, pAcc: 0 });
  const r = rng(seed + 999);
  const kalt = keyAlter(base.fifths);
  for (const bar of base.parts[0].bars) {
    bar.ev = bar.ev.map(e => {
      if (e.rest || r() < (opt.pSolo != null ? opt.pSolo : 0.1)) return e;
      const iv = [2, 2, 2, 5, 3, 4][Math.floor(r() * 6)]; // 3도·6도 위주
      const lo = e.s - iv;
      return { chord: [{ s: lo, alt: kalt[((lo % 7) + 7) % 7] }, { s: e.s, alt: e.alt }], d: e.d };
    });
  }
  base.split = 'dyad';
  return base;
}

/* ---------- 한 오선에 두 성부(기둥 위·아래) ---------- */
export function twoVoiceScore(seed, opt = {}) {
  const a = randomScore(seed, { ...opt, parts: 1, lo: 5, hi: 11, pTie: 0.05, pAcc: 0.03 });
  const b = randomScore(seed + 7, { ...opt, meter: a.meter, fifths: a.fifths, parts: 1, lo: -1, hi: 4, pTie: 0.05, pAcc: 0.03, level: 'easy' });
  a.parts[0].bars.forEach((bar, i) => { bar.ev2 = b.parts[0].bars[i].ev; });
  a.split = 'voices';
  return a;
}

/* ---------- 합창 악보: 윗 오선에 두 성부, 아랫 오선(낮은음자리표)에 반주 한 줄 ---------- */
export function choirScore(seed, opt = {}) {
  const a = twoVoiceScore(seed, opt);
  const c = randomScore(seed + 13, { ...opt, meter: a.meter, fifths: a.fifths, parts: 1, lo: 0, hi: 8, pTie: 0.03, pAcc: 0.03, level: 'easy' });
  for (const b of c.parts[0].bars) for (const e of b.ev) if (!e.rest) e.s -= 12;
  c.parts[0].clef = 'F';
  a.parts.push(c.parts[0]);
  a.split = 'choir';
  return a;
}

/* ---------- 이음줄 넣기 ---------- */
// 한 성부 악보의 음 2~4개를 이음줄로 묶는다. 묶인 음마다(끝 음 빼고) sl 표시를 남긴다.
export function addSlurs(score, seed, p = 0.5) {
  const r = rng(seed + 4242);
  const seq = [];
  score.parts[0].bars.forEach((b, bi) => b.ev.forEach(e => seq.push({ e, bi })));
  seq.forEach((x, k) => { if (!x.e.rest && !x.e.chord) x.e._id = 's' + k; });
  let k = 0, lastBar = -1;
  while (k < seq.length) {
    const len = 1 + Math.floor(r() * 3); // 이어지는 음 사이 간격 수
    const run = seq.slice(k, k + len + 1);
    const ok = run.length === len + 1 && run.every(x => !x.e.rest && !x.e.chord && !x.e.tie) && run[len].bi - run[0].bi <= 1
      && !(seq[k - 1] && seq[k - 1].e.tie) && seq[k].bi !== lastBar && run[0].e.s !== run[len].e.s;
    if (ok && r() < p) {
      run[0].e.slurTo = run[len].e;
      for (let i = 0; i < len; i++) if (run[i].e.s !== run[i + 1].e.s || run[i].e.alt !== run[i + 1].e.alt) run[i].e.sl = true;
      lastBar = run[0].bi;
      k += len + 1;
    } else k++;
  }
  return score;
}

/* ---------- 정답 만들기: 마디 안 임시표 규칙을 적용한 '적힌 임시표' ---------- */
function annotate(score) {
  const kalt = keyAlter(score.fifths);
  for (const part of score.parts) {
    for (const bar of part.bars) {
      for (const key of ['ev', 'ev2']) {
        if (!bar[key]) continue;
      }
      const state = new Map();
      const cur = s => (state.has(s) ? state.get(s) : kalt[((s % 7) + 7) % 7]);
      const mark = n => {
        if (n.tiedIn) { n.written = null; return; }
        if (n.alt !== cur(n.s)) { n.written = n.alt; state.set(n.s, n.alt); } else n.written = null;
      };
      // 두 성부가 있으면 시간 순서대로 처리
      const seq = [];
      for (const key of ['ev', 'ev2']) {
        let t = 0;
        for (const e of bar[key] || []) { seq.push({ e, t, v: key === 'ev' ? 0 : 1 }); t += e.d; }
      }
      seq.sort((a, b) => a.t - b.t || a.v - b.v);
      for (const { e } of seq) {
        if (e.rest) continue;
        if (e.chord) e.chord.slice().sort((a, b) => a.s - b.s).forEach(mark); else mark(e);
      }
    }
    for (const key of ['ev', 'ev2']) {
      const flat = part.bars.flatMap(b => b[key] || []);
      for (let i = 0; i + 1 < flat.length; i++) if (flat[i].tie && !flat[i + 1].rest) flat[i + 1].tiedIn = true;
    }
  }
}

/* ---------- MEI ---------- */
const DUR = { 4: ['1', 0], 3: ['2', 1], 2: ['2', 0], 1.5: ['4', 1], 1: ['4', 0], 0.75: ['8', 1], 0.5: ['8', 0], 0.25: ['16', 0], 0.375: ['16', 1] };
const PN = 'cdefgab';
let idc = 0;

function noteXml(n, d, extra = '') {
  const [dur, dots] = DUR[d];
  const pc = ((n.s % 7) + 7) % 7;
  const oct = 4 + Math.floor(n.s / 7);
  let a = '';
  if (n.written != null) a += ` accid="${n.written > 0 ? 's' : n.written < 0 ? 'f' : 'n'}"`;
  else if (n.alt) a += ` accid.ges="${n.alt > 0 ? 's' : 'f'}"`;
  let tie = '';
  if (n.tieAttr) tie = ` tie="${n.tieAttr}"`;
  const head = `<note xml:id="${n._id || 'n' + idc++}" pname="${PN[pc]}" oct="${oct}"${d != null && !extra.includes('nodur') ? ` dur="${dur}"${dots ? ` dots="${dots}"` : ''}` : ''}${a}${tie}`;
  if (SONG && !extra.includes('nodur')) { const syl = SONG.syl[SONG.k++ % SONG.syl.length]; return `${head}><verse n="1"><syl>${syl}</syl></verse></note>`; }
  return head + '/>';
}
// 노래 악보 꾸밈(가사·코드 이름·빠르기말·셈여림): 켜 두면 음표마다 가사가 붙는다
let SONG = null;
const SYL = '나 비 야 이 리 날 아 오 너 라 노 랑 흰 봄 바 람 에 꽃 잎 도 방 긋 웃 으 며 참 새 짹 춤 을 춘 다 산 들 강 물 따 라 별 빛 달 꿈 하 늘 우 리 함 께 걸 어 요'.split(' ');
const HARMS = ['C', 'G7', 'F', 'Am', 'Dm', 'G', 'Em', 'C7', 'B♭', 'D7'];

function layerXml(evs, meter, n) {
  // 빔 묶기: 박 단위(6/8은 점4분)
  const beat = meter[1] === 8 ? 1.5 : 1;
  let t = 0;
  const items = evs.map(e => { const o = { e, t }; t += e.d; return o; });
  let out = '';
  let i = 0;
  const one = e => {
    const [dur, dots] = DUR[e.d];
    if (e.rest) return `<rest dur="${dur}"${dots ? ` dots="${dots}"` : ''}/>`;
    if (e.chord) {
      return `<chord dur="${dur}"${dots ? ` dots="${dots}"` : ''}>${e.chord.map(c => noteXml(c, e.d, 'nodur')).join('')}</chord>`;
    }
    return noteXml(e, e.d);
  };
  while (i < items.length) {
    const it = items[i];
    const beamable = x => !x.e.rest && x.e.d < 1;
    if (beamable(it)) {
      const g = [it];
      const b0 = Math.floor(it.t / beat + 1e-9);
      let j = i + 1;
      while (j < items.length && beamable(items[j]) && Math.floor(items[j].t / beat + 1e-9) === b0) { g.push(items[j]); j++; }
      if (g.length > 1) { out += `<beam>${g.map(x => one(x.e)).join('')}</beam>`; i = j; continue; }
    }
    out += one(it.e);
    i++;
  }
  return `<layer n="${n}">${out}</layer>`;
}

export function toMei(score, opt = {}) {
  annotate(score);
  // tie 속성
  for (const part of score.parts) for (const key of ['ev', 'ev2']) {
    const flat = part.bars.flatMap(b => b[key] || []);
    for (let i = 0; i < flat.length; i++) {
      const e = flat[i];
      if (e.rest) continue;
      const tin = i > 0 && flat[i - 1].tie && !flat[i - 1].rest;
      const tout = e.tie && i + 1 < flat.length && !flat[i + 1].rest;
      const attr = tin && tout ? 'm' : tin ? 't' : tout ? 'i' : null;
      if (e.chord) e.chord.forEach(c => { c.tieAttr = attr; }); else e.tieAttr = attr;
      if (!tout) e.tie = false;
    }
  }
  const f = score.fifths;
  const keysig = f === 0 ? '0' : Math.abs(f) + (f > 0 ? 's' : 'f');
  const nP = score.parts.length;
  const staffDefs = score.parts.map((p, i) =>
    `<staffDef n="${i + 1}" lines="5" clef.shape="${p.clef === 'F' ? 'F' : 'G'}" clef.line="${p.clef === 'F' ? 4 : 2}"/>`).join('');
  const grpAttr = nP > 1 ? ` symbol="${opt.brace ? 'brace' : 'bracket'}" bar.thru="${opt.barThru ? 'true' : 'false'}"` : '';
  let body = '';
  const nB = score.parts[0].bars.length;
  let open = 0;
  for (let b = 0; b < nB; b++) {
    const b0 = score.parts[0].bars[b];
    if (b0.ending && b0.ending !== open) {
      if (open) body += '</ending>';
      body += `<ending n="${b0.ending}">`;
      open = b0.ending;
    } else if (!b0.ending && open) { body += '</ending>'; open = 0; }
    const left = b0.repStart ? ' left="rptstart"' : '';
    const right = b0.repEnd ? ' right="rptend"' : b === nB - 1 ? ' right="end"' : '';
    body += `<measure n="${b + 1}"${left}${right}>`;
    SONG = opt.song ? (SONG && SONG.live ? SONG : { syl: SYL, k: 0, live: true }) : null;
    score.parts.forEach((p, i) => {
      const bar = p.bars[b];
      body += `<staff n="${i + 1}">${layerXml(bar.ev, score.meter, 1)}${bar.ev2 ? layerXml(bar.ev2, score.meter, 2) : ''}</staff>`;
    });
    for (const e of score.parts[0].bars[b].ev) if (e.slurTo) body += `<slur staff="1" startid="#${e._id}" endid="#${e.slurTo._id}"/>`;
    if (opt.song) {
      body += `<harm staff="1" tstamp="1" place="above">${HARMS[(b * 3 + 1) % HARMS.length]}</harm>`;
      if (b % 3 === 1 && score.meter[0] >= 3) body += `<harm staff="1" tstamp="3" place="above">${HARMS[(b * 5 + 2) % HARMS.length]}</harm>`;
      if (b === 0) body += `<tempo staff="1" tstamp="1" place="above">조금 빠르게 ♩ = 96</tempo>`;
      if (b % 4 === 0) body += `<dynam staff="1" tstamp="1" place="below">${['mf', 'p', 'f', 'mp'][(b / 4) % 4]}</dynam>`;
      if (b % 6 === 3) body += `<hairpin staff="1" tstamp="1" tstamp2="0m+${Math.min(3, score.meter[0])}" form="cres" place="below"/>`;
    }
    body += '</measure>';
  }
  if (open) body += '</ending>';
  SONG = null;
  return `<?xml version="1.0" encoding="UTF-8"?>
<mei xmlns="http://www.music-encoding.org/ns/mei" meiversion="5.0">
<meiHead><fileDesc><titleStmt><title>t</title></titleStmt><pubStmt/></fileDesc></meiHead>
<music><body><mdiv><score>
<scoreDef meter.count="${score.meter[0]}" meter.unit="${score.meter[1]}" key.sig="${keysig}"><staffGrp${grpAttr}>${staffDefs}</staffGrp></scoreDef>
<section>${body}</section>
</score></mdiv></body></music></mei>`;
}

/* ---------- 정답 문자열 ---------- */
export function expected(score) {
  if (score.split === 'dyad') {
    // 위 음은 성부 1, 아래 음은 성부 2. 혼자 있는 음과 쉼표는 두 성부가 함께.
    const pick = k => score.parts[0].bars.map(b => ({
      repStart: !!b.repStart, repEnd: !!b.repEnd, ending: b.ending || 0,
      ev: b.ev.map(e => e.rest ? { rest: true, d: e.d } : e.chord ? (() => { const c = e.chord.slice().sort((x, y) => x.s - y.s); const h = k === 0 ? c[c.length - 1] : c[0]; return { s: h.s, alt: h.alt, d: e.d, tie: !!e.tie }; })() : { s: e.s, alt: e.alt, d: e.d, tie: !!e.tie })
    }));
    return { meter: score.meter, fifths: score.fifths, parts: [{ bars: pick(0) }, { bars: pick(1) }] };
  }
  if (score.split === 'choir') {
    const pick = (pi, key) => score.parts[pi].bars.map(b => ({
      repStart: !!b.repStart, repEnd: !!b.repEnd, ending: b.ending || 0,
      ev: b[key].map(e => e.rest ? { rest: true, d: e.d } : { s: e.s, alt: e.alt, d: e.d, tie: !!e.tie })
    }));
    return { meter: score.meter, fifths: score.fifths, parts: [{ bars: pick(0, 'ev') }, { bars: pick(0, 'ev2') }, { bars: pick(1, 'ev') }] };
  }
  if (score.split === 'voices') {
    const pick = key => score.parts[0].bars.map(b => ({
      repStart: !!b.repStart, repEnd: !!b.repEnd, ending: b.ending || 0,
      ev: b[key].map(e => e.rest ? { rest: true, d: e.d } : { s: e.s, alt: e.alt, d: e.d, tie: !!e.tie })
    }));
    return { meter: score.meter, fifths: score.fifths, parts: [{ bars: pick('ev') }, { bars: pick('ev2') }] };
  }
  return {
    meter: score.meter, fifths: score.fifths,
    parts: score.parts.map(p => ({
      bars: p.bars.map(b => {
        const o = { repStart: !!b.repStart, repEnd: !!b.repEnd, ending: b.ending || 0 };
        for (const key of ['ev', 'ev2']) {
          if (!b[key]) continue;
          o[key] = b[key].map(e => e.rest ? { rest: true, d: e.d }
            : e.chord ? { chord: e.chord.map(c => ({ s: c.s, alt: c.alt })).sort((a, c) => a.s - c.s), d: e.d, tie: !!e.tie }
              : { s: e.s, alt: e.alt, d: e.d, tie: !!e.tie || !!e.sl });
        }
        return o;
      })
    }))
  };
}

/* ---------- 렌더 ---------- */
let tk = null, browser = null;
export async function init() {
  const mod = await createVerovioModule();
  tk = new VerovioToolkit(mod);
  browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
}
export async function done() { if (browser) await browser.close(); }

export async function render(score, file, opt = {}) {
  const mei = toMei(score, opt);
  tk.setOptions({
    font: opt.font || 'Leipzig', scale: opt.scale || 50, pageWidth: opt.pageWidth || 2100, pageHeight: 60000,
    adjustPageHeight: true, header: 'none', footer: 'none', breaks: 'auto',
    pageMarginLeft: 80, pageMarginRight: 80, pageMarginTop: 80, pageMarginBottom: 80,
    spacingStaff: opt.spacingStaff || 12, spacingSystem: opt.spacingSystem || 12,
    spacingLinear: opt.spacingLinear || 0.25, spacingNonLinear: opt.spacingNonLinear || 0.6,
  });
  if (!tk.loadData(mei)) throw new Error('MEI 읽기 실패');
  const pages = tk.getPageCount();
  const svg = tk.renderToSVG(1);
  const page = await browser.newPage({ deviceScaleFactor: opt.dsf || 1 });
  await page.setContent(`<body style="margin:0;background:#fff">${svg}</body>`);
  // 머리를 오선 칸보다 크게 그리는 악보체: 머리를 기둥 쪽 끝을 붙잡고 키우고, 덧줄·점·임시표를 그만큼 옮긴다
  if (opt.headScale && opt.headScale !== 1) await page.evaluate(k => {
    const box = el => el.getBBox();
    const moves = [];
    for (const nh of document.querySelectorAll('g.notehead')) {
      const b = box(nh), hx = b.x + b.width / 2, hy = b.y + b.height / 2;
      const note = nh.closest('g.note'), chord = nh.closest('g.chord');
      const stemEl = (chord && chord.querySelector(':scope > g.stem')) || (note && note.querySelector(':scope > g.stem'));
      let ax = hx;
      if (stemEl && box(stemEl).height > 0) { const sb = box(stemEl); ax = sb.x + sb.width / 2 > hx ? b.x + b.width : b.x; }
      moves.push({ nh, note, hx, hy, ax, w: b.width, nx: ax + (hx - ax) * k });
    }
    for (const lg of document.querySelectorAll('g.ledgerLines path')) {
      const b = box(lg), cx = b.x + b.width / 2;
      let best = null;
      for (const m of moves) if (Math.abs(m.hx - cx) < m.w && (!best || Math.abs(m.hx - cx) < Math.abs(best.hx - cx))) best = m;
      if (best) lg.setAttribute('transform', `translate(${best.nx},0) scale(${k},1) translate(${-cx},0)`);
    }
    for (const m of moves) {
      m.nh.setAttribute('transform', `translate(${m.ax},${m.hy}) scale(${k}) translate(${-m.ax},${-m.hy})`);
      const grow = m.w * (k - 1);
      const right = m.ax < m.hx ? grow : m.ax > m.hx ? 0 : grow / 2, left = m.ax > m.hx ? grow : m.ax < m.hx ? 0 : grow / 2;
      if (!m.note) continue;
      for (const d of m.note.querySelectorAll(':scope > g.dots')) d.setAttribute('transform', `translate(${right},0)`);
      for (const a of m.note.querySelectorAll(':scope > g.accid')) a.setAttribute('transform', `translate(${-left},0)`);
    }
  }, opt.headScale);
  const el = await page.$('svg');
  await el.screenshot({ path: file });
  await page.close();
  fs.writeFileSync(file.replace(/\.png$/, '.json'), JSON.stringify({ ...expected(score), pages, opt }));
  fs.writeFileSync(file.replace(/\.png$/, '.mei'), mei);
  return pages;
}

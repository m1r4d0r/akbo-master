(() => {
  'use strict';

  const SYL = ['도', '레', '미', '파', '솔', '라', '시'];
  const SEMI = [0, 2, 4, 5, 7, 9, 11];
  const SHARP_ORDER = [3, 0, 4, 1, 5, 2, 6], FLAT_ORDER = [6, 2, 5, 1, 4, 0, 3];
  const KEY_SHARP_POS = [10, 7, 11, 8, 5, 9, 6], KEY_FLAT_POS = [6, 9, 5, 8, 4, 7, 3];
  const STORE = 'garak-text-2';
  const DEFAULT_TEXT = [
    '제목 아름다운 것들',
    '박자 3/4',
    '빠르기 100',
    '첫마디 5',
    "|: 미2 레 | 도 미 솔 | 라2 라 | 솔2 미/ 레/ | 도2 도/ 도/ | 미 솔 미 | 레3~ | 레2 솔 |",
    "도'2 도' | 시 시 라 | 솔 솔 미/ 레/ | 도2 도/ 레/ | 미 파 미 | 레 도 레 | 도3~ | 도2 미 |",
    "미2 레 | 도 미 솔 | 라2 라 | 솔2 미/ 레/ | 도2 도/ 도/ | 미 솔 미 | 레3~ | 레2 솔 |",
    "도'2 도' | 시 시 라 | 솔~ 솔 미/ 레/ | 도2 도/ 레/ | 미 파 미 | 레 도 레 | 도3~ | [1 도2 미 :|",
    '[2 도2 도/ 레/ | 미 파 미 | 레 도 레 | 도3~ | 도3 ||'
  ].join('\n');

  const $ = id => document.getElementById(id);
  const mod7 = n => ((n % 7) + 7) % 7;
  const state = {
    text: '', song: null, events: [], cursor: 0, playing: false,
    tempo: 100, octave: 1, shift: 0, loop: false, mute: [],
    note: '', mark: 0, playBase: 0, sel: null, selHead: 0, selBar: null, selHdr: null, fixed: new Set()
  };

  function keyAlter(fifths) {
    const alt = [0, 0, 0, 0, 0, 0, 0];
    for (let i = 0; i < Math.abs(fifths); i++) { if (fifths > 0) alt[SHARP_ORDER[i]] = 1; else alt[FLAT_ORDER[i]] = -1; }
    return alt;
  }

  /* ---------- 표기 읽기 ---------- */

  const PITCH_RE = /^(도|레|미|파|솔|라|시)([#b♯♭]{0,2})([',]*)$/;
  const NOTE_RE = /^(.+?)(\d*\.?\d*)(\/*)(~?)$/;
  const TOKEN_RE = /\|\||\|:|:\||\||[^\s|:]+|:/g;

  function parse(text) {
    const meta = { title: '', beats: 4, unit: 4, tempo: 100, first: 1, fifths: 0 };
    const parts = [];
    const bad = [], tokens = [];
    let part = null, cur = null, volta = 0;
    const usePart = i => {
      close();
      while (parts.length <= i) parts.push({ bars: [] });
      part = parts[i]; volta = 0;
    };
    const open = () => {
      if (!part) usePart(0);
      return cur || (cur = { notes: [], repStart: false, repEnd: false, volta, voltaStart: false, final: false });
    };
    function close() {
      if (cur && cur.notes.length) { part.bars.push(cur); if (volta === 2) volta = 0; }
      cur = null;
    }

    let lineStart = 0;
    for (const line of text.split('\n')) {
      const t = line.trim();
      let m;
      if (!t) { /* 빈 줄 */ }
      else if ((m = t.match(/^제목\s+(.+)$/))) meta.title = m[1];
      else if ((m = t.match(/^박자\s+(\d+)\s*\/\s*(\d+)$/))) { meta.beats = +m[1]; meta.unit = +m[2]; }
      else if ((m = t.match(/^빠르기\s+(\d+)$/))) meta.tempo = Math.min(240, Math.max(30, +m[1]));
      else if ((m = t.match(/^첫마디\s+(\d+)$/))) meta.first = +m[1];
      else if ((m = t.match(/^조표\s+([#b♯♭]?)\s*(\d)$/))) meta.fifths = (m[1] === 'b' || m[1] === '♭' ? -1 : 1) * Math.min(7, +m[2]);
      else if ((m = t.match(/^성부\s+(\d+)$/))) usePart(Math.max(0, Math.min(3, +m[1] - 1)));
      else if ((m = t.match(/^음자리표\s+(낮은|높은)$/))) { if (!part) usePart(0); part.clef = m[1] === '낮은' ? 'F' : 'G'; }
      else {
        TOKEN_RE.lastIndex = 0;
        while ((m = TOKEN_RE.exec(line))) {
          const tk = m[0];
          const tok = { text: tk, s: lineStart + m.index, e: lineStart + m.index + tk.length, type: 'bar' };
          tokens.push(tok);
          if (tk === '|') close();
          else if (tk === '||') { if (cur) cur.final = true; close(); }
          else if (tk === '|:') { close(); open().repStart = true; }
          else if (tk === ':|') { if (cur) cur.repEnd = true; close(); volta = 0; }
          else if (tk === '[1' || tk === '[2') { tok.type = 'volta'; close(); if (!part) usePart(0); volta = +tk[1]; open().voltaStart = true; }
          else {
            const nm = tk.match(NOTE_RE);
            const dur = nm ? (nm[2] ? parseFloat(nm[2]) : 1) / Math.pow(2, nm[3].length) : NaN;
            let heads = null, rest = false;
            if (nm && dur > 0) {
              if (nm[1] === '쉼') rest = true;
              else {
                heads = [];
                for (const ps of nm[1].split('+')) {
                  const pm = ps.match(PITCH_RE);
                  if (!pm) { heads = null; break; }
                  let acc = 0;
                  for (const ch of pm[2]) acc += ch === '#' || ch === '♯' ? 1 : -1;
                  let oct = 0;
                  for (const ch of pm[3]) oct += ch === "'" ? 1 : -1;
                  heads.push({ deg: SYL.indexOf(pm[1]), acc, oct });
                }
              }
            }
            if (!rest && !heads) { tok.type = 'bad'; bad.push(tk); continue; }
            tok.type = 'note';
            open().notes.push({ rest, heads: heads || [], dur, tie: !!nm[4], s: tok.s, e: tok.e });
          }
        }
      }
      lineStart += line.length + 1;
    }
    close();
    if (!parts.length) parts.push({ bars: [] });
    for (const p of parts) if (p.bars.length) p.bars[p.bars.length - 1].final = true;
    return { meta, parts, bad, tokens };
  }

  function unfold(flags) {
    const out = [];
    let i = 0, start = 0, pass = 1, guard = 0;
    while (i < flags.length && guard++ < 20000) {
      const b = flags[i];
      if (b.repStart && i !== start) { start = i; pass = 1; }
      // 둘째 번에는 1번 괄호를 건너뛰고 2번 괄호로 간다. 괄호를 다 지나면 새 구간이다.
      if (b.volta && b.volta !== pass) { i++; continue; }
      if (!b.volta && pass === 2 && out.length && out[out.length - 1] === i - 1 && flags[i - 1].volta) { pass = 1; start = i; }
      out.push(i);
      if (b.repEnd && pass === 1) { pass = 2; i = start; continue; }
      if (b.repEnd) { pass = 1; start = i + 1; }
      i++;
    }
    return out;
  }

  function build(text) {
    const song = parse(text);
    const { meta } = song;
    const barLen = meta.beats * 4 / meta.unit;
    const kalt = keyAlter(meta.fifths);
    const tonic = mod7(meta.fifths * 4);
    song.barLen = barLen;
    song.notes = [];
    // 글자 순서대로 번호(찍어 넣기·선택용)
    const all = [];
    song.parts.forEach((p, pi) => p.bars.forEach((b, bi) => {
      b.index = bi; b.num = meta.first + bi;
      let off = 0;
      for (const n of b.notes) {
        n.part = pi; n.bar = b; n.off = off; off += n.dur;
        for (const h of n.heads) {
          h.step = tonic + h.deg + 7 * h.oct;
          h.midi = 60 + 12 * Math.floor(h.step / 7) + SEMI[mod7(h.step)] + kalt[mod7(h.step)] + h.acc;
          h.alt = kalt[mod7(h.step)] + h.acc;
        }
        n.heads.sort((a, c) => a.step - c.step);
        all.push(n);
      }
      b.len = off;
      const edge = bi === 0 || bi === p.bars.length - 1;
      b.bad = b.notes.length > 0 && Math.abs(off - barLen) > 1e-6 && !(edge && off < barLen);
      // 박자와의 차이: 음수면 모자람, 양수면 넘침. 넘친 음에는 표시를 해 둔다.
      b.diff = b.bad ? off - barLen : 0;
      for (const n of b.notes) n.over = b.diff > 0 && n.off + n.dur > barLen + 1e-6;
    }));
    all.sort((a, c) => a.s - c.s);
    all.forEach((n, i) => { n.i = i; });
    song.notes = all;

    // 마디 수와 도돌이 표시(성부 가운데 하나라도 표시가 있으면 적용)
    const nBars = Math.max(0, ...song.parts.map(p => p.bars.length));
    song.nBars = nBars;
    song.flags = [];
    for (let b = 0; b < nBars; b++) {
      const f = { repStart: false, repEnd: false, volta: 0, voltaStart: false, final: b === nBars - 1 };
      for (const p of song.parts) {
        const bar = p.bars[b];
        if (!bar) continue;
        f.repStart = f.repStart || bar.repStart; f.repEnd = f.repEnd || bar.repEnd;
        f.volta = f.volta || bar.volta; f.voltaStart = f.voltaStart || bar.voltaStart;
      }
      f.len = Math.max(0, ...song.parts.map(p => (p.bars[b] ? p.bars[b].len : 0))) || barLen;
      f.num = meta.first + b;
      f.bad = song.parts.some(p => p.bars[b] && p.bars[b].bad);
      song.flags.push(f);
    }

    // 재생 순서
    const ev = [];
    let t = 0;
    for (const bi of unfold(song.flags)) {
      song.parts.forEach((p, pi) => {
        const bar = p.bars[bi];
        if (!bar) return;
        for (const n of bar.notes) ev.push({ n, part: pi, t: t + n.off, dur: n.dur, len: n.dur, sound: true });
      });
      t += song.flags[bi].len;
    }
    // 줄(~): 바로 다음 음과 높이가 같으면 붙임줄(이어서 한 음), 다르면 이음줄(끊지 않고 넘어감)
    song.parts.forEach((p, pi) => {
      const seq = ev.filter(e => e.part === pi);
      const same = (a, c) => a.heads.length === c.heads.length && a.heads.every((h, k) => h.midi === c.heads[k].midi);
      for (let k = 1; k < seq.length; k++) {
        const a = seq[k - 1].n, c = seq[k].n;
        if (!a.tie || a.rest || c.rest) continue;
        if (same(a, c)) seq[k].sound = false; else seq[k - 1].legato = true;
      }
      for (let k = seq.length - 2; k >= 0; k--) if (!seq[k + 1].sound) seq[k].len = seq[k].dur + seq[k + 1].len;
    });
    ev.sort((a, c) => a.t - c.t || a.part - c.part);
    song.total = t;
    state.song = song;
    state.events = ev;
    while (state.mute.length < song.parts.length) state.mute.push(false);
    return song;
  }

  /* ---------- 악보 그리기 ---------- */

  const CLEF_W = 40, TS_W = 22;
  const FCLEF_D = 'M6 12C6 4 21 1 22 12C23 24 12 33 2 38';
  const CLEF_D = 'M12 53C12 48 19 47 20 53C21 59 14 63 9 60C3 56 3 46 9 38C14 31 21 24 20 13' +
    'C19.5 6 15 4 14 11C13 18 15 40 17 64C18 71 11 74 8 69';
  let els = [];
  let lastW = 0;

  const noteW = n => (n.dur <= 0.5 ? 24 : n.dur <= 1 ? 32 : n.dur <= 1.5 ? 38 : n.dur <= 2 ? 42 : 54) + (n.heads.some(h => h.acc) ? 10 : 0);
  const f1 = v => Math.round(v * 10) / 10;
  const accSign = a => (a > 1 ? '𝄪' : a === 1 ? '♯' : a === -1 ? '♭' : a < -1 ? '♭♭' : '♮');

  function render() {
    const host = $('score');
    const song = state.song;
    const W = Math.floor(host.clientWidth - 32);
    if (!song || W < 120) return;
    lastW = W;
    const nP = song.parts.length;
    const fifths = song.meta.fifths;
    const keyW = fifths ? Math.abs(fifths) * 9 + 6 : 0;

    for (const n of song.notes) { n.beamed = null; n.mate = null; }

    // 마디 너비: 성부들의 같은 박 자리를 세로로 맞춘다
    const cols = [];
    for (let b = 0; b < song.nBars; b++) {
      const f = song.flags[b];
      const times = new Map();
      song.parts.forEach(p => {
        const bar = p.bars[b];
        if (!bar) return;
        for (const n of bar.notes) {
          const k = Math.round(n.off * 96);
          times.set(k, Math.max(times.get(k) || 0, noteW(n)));
        }
        // 모자란 마디는 끝에 빈칸 자리를 둔다
        if (bar.diff < 0) { const k = Math.round(bar.len * 96); times.set(k, Math.max(times.get(k) || 0, 30)); }
      });
      const keys = [...times.keys()].sort((a, c) => a - c);
      let x = 0;
      const xs = new Map();
      for (const k of keys) { xs.set(k, x); x += times.get(k); }
      const padL = 10 + (f.repStart ? 12 : 0), padR = 4 + (f.repEnd || f.final ? 8 : 0);
      cols.push({ xs, widths: times, inner: x || 20, padL, padR, w: padL + (x || 20) + padR });
    }

    const rows = [];
    let row = { bars: [], sum: 0, prefix: CLEF_W + keyW + TS_W };
    for (let b = 0; b < song.nBars; b++) {
      if (row.bars.length && row.prefix + row.sum + cols[b].w > W - 2) {
        rows.push(row);
        row = { bars: [], sum: 0, prefix: CLEF_W + keyW };
      }
      row.bars.push(b);
      row.sum += cols[b].w;
    }
    if (row.bars.length) rows.push(row);

    // 1차: 자리 계산
    rows.forEach((r, ri) => {
      const last = ri === rows.length - 1;
      r.scale = (W - 2 - r.prefix) / r.sum;
      if (last) r.scale = Math.min(r.scale, 1.5);
      r.xEnd = r.prefix + r.sum * r.scale;
      r.staves = [];
      let yOff = 0;
      song.parts.forEach((p, pi) => {
        // 낮은음자리표 오선은 같은 음이 열두 칸 위에 놓인다
        const off = p.clef === 'F' ? 12 : 0;
        let maxStep = 10, minStep = 2;
        for (const b of r.bars) for (const n of (p.bars[b] ? p.bars[b].notes : [])) for (const h of n.heads) {
          maxStep = Math.max(maxStep, h.step + off); minStep = Math.min(minStep, h.step + off);
        }
        const y0 = yOff + Math.max(38, maxStep * 5 - 50 + 26);
        const ys = s => y0 + 50 - (s + off) * 5;
        const labelY = Math.max(y0 + 72, y0 + 50 - minStep * 5 + 24);
        const st = { y0, ys, off, labelY, top: yOff, bottom: labelY + 14 };
        r.staves.push(st);
        yOff = st.bottom;
      });
      r.H = yOff;

      let x = r.prefix;
      for (const b of r.bars) {
        const c = cols[b];
        c.x = x; c.bw = c.w * r.scale; c.row = ri;
        const ns = (c.bw - c.padL - c.padR) / c.inner;
        song.parts.forEach((p, pi) => {
          const bar = p.bars[b];
          if (!bar) return;
          const st = r.staves[pi];
          bar.notes.forEach((n, k) => {
            const key = Math.round(n.off * 96);
            const sw = c.widths.get(key) * ns;
            const sx = x + c.padL + c.xs.get(key) * ns;
            const accW = n.heads.some(h => h.acc) ? 10 : 0;
            n.sx = sx; n.sw = sw; n.row = ri; n.st = st;
            n.x = sx + accW + Math.min((sw - accW) * 0.4, 14);
            const steps = n.heads.map(h => h.step);
            const lo = steps.length ? Math.min(...steps) : 6, hi = steps.length ? Math.max(...steps) : 6;
            n.yLo = st.ys(lo); n.yHi = st.ys(hi); n.y = n.yLo;
            n.up = (lo + hi) / 2 + st.off < 6;
            n.end = n.up ? n.yHi - 30 : n.yLo + 30;
            const prev = bar.notes[k - 1];
            if (prev && !prev.beamed && !prev.rest && !n.rest && prev.dur === 0.5 && n.dur === 0.5 && Number.isInteger(prev.off)) {
              prev.beamed = 'a'; n.beamed = 'b'; prev.mate = n;
              const up = (prev.yLo + prev.yHi + n.yLo + n.yHi) / 4 > st.y0 + 20;
              prev.up = n.up = up;
              let e1 = up ? prev.yHi - 30 : prev.yLo + 30;
              let e2 = up ? n.yHi - 30 : n.yLo + 30;
              if (up) { if (e1 > e2 + 8) e1 = e2 + 8; if (e2 > e1 + 8) e2 = e1 + 8; }
              else { if (e1 < e2 - 8) e1 = e2 - 8; if (e2 < e1 - 8) e2 = e1 - 8; }
              prev.end = e1; n.end = e2;
            }
          });
        });
        x += c.bw;
      }
    });

    // 2차: 그리기
    const html = rows.map((r, ri) => {
      let g = '';
      song.parts.forEach((p, pi) => {
        const st = r.staves[pi];
        const y0 = st.y0, ys = st.ys, yb = y0 + 40;
        for (let k = 0; k < 5; k++) g += `<line class="st" x1="0" x2="${f1(r.xEnd)}" y1="${y0 + k * 10 + 0.5}" y2="${y0 + k * 10 + 0.5}"/>`;
        if (st.off) g += `<g transform="translate(4 ${y0})"><path class="clef" d="${FCLEF_D}"/><circle class="rd" cx="6" cy="12" r="3"/><circle class="rd" cx="27" cy="5" r="1.9"/><circle class="rd" cx="27" cy="15" r="1.9"/></g>`;
        else g += `<g transform="translate(4 ${y0 - 20})"><path class="clef" d="${CLEF_D}"/><circle class="rd" cx="9.5" cy="68" r="2.4"/></g>`;
        if (pi === 0) g += `<text class="bn" x="2" y="${y0 - 22}">${song.flags[r.bars[0]].num}</text>`;
        for (let k = 0; k < Math.abs(fifths); k++) {
          const pos = fifths > 0 ? KEY_SHARP_POS[k] : KEY_FLAT_POS[k];
          g += `<text class="acc" x="${CLEF_W + 4 + k * 9}" y="${ys(pos - (st.off ? 14 : 0)) + 6}" text-anchor="middle">${fifths > 0 ? '♯' : '♭'}</text>`;
        }
        g += `<rect class="hhit" data-hdr="key" x="0" y="${y0 - 8}" width="${CLEF_W + keyW - 2}" height="56"/>`;
        if (ri === 0) {
          g += `<text class="ts" x="${CLEF_W + keyW + 8}" y="${y0 + 19}" text-anchor="middle">${song.meta.beats}</text>`;
          g += `<text class="ts" x="${CLEF_W + keyW + 8}" y="${y0 + 39}" text-anchor="middle">${song.meta.unit}</text>`;
          g += `<rect class="hhit" data-hdr="time" x="${CLEF_W + keyW - 2}" y="${y0 - 8}" width="${TS_W}" height="56"/>`;
        }
        for (const b of r.bars) {
          const c = cols[b], f = song.flags[b];
          const x1 = f1(c.x), x2 = f1(c.x + c.bw);
          if (f.repStart) {
            g += `<line class="bk" x1="${x1 + 2}" x2="${x1 + 2}" y1="${y0}" y2="${yb + 1}"/>`;
            g += `<line class="bl" x1="${x1 + 6.5}" x2="${x1 + 6.5}" y1="${y0}" y2="${yb + 1}"/>`;
            g += `<circle class="rd" cx="${x1 + 11}" cy="${y0 + 15.5}" r="1.9"/><circle class="rd" cx="${x1 + 11}" cy="${y0 + 25.5}" r="1.9"/>`;
          }
          if (f.repEnd || f.final) {
            if (f.repEnd) g += `<circle class="rd" cx="${x2 - 11}" cy="${y0 + 15.5}" r="1.9"/><circle class="rd" cx="${x2 - 11}" cy="${y0 + 25.5}" r="1.9"/>`;
            g += `<line class="bl" x1="${x2 - 6.5}" x2="${x2 - 6.5}" y1="${y0}" y2="${yb + 1}"/>`;
            g += `<line class="bk" x1="${x2 - 2}" x2="${x2 - 2}" y1="${y0}" y2="${yb + 1}"/>`;
          } else {
            g += `<line class="bl" x1="${x2}" x2="${x2}" y1="${y0}" y2="${yb + 1}"/>`;
          }
          if (pi === 0) {
            if (f.volta) {
              const vy = y0 - 17;
              let d = `M${x1 + 3} ${vy}H${x2 - 3}`;
              if (f.voltaStart) {
                d = `M${x1 + 3} ${vy + 12}V${vy}H${x2 - 3}`;
                g += `<text class="vtx" x="${x1 + 8}" y="${vy + 12}">${f.volta}.</text>`;
              }
              if (f.volta === 1 && f.repEnd) d += `V${vy + 12}`;
              g += `<path class="vt" d="${d}"/>`;
            }
          }
          const bar = p.bars[b];
          if (bar && bar.diff) {
            const lack = bar.diff < 0;
            g += `<text class="bn ${lack ? 'lack' : 'over'}" x="${x2 - 5}" y="${y0 - (f.volta ? 21 : 7)}" text-anchor="end">${beatsText(Math.abs(bar.diff))} ${lack ? '모자람' : '넘침'}</text>`;
            if (lack) {
              const key = Math.round(bar.len * 96), ns = (c.bw - c.padL - c.padR) / c.inner;
              const gx = c.x + c.padL + c.xs.get(key) * ns;
              g += `<rect class="gap" data-gap="${pi}:${b}" x="${f1(gx + 2)}" y="${y0 - 5}" width="${f1(Math.max(8, c.widths.get(key) * ns - 4))}" height="50"/>`;
            }
          }
          if (bar) for (const n of bar.notes) g += drawNote(n, st, r);
          // 마디줄을 누르는 자리(줄 양옆으로 넉넉하게). 줄 첫 마디는 왼쪽 끝도 누를 수 있다.
          if (b === r.bars[0]) g += `<rect class="bhit" data-b="${b}" x="${x1 - 2}" y="${y0 - 6}" width="13" height="53"/>`;
          g += `<rect class="bhit" data-b="${b + 1}" x="${x2 - 9}" y="${y0 - 6}" width="18" height="53"/>`;
        }
        // 붙임줄
        const partNotes = song.notes.filter(n => n.part === pi);
        for (const b of r.bars) for (const n of (p.bars[b] ? p.bars[b].notes : [])) {
          if (!n.tie || n.rest) continue;
          const k = partNotes.indexOf(n);
          const m = partNotes[k + 1];
          if (!m || m.rest) continue;
          const dy = n.up ? 7 : -7;
          const yy = (n.up ? n.yLo : n.yHi) + dy;
          const y2 = (n.up ? m.yLo : m.yHi) + dy;
          if (m.row === ri) g += `<path class="tie" d="M${f1(n.x + 7)} ${yy}Q${f1((n.x + m.x) / 2)} ${(yy + y2) / 2 + dy * 1.7} ${f1(m.x - 7)} ${y2}"/>`;
          else g += `<path class="tie" d="M${f1(n.x + 7)} ${yy}Q${f1(n.x + 18)} ${yy + dy * 1.3} ${f1(r.xEnd - 1)} ${yy + dy * 0.8}"/>`;
        }
        for (const b of r.bars) for (const m of (p.bars[b] ? p.bars[b].notes : [])) {
          const k = partNotes.indexOf(m);
          const n = partNotes[k - 1];
          if (!n || !n.tie || n.rest || m.rest || n.row === ri) continue;
          const dy = m.up ? 7 : -7;
          const yy = (m.up ? m.yLo : m.yHi) + dy;
          g += `<path class="tie" d="M${r.prefix + 2} ${yy + dy * 0.8}Q${f1(m.x - 18)} ${yy + dy * 1.3} ${f1(m.x - 7)} ${yy}"/>`;
        }
      });
      if (nP > 1) g += `<line class="bl" x1="0.6" x2="0.6" y1="${r.staves[0].y0}" y2="${r.staves[nP - 1].y0 + 41}"/>`;
      return `<svg width="${W}" height="${r.H}" viewBox="0 0 ${W} ${r.H}" data-row="${ri}">${g}</svg>`;
    }).join('');

    host.innerHTML = html;
    els = [];
    host.querySelectorAll('.nt').forEach(el => { els[+el.dataset.n] = el; });
    showMark();
    showSel();
    showCursor(false);
  }

  // 박 수를 말로: 반 박, 1박 반 같은 흔한 값은 풀어 쓴다
  function beatsText(d) {
    const whole = Math.floor(d + 1e-6), frac = d - whole;
    const f = Math.abs(frac - 0.5) < 1e-6 ? '반' : Math.abs(frac - 0.25) < 1e-6 ? '¼' : Math.abs(frac - 0.75) < 1e-6 ? '¾' : frac < 1e-6 ? '' : null;
    if (f === null) return f1(d) + '박';
    if (!whole) return f === '반' ? '반 박' : f + '박';
    return whole + '박' + (f ? ' ' + f : '');
  }

  function drawNote(n, st, r) {
    const y0 = st.y0, ys = st.ys;
    const x = f1(n.x);
    const pc = n.rest ? -1 : n.heads[n.heads.length - 1].deg;
    let s = `<g class="nt ${n.rest ? 'rest' : 'p' + pc}${n.over ? ' over' : ''}" data-n="${n.i}">`;
    // 사진을 읽을 때 박자에 맞추려고 길이를 고친 음
    if (state.fixed.has(n.i)) s += `<path class="fxm" d="M${x - 7} ${st.labelY + 13}q3.5 -4 7 0t7 0"/>`;
    s += `<rect class="hit" x="${f1(n.sx)}" y="${st.top}" width="${f1(n.sw)}" height="${st.bottom - st.top}"/>`;

    if (n.rest) {
      s += `<circle class="halo" cx="${x}" cy="${y0 + 20}" r="13"/>`;
      if (n.dur >= 4) s += `<rect class="rsb" x="${x - 6}" y="${y0 + 10.5}" width="12" height="5"/>`;
      else if (n.dur >= 2) {
        s += `<rect class="rsb" x="${x - 6}" y="${y0 + 15.5}" width="12" height="5"/>`;
        if (n.dur === 3) s += `<circle class="rsb" cx="${x + 10}" cy="${y0 + 15}" r="1.8"/>`;
      } else if (n.dur >= 1) {
        s += `<path class="rs" d="M${x - 3} ${y0 + 8}l6 8l-5 6l6 8q-8 -3 -6 5"/>`;
        if (n.dur === 1.5) s += `<circle class="rsb" cx="${x + 10}" cy="${y0 + 15}" r="1.8"/>`;
      } else {
        s += `<circle class="rsb" cx="${x - 3}" cy="${y0 + 17}" r="2.3"/><path class="rs" d="M${x - 3} ${y0 + 18}q4 2 7 -2l-5 16"/>`;
        if (n.dur <= 0.25) s += `<circle class="rsb" cx="${x - 5}" cy="${y0 + 25}" r="2.1"/><path class="rs" d="M${x - 5} ${y0 + 26}q4 2 6 -1"/>`;
      }
      return s + '</g>';
    }

    s += `<circle class="halo" cx="${x}" cy="${(n.yLo + n.yHi) / 2}" r="${13 + (n.yLo - n.yHi) / 2}"/>`;
    const hollow = n.dur >= 2;
    const dotted = n.dur === 3 || n.dur === 1.5 || n.dur === 0.75 || n.dur === 0.375;
    for (const h of n.heads) {
      const y = ys(h.step);
      const v = h.step + st.off, ly = L => y0 + 50 - L * 5 + 0.5;
      for (let L = 0; L >= v; L -= 2) s += `<line class="st" x1="${x - 10}" x2="${x + 10}" y1="${ly(L)}" y2="${ly(L)}"/>`;
      for (let L = 12; L <= v; L += 2) s += `<line class="st" x1="${x - 10}" x2="${x + 10}" y1="${ly(L)}" y2="${ly(L)}"/>`;
      if (h.acc) s += `<text class="acc" x="${x - 14}" y="${y + 6}" text-anchor="middle">${accSign(h.alt)}</text>`;
      s += `<ellipse class="hd p${h.deg}${hollow ? ' ho' : ''}" cx="${x}" cy="${y + 0.5}" rx="${hollow ? 5.6 : 6.2}" ry="${hollow ? 3.8 : 4.5}" transform="rotate(-22 ${x} ${y + 0.5})"/>`;
      if (dotted) {
        const onLine = ((h.step % 2) + 2) % 2 === 0;
        s += `<circle class="dot p${h.deg}" cx="${x + 11}" cy="${onLine ? y - 4.5 : y + 0.5}" r="1.9"/>`;
      }
    }
    if (n.dur < 4) {
      const sx = n.up ? x + 5.6 : x - 5.6;
      const e = f1(n.end);
      s += `<line class="stem" x1="${sx}" x2="${sx}" y1="${n.up ? n.yLo - 1 : n.yHi + 2}" y2="${e}"/>`;
      if (n.beamed === 'a') {
        const m = n.mate;
        const mx = f1(m.x) + (n.up ? 5.6 : -5.6);
        const me = f1(m.end);
        const t = n.up ? 5 : -5;
        s += `<polygon class="beam" points="${sx - 0.7},${e} ${mx + 0.7},${me} ${mx + 0.7},${me + t} ${sx - 0.7},${e + t}"/>`;
      } else if (!n.beamed && n.dur < 1) {
        const k = n.up ? 1 : -1;
        s += `<path class="flag" d="M${sx} ${e}c1 ${7 * k} 9 ${9 * k} 7.5 ${20 * k}"/>`;
        if (n.dur <= 0.375) s += `<path class="flag" d="M${sx} ${e + 7 * k}c1 ${7 * k} 9 ${9 * k} 7.5 ${20 * k}"/>`;
      }
    }

    const ly = st.labelY;
    const top = n.heads[n.heads.length - 1];
    const label = n.heads.slice().reverse().map(h => SYL[h.deg] + (h.acc > 0 ? '♯' : h.acc < 0 ? '♭' : '')).join('·');
    s += `<text class="sy" x="${x}" y="${ly}" text-anchor="middle">${label}</text>`;
    if (n.heads.length === 1) {
      for (let k = 0; k < Math.abs(top.oct); k++) s += `<circle class="od" cx="${x}" cy="${top.oct > 0 ? ly - 15 - k * 4 : ly + 5 + k * 4}" r="1.5"/>`;
    }
    return s + '</g>';
  }

  /* ---------- 팬플룻 관 ---------- */

  let pipeEls = {};

  function renderPipes() {
    const song = state.song;
    const tonic = mod7(song.meta.fifths * 4);
    const rel = song.notes.flatMap(n => n.heads.map(h => h.deg + 7 * h.oct));
    const lo = Math.min(0, ...rel), hi = Math.max(7, ...rel);
    const count = hi - lo + 1;
    const pw = 20, gap = 3, hMax = 60, hMin = 28;
    const W = count * (pw + gap) - gap + 2;
    let g = '';
    for (let s = hi; s >= lo; s--) {
      const k = hi - s;
      const x = 1 + k * (pw + gap);
      const L = hMin + (hMax - hMin) * k / (count - 1);
      const pc = mod7(s);
      const oct = Math.floor(s / 7);
      g += `<g class="pipe p${pc}" data-step="${s}">`;
      g += `<path d="M${x} 2v${f1(L - 7)}q0 7 7 7h${pw - 14}q7 0 7 -7V2z"/>`;
      g += `<text x="${x + pw / 2}" y="18" text-anchor="middle">${SYL[pc]}</text>`;
      for (let d = 0; d < Math.abs(oct); d++) g += `<circle class="od" cx="${x + pw / 2}" cy="${oct > 0 ? 6 - d * 3 : 23 + d * 3}" r="1.2"/>`;
      g += '</g>';
    }
    $('pipes').innerHTML = `<svg width="${W}" height="${hMax + 4}" viewBox="0 0 ${W} ${hMax + 4}">${g}</svg>`;
    pipeEls = {};
    $('pipes').querySelectorAll('.pipe').forEach(el => { pipeEls[el.dataset.step] = el; });
    state.pipeTonic = tonic;
  }

  /* ---------- 소리 ---------- */

  let ctx = null, master = null, noiseBuf = null, wave = null;
  let live = [];

  function audio() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      // 여러 음이 겹쳐 넘칠 때만 눌러 주는 안전판. 보통 크기의 소리는 건드리지 않는다.
      const limit = ctx.createDynamicsCompressor();
      limit.threshold.value = -3; limit.knee.value = 3; limit.ratio.value = 12;
      limit.attack.value = 0.003; limit.release.value = 0.2;
      master.connect(limit);
      limit.connect(ctx.destination);
      // 관 소리: 한쪽이 막힌 관이라 거의 바탕음뿐이고 홀수 배음(3배·5배)만 조금 섞인다
      wave = ctx.createPeriodicWave(new Float32Array(8), new Float32Array([0, 0.62, 0.009, 0.062, 0.008, 0.017, 0.003, 0.004]), { disableNormalization: true });
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }

  // 한 음. len은 다음 음까지의 길이이고, 끝에서 혀로 끊듯 조금 일찍 닫아 다음 음과 겹치지 않게 한다.
  function tone(midi, when, len, vol, legato) {
    const f = 440 * Math.pow(2, (midi - 69) / 12);
    const gap = legato ? 0.006 : Math.min(0.085, Math.max(0.045, 0.3 * len));
    const off = when + Math.max(0.05, len - gap);
    const peak = vol == null ? 1 : vol;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, when);
    env.gain.setTargetAtTime(peak, when, 0.018);
    env.gain.setTargetAtTime(0, off, 0.016);
    env.connect(master);

    const o = ctx.createOscillator();
    o.setPeriodicWave(wave);
    o.frequency.value = f;
    // 불기 시작할 때 살짝 낮게 들어왔다가 제 높이로 올라온다
    o.detune.setValueAtTime(-14, when);
    o.detune.linearRampToValueAtTime(0, when + 0.06);
    o.connect(env);

    // 숨소리는 음이 시작될 때만 짧고 작게
    const noise = ctx.createBufferSource();
    const bp = ctx.createBiquadFilter();
    const ng = ctx.createGain();
    noise.buffer = noiseBuf;
    bp.type = 'bandpass';
    bp.frequency.value = Math.min(6000, f * 3);
    bp.Q.value = 0.8;
    ng.gain.setValueAtTime(0.05, when);
    ng.gain.exponentialRampToValueAtTime(0.001, when + 0.09);
    noise.connect(bp);
    bp.connect(ng);
    ng.connect(env);
    noise.start(when, Math.random() * 0.8, 0.1);

    o.start(when);
    o.stop(off + 0.15);
    const item = { env, srcs: [o, noise] };
    live.push(item);
    o.onended = () => {
      env.disconnect();
      const k = live.indexOf(item);
      if (k >= 0) live.splice(k, 1);
    };
  }

  // 울리던 소리는 짧게 줄인 뒤 멈춘다(뚝 끊으면 딱 소리가 난다)
  function silence() {
    const now = ctx ? ctx.currentTime : 0;
    for (const it of live) {
      it.srcs[0].onended = null;
      const env = it.env;
      env.gain.cancelScheduledValues(now);
      env.gain.setTargetAtTime(0, now, 0.012);
      for (const s of it.srcs) { try { s.stop(now + 0.08); } catch (e) { /* 아직 시작하지 않았거나 이미 멈춘 소리 */ } }
      setTimeout(() => env.disconnect(), 150);
    }
    live = [];
  }

  /* ---------- 재생 ---------- */

  let raf = 0, endAt = 0, pumpTimer = 0, queued = 0, playVol = 1;
  const AHEAD = 1.5; // 이만큼 앞의 음까지만 미리 걸어 둔다(초)
  let shown = [], shownPipe = null;
  const pitchShift = () => state.shift + 12 * state.octave;

  function clearShown() {
    for (const i of shown) if (els[i]) els[i].classList.remove('on');
    shown = [];
    if (pipeEls[shownPipe]) pipeEls[shownPipe].classList.remove('on');
    shownPipe = null;
  }

  function light(n) {
    const el = els[n.i];
    if (el) { el.classList.add('on'); shown.push(n.i); }
    return el;
  }

  function lightPipe(n) {
    if (pipeEls[shownPipe]) pipeEls[shownPipe].classList.remove('on');
    shownPipe = null;
    if (!n || n.rest || !n.heads.length) return;
    const h = n.heads[n.heads.length - 1];
    shownPipe = h.deg + 7 * h.oct;
    if (pipeEls[shownPipe]) pipeEls[shownPipe].classList.add('on');
  }

  function follow(el) {
    if (!el) return;
    const r = el.closest('svg').getBoundingClientRect();
    const top = document.querySelector('.top').getBoundingClientRect().bottom + 6;
    const bottom = document.querySelector('.foot').getBoundingClientRect().top - 6;
    if (r.top < top || r.bottom > bottom) {
      const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      window.scrollBy({ top: r.top - top - 4, behavior: smooth ? 'smooth' : 'auto' });
    }
  }

  // 멈춰 있을 때: 고른 음 하나만 밝힌다
  function showCursor(doFollow) {
    clearShown();
    const ev = state.events[state.cursor];
    if (!ev) return;
    const el = light(ev.n);
    lightPipe(ev.n);
    if (doFollow) follow(el);
  }

  const leadPart = () => { const k = state.mute.findIndex(m => !m); return k < 0 ? 0 : k; };

  function play() {
    const ev = state.events;
    if (!ev.length) return;
    audio();
    if (state.cursor >= ev.length) state.cursor = 0;
    const spb = 60 / state.tempo;
    const base = ev[state.cursor].t;
    state.playBase = base;
    const t0 = ctx.currentTime + 0.12;
    const nSound = state.song.parts.filter((p, i) => !state.mute[i]).length || 1;
    playVol = nSound > 1 ? 0.75 : 1;
    for (const e of ev) e.at = t0 + (e.t - base) * spb;
    queued = state.cursor;
    while (queued > 0 && Math.abs(ev[queued - 1].t - base) < 1e-9) queued--;
    endAt = t0 + (state.song.total - base) * spb;
    state.playing = true;
    $('play').textContent = '멈춤';
    $('ePlay').textContent = '멈춤';
    document.body.classList.add('playing');
    clearShown();
    state.onPart = [];
    pump();
    clearInterval(pumpTimer);
    pumpTimer = setInterval(pump, 200);
    step(true);
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(tick);
  }

  // 곧 날 음만 소리 장치에 건다. 곡 전체를 한꺼번에 걸면 소리 장치가 버거워 끊긴다.
  function pump() {
    if (!state.playing) return;
    const ev = state.events, spb = 60 / state.tempo;
    const base = state.playBase;
    const until = ctx.currentTime + AHEAD;
    while (queued < ev.length && ev[queued].at <= until) {
      const e = ev[queued++];
      if (e.n.rest || state.mute[e.part]) continue;
      // 붙임줄 중간에서 시작하면 그 음부터 낸다
      if (e.sound || Math.abs(e.t - base) < 1e-9) {
        const v = playVol / Math.sqrt(e.n.heads.length);
        for (const h of e.n.heads) tone(h.midi + pitchShift(), Math.max(e.at, ctx.currentTime + 0.01), e.len * spb, v, e.legato);
      }
    }
  }

  // 지금 시각까지 시작한 음을 성부마다 하나씩 밝힌다
  function step(first) {
    const now = ctx.currentTime;
    const ev = state.events;
    let k = state.cursor, moved = false;
    const base = ev[state.cursor].t;
    const apply = e => {
      const prev = state.onPart[e.part];
      if (prev != null && els[prev]) { els[prev].classList.remove('on'); shown = shown.filter(i => i !== prev); }
      const el = light(e.n);
      state.onPart[e.part] = e.n.i;
      if (e.part === leadPart()) { lightPipe(e.n); follow(el); }
    };
    if (first) {
      for (let j = state.cursor; j < ev.length && Math.abs(ev[j].t - base) < 1e-9; j++) { apply(ev[j]); k = j; }
      state.cursor = k;
      return;
    }
    while (k + 1 < ev.length && ev[k + 1].at <= now) { k++; apply(ev[k]); moved = true; }
    if (moved) state.cursor = k;
  }

  function tick() {
    if (!state.playing) return;
    step(false);
    if (ctx.currentTime >= endAt) {
      state.cursor = state.mark;
      if (state.loop) { silence(); play(); return; }
      pause();
      showCursor(true);
      return;
    }
    raf = requestAnimationFrame(tick);
  }

  function pause() {
    state.playing = false;
    cancelAnimationFrame(raf);
    clearInterval(pumpTimer);
    silence();
    $('play').textContent = '재생';
    $('ePlay').textContent = '들어보기';
    document.body.classList.remove('playing');
  }

  // 시작 자리: 누른 음에 테를 둘러 둔다. 끝까지 가거나 되풀이하면 여기로 돌아온다.
  function showMark() {
    for (const el of els) if (el) el.classList.remove('mark');
    for (const t of document.querySelectorAll('#score .markn')) t.remove();
    const e = state.mark > 0 ? state.events[state.mark] : null;
    const el = e && els[e.n.i];
    if (!el) return;
    el.classList.add('mark');
    // 몇 번째로 지날 때인지: 둘째부터 숫자를 붙인다
    let pass = 1;
    for (let i = 0; i < state.mark; i++) if (state.events[i].n === e.n) pass++;
    const halo = el.querySelector('.halo');
    if (pass > 1 && halo) {
      const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      t.setAttribute('class', 'markn');
      t.setAttribute('x', +halo.getAttribute('cx') + +halo.getAttribute('r') + 1);
      t.setAttribute('y', +halo.getAttribute('cy') - +halo.getAttribute('r') + 3);
      t.textContent = pass;
      el.appendChild(t);
    }
  }

  function restart() {
    if (!state.playing) return;
    silence();
    // 같은 시각의 첫 사건으로 되돌려 모든 성부가 함께 다시 시작하게 한다
    const t = state.events[state.cursor].t;
    while (state.cursor > 0 && Math.abs(state.events[state.cursor - 1].t - t) < 1e-9) state.cursor--;
    play();
  }

  /* ---------- 조작 ---------- */

  function load(text, fromInput) {
    const prevTempo = state.song ? state.song.meta.tempo : null;
    if (state.playing) pause();
    state.text = text;
    const song = build(text);
    if (song.meta.tempo !== prevTempo) state.tempo = song.meta.tempo;
    state.cursor = Math.min(state.cursor, Math.max(0, state.events.length - 1));
    state.mark = Math.min(state.mark, Math.max(0, state.events.length - 1));
    if (state.sel != null && state.sel >= song.notes.length) state.sel = song.notes.length ? song.notes.length - 1 : null;
    if (state.selBar != null && state.selBar > song.nBars) state.selBar = null;
    if (!fromInput) $('src').value = text;
    $('title').textContent = song.meta.title;
    $('tVal').textContent = state.tempo;
    const msgs = [];
    if (song.bad.length) msgs.push('읽지 못한 표기: ' + song.bad.join(' '));
    if (state.note) msgs.unshift(state.note);
    $('msg').textContent = msgs.join(' / ');
    // 성부 켜고 끄기 단추
    const box = $('parts');
    box.hidden = song.parts.length < 2;
    box.innerHTML = song.parts.map((p, i) => `<button type="button" data-part="${i}" aria-pressed="${!state.mute[i]}">성부 ${i + 1}</button>`).join('');
    renderPipes();
    render();
  }

  function saved() {
    try { return localStorage.getItem(STORE); } catch (e) { return null; }
  }
  function save(text) {
    try {
      if (text === DEFAULT_TEXT) localStorage.removeItem(STORE);
      else localStorage.setItem(STORE, text);
    } catch (e) { /* 저장소를 못 쓰는 환경에서는 이번 화면에서만 유지 */ }
  }

  $('play').addEventListener('click', () => { if (state.playing) pause(); else play(); });
  $('rew').addEventListener('click', () => {
    state.cursor = 0;
    state.mark = 0;
    showMark();
    if (state.playing) restart(); else showCursor(true);
  });
  $('loop').addEventListener('click', e => {
    state.loop = !state.loop;
    e.currentTarget.setAttribute('aria-pressed', state.loop);
  });
  $('parts').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    const i = +b.dataset.part;
    state.mute[i] = !state.mute[i];
    b.setAttribute('aria-pressed', !state.mute[i]);
    restart();
  });
  const setTempo = d => {
    state.tempo = Math.min(240, Math.max(30, state.tempo + d));
    $('tVal').textContent = state.tempo;
    restart();
  };
  $('tDn').addEventListener('click', () => setTempo(-4));
  $('tUp').addEventListener('click', () => setTempo(4));
  const signed = v => (v > 0 ? '+' : '') + v;
  const setOct = d => {
    state.octave = Math.min(2, Math.max(-1, state.octave + d));
    $('oVal').textContent = signed(state.octave);
    restart();
  };
  $('oDn').addEventListener('click', () => setOct(-1));
  $('oUp').addEventListener('click', () => setOct(1));
  const setShift = d => {
    state.shift = Math.min(11, Math.max(-11, state.shift + d));
    $('sVal').textContent = signed(state.shift);
    restart();
  };
  $('sDn').addEventListener('click', () => setShift(-1));
  $('sUp').addEventListener('click', () => setShift(1));

  $('tgSyl').addEventListener('click', e => {
    const on = document.body.classList.toggle('nosyl');
    e.currentTarget.setAttribute('aria-pressed', !on);
  });
  $('tgSound').addEventListener('click', e => {
    const box = $('sound');
    box.hidden = !box.hidden;
    e.currentTarget.setAttribute('aria-pressed', !box.hidden);
  });
  $('tgSrc').addEventListener('click', e => {
    const box = $('srcImg');
    box.hidden = !box.hidden;
    e.currentTarget.setAttribute('aria-pressed', !box.hidden);
  });

  $('reset').addEventListener('click', () => { pushHist(); save(DEFAULT_TEXT); state.cursor = 0; state.mark = 0; state.sel = null; state.selBar = null; state.selHdr = null; state.fixed = new Set(); state.note = ''; load(DEFAULT_TEXT, false); syncTools(); });

  $('score').addEventListener('click', e => {
    if (editing()) {
      const gap = e.target.closest('.gap');
      if (gap) fillGap(...gap.dataset.gap.split(':').map(Number));
      return;
    }
    const el = e.target.closest('.nt');
    if (!el) return;
    const n = state.song.notes[+el.dataset.n];
    // 도돌이로 두 번 지나는 음은 다시 누를 때마다 다음 번째로 넘어간다
    const at = [];
    state.events.forEach((ev, i) => { if (ev.n === n) at.push(i); });
    if (!at.length) return;
    const cur = at.indexOf(state.mark);
    const k = at[cur < 0 ? 0 : (cur + 1) % at.length];
    state.cursor = k;
    state.mark = k;
    showMark();
    if (state.playing) { restart(); return; }
    showCursor(false);
    if (!n.rest) { audio(); for (const h of n.heads) tone(h.midi + pitchShift(), ctx.currentTime + 0.02, 0.5); }
  });
  $('pipes').addEventListener('click', e => {
    const el = e.target.closest('.pipe');
    if (!el) return;
    const s = +el.dataset.step;
    const fifths = state.song.meta.fifths;
    const step = mod7(fifths * 4) + s;
    audio();
    tone(60 + 12 * Math.floor(step / 7) + SEMI[mod7(step)] + keyAlter(fifths)[mod7(step)] + pitchShift(), ctx.currentTime + 0.02, 0.5);
  });

  /* ---------- 고치기 ---------- */
  // 음을 골라 높이·길이·임시표·줄을 바꾼다. 바꾼 음만 달라지고 다른 음은 옮기지 않는다
  // (마디가 모자라거나 넘치면 그대로 보여 줄 뿐이다). 고친 내용은 글자 악보에 바로 적힌다.

  const editing = () => document.body.classList.contains('editing');
  const durText = d => (d === 1 ? '' : d === 0.5 ? '/' : d === 0.25 ? '//' : String(d));
  const isDotted = d => [3, 1.5, 0.75, 0.375].some(v => Math.abs(v - d) < 1e-6);
  const baseOf = d => (isDotted(d) ? d / 1.5 : d);
  const selNote = () => (state.sel != null && state.song ? state.song.notes[state.sel] || null : null);
  const plain = n => ({ rest: n.rest, heads: n.heads.map(h => ({ deg: h.deg, acc: h.acc, oct: h.oct })), dur: n.dur, tie: n.tie });
  const hist = [];

  function setText(t) {
    state.note = '';
    $('src').value = t;
    save(t);
    load(t, true);
  }

  function pushHist() {
    hist.push({ text: state.text, sel: state.sel, fixed: [...state.fixed] });
    if (hist.length > 200) hist.shift();
  }

  function undo() {
    const h = hist.pop();
    if (!h) return;
    state.fixed = new Set(h.fixed);
    state.sel = h.sel;
    setText(h.text);
    syncTools();
  }

  function tokenOf(m) {
    const body = m.rest ? '쉼' : m.heads.map(h => SYL[h.deg] + (h.acc > 0 ? '#'.repeat(h.acc) : 'b'.repeat(-h.acc)) + (h.oct > 0 ? "'".repeat(h.oct) : ','.repeat(-h.oct))).join('+');
    return body + durText(m.dur) + (m.tie && !m.rest ? '~' : '');
  }

  // 고른 음 하나를 바꿔 적는다. keep이면 되돌리기 한 칸에 묶는다(끌기 도중).
  function change(n, fn, keep) {
    const m = plain(n);
    fn(m);
    if (!keep) pushHist();
    if (m.dur !== n.dur) state.fixed.delete(n.i);
    state.sel = n.i;
    setText(state.text.slice(0, n.s) + tokenOf(m) + state.text.slice(n.e));
    syncTools();
  }

  function hearSel() {
    const n = selNote();
    if (!n || n.rest) return;
    audio();
    for (const h of n.heads) tone(h.midi + pitchShift(), ctx.currentTime + 0.02, 0.35);
  }

  function showSel() {
    for (const el of els) if (el) el.classList.remove('sel');
    for (const t of document.querySelectorAll('#score .selh')) t.remove();
    const n = selNote();
    if (n && els[n.i]) {
      els[n.i].classList.add('sel');
      // 겹음에서는 고른 머리에 작은 테를 더한다
      if (n.heads.length > 1) {
        const h = n.heads[Math.min(state.selHead, n.heads.length - 1)];
        const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        c.setAttribute('class', 'selh');
        c.setAttribute('cx', f1(n.x)); c.setAttribute('cy', n.st.ys(h.step) + 0.5); c.setAttribute('r', 8);
        els[n.i].appendChild(c);
      }
    }
    document.querySelectorAll('#score .bhit').forEach(el => el.classList.toggle('on', state.selBar != null && +el.dataset.b === state.selBar));
    document.querySelectorAll('#score .hhit').forEach(el => el.classList.toggle('on', el.dataset.hdr === state.selHdr));
  }

  function select(i, head) {
    state.selBar = null; state.selHdr = null;
    state.sel = i;
    state.selHead = head || 0;
    showSel();
    syncTools();
  }

  function syncTools() {
    const n = selNote();
    $('tools').classList.toggle('nosel', !n);
    const b = n ? baseOf(n.dur) : null;
    $('durs').querySelectorAll('button[data-dur]').forEach(x => x.setAttribute('aria-pressed', !!n && Math.abs(+x.dataset.dur - b) < 1e-6));
    $('eDot').setAttribute('aria-pressed', !!n && isDotted(n.dur));
    const h = n && !n.rest ? n.heads[Math.min(state.selHead, n.heads.length - 1)] : null;
    $('eSharp').setAttribute('aria-pressed', !!h && h.acc > 0);
    $('eFlat').setAttribute('aria-pressed', !!h && h.acc < 0);
    $('eRest').setAttribute('aria-pressed', !!n && n.rest);
    $('eTie').setAttribute('aria-pressed', !!n && n.tie);
    // 아래 막대: 고른 것(음 · 마디줄 · 박자표 · 조표)에 맞는 도구만 보인다
    const ed = editing(), k = state.selBar, song = state.song;
    $('player').hidden = ed;
    $('tools').hidden = !ed || k != null || state.selHdr != null;
    $('barTools').hidden = !ed || k == null;
    $('timeTools').hidden = !ed || state.selHdr !== 'time';
    $('keyTools').hidden = !ed || state.selHdr !== 'key';
    $('title').contentEditable = ed ? 'true' : 'false';
    if (!song) return;
    const left = k != null ? song.flags[k - 1] : null, right = k != null ? song.flags[k] : null;
    $('bRepEnd').setAttribute('aria-pressed', !!left && left.repEnd);
    $('bRepStart').setAttribute('aria-pressed', !!right && right.repStart);
    $('bV1').setAttribute('aria-pressed', !!right && right.voltaStart && right.volta === 1);
    $('bV2').setAttribute('aria-pressed', !!right && right.voltaStart && right.volta === 2);
    $('bRepEnd').classList.toggle('off', !left);
    for (const id of ['bRepStart', 'bV1', 'bV2']) $(id).classList.toggle('off', !right);
    $('bDel').classList.toggle('off', !left || !right);
    const ts = song.meta.beats + '/' + song.meta.unit;
    $('times').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x.dataset.ts === ts));
    const f = song.meta.fifths;
    $('kVal').textContent = f ? (f > 0 ? '♯ ' : '♭ ') + Math.abs(f) + '개' : '없음';
  }

  // 머리 하나를 줄·칸 단위 자리 v(도=0, 한 옥타브 7)로 옮긴다. 임시표는 지운다.
  function setPitch(n, k, v, keep) {
    const tonic = mod7(state.song.meta.fifths * 4);
    v = Math.max(-10 - tonic, Math.min(22 - tonic, v));
    const deg = mod7(v), oct = Math.floor(v / 7);
    if (n.heads.some((h, i) => i !== k && h.deg === deg && h.oct === oct)) return false;
    if (n.heads[k].deg === deg && n.heads[k].oct === oct) return false;
    change(n, m => { m.heads[k].deg = deg; m.heads[k].oct = oct; m.heads[k].acc = 0; }, keep);
    const nn = selNote();
    state.selHead = Math.max(0, nn.heads.findIndex(h => h.deg === deg && h.oct === oct));
    hearSel();
    return true;
  }

  function setDur(base) {
    const n = selNote();
    if (!n) return;
    change(n, m => { m.dur = base; });
  }

  function toggleDot() {
    const n = selNote();
    if (!n) return;
    const b = baseOf(n.dur);
    change(n, m => { m.dur = isDotted(n.dur) ? b : b * 1.5; });
  }

  function setAcc(v) {
    const n = selNote();
    if (!n || n.rest) return;
    const k = Math.min(state.selHead, n.heads.length - 1);
    change(n, m => { m.heads[k].acc = m.heads[k].acc === v ? 0 : v; });
    hearSel();
  }

  function toggleRest() {
    const n = selNote();
    if (!n) return;
    if (!n.rest) { change(n, m => { m.rest = true; m.heads = []; m.tie = false; }); return; }
    // 쉼표를 음표로: 같은 성부의 앞 음 높이를 따르고, 없으면 오선 가운데 줄
    const before = state.song.notes.filter(x => x.part === n.part && x.i < n.i && !x.rest).pop();
    const tonic = mod7(state.song.meta.fifths * 4);
    const head = before ? { deg: before.heads[0].deg, acc: 0, oct: before.heads[0].oct } : { deg: mod7(6 - tonic), acc: 0, oct: Math.floor((6 - tonic) / 7) };
    change(n, m => { m.rest = false; m.heads = [head]; });
    state.selHead = 0;
    hearSel();
  }

  function toggleTie() {
    const n = selNote();
    if (!n || n.rest) return;
    change(n, m => { m.tie = !m.tie; });
  }

  function insertAfter(n, m) {
    pushHist();
    state.fixed = new Set([...state.fixed].map(i => (i > n.i ? i + 1 : i)));
    state.sel = n.i + 1;
    state.selHead = 0;
    setText(state.text.slice(0, n.e) + ' ' + tokenOf(m) + state.text.slice(n.e));
    syncTools();
    hearSel();
  }

  function addNote() {
    const notes = state.song.notes;
    const n = selNote() || notes[notes.length - 1];
    if (!n) {
      pushHist();
      state.sel = 0;
      setText((state.text && !state.text.endsWith('\n') ? state.text + '\n' : state.text) + '도');
      syncTools();
      return;
    }
    const m = plain(n);
    m.tie = false;
    insertAfter(n, m);
  }

  // 모자란 마디의 빈칸을 누르면 모자란 만큼의 음을 그 마디 끝에 넣는다
  function fillGap(pi, bi) {
    const bar = state.song.parts[pi] && state.song.parts[pi].bars[bi];
    if (!bar || !bar.notes.length || bar.diff >= 0) return;
    const last = bar.notes[bar.notes.length - 1];
    const m = plain(last);
    m.dur = [4, 3, 2, 1.5, 1, 0.75, 0.5, 0.25].find(v => v <= -bar.diff + 1e-6) || 0.25;
    m.tie = false;
    insertAfter(last, m);
  }

  function delNote() {
    const n = selNote();
    if (!n) return;
    if (n.heads.length > 1) {
      const k = Math.min(state.selHead, n.heads.length - 1);
      change(n, m => { m.heads.splice(k, 1); });
      state.selHead = Math.min(k, n.heads.length - 2);
      showSel();
      return;
    }
    pushHist();
    state.fixed = new Set([...state.fixed].filter(i => i !== n.i).map(i => (i > n.i ? i - 1 : i)));
    const t = state.text;
    const from = n.s > 0 && t[n.s - 1] === ' ' ? n.s - 1 : n.s;
    const left = state.song.notes.length - 1;
    state.sel = left ? Math.min(n.i, left - 1) : null;
    setText(t.slice(0, from) + t.slice(n.e));
    syncTools();
  }

  function setMode(edit) {
    if (state.playing) pause();
    document.body.classList.toggle('editing', edit);
    $('mListen').setAttribute('aria-pressed', !edit);
    $('mEdit').setAttribute('aria-pressed', edit);
    if (edit) { $('sound').hidden = true; $('tgSound').setAttribute('aria-pressed', false); }
    syncTools();
  }
  $('mListen').addEventListener('click', () => setMode(false));
  $('mEdit').addEventListener('click', () => setMode(true));

  $('durs').addEventListener('click', e => {
    const b = e.target.closest('button[data-dur]');
    if (b) setDur(+b.dataset.dur);
  });
  $('eDot').addEventListener('click', toggleDot);
  $('eSharp').addEventListener('click', () => setAcc(1));
  $('eFlat').addEventListener('click', () => setAcc(-1));
  $('eRest').addEventListener('click', toggleRest);
  $('eTie').addEventListener('click', toggleTie);
  $('eAdd').addEventListener('click', addNote);
  $('eDel').addEventListener('click', delNote);
  document.querySelectorAll('.undo').forEach(b => b.addEventListener('click', undo));
  $('ePlay').addEventListener('click', () => {
    if (state.playing) { pause(); return; }
    const n = selNote();
    state.cursor = Math.max(0, n ? state.events.findIndex(ev => ev.n === n) : 0);
    play();
  });

  /* ---------- 마디줄 · 도돌이 · 괄호 · 박자 · 조표 ---------- */
  // 악보에서 마디줄, 박자표, 음자리표·조표를 누르면 그것을 고르고 아래 막대가 그 도구로 바뀐다.
  // 곡의 얼개를 바꾼 뒤 글자 악보를 통째로 다시 적는다(음의 차례는 그대로다).

  function serialize(meta, parts) {
    const L = [];
    if (meta.title) L.push('제목 ' + meta.title);
    L.push(`박자 ${meta.beats}/${meta.unit}`);
    if (meta.fifths) L.push('조표 ' + (meta.fifths > 0 ? '#' : 'b') + Math.abs(meta.fifths));
    L.push('빠르기 ' + meta.tempo);
    if (meta.first !== 1) L.push('첫마디 ' + meta.first);
    parts.forEach((p, pi) => {
      if (parts.length > 1) L.push('성부 ' + (pi + 1));
      if (p.clef === 'F') L.push('음자리표 낮은');
      let line = [];
      p.bars.forEach((b, bi) => {
        const next = p.bars[bi + 1];
        if (b.repStart) line.push('|:');
        if (b.voltaStart && b.volta) line.push('[' + b.volta);
        for (const n of b.notes) line.push(tokenOf(n));
        if (b.repEnd) line.push(':|');
        else if (!next) line.push('||');
        else if (!next.repStart) line.push('|');
        if ((bi + 1) % 4 === 0 || !next) { L.push(line.join(' ')); line = []; }
      });
    });
    return L.join('\n');
  }

  function restructure(fn) {
    pushHist();
    const song = state.song;
    fn(song);
    setText(serialize(song.meta, song.parts));
    syncTools();
  }

  // k번째 마디줄: k번 마디의 왼쪽 끝(0은 곡의 맨 앞, 마디 수와 같으면 맨 끝)
  function selectBar(k) {
    state.sel = null; state.selHdr = null;
    state.selBar = k;
    showSel();
    syncTools();
  }

  function selectHdr(what) {
    state.sel = null; state.selBar = null;
    state.selHdr = what;
    showSel();
    syncTools();
  }

  function toggleRepEnd() {
    const k = state.selBar, f = state.song.flags[k - 1];
    if (k == null || !f) return;
    const on = !f.repEnd;
    restructure(song => song.parts.forEach(p => { if (p.bars[k - 1]) p.bars[k - 1].repEnd = on; }));
  }

  function toggleRepStart() {
    const k = state.selBar, f = state.song.flags[k];
    if (k == null || !f) return;
    const on = !f.repStart;
    restructure(song => song.parts.forEach(p => { if (p.bars[k]) p.bars[k].repStart = on; }));
  }

  function toggleVolta(v) {
    const k = state.selBar, f = state.song.flags[k];
    if (k == null || !f) return;
    const nv = f.voltaStart && f.volta === v ? 0 : v;
    restructure(song => song.parts.forEach(p => { if (p.bars[k]) { p.bars[k].volta = nv; p.bars[k].voltaStart = !!nv; } }));
  }

  // 마디줄을 지우면 앞뒤 마디가 한 마디가 된다
  function removeBarline() {
    const k = state.selBar;
    if (k == null || k < 1 || k >= state.song.nBars) return;
    restructure(song => song.parts.forEach(p => {
      const a = p.bars[k - 1], b = p.bars[k];
      if (!a || !b) return;
      a.notes.push(...b.notes);
      a.repEnd = b.repEnd; a.final = b.final;
      p.bars.splice(k, 1);
    }));
    state.selBar = null;
    showSel();
    syncTools();
  }

  // 고른 음 뒤에서 마디를 나눈다. 성부가 여럿이면 모든 성부의 같은 박 자리에서 나눈다.
  function splitAfter() {
    const n = selNote();
    if (!n) return;
    const off = n.off + n.dur, bi = n.bar.index;
    const at = state.song.parts.map(p => (p.bars[bi] ? p.bars[bi].notes.findIndex(x => Math.abs(x.off - off) < 1e-6) : -2));
    if (at[n.part] <= 0) return;
    if (at.some(i => i === -1 || i === 0)) { $('msg').textContent = '다른 성부에 그 자리에서 시작하는 음이 없어 나눌 수 없음'; return; }
    restructure(song => song.parts.forEach((p, pi) => {
      const b = p.bars[bi];
      if (!b) return;
      const nb = { notes: b.notes.splice(at[pi]), repStart: false, repEnd: b.repEnd, volta: b.volta === 1 ? 1 : 0, voltaStart: false, final: b.final };
      b.repEnd = false; b.final = false;
      p.bars.splice(bi + 1, 0, nb);
    }));
  }

  function setTime(beats, unit) {
    restructure(song => { song.meta.beats = beats; song.meta.unit = unit; });
  }

  // 조표를 바꾼다. 음표의 줄·칸 자리는 그대로 두고 계이름만 새 조에 맞춰 다시 읽는다.
  // 임시표가 붙은 음은 실제 높이(올림·내림 정도)를 지킨다.
  function setKey(f) {
    f = Math.max(-7, Math.min(7, f));
    if (f === state.song.meta.fifths) return;
    restructure(song => {
      const tonic = mod7(f * 4), nk = keyAlter(f);
      for (const p of song.parts) for (const b of p.bars) for (const n of b.notes) for (const h of n.heads) {
        const v = h.step - tonic;
        if (h.acc) h.acc = Math.max(-2, Math.min(2, h.alt - nk[mod7(h.step)]));
        h.deg = mod7(v); h.oct = Math.floor(v / 7);
      }
      song.meta.fifths = f;
    });
  }

  // 겹음: 고른 음 위로 3도 위 음을 하나 더 얹는다
  function addHead() {
    const n = selNote();
    if (!n || n.rest || n.heads.length >= 4) return;
    const base = n.heads[Math.min(state.selHead, n.heads.length - 1)];
    let v = base.deg + 7 * base.oct + 2;
    while (n.heads.some(h => h.deg + 7 * h.oct === v)) v++;
    const deg = mod7(v), oct = Math.floor(v / 7);
    change(n, m => { m.heads.push({ deg, acc: 0, oct }); });
    const nn = selNote();
    state.selHead = Math.max(0, nn.heads.findIndex(h => h.deg === deg && h.oct === oct));
    showSel();
    hearSel();
  }

  $('bRepEnd').addEventListener('click', toggleRepEnd);
  $('bRepStart').addEventListener('click', toggleRepStart);
  $('bV1').addEventListener('click', () => toggleVolta(1));
  $('bV2').addEventListener('click', () => toggleVolta(2));
  $('bDel').addEventListener('click', removeBarline);
  $('eBar').addEventListener('click', splitAfter);
  $('eChord').addEventListener('click', addHead);
  $('times').addEventListener('click', e => {
    const b = e.target.closest('button[data-ts]');
    if (b) setTime(...b.dataset.ts.split('/').map(Number));
  });
  $('kDn').addEventListener('click', () => setKey(state.song.meta.fifths - 1));
  $('kUp').addEventListener('click', () => setKey(state.song.meta.fifths + 1));

  // 제목: 고치기에서 누르면 바로 고쳐 쓴다
  $('title').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } });
  $('title').addEventListener('blur', e => {
    const t = e.target.textContent.replace(/\s+/g, ' ').trim();
    if (t !== state.song.meta.title) restructure(song => { song.meta.title = t; });
  });

  /* ---------- 내보내기 ---------- */

  function download(name, data, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([data], { type }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  const fileBase = () => (state.song.meta.title || '가락').replace(/[\\/:*?"<>|]+/g, ' ').trim() || '가락';

  $('tgIo').addEventListener('click', e => {
    const box = $('io');
    box.hidden = !box.hidden;
    e.currentTarget.setAttribute('aria-pressed', !box.hidden);
    if (!box.hidden) $('src').value = state.text;
  });
  $('xXml').addEventListener('click', () => download(fileBase() + '.musicxml', window.GarakExport.musicXML(state.song), 'application/vnd.recordare.musicxml+xml'));
  $('xMidi').addEventListener('click', () => download(fileBase() + '.mid', window.GarakExport.midi(state.events, { tempo: state.tempo, shift: pitchShift(), parts: state.song.parts.length }), 'audio/midi'));
  $('xPrint').addEventListener('click', () => window.print());
  $('xCopy').addEventListener('click', e => {
    const done = () => { const b = e.currentTarget || $('xCopy'); b.textContent = '복사함'; setTimeout(() => { b.textContent = '글자 악보 복사'; }, 1200); };
    $('src').value = state.text;
    const fallback = () => { $('src').focus(); $('src').select(); try { document.execCommand('copy'); } catch (err) { /* 고른 채로 두면 직접 복사할 수 있다 */ } done(); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(state.text).then(done, fallback);
    else fallback();
  });
  $('xApply').addEventListener('click', () => {
    const t = $('src').value;
    if (t === state.text) return;
    pushHist();
    state.note = ''; state.fixed = new Set(); state.sel = null; state.selBar = null; state.selHdr = null;
    save(t);
    load(t, true);
    syncTools();
  });


  // 끌어서 높이 바꾸기: 머리가 손가락을 따라 줄·칸 단위로 움직인다
  let drag = null;
  const scoreEl = $('score');
  scoreEl.addEventListener('pointerdown', e => {
    if (!editing() || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const bh = e.target.closest('.bhit');
    if (bh) { selectBar(+bh.dataset.b); return; }
    const hh = e.target.closest('.hhit');
    if (hh) { selectHdr(hh.dataset.hdr); return; }
    const el = e.target.closest('.nt');
    if (!el) { if (!e.target.closest('.gap')) select(null); return; }
    const n = state.song.notes[+el.dataset.n];
    const was = state.sel === n.i;
    let hi = 0;
    if (!n.rest && n.heads.length > 1) {
      const y = e.clientY - el.closest('svg').getBoundingClientRect().top;
      let bd = Infinity;
      n.heads.forEach((h, k) => { const d = Math.abs(n.st.ys(h.step) - y); if (d < bd) { bd = d; hi = k; } });
    }
    select(n.i, hi);
    hearSel();
    if (n.rest) return;
    // 터치에서는 이미 고른 음 위에서만 끈다. 다른 곳에서는 화면이 스크롤된다.
    if (e.pointerType !== 'mouse' && !was) return;
    const h = n.heads[hi];
    drag = { id: e.pointerId, y: e.clientY, v0: h.deg + 7 * h.oct, k: 0, started: false };
    scoreEl.setPointerCapture(e.pointerId);
    if (e.pointerType === 'mouse') e.preventDefault();
  });
  scoreEl.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    const k = Math.round((drag.y - e.clientY) / 5);
    if (k === drag.k) return;
    const n = selNote();
    if (!n || n.rest) return;
    if (setPitch(n, Math.min(state.selHead, n.heads.length - 1), drag.v0 + k, drag.started)) drag.started = true;
    drag.k = k;
  });
  const endDrag = e => { if (drag && e.pointerId === drag.id) drag = null; };
  scoreEl.addEventListener('pointerup', endDrag);
  scoreEl.addEventListener('pointercancel', endDrag);

  const DUR_KEY = { Digit1: 4, Digit2: 2, Digit4: 1, Digit8: 0.5, Digit6: 0.25, Numpad1: 4, Numpad2: 2, Numpad4: 1, Numpad8: 0.5, Numpad6: 0.25 };
  document.addEventListener('keydown', e => {
    const tag = e.target.tagName;
    if (tag === 'TEXTAREA' || tag === 'INPUT' || e.target.isContentEditable) return;
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') { e.preventDefault(); undo(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (tag === 'BUTTON' && (e.code === 'Space' || e.code === 'Enter')) return;
    if (e.code === 'Space') { e.preventDefault(); (editing() ? $('ePlay') : $('play')).click(); return; }
    if (!editing()) return;
    if (state.selBar != null) {
      if (e.code === 'Delete' || e.code === 'Backspace') { e.preventDefault(); removeBarline(); }
      else if (e.code === 'Escape') select(null);
      return;
    }
    const n = selNote();
    const notes = state.song.notes;
    if (e.code === 'ArrowUp' || e.code === 'ArrowDown') {
      if (!n || n.rest) return;
      e.preventDefault();
      const d = e.code === 'ArrowUp' ? 1 : -1, k = Math.min(state.selHead, n.heads.length - 1), h = n.heads[k];
      if (e.shiftKey) { change(n, m => { m.heads[k].acc = Math.max(-1, Math.min(1, m.heads[k].acc + d)); }); hearSel(); }
      else setPitch(n, k, h.deg + 7 * h.oct + d);
    } else if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
      if (!notes.length) return;
      e.preventDefault();
      select(n ? Math.max(0, Math.min(notes.length - 1, n.i + (e.code === 'ArrowRight' ? 1 : -1))) : 0);
      hearSel();
      follow(els[state.sel]);
    } else if (DUR_KEY[e.code] && !e.shiftKey) setDur(DUR_KEY[e.code]);
    else if (e.code === 'Period' || e.code === 'NumpadDecimal') toggleDot();
    else if (e.code === 'KeyR') toggleRest();
    else if (e.code === 'KeyT') toggleTie();
    else if (e.code === 'Enter' || e.code === 'NumpadEnter') { e.preventDefault(); addNote(); }
    else if (e.code === 'Delete' || e.code === 'Backspace') { e.preventDefault(); delNote(); }
    else if (e.code === 'Escape') select(null);
  });

  /* ---------- 악보 이미지 읽기 ---------- */

  const MAX_SIDE = 3400;

  function readImage(file) {
    if (!file) return;
    if (state.playing) pause();
    const url = URL.createObjectURL(file);
    const img = new Image();
    $('msg').textContent = '악보를 읽는 중입니다.';
    img.onerror = () => { URL.revokeObjectURL(url); $('msg').textContent = '이미지를 열지 못했습니다. PNG나 JPG 파일인지 확인해 주세요.'; };
    img.onload = () => {
      // 화면에 "읽는 중"이 먼저 보이도록 한 박자 쉬고 시작
      setTimeout(() => {
        try {
          const k = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
          const cv = document.createElement('canvas');
          cv.width = Math.round(img.naturalWidth * k); cv.height = Math.round(img.naturalHeight * k);
          const c2 = cv.getContext('2d', { willReadFrequently: true });
          c2.fillStyle = '#fff'; c2.fillRect(0, 0, cv.width, cv.height);
          c2.drawImage(img, 0, 0, cv.width, cv.height);
          const data = c2.getImageData(0, 0, cv.width, cv.height);
          const res = window.OMR.recognize({ width: cv.width, height: cv.height, data: data.data });
          if (res.error) { $('msg').textContent = res.error + ' 인쇄된 5선보 이미지인지, 너무 작거나 흐리지 않은지 확인해 주세요.'; return; }
          const title = file.name.replace(/\.[^.]+$/, '');
          const text = window.OMR.toText(res, { title });
          const nBars = Math.max(...res.parts.map(p => p.bars.length));
          const fixed = [], off = [];
          res.parts[0].bars.forEach((b, i) => {
            if (res.parts.some(p => p.bars[i] && p.bars[i].fixed)) fixed.push(i + 1);
          });
          let note = `마디 ${nBars}개를 읽음`;
          if (res.parts.length > 1) note += `(성부 ${res.parts.length}개)`;
          if (fixed.length) note += `, 박자에 맞춰 고친 마디: ${fixed.join(', ')}`;
          if (res.spacing < 12) note += `, 오선 간격이 ${Math.round(res.spacing)}픽셀로 좁아 틀린 곳이 많을 수 있음`;
          state.note = note;
          pushHist();
          state.cursor = 0; state.mark = 0; state.sel = null;
          // 엔진이 박자에 맞추려고 길이를 고친 음(글자 악보의 음 차례와 같다)
          state.fixed = new Set();
          let ni = 0;
          for (const p of res.parts) for (const b of p.bars) for (const ev of b.ev) { if (ev.fixed) state.fixed.add(ni); ni++; }
          $('src').value = text;
          save(text);
          load(text, true);
          $('srcPic').src = url;
          $('tgSrc').hidden = false;
          syncTools();
        } catch (err) {
          $('msg').textContent = '읽는 중 오류가 났습니다: ' + err.message;
        }
      }, 30);
    };
    img.src = url;
  }
  $('pick').addEventListener('change', e => { readImage(e.target.files[0]); e.target.value = ''; });
  $('readBtn').addEventListener('click', () => $('pick').click());
  document.addEventListener('dragover', e => { e.preventDefault(); });
  document.addEventListener('drop', e => {
    e.preventDefault();
    const f = [...(e.dataTransfer ? e.dataTransfer.files : [])].find(x => x.type.startsWith('image/'));
    if (f) readImage(f);
  });
  document.addEventListener('paste', e => {
    if (e.target === $('src')) return;
    const f = [...(e.clipboardData ? e.clipboardData.files : [])].find(x => x.type.startsWith('image/'));
    if (f) readImage(f);
  });

  if (window.ResizeObserver) {
    new ResizeObserver(() => {
      const w = Math.floor($('score').clientWidth - 32);
      if (w !== lastW) render();
    }).observe($('score'));
  } else {
    window.addEventListener('resize', render);
  }

  load(saved() || DEFAULT_TEXT, false);
  syncTools();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(render);
})();

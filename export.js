/* 내보내기: 곡을 MusicXML과 MIDI로 바꾼다. 화면과 무관한 순수 변환이다. */
(function (root) {
  'use strict';

  const LETTER = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  const DIV = 48; // 4분음표 하나를 나눈 수(16분음표 = 12, 점16분 = 18)
  const TYPES = [[6, 'whole', 1], [4, 'whole', 0], [3, 'half', 1], [2, 'half', 0], [1.5, 'quarter', 1], [1, 'quarter', 0],
    [0.75, 'eighth', 1], [0.5, 'eighth', 0], [0.375, '16th', 1], [0.25, '16th', 0]];
  const ACC = { '2': 'double-sharp', '1': 'sharp', '0': 'natural', '-1': 'flat', '-2': 'flat-flat' };
  const mod7 = n => ((n % 7) + 7) % 7;
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const same = (a, c) => a.heads.length === c.heads.length && a.heads.every((h, k) => h.midi === c.heads[k].midi);

  /* MusicXML(score-partwise 4.0). 음표·길이·임시표·붙임줄·이음줄·조표·박자·음자리표·도돌이·괄호·빠르기·제목을 담는다.
     박자가 안 맞는 마디도 적힌 길이 그대로 내보낸다. */
  function musicXML(song) {
    const meta = song.meta;
    const barDur = Math.round(song.barLen * DIV);
    let x = '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">\n' +
      '<score-partwise version="4.0">\n';
    if (meta.title) x += `  <work><work-title>${esc(meta.title)}</work-title></work>\n`;
    x += '  <part-list>\n';
    song.parts.forEach((p, i) => {
      x += `    <score-part id="P${i + 1}"><part-name>${song.parts.length > 1 ? '성부 ' + (i + 1) : esc(meta.title || '가락')}</part-name></score-part>\n`;
    });
    x += '  </part-list>\n';

    song.parts.forEach((p, pi) => {
      // 줄(~): 다음 음과 높이가 같으면 붙임줄, 다르면 이음줄
      const seq = [];
      p.bars.forEach(b => b.notes.forEach(n => seq.push(n)));
      const marks = new Map();
      const mk = n => { if (!marks.has(n)) marks.set(n, {}); return marks.get(n); };
      seq.forEach((n, k) => {
        const m = seq[k + 1];
        if (!n.tie || n.rest || !m || m.rest) return;
        const kind = same(n, m) ? 'tie' : 'slur';
        mk(n)[kind + 'Start'] = true;
        mk(m)[kind + 'Stop'] = true;
      });

      x += `  <part id="P${pi + 1}">\n`;
      for (let b = 0; b < song.nBars; b++) {
        const bar = p.bars[b], f = song.flags[b], next = song.flags[b + 1];
        const pickup = bar && b === 0 && bar.len < song.barLen - 1e-6;
        x += `    <measure number="${meta.first + b}"${pickup ? ' implicit="yes"' : ''}>\n`;
        if (b === 0) {
          x += `      <attributes><divisions>${DIV}</divisions><key><fifths>${meta.fifths}</fifths></key>` +
            `<time><beats>${meta.beats}</beats><beat-type>${meta.unit}</beat-type></time>` +
            `<clef><sign>${p.clef === 'F' ? 'F' : 'G'}</sign><line>${p.clef === 'F' ? 4 : 2}</line></clef></attributes>\n`;
          if (pi === 0) {
            x += `      <direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${meta.tempo}</per-minute></metronome></direction-type><sound tempo="${meta.tempo}"/></direction>\n`;
          }
        }
        if (f.repStart || f.voltaStart) {
          x += '      <barline location="left">' + (f.repStart ? '<bar-style>heavy-light</bar-style>' : '') +
            (f.voltaStart ? `<ending number="${f.volta}" type="start"/>` : '') +
            (f.repStart ? '<repeat direction="forward"/>' : '') + '</barline>\n';
        }
        if (!bar || !bar.notes.length) {
          x += `      <note><rest measure="yes"/><duration>${barDur}</duration><voice>1</voice></note>\n`;
        } else {
          for (const n of bar.notes) {
            const ty = TYPES.find(t => Math.abs(t[0] - n.dur) < 1e-6);
            const shape = ty ? `<type>${ty[1]}</type>` + (ty[2] ? '<dot/>' : '') : '';
            const dur = `<duration>${Math.max(1, Math.round(n.dur * DIV))}</duration>`;
            if (n.rest) { x += `      <note><rest/>${dur}<voice>1</voice>${shape}</note>\n`; continue; }
            const m = marks.get(n) || {};
            n.heads.forEach((h, k) => {
              const ties = (m.tieStop ? '<tie type="stop"/>' : '') + (m.tieStart ? '<tie type="start"/>' : '');
              let nota = (m.tieStop ? '<tied type="stop"/>' : '') + (m.tieStart ? '<tied type="start"/>' : '');
              if (k === 0) nota += (m.slurStop ? '<slur type="stop" number="1"/>' : '') + (m.slurStart ? '<slur type="start" number="1"/>' : '');
              x += '      <note>' + (k ? '<chord/>' : '') +
                `<pitch><step>${LETTER[mod7(h.step)]}</step>${h.alt ? `<alter>${h.alt}</alter>` : ''}<octave>${4 + Math.floor(h.step / 7)}</octave></pitch>` +
                dur + ties + '<voice>1</voice>' + shape +
                (h.acc ? `<accidental>${ACC[String(Math.max(-2, Math.min(2, h.alt)))]}</accidental>` : '') +
                (nota ? `<notations>${nota}</notations>` : '') + '</note>\n';
            });
          }
        }
        const voltaEnd = f.volta && (f.repEnd || !next || next.volta !== f.volta || next.voltaStart);
        if (f.repEnd || f.final || voltaEnd) {
          x += '      <barline location="right">' + (f.repEnd || f.final ? '<bar-style>light-heavy</bar-style>' : '') +
            (voltaEnd ? `<ending number="${f.volta}" type="${f.volta === 1 ? 'stop' : 'discontinue'}"/>` : '') +
            (f.repEnd ? '<repeat direction="backward"/>' : '') + '</barline>\n';
        }
        x += '    </measure>\n';
      }
      x += '  </part>\n';
    });
    return x + '</score-partwise>\n';
  }

  /* MIDI(형식 1). 재생 차례대로(도돌이는 펼쳐서) 음높이와 길이만 담는다.
     events: { n, part, t, len, sound, legato } 박 단위, opt: { tempo, shift, parts } */
  function midi(events, opt) {
    const TPQ = 480;
    const vlq = v => {
      const out = [v & 0x7f];
      while ((v >>= 7)) out.unshift((v & 0x7f) | 0x80);
      return out;
    };
    const chunk = (id, bytes) => [...id].map(c => c.charCodeAt(0)).concat([(bytes.length >>> 24) & 255, (bytes.length >>> 16) & 255, (bytes.length >>> 8) & 255, bytes.length & 255], bytes);
    const us = Math.round(60000000 / opt.tempo);
    const tracks = [[0, 0xff, 0x51, 3, (us >> 16) & 255, (us >> 8) & 255, us & 255, 0, 0xff, 0x2f, 0]];
    for (let pi = 0; pi < opt.parts; pi++) {
      const ch = pi >= 9 ? pi + 1 : pi; // 10번 채널(타악기)은 건너뛴다
      const list = [];
      for (const e of events) {
        if (e.part !== pi || !e.sound || e.n.rest) continue;
        const on = Math.round(e.t * TPQ);
        const off = Math.max(on + 1, Math.round((e.t + e.len * (e.legato ? 1 : 0.92)) * TPQ));
        for (const h of e.n.heads) {
          const key = Math.max(0, Math.min(127, h.midi + opt.shift));
          list.push({ t: on, o: 1, b: [0x90 | ch, key, 88] }, { t: off, o: 0, b: [0x80 | ch, key, 0] });
        }
      }
      list.sort((a, c) => a.t - c.t || a.o - c.o);
      const bytes = [0, 0xc0 | ch, 75]; // 팬플룻 음색
      let last = 0;
      for (const ev of list) { bytes.push(...vlq(ev.t - last), ...ev.b); last = ev.t; }
      bytes.push(0, 0xff, 0x2f, 0);
      tracks.push(bytes);
    }
    let out = chunk('MThd', [0, 1, 0, tracks.length, (TPQ >> 8) & 255, TPQ & 255]);
    for (const t of tracks) out = out.concat(chunk('MTrk', t));
    return new Uint8Array(out);
  }

  root.GarakExport = { musicXML, midi };
})(typeof window !== 'undefined' ? window : globalThis);

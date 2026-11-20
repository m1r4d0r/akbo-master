  /* ================= 7. 악보로 엮기 ================= */

  const SHARP_ORDER = [3, 0, 4, 1, 5, 2, 6], FLAT_ORDER = [6, 2, 5, 1, 4, 0, 3];
  function keyAlter(fifths) {
    const alt = [0, 0, 0, 0, 0, 0, 0];
    for (let i = 0; i < Math.abs(fifths); i++) { if (fifths > 0) alt[SHARP_ORDER[i]] = 1; else alt[FLAT_ORDER[i]] = -1; }
    return alt;
  }
  const mod7 = n => ((n % 7) + 7) % 7;

  function recognize(img, opt) {
    opt = opt || {};
    const A = analyze(img);
    if (A.error) return { error: A.error };
    const { W, H } = A;
    const sym = A.P.sym;
    const HP = SP * A.HK; // 머리 치수의 단위
    const warnings = [];

    /* --- 단(여러 오선 묶음): 두 오선을 잇는 긴 세로선(마디줄이거나, 단의 왼쪽 끝에 선 이음선·묶음표)으로 묶는다 --- */
    const rows = [];
    A.per.forEach((S, i) => {
      const prev = i > 0 ? A.per[i - 1].st : null, cur = S.st;
      const joined = prev && A.vlines.some(v => v.len > 5 * SP && v.y0 <= prev.bottom + SP && v.y1 >= cur.top - SP &&
        (v.kind !== 'none' || (v.x >= cur.xL - 2 * SP && v.x <= cur.xL + 1.5 * SP)));
      if (joined) rows[rows.length - 1].push(S); else rows.push([S]);
    });
    // 여러 오선이 묶인 악보에서 같은 자리의 오선은 음자리표가 같다: 단마다 판정이 갈리면 많은 쪽을 따른다
    {
      const count = {};
      for (const r of rows) count[r.length] = (count[r.length] || 0) + 1;
      const n = +Object.entries(count).sort((a, b) => b[1] - a[1])[0][0];
      if (n > 1) for (let k = 0; k < n; k++) {
        const col = rows.filter(r => r.length === n).map(r => r[k]);
        const f = col.filter(S => S.clef === 'F').length;
        const clef = f * 2 > col.length ? 'F' : f * 2 < col.length ? 'G' : null;
        if (clef) for (const S of col) S.clef = clef;
      }
    }

    /* --- 오선별: 사건(음표·쉼표) 만들기 --- */
    const staffRes = A.per.map(S => {
      const st = S.st;
      const off = S.clef === 'F' ? -10 : 2; // 맨 아랫줄의 음높이(도=0, 한 음씩 +1)
      const events = [];
      // 오선을 벗어난 음에는 덧줄이 있다. 덧줄 없이 오선 밖에 떠 있는 것은 가사·코드 이름·셈여림 같은 글자다.
      const bin = A.P.bin;
      const hasLedger = h => {
        const p = Math.round(h.pos);
        if (p > -2 && p < 10) return true;
        const yL = Math.round(p <= -2 ? st.bottom + SP : st.top - SP);
        // 덧줄은 머리 양옆으로 조금씩 나온 가는 가로줄이다
        const thinAt = x => {
          if (x < 0 || x >= W) return false;
          for (let d = -2; d <= 2; d++) {
            const yy = yL + d;
            if (yy < 1 || yy >= H - 1 || !bin[yy * W + x]) continue;
            let a2 = yy, b2 = yy;
            while (a2 > 0 && bin[(a2 - 1) * W + x]) a2--;
            while (b2 < H - 1 && bin[(b2 + 1) * W + x]) b2++;
            // 머리가 덧줄에 걸친 자리는 두꺼워도 된다
            if (b2 - a2 + 1 <= st.t + 3 || Math.abs((a2 + b2) / 2 - h.y) <= 0.75 * HP) return true;
          }
          return false;
        };
        const side = sgn => { for (let dx = 0.65 * HP; dx <= 1.15 * HP; dx++) if (thinAt(Math.round(h.x + sgn * dx))) return true; return false; };
        return side(-1) && side(1);
      };
      for (const s of S.stems) {
        const heads = s.heads.filter(hasLedger).map(h => ({ pos: h.pos, step: Math.round(h.pos) + off, x: h.x, y: h.y, filled: h.filled, fill: h.fill, acc: null }));
        if (!heads.length) continue;
        const filled = heads.filter(h => h.filled).length * 2 >= heads.length;
        const x = heads.reduce((a, h) => a + h.x, 0) / heads.length;
        events.push({ type: 'note', x, heads, dir: s.dir, filled, flags: s.flags, base: filled ? Math.pow(0.5, s.flags) : 2, dots: 0, stem: s });
      }
      // 같은 자리에 쌓인 온음표는 한 화음
      for (const w of S.wholes.filter(hasLedger).sort((a, b) => a.x - b.x)) {
        const head = { pos: w.pos, step: Math.round(w.pos) + off, x: w.x, y: w.y, filled: false, acc: null };
        const prev = events[events.length - 1];
        if (prev && prev.whole && Math.abs(prev.x - w.x) <= 1.4 * HP && prev.heads.every(h => h.step !== head.step)) prev.heads.push(head);
        else events.push({ type: 'note', whole: true, x: w.x, heads: [head], dir: 0, filled: false, flags: 0, base: 4, dots: 0 });
      }
      for (const r of S.rests) {
        events.push({ type: 'rest', x: r.x, x0: r.x0, x1: r.x1, y: r.y, kind: r.kind, far: !!r.far, base: r.kind === 'whole' ? 4 : r.kind === 'half' ? 2 : r.kind === 'rest4' ? 1 : r.kind === 'rest16' ? 0.25 : 0.5, dots: 0 });
      }
      events.sort((a, b) => a.x - b.x);

      // 점
      for (const d of S.dots) {
        let best = null, bd = 1e9;
        for (const e of events) {
          const right = e.type === 'rest' ? e.x1 : Math.max(...e.heads.map(h => h.x)) + 0.55 * HP;
          const dx = d.x - right;
          if (dx < -0.1 * SP || dx > 1.7 * SP) continue;
          let ok = false;
          if (e.type === 'rest') ok = Math.abs(d.y - (e.far ? e.y - 0.3 * SP : st.top + 1.5 * SP)) <= 0.8 * SP;
          else ok = e.heads.some(h => d.y - h.y <= 0.65 * SP && d.y - h.y >= -0.8 * SP);
          if (!ok) continue;
          // 점은 제 머리 옆 칸에 찍힌다(줄 위의 머리는 바로 위 칸). 두 성부의 머리가 위아래로 놓이면 높이가 맞는 쪽의 점이다.
          let cost = dx;
          if (e.type === 'note') cost += 1.5 * Math.min(...e.heads.map(h => Math.abs(d.y - (Math.abs(h.pos - Math.round(h.pos / 2) * 2) < 0.5 ? h.y - st.sp / 2 : h.y))));
          // 한 머리를 두 성부가 함께 쓰면(기둥이 위·아래로 둘) 점은 긴 음의 것이다
          if (cost < bd - 0.5 || (Math.abs(cost - bd) <= 0.5 && best && e.base > best.base)) { bd = cost; best = e; }
        }
        if (best) { (best.dotXs = best.dotXs || []).push(d.x); d.used = true; }
      }
      // 화음은 머리마다 점이 붙으므로 가로 자리가 다른 점만 센다
      for (const e of events) {
        if (!e.dotXs) continue;
        e.dotXs.sort((a, b) => a - b);
        let n = 1;
        for (let i = 1; i < e.dotXs.length; i++) if (e.dotXs[i] - e.dotXs[i - 1] > 0.4 * SP) n++;
        e.dots = Math.min(2, n);
      }

      // 임시표
      for (const a of S.accs) {
        let best = null, bd = 1e9;
        for (const e of events) {
          if (e.type !== 'note') continue;
          for (const h of e.heads) {
            const dx = h.x - a.x1;
            if (dx < 0.05 * SP || dx > 2.4 * SP + 0.6 * (HP - SP)) continue;
            if (Math.abs(h.pos - a.pos) > 1.3) continue;
            if (dx < bd) { bd = dx; best = h; }
          }
        }
        if (best && !best.acc) { best.acc = a.type; a.used = true; }
      }

      const bars = S.barlines.filter(b => b.x > S.xStart - 2);
      return { S, st, events, barlines: bars, off };
    });

    const systems = rows.map(r => r.map(S => staffRes.find(q => q.S === S)));
    const sizes = {};
    for (const s of systems) sizes[s.length] = (sizes[s.length] || 0) + 1;
    const nParts = +Object.entries(sizes).sort((a, b) => b[1] - a[1])[0][0];

    /* --- 붙임줄 판정: 두 머리 사이에서 머리 바로 아래(또는 위)로 이어지는 얇은 호를 따라간다 --- */
    function arcCover(st, y, xa, xb, barXs, side, minBow) {
      if (minBow == null) minBow = 0.4;
      xa = Math.round(xa); xb = Math.round(xb);
      if (xb - xa < 3) return 0;
      let bestCov = 0;
      const k0 = Math.round(0.2 * SP), k1 = Math.round(2.2 * SP);
      for (const sgn of side ? [side] : [1, -1]) {
        // 열마다 얇은 토막(호 후보)들을 모은다
        const xs = [];
        const cand = [];
        for (let x = xa; x <= xb; x++) {
          if (barXs.some(b => x >= b[0] - 3 && x <= b[1] + 3)) continue;
          const runs = [];
          let run = 0, start = 0;
          for (let k = k0; k <= k1 + 1; k++) {
            const yy = Math.round(y + sgn * k);
            const b = k <= k1 && yy >= 0 && yy < H && sym[yy * W + x];
            if (b) { if (!run) start = k; run++; }
            else if (run) { if (run <= 0.45 * SP) runs.push(start + run / 2); run = 0; }
          }
          xs.push(x); cand.push(runs);
        }
        const n = xs.length;
        if (n < 3) continue;
        // 가장 길게 매끄럽게 이어지는 줄기 찾기
        const tracks = [];
        for (let i = 0; i < n; i++) {
          for (const v of cand[i]) {
            let best = null;
            for (const t of tracks) {
              if (i - t.last > Math.round(0.9 * SP) || i === t.last) continue;
              const tol = 2.5 + 0.6 * (i - t.last - 1);
              if (Math.abs(v - t.y) <= tol && (!best || t.pts.length > best.pts.length)) best = t;
            }
            if (best) { best.pts.push([i, v]); best.last = i; best.y = v; }
            else tracks.push({ pts: [[i, v]], last: i, y: v });
          }
        }
        let tr = null;
        for (const t of tracks) if (!tr || t.pts.length > tr.pts.length) tr = t;
        if (!tr || tr.pts.length < 3) continue;
        const col = new Array(n).fill(null);
        for (const [i, v] of tr.pts) col[i] = v;
        // 호가 오선과 겹쳐 함께 지워진 열은 판단에서 뺀다
        let unknown = 0;
        for (let i = 0; i < n; i++) {
          if (col[i] != null) continue;
          let l = i - 1, r = i + 1;
          while (l >= 0 && col[l] == null && i - l <= 0.9 * SP) l--;
          while (r < n && col[r] == null && r - i <= 0.9 * SP) r++;
          if (l < 0 || r >= n || col[l] == null || col[r] == null) continue;
          const kk = col[l] + (col[r] - col[l]) * (i - l) / (r - l);
          const yy = y + sgn * kk;
          if (st.lines.some(ly => Math.abs(ly - yy) <= st.t + 2)) { col[i] = -1; unknown++; }
        }
        const ys = col.filter(v => v != null && v >= 0);
        const cols = n - unknown;
        if (cols < 3) continue;
        const cov = ys.length / cols;
        const mn = Math.min(...ys), mx = Math.max(...ys);
        if (mx - mn > 1.3 * SP) continue;
        // 호는 가운데가 머리에서 가장 멀다(평평한 줄 찌꺼기와 구별)
        const third = Math.max(1, Math.floor(ys.length / 3));
        const avg = arr => arr.reduce((a, v) => a + v, 0) / arr.length;
        const midArr = ys.slice(third, ys.length - third);
        const ends = avg(ys.slice(0, third).concat(ys.slice(-third))), midv = avg(midArr.length ? midArr : ys);
        if (ys.length >= 6 && midv - ends < minBow) continue;
        bestCov = Math.max(bestCov, cov);
      }
      return bestCov;
    }

    /* --- 성부별 마디 만들기 --- */
    const parts = [];
    for (let p = 0; p < nParts; p++) parts.push({ clef: null, bars: [] });
    let fifthsVotes = {};
    const timeInfo = [];
    for (const sys of systems) {
      if (sys.length !== nParts) { warnings.push('단마다 오선 수가 달라 일부를 건너뜀'); continue; }
      // 마디줄 자리: 오선들의 마디줄을 x로 묶기
      const all = [];
      sys.forEach((r, k) => r.barlines.forEach(b => all.push({ b, k })));
      all.sort((a, b) => a.b.x - b.b.x);
      const bounds = [];
      for (const it of all) {
        const last = bounds[bounds.length - 1];
        if (last && it.b.x - last.x <= 0.9 * SP) { last.items.push(it); last.x = (last.x * (last.items.length - 1) + it.b.x) / last.items.length; }
        else bounds.push({ x: it.b.x, items: [it] });
      }
      const need = Math.ceil(sys.length / 2 + 0.01);
      const bnd = bounds.filter(b => new Set(b.items.map(i => i.k)).size >= Math.min(need, sys.length) || b.items.some(i => i.b.long));
      bnd.forEach(b => {
        b.repStart = b.items.some(i => i.b.repStart); b.repEnd = b.items.some(i => i.b.repEnd);
        b.thick = b.items.some(i => i.b.thick);
        b.xa = Math.min(...b.items.map(i => i.b.xa)); b.xb = Math.max(...b.items.map(i => i.b.xb));
      });
      sys.forEach((r, k) => {
        const part = parts[k];
        if (!part.clef) part.clef = r.S.clef;
        const sh = r.S.keyAccs.filter(a => a.type === 'sharp').length, fl = r.S.keyAccs.filter(a => a.type === 'flat').length;
        const f = r.S.keyFifths != null ? r.S.keyFifths : sh ? sh + (r.S.keyMissed || 0) : fl ? -(fl + (r.S.keyMissed || 0)) : 0;
        fifthsVotes[f] = (fifthsVotes[f] || 0) + 1;
        if (r.S.digits.length) timeInfo.push(r.S.digits);
        const nb = bnd.length;
        const cells = [];
        for (let i = 0; i <= nb; i++) cells.push({ events: [], left: i > 0 ? bnd[i - 1] : null, right: i < nb ? bnd[i] : null, staff: r });
        for (const e of r.events) {
          let i = 0;
          while (i < nb && bnd[i].x < e.x) i++;
          cells[i].events.push(e);
        }
        // 맨 끝 마디줄 뒤의 빈 칸은 버린다
        while (cells.length && !cells[cells.length - 1].events.length && cells.length > 1 && cells[cells.length - 1].left) cells.pop();
        // 맨 앞: 첫 마디줄이 도돌이 시작이면서 앞이 비었으면 버린다
        if (cells.length > 1 && !cells[0].events.length) cells.shift();
        cells.forEach((c, i) => {
          const lx = c.left ? c.left.x : r.S.xStart;
          const volta = r.S.voltas.some(v => Math.abs(v.x0 - lx) <= 1.6 * SP || (!c.left && v.x0 <= lx + 1.6 * SP));
          part.bars.push({
            voltaStart: volta,
            events: c.events, staff: r,
            repStart: !!(c.left && c.left.repStart), repEnd: !!(c.right && c.right.repEnd),
            final: !!(c.right && c.right.thick && !c.right.repEnd && !c.right.repStart),
            sysBreak: i === 0, barXs: bnd.map(b => [b.xa, b.xb]),
          });
        });
      });
    }

    // 도돌이 괄호 번호: 첫 괄호는 1(도돌이 끝까지), 그 바로 뒤 괄호는 2
    for (const part of parts) {
      let open1 = false, afterRep = false;
      for (const bar of part.bars) {
        if (bar.voltaStart) {
          if (afterRep) { bar.ending = 2; open1 = false; }
          else { bar.ending = 1; open1 = true; }
        } else if (open1) bar.ending = 1;
        afterRep = false;
        if (bar.repEnd) { if (open1) afterRep = true; open1 = false; }
      }
    }

    // 조표는 단마다 같다. 표가 같으면 더 많이 읽힌 쪽(임시표는 덧붙기보다 빠지기 쉽다)
    const fifths = +Object.entries(fifthsVotes).sort((a, b) => b[1] - a[1] || Math.abs(+b[0]) - Math.abs(+a[0]))[0][0] || 0;
    const kalt = keyAlter(fifths);

    /* --- 임시표: 오선 단위로, 마디 안에서 왼쪽부터 --- */
    for (const part of parts) for (const bar of part.bars) {
      const state = new Map();
      for (const e of bar.events) {
        if (e.type !== 'note') continue;
        for (const h of e.heads) {
          if (h.acc) { h.alt = h.acc === 'sharp' ? 1 : h.acc === 'flat' ? -1 : 0; state.set(h.step, h.alt); }
          else h.alt = state.has(h.step) ? state.get(h.step) : kalt[mod7(h.step)];
        }
      }
    }

    /* --- 한 오선에 두 성부가 적힌 경우 나누기 --- */
    {
      const out = [];
      for (const part of parts) {
        let nNotes = 0, nChord = 0, nPair = 0;
        for (const bar of part.bars) {
          const ns = bar.events.filter(e => e.type === 'note');
          nNotes += ns.length;
          nChord += ns.filter(e => e.heads.length >= 2).length;
          for (const a of ns) if (a.dir > 0) for (const b of ns) if (b.dir < 0 && Math.abs(a.x - b.x) <= 1.3 * HP) { nPair++; break; }
        }
        const voices = nPair >= Math.max(3, 0.12 * nNotes);
        const dyads = !voices && nChord >= Math.max(3, 0.25 * nNotes);
        // 제자리를 벗어난 쉼표는 두 성부가 한 오선을 쓸 때만 쉼표로 본다
        if (!voices) for (const bar of part.bars) bar.events = bar.events.filter(e => !(e.type === 'rest' && e.far));
        // 한 성부 악보에서 한 머리에 기둥이 둘 붙었다면 하나는 다른 것(코드 이름의 획 등)이다: 빔·꼬리가 있거나 긴 쪽을 남긴다
        if (!voices) for (const bar of part.bars) {
          const ns = bar.events.filter(e => e.type === 'note' && e.stem);
          const drop = new Set();
          for (const a of ns) for (const b of ns) {
            if (a === b || drop.has(a) || drop.has(b) || a.heads.length !== 1 || b.heads.length !== 1) continue;
            if (Math.abs(a.heads[0].x - b.heads[0].x) > 0.3 * HP || Math.abs(a.heads[0].y - b.heads[0].y) > 0.3 * SP) continue;
            const rank = e => (e.flags ? 100 : 0) + e.stem.v.len / SP;
            drop.add(rank(a) >= rank(b) ? b : a);
          }
          if (drop.size) bar.events = bar.events.filter(e => !drop.has(e));
        }
        if (!voices && !dyads) { out.push(part); continue; }
        const p1 = { clef: part.clef, bars: [], side: -1 }, p2 = { clef: part.clef, bars: [], side: 1 };
        for (const bar of part.bars) {
          const b1 = Object.assign({}, bar, { events: [] }), b2 = Object.assign({}, bar, { events: [] });
          const st = bar.staff.st;
          for (const e of bar.events) {
            const clone = heads => Object.assign({}, e, { heads: heads.map(h => Object.assign({}, h)) });
            if (e.type === 'rest') {
              const blockRest = e.kind === 'whole' || e.kind === 'half';
              const hi = blockRest ? st.top + 1.0 * SP : st.mid - 0.7 * SP, lo = blockRest ? st.top + 2.0 * SP : st.mid + 0.7 * SP;
              if (voices && e.y < hi) b1.events.push(Object.assign({}, e));
              else if (voices && e.y > lo) b2.events.push(Object.assign({}, e));
              else { b1.events.push(Object.assign({}, e, { shared: voices })); b2.events.push(Object.assign({}, e, { shared: voices })); }
            } else if (voices) {
              if (e.dir > 0) b1.events.push(e);
              else if (e.dir < 0) b2.events.push(e);
              else { const c1 = clone(e.heads), c2 = clone(e.heads); c1.shared = c2.shared = true; b1.events.push(c1); b2.events.push(c2); }
            } else {
              const hs = e.heads.slice().sort((a, c) => a.step - c.step);
              if (hs.length >= 2) { b1.events.push(clone([hs[hs.length - 1]])); b2.events.push(clone(hs.slice(0, hs.length - 1))); }
              else { b1.events.push(clone(hs)); b2.events.push(clone(hs)); }
            }
          }
          b1.other = b2; b2.other = b1;
          p1.bars.push(b1); p2.bars.push(b2);
        }
        out.push(p1, p2);
      }
      parts.length = 0;
      for (const p of out) parts.push(p);
    }

    /* --- 길이, 붙임줄 --- */
    for (const part of parts) {
      let prevEv = null, prevBar = null;
      for (const bar of part.bars) {
        for (const e of bar.events) {
          e.d = e.base * (e.dots === 1 ? 1.5 : e.dots === 2 ? 1.75 : 1);
          if (e.type !== 'note') { prevEv = null; continue; }
          e.tiedIn = false; e.tie = false;
          if (prevEv && prevEv.type === 'note' && prevEv.heads.length === 1 && e.heads.length === 1 && prevEv.heads[0].step === e.heads[0].step) {
            const a = prevEv.heads[0], b = e.heads[0];
            const sameStaff = prevBar.staff === bar.staff;
            let cov = 0;
            // 가까운 두 음 사이의 붙임줄은 머리 바로 밑에서 밑으로 이어진다: 머리 아래까지 본다
            const near = sameStaff && b.x - a.x < 4 * SP;
            const M = near ? 0.1 * SP : 0.7 * HP;
            if (sameStaff) cov = arcCover(bar.staff.st, (a.y + b.y) / 2, a.x + M, b.x - M, bar.barXs, part.side || 0, near ? 0.12 * SP : 0.4);
            else {
              const st1 = prevBar.staff.st, st2 = bar.staff.st;
              const c1 = arcCover(st1, a.y, a.x + M, Math.min(st1.xR - 2, a.x + 3.5 * SP), prevBar.barXs, part.side || 0);
              const c2 = arcCover(st2, b.y, Math.max(bar.staff.S.xStart + 2, b.x - 3.5 * SP), b.x - M, bar.barXs, part.side || 0);
              cov = Math.max(c1, c2);
            }
            if (cov >= 0.6) {
              prevEv.tie = true; e.tiedIn = true;
              // 붙임줄로 이어진 음은 앞 음의 임시표를 그대로 따른다
              if (!b.acc) b.alt = a.alt;
            }
            e.tieCov = cov;
          }
          prevEv = e; prevBar = bar;
        }
        if (!bar.events.length) prevEv = null;
      }
    }

    /* --- 이음줄: 여러 음에 걸친 호를 찾아 그 사이의 음들을 줄로 잇는다 --- */
    {
      // 가는 가로 획을 열에서 열로 따라가 매끄럽게 휜 줄기(호)를 모은다.
      // 곧은 선(셈여림 쐐기·괄호 줄·덧줄)과 짧은 획(글자·꼬리)은 호가 아니다.
      const maxT = Math.max(3, Math.round(0.34 * SP)), maxT2 = Math.round(0.5 * SP);
      const GAP = Math.round(0.5 * SP);
      const findArcs = (st, xFrom, xTo, heads, accs) => {
        const ya = st.zTop, yb = st.zBot;
        const x0 = Math.max(1, Math.round(xFrom)), x1 = Math.min(W - 2, Math.round(xTo));
        const cols = [];
        for (let x = x0; x <= x1; x++) {
          const runs = [];
          let run = 0;
          for (let y = ya; y <= yb + 1; y++) {
            if (y <= yb && sym[y * W + x]) { run++; continue; }
            if (run && run <= maxT2) {
              // 머리와 임시표 안의 획은 호가 아니다
              const yc = y - run / 2 - 0.5;
              if (!accs.some(a => x >= a.x0 && x <= a.x1 && yc >= a.y0 && yc <= a.y1) &&
                  !heads.some(h => Math.abs(h.x - x) < 0.75 * HP && Math.abs(h.y - yc) < 0.55 * HP)) runs.push({ y: yc, t: run, used: false });
            }
            run = 0;
          }
          cols.push(runs);
        }
        const arcs = [];
        for (let ci = 0; ci < cols.length; ci++) for (const r0 of cols[ci]) {
          // 가는 토막에서 시작하고, 오선과 겹쳐 두꺼워진 가운데는 이어서 따라간다
          if (r0.used || r0.t > maxT) continue;
          const pts = [{ x: x0 + ci, y: r0.y, t: r0.t }];
          r0.used = true;
          let c = ci, cur = r0, slope = 0;
          for (;;) {
            let found = null, fc = -1;
            for (let n = c + 1; n <= Math.min(cols.length - 1, c + 1 + GAP) && !found; n++) {
              const pred = cur.y + slope * (n - c), tol = 1.6 + 0.3 * (n - c - 1);
              let bd = tol;
              for (const r of cols[n]) { const d = Math.abs(r.y - pred); if (!r.used && d <= bd) { bd = d; found = r; fc = n; } }
            }
            if (!found) break;
            slope = 0.75 * slope + 0.25 * (found.y - cur.y) / (fc - c);
            found.used = true;
            pts.push({ x: x0 + fc, y: found.y, t: found.t });
            c = fc; cur = found;
          }
          const w = pts[pts.length - 1].x - pts[0].x;
          if (w < 1.5 * SP || pts.length < 0.6 * w) continue;
          // 양 끝을 이은 곧은 선에서 한쪽으로만, 가운데가 가장 멀리 휘어 있어야 한다
          const a = pts[0], b = pts[pts.length - 1];
          let bow = 0, at = 0, pos = 0, neg = 0, tsum = 0;
          for (const q of pts) {
            const d = q.y - (a.y + (b.y - a.y) * (q.x - a.x) / w);
            if (Math.abs(d) > Math.abs(bow)) { bow = d; at = (q.x - a.x) / w; }
            if (d > 1) pos++; else if (d < -1) neg++;
            tsum += q.t;
          }
          // 덧줄처럼 한 높이로 곧게 뻗은 부분이 대부분이면 호가 아니다(덧줄 자리면 더 엄하게)
          let flat = 0;
          for (let i = 0, j = 0, lo, hi; i < pts.length; i++) {
            if (j < i) j = i;
            lo = hi = pts[i].y;
            for (let k = i; k < pts.length; k++) { lo = Math.min(lo, pts[k].y); hi = Math.max(hi, pts[k].y); if (hi - lo > 1) break; j = k; }
            const len = pts[j].x - pts[i].x;
            if (len > flat) {
              const off = pts[i].y < st.top ? st.top - pts[i].y : pts[i].y - st.bottom;
              const onLedger = off > 0.5 * SP && Math.abs(off / SP - Math.round(off / SP)) < 0.14;
              if (len >= (onLedger ? 0.5 : 0.7) * w) { flat = -1; break; }
              flat = len;
            }
          }
          if (flat < 0) continue;
          const need = Math.max(0.16 * SP, 0.03 * w);
          if (Math.abs(bow) < need || Math.abs(bow) > 0.45 * w + SP) continue;
          if (at < 0.2 || at > 0.8) continue;
          if ((bow > 0 ? neg : pos) > 0.12 * pts.length) continue;
          if (tsum / pts.length > 0.34 * SP) continue;
          // 4분의 1, 4분의 3 자리에서도 휜 만큼의 절반은 떨어져 있어야 한다(꺾인 선이 아니라 둥근 호)
          const dAt = f => { const q = pts[Math.round(f * (pts.length - 1))]; return (q.y - (a.y + (b.y - a.y) * (q.x - a.x) / w)) / bow; };
          if (dAt(0.25) < 0.35 || dAt(0.75) < 0.35) continue;
          // 나란히 붙은 두 호(∪∪)는 가운데가 다시 올라온다: 가운데 자리는 가장 많이 휜 쪽에 가까워야 한다
          let mid = pts[0];
          for (const q of pts) if (Math.abs(q.x - a.x - w / 2) < Math.abs(mid.x - a.x - w / 2)) mid = q;
          if ((mid.y - (a.y + (b.y - a.y) * (mid.x - a.x) / w)) / bow < 0.6) continue;
          // 끝은 가파르게 서 있어 가는 획으로 잡히지 않는다: 끝에서 바깥으로(가운데의 반대쪽으로) 잉크를 더 따라간다
          const grow = (q, dir) => {
            let x = q.x, lo = q.y - q.t / 2, hi = q.y + q.t / 2, y = q.y, far = q.y;
            for (let n = 0, skip = 0; n < 2.6 * SP; n++) {
              const nx = x + dir * (1 + skip);
              if (nx < x0 || nx > x1) break;
              // 휜 방향의 반대쪽으로 이어지는 토막을 찾는다(∩ 모양이면 아래로, ∪ 모양이면 위로)
              let ra = -1, rb = -1;
              const from = Math.round(bow < 0 ? lo - 1 - skip : lo - 1.4 * SP), to = Math.round(bow < 0 ? hi + 1.4 * SP : hi + 1 + skip);
              for (let yy = Math.max(ya, from); yy <= Math.min(yb, to); yy++) {
                if (!sym[yy * W + nx]) { if (ra >= 0 && rb >= lo - 1.5 - skip) break; ra = -1; continue; }
                if (ra < 0) ra = yy;
                rb = yy;
              }
              // 오선을 지운 자리에서 잠깐 끊긴 곳은 건너뛴다
              if (ra < 0 || rb < lo - 1.5 - skip || ra > hi + 1.5 + skip) { if (++skip > 0.35 * SP) break; continue; }
              skip = 0;
              while (ra > ya && sym[(ra - 1) * W + nx]) ra--;
              while (rb < yb && sym[(rb + 1) * W + nx]) rb++;
              if (rb - ra + 1 > 1.3 * SP) break;
              // 머리나 임시표에 닿으면 거기가 끝이다
              const ym = (ra + rb) / 2;
              if (heads.some(h => Math.abs(h.x - nx) < 0.85 * HP && Math.abs(h.y - ym) < 0.7 * HP)) break;
              if (accs.some(c => nx >= c.x0 && nx <= c.x1 && ym >= c.y0 && ym <= c.y1)) break;
              // 끝으로 갈수록 휜 쪽에서 멀어지기만 한다: 되돌아오면 옆에 붙은 다른 호다
              const edge = bow < 0 ? rb : ra;
              if (bow < 0 ? edge < far - 1.5 : edge > far + 1.5) break;
              far = bow < 0 ? Math.max(far, edge) : Math.min(far, edge);
              x = nx; lo = ra; hi = rb; y = edge;
            }
            return { x, y };
          };
          const ea = grow(a, -1), eb = grow(b, 1);
          arcs.push({ xa: ea.x, ya: ea.y, xb: eb.x, yb: eb.y, bow, pts });
        }
        // 오선에 걸려 두 토막으로 따라간 한 호는 하나로 합친다
        const yOf = (arc, x) => { let best = arc.pts[0]; for (const q of arc.pts) if (Math.abs(q.x - x) < Math.abs(best.x - x)) best = q; return best.y; };
        for (let i = 0; i < arcs.length; i++) for (let j = i + 1; j < arcs.length; j++) {
          const p = arcs[i], q = arcs[j];
          if (p.bow * q.bow <= 0) continue;
          const lo = Math.max(p.pts[0].x, q.pts[0].x), hi = Math.min(p.pts[p.pts.length - 1].x, q.pts[q.pts.length - 1].x);
          if (hi - lo < 0.5 * SP) continue;
          const xm = (lo + hi) / 2;
          if (Math.abs(yOf(p, xm) - yOf(q, xm)) > 0.4 * SP) continue;
          const L = p.xa <= q.xa ? p : q, R = p.xb >= q.xb ? p : q;
          arcs[i] = { xa: L.xa, ya: L.ya, xb: R.xb, yb: R.yb, bow: Math.abs(p.bow) > Math.abs(q.bow) ? p.bow : q.bow, pts: p.pts.concat(q.pts).sort((u, v) => u.x - v.x) };
          arcs.splice(j, 1); j = i;
        }
        return arcs;
      };

      // 오선마다 호를 찾고, 양 끝에 가장 가까운 음을 시작 음과 끝 음으로 삼는다
      const flat = parts.map(part => {
        const list = [];
        for (const bar of part.bars) for (const e of bar.events) list.push({ e, bar });
        return list;
      });
      const staffs = new Set();
      for (const part of parts) for (const bar of part.bars) staffs.add(bar.staff);
      const spans = [];
      A.arcs = [];
      for (const sf of staffs) {
        const st = sf.st;
        const here = [];
        flat.forEach((list, pi) => list.forEach((it, k) => { if (it.bar.staff === sf && it.e.type === 'note') here.push({ pi, k, e: it.e }); }));
        const arcs = findArcs(st, sf.S.xStart, st.xR, here.flatMap(c => c.e.heads), sf.S.accs);
        // 호의 끝은 머리 바로 옆이나 기둥 끝 가까이에서 시작하고 끝난다
        const nearest = (x, y, side) => {
          let best = null, bs = 2.4 * SP;
          for (const c of here) {
            const e = c.e;
            for (const h of e.heads) {
              // 시작 음은 호의 왼쪽에, 끝 음은 오른쪽에 있다
              if (side < 0 ? h.x > x + 0.8 * SP : h.x < x - 0.8 * SP) continue;
              const d = Math.hypot(h.x - x, 0.7 * (h.y - y));
              if (d < bs) { bs = d; best = c; }
            }
            if (!e.dir) continue;
            // 기둥 쪽에 놓인 호는 기둥 끝이나 기둥 옆에서 시작하고 끝난다
            const h = e.dir > 0 ? e.heads.reduce((p, q) => (q.y < p.y ? q : p)) : e.heads.reduce((p, q) => (q.y > p.y ? q : p));
            const sx = h.x + 0.6 * HP * e.dir, tip = h.y - e.dir * 3.3 * SP;
            if (side < 0 ? sx > x + 0.8 * SP : sx < x - 0.8 * SP) continue;
            const yy = Math.max(Math.min(h.y, tip), Math.min(Math.max(h.y, tip), y));
            const d = 1.15 * Math.hypot(sx - x, 0.7 * (yy - y));
            if (d < bs) { bs = d; best = c; }
          }
          return best;
        };
        for (const arc of arcs) {
          let A1 = nearest(arc.xa, arc.ya, -1), B1 = nearest(arc.xb, arc.yb, 1);
          // 단이 바뀌며 끊긴 이음줄: 단의 오른쪽 끝까지 가면 다음 단 첫 음까지, 단의 왼쪽 끝에서 시작하면 그 단 첫 음부터
          if (A1 && !B1 && arc.xb >= st.xR - 1.2 * SP) {
            const mine = here.filter(c => c.pi === A1.pi);
            const lastK = Math.max(...mine.map(c => c.k));
            if (lastK + 1 < flat[A1.pi].length) B1 = { pi: A1.pi, k: lastK + 1 };
          } else if (!A1 && B1 && arc.xa <= sf.S.xStart + 1.5 * SP) {
            A1 = { pi: B1.pi, k: Math.min(...here.filter(c => c.pi === B1.pi).map(c => c.k)) };
          }
          A.arcs.push({ from: A1 ? A1.k : null, to: B1 ? B1.k : null, xa: arc.xa, ya: arc.ya, xb: arc.xb, yb: arc.yb, bow: arc.bow });
          if (!A1 || !B1 || A1.pi !== B1.pi || B1.k <= A1.k || B1.k - A1.k > 8) continue;
          spans.push({ pi: A1.pi, a: A1.k, b: B1.k });
        }
      }
      const samePitch = (p, q) => p.heads.length === 1 && q.heads.length === 1 && p.heads[0].step === q.heads[0].step && p.heads[0].alt === q.heads[0].alt;
      for (const sp of spans) {
        const list = flat[sp.pi];
        for (let k = sp.a; k < sp.b; k++) {
          const p = list[k].e, q = list[k + 1].e;
          if (p.type !== 'note' || q.type !== 'note') continue;
          if (!samePitch(p, q)) { p.tie = true; continue; }
          // 긴 이음줄 안의 같은 음 둘은 붙임줄이 아니다. 그 둘만 잇는 호가 따로 있을 때만 붙임줄이다.
          if (sp.b - sp.a >= 2 && !spans.some(o => o.pi === sp.pi && o.a === k && o.b === k + 1)) { p.tie = false; q.tiedIn = false; }
          // 같은 음 둘만 잇는 호는 붙임줄이다
          else if (sp.b - sp.a === 1) { p.tie = true; q.tiedIn = true; }
        }
      }
    }

    /* --- 박자 --- */
    const sums = {};
    for (const part of parts) part.bars.forEach(bar => {
      bar.sum = bar.events.reduce((a, e) => a + e.d, 0);
      const k = Math.round(bar.sum * 4) / 4;
      if (k > 0) sums[k] = (sums[k] || 0) + 1;
    });
    let L = +(Object.entries(sums).sort((a, b) => b[1] - a[1])[0] || [4])[0];
    let meter = L === 4 ? [4, 4] : L === 3 ? [3, 4] : L === 2 ? [2, 4] : L === 1.5 ? [3, 8] : L === 4.5 ? [9, 8] : L === 6 ? [6, 4] : [Math.round(L * 2), 8];
    // 한 마디가 3박 길이일 때: 박자표 숫자에 구멍이 있으면(6, 8) 6/8, 없으면 3/4
    const th = staffRes.map(r => r.S.timeHoles).find(Boolean);
    if (L === 3) {
      // 리듬 증거: 1.5박에서 시작해 2박을 넘는 음(6/8) 대 1박·2박에서 시작해 1.5박·2.5박을 넘는 음(3/4)
      let e68 = 0, e34 = 0;
      for (const part of parts) for (const bar of part.bars) {
        let t = 0;
        for (const e of bar.events) {
          if (Math.abs(t - 1.5) < 1e-6 && e.d >= 1) e68++;
          if ((Math.abs(t - 1) < 1e-6 || Math.abs(t - 2) < 1e-6) && e.d >= 1) e34++;
          t += e.d;
        }
      }
      const digits68 = th ? (th.top >= 1 && th.bot >= 2) : null;
      if (digits68 === true && e34 <= e68 * 2 + 1) meter = [6, 8];
      else if (th && th.top >= 1 && th.bot >= 1 && e68 > e34) meter = [6, 8];
      else if (!th && e68 > e34 * 2 + 1) meter = [6, 8];
    }
    if (opt.meter) { meter = opt.meter; L = meter[0] * 4 / meter[1]; }

    // 두 성부가 함께 쓰는 자리의 쉼표와 기둥 없는 온음표: 한쪽 성부가 그것 없이도 찼으면 다른 쪽 것이다
    for (const part of parts) for (const bar of part.bars) {
      const o = bar.other;
      if (!o || bar.sharedDone) continue;
      bar.sharedDone = o.sharedDone = true;
      const sh = bar.events.filter(e => e.shared);
      if (!sh.length) continue;
      const dOf = e => (e.type === 'rest' && e.kind === 'whole') ? L : e.d;
      const own = b => b.events.reduce((a, e) => a + (e.shared ? 0 : e.d), 0);
      const o1 = own(bar), o2 = own(o), tot = sh.reduce((a, e) => a + dOf(e), 0);
      const fit = v => Math.abs(v - L) < 1e-6;
      let keep1 = null; // 위 성부에 남길 것들
      if (fit(o1 + tot) && fit(o2 + tot)) continue;
      const n = Math.min(sh.length, 4);
      let best = null;
      for (let m = 0; m < (1 << n); m++) {
        let a = o1, b = o2;
        for (let k = 0; k < n; k++) { if (m >> k & 1) a += dOf(sh[k]); else b += dOf(sh[k]); }
        const miss = Math.abs(a - L) + Math.abs(b - L);
        if (!best || miss < best.miss - 1e-6) best = { m, miss };
      }
      // 둘 다 가지는 쪽이 더 잘 맞으면 그대로 둔다
      if (Math.abs(o1 + tot - L) + Math.abs(o2 + tot - L) <= best.miss + 1e-6) continue;
      keep1 = new Set(); for (let k = 0; k < n; k++) if (best.m >> k & 1) keep1.add(sh[k].x);
      bar.events = bar.events.filter(e => !e.shared || keep1.has(e.x));
      o.events = o.events.filter(e => !e.shared || !keep1.has(e.x));
      for (const b of [bar, o]) { for (const e of b.events) e.shared = false; b.sum = b.events.reduce((a, e) => a + e.d, 0); }
    }

    // 온쉼표 하나뿐인 마디는 한 마디 쉼
    for (const part of parts) for (const bar of part.bars) {
      if (bar.events.length === 1 && bar.events[0].type === 'rest' && bar.events[0].kind === 'whole') { bar.events[0].d = L; bar.sum = L; }
    }

    /* --- 리듬 검산: 박자에 안 맞는 마디는 가장 의심스러운 곳을 고쳐 맞춘다 --- */
    const fixes = [];
    for (const part of parts) {
      part.bars.forEach((bar, bi) => {
        if (!bar.events.length || Math.abs(bar.sum - L) < 1e-6) return;
        const edge = bi === 0 || bi === part.bars.length - 1;
        if (edge && bar.sum < L) return; // 못갖춘마디
        // 사건마다 가능한 다른 길이와 그 대가
        const alts = bar.events.map(e => {
          const out = [];
          const mul = e.dots === 1 ? 1.5 : e.dots === 2 ? 1.75 : 1;
          if (e.type === 'note') {
            if (e.dots === 0) out.push({ d: e.base * 1.5, cost: 3, what: '점 추가', set: () => { e.dots = 1; } });
            else out.push({ d: e.base, cost: 3, what: '점 빼기', set: () => { e.dots = 0; } });
            // 오선 밖에 뜬 온음표는 코드 이름 같은 글자의 고리일 수 있다
            if (e.whole && e.heads.length === 1 && (e.heads[0].pos > 9.5 || e.heads[0].pos < -1.5)) out.push({ d: 0, cost: 2.5, what: '음표 아님', set: () => { e.drop = true; } });
            if (e.dir !== 0 && e.filled) {
              if (e.flags > 0) out.push({ d: e.base * 2 * mul, cost: 4, what: '꼬리 하나 줄임', set: () => { e.flags--; e.base *= 2; } });
              if (e.flags < 3) out.push({ d: e.base / 2 * mul, cost: 4, what: '꼬리 하나 늘림', set: () => { e.flags++; e.base /= 2; } });
              if (e.flags === 0) {
                const h = e.heads[0];
                const c = h.envFill != null && h.envFill < 0.95 ? 2.5 : 5;
                out.push({ d: 2 * mul, cost: c, what: '4분음표 → 2분음표', set: () => { e.filled = false; e.base = 2; } });
              }
            } else if (e.dir !== 0 && !e.filled) {
              const h = e.heads[0];
              const c = h.hole && h.hole.h >= 0.45 * SP ? 5 : (h.envFill != null && h.envFill >= 0.8 ? 2.5 : 4);
              out.push({ d: 1 * mul, cost: c, what: '2분음표 → 4분음표', set: () => { e.filled = true; e.base = 1; } });
            }
          } else {
            out.push({ d: 0, cost: e.shared ? 1 : 3.5, what: e.shared ? '다른 성부의 쉼표' : '쉼표 아님', set: () => { e.drop = true; } });
            const k = e.kind;
            const swap = (to, base, cost) => out.push({ d: base * mul, cost, what: '쉼표 종류 바꿈', set: () => { e.kind = to; e.base = base; } });
            if (k === 'rest4') { swap('rest16', 0.25, 2.5); swap('rest8', 0.5, 4); }
            if (k === 'rest16') { swap('rest4', 1, 2.5); swap('rest8', 0.5, 3); }
            if (k === 'rest8') { swap('rest16', 0.25, 3); swap('rest4', 1, 4); }
            if (k === 'whole') swap('half', 2, 2.5);
            if (k === 'half') swap('whole', 4, 2.5);
            if (e.dots === 0) out.push({ d: e.base * 1.5, cost: 3.5, what: '점 추가', set: () => { e.dots = 1; } });
            else out.push({ d: e.base, cost: 3, what: '점 빼기', set: () => { e.dots = 0; } });
          }
          for (const o of out) o.ev = e;
          return out;
        });
        const need = L - bar.sum;
        let best = null, second = Infinity;
        const consider = (cost, list) => {
          if (!best || cost < best.cost - 1e-9) { second = best ? best.cost : Infinity; best = { cost, list }; }
          else if (cost < second) second = cost;
        };
        const n = bar.events.length;
        for (let i = 0; i < n; i++) for (const a of alts[i]) {
          const di = a.d - bar.events[i].d;
          if (Math.abs(di - need) < 1e-6) consider(a.cost, [a]);
          for (let j = i + 1; j < n; j++) for (const b of alts[j]) {
            const dj = b.d - bar.events[j].d;
            if (Math.abs(di + dj - need) < 1e-6) consider(a.cost + b.cost + 0.5, [a, b]);
          }
        }
        if (best && best.cost <= 6.5 && second - best.cost >= 0.4) {
          for (const a of best.list) { a.set(); a.ev.fixed = a.what; }
          bar.events = bar.events.filter(e => !e.drop);
          for (const e of bar.events) e.d = e.base * (e.dots === 1 ? 1.5 : e.dots === 2 ? 1.75 : 1);
          bar.sum = bar.events.reduce((a, e) => a + e.d, 0);
          bar.fixed = best.list.map(a => a.what).join(', ');
          fixes.push(bi);
        }
      });
    }

    /* --- 결과 정리 --- */
    const outParts = parts.map(part => ({
      clef: part.clef || 'G',
      bars: part.bars.map(bar => ({
        repStart: bar.repStart, repEnd: bar.repEnd, final: bar.final, ending: bar.ending || 0, sum: bar.sum, fixed: bar.fixed || null, sysBreak: !!bar.sysBreak,
        ok: Math.abs(bar.sum - L) < 1e-6,
        ev: bar.events.map(e => Object.assign(e.type === 'rest' ? { rest: true, d: e.d }
          : e.heads.length > 1 ? { chord: e.heads.map(h => ({ s: h.step, alt: h.alt })).sort((a, b) => a.s - b.s), d: e.d, tie: !!e.tie }
            : { s: e.heads[0].step, alt: e.heads[0].alt, d: e.d, tie: !!e.tie }, e.fixed ? { fixed: e.fixed } : null)),
        _events: bar.events,
      })),
    }));
    return { spacing: A.P.sp0, meter, fifths, parts: outParts, warnings, _A: A };
  }

  /* ================= 8. 글자 악보로 ================= */
  // 계이름은 조표 기준(이동도): 올림표·내림표 수로 정한 장조의 으뜸음이 '도'
  const SYL = ['도', '레', '미', '파', '솔', '라', '시'];
  function durText(d) {
    if (d === 1) return '';
    if (d === 0.5) return '/';
    if (d === 0.25) return '//';
    if (d === 0.125) return '///';
    return String(Math.round(d * 1000) / 1000);
  }
  function pitchText(s, alt, fifths) {
    const kalt = keyAlter(fifths);
    const tonic = mod7(fifths * 4);
    const rel = s - tonic;
    const deg = mod7(rel), oct = Math.floor(rel / 7);
    const acc = (alt || 0) - kalt[mod7(s)];
    return SYL[deg] + (acc > 0 ? '#'.repeat(acc) : acc < 0 ? 'b'.repeat(-acc) : '') + (oct > 0 ? "'".repeat(oct) : ','.repeat(-oct));
  }
  function toText(res, opt) {
    opt = opt || {};
    const lines = [];
    if (opt.title) lines.push('제목 ' + opt.title);
    lines.push('박자 ' + res.meter.join('/'));
    if (res.fifths) lines.push('조표 ' + (res.fifths > 0 ? '#' : 'b') + Math.abs(res.fifths));
    lines.push('빠르기 ' + (opt.tempo || 100));
    res.parts.forEach((part, pi) => {
      if (res.parts.length > 1) lines.push('성부 ' + (pi + 1));
      if (part.clef === 'F') lines.push('음자리표 낮은');
      let cur = [];
      const flush = () => { if (cur.length) lines.push(cur.join(' | ') ); cur = []; };
      part.bars.forEach((bar, bi) => {
        if (bar.sysBreak && bi > 0) { flush(); }
        let t = '';
        if (bar.repStart) t += '|: ';
        if (bar.ending && (bi === 0 || part.bars[bi - 1].ending !== bar.ending)) t += '[' + bar.ending + ' ';
        t += bar.ev.map(e => {
          if (e.rest) return '쉼' + durText(e.d);
          const p = e.chord ? e.chord.map(c => pitchText(c.s, c.alt, res.fifths)).join('+') : pitchText(e.s, e.alt, res.fifths);
          return p + durText(e.d) + (e.tie ? '~' : '');
        }).join(' ');
        if (bar.repEnd) t += ' :|';
        else if (bi === part.bars.length - 1) t += ' ||';
        cur.push(t);
      });
      if (cur.length) {
        // 줄 끝의 마디줄 표기를 맞춘다
        lines.push(cur.join(' | '));
      }
    });
    return lines.join('\n').replace(/:\| \| /g, ':| ').replace(/ \| \|: /g, ' |: ').replace(/\n(?!제목|박자|조표|빠르기|성부|음자리표|\|:|\[)/g, ' |\n').replace(/(박자 [^\n]*|조표 [^\n]*|빠르기 [^\n]*|성부 [^\n]*|음자리표 [^\n]*|제목 [^\n]*) \|\n/g, '$1\n');
  }

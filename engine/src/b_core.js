  /* ================= 6. 기호 찾기 ================= */

  // 4방향 연결 요소(작은 것만 돌려준다): 빈 머리의 구멍 찾기용
  function smallComponents4(mask, W, H, maxW, maxH) {
    const lab = new Int32Array(W * H);
    const out = [];
    const stack = [];
    let id = 0;
    for (let i0 = 0; i0 < mask.length; i0++) {
      if (!mask[i0] || lab[i0]) continue;
      id++;
      const c = { x0: W, y0: H, x1: -1, y1: -1, area: 0, sx: 0, sy: 0 };
      lab[i0] = id; stack.push(i0);
      while (stack.length) {
        const p = stack.pop();
        const px = p % W, py = (p - px) / W;
        c.area++; c.sx += px; c.sy += py;
        if (px < c.x0) c.x0 = px; if (px > c.x1) c.x1 = px;
        if (py < c.y0) c.y0 = py; if (py > c.y1) c.y1 = py;
        if (px > 0 && mask[p - 1] && !lab[p - 1]) { lab[p - 1] = id; stack.push(p - 1); }
        if (px < W - 1 && mask[p + 1] && !lab[p + 1]) { lab[p + 1] = id; stack.push(p + 1); }
        if (py > 0 && mask[p - W] && !lab[p - W]) { lab[p - W] = id; stack.push(p - W); }
        if (py < H - 1 && mask[p + W] && !lab[p + W]) { lab[p + W] = id; stack.push(p + W); }
      }
      c.w = c.x1 - c.x0 + 1; c.h = c.y1 - c.y0 + 1; c.cx = c.sx / c.area; c.cy = c.sy / c.area;
      if (c.w <= maxW && c.h <= maxH) out.push(c);
    }
    return out;
  }

  function analyze(img) {
    const P = prepare(img);
    if (P.error) return P;
    const { g0, bin, sym, W, H, staves } = P;
    if (!staves.length) return { error: '오선을 찾지 못했습니다.' };

    // 어두움 척도: 가장 짙은 잉크(하위 1%)를 1, 바탕(중앙값 근처)을 0으로
    const lvl0 = (() => {
      const h = new Uint32Array(256);
      let n = 0;
      for (let i = 0; i < g0.length; i += 2) { h[g0[i]]++; n++; }
      let acc = 0, black = 0, white = 255;
      for (let v = 0; v < 256; v++) { acc += h[v]; if (acc >= n * 0.01) { black = v; break; } }
      acc = 0;
      for (let v = 0; v < 256; v++) { acc += h[v]; if (acc >= n * 0.6) { white = v; break; } }
      return { black, white };
    })();
    const span0 = Math.max(1, lvl0.white - lvl0.black);
    const darkAt = (x, y) => { const v = (lvl0.white - g0[y * W + x]) / span0; return v < 0 ? 0 : v > 1 ? 1 : v; };

    /* --- 오선별 구역, 덧줄 지우기 --- */
    staves.forEach((st, si) => {
      st.i = si;
      const prev = staves[si - 1], next = staves[si + 1];
      st.zTop = Math.max(0, Math.round(prev ? Math.max(st.top - 6 * SP, (prev.bottom + st.top) / 2) : st.top - 6 * SP));
      st.zBot = Math.min(H - 1, Math.round(next ? Math.min(st.bottom + 6 * SP, (st.bottom + next.top) / 2) : st.bottom + 6 * SP));
      st.thinMax = Math.max(5, Math.round(1.6 * st.t + 1));
      st.mid = (st.top + st.bottom) / 2;
      st.stepAt = y => (st.bottom - y) / (st.sp / 2);
      st.yOf = step => st.bottom - step * st.sp / 2;
      const tol = st.t + 1;
      const thinAt = (x, yc) => {
        let y = -1;
        for (let d = 0; d <= 2 && y < 0; d++) { if (sym[(yc + d) * W + x]) y = yc + d; else if (sym[(yc - d) * W + x]) y = yc - d; }
        if (y < 0) return null;
        let a = y, b = y;
        while (a > 0 && sym[(a - 1) * W + x]) a--;
        while (b < H - 1 && sym[(b + 1) * W + x]) b++;
        return b - a + 1 > tol ? null : [a, b];
      };
      for (let k = 1; k <= 5; k++) {
        for (const ly of [st.top - k * st.sp, st.bottom + k * st.sp]) {
          const yc = Math.round(ly);
          if (yc < st.zTop + 3 || yc > st.zBot - 3) continue;
          let x = Math.max(0, st.xL);
          const xEnd = Math.min(W - 1, st.xR);
          while (x <= xEnd) {
            const s0 = thinAt(x, yc);
            if (!s0) { x++; continue; }
            const segs = [s0];
            let e = x;
            while (e + 1 <= xEnd) { const s1 = thinAt(e + 1, yc); if (!s1) break; segs.push(s1); e++; }
            if (e - x + 1 >= 0.5 * SP) {
              // 덧줄은 머리(굵은 잉크)를 꿰고 있다. 그런 것이 없으면 붙임줄의 평평한 부분이므로 남긴다.
              let ca = Math.round(x + 0.3 * SP), cb = Math.round(e - 0.3 * SP);
              if (cb < ca) ca = cb = (x + e) >> 1;
              let head = false;
              const wy0 = Math.max(0, Math.round(yc - 1.7 * SP)), wy1 = Math.min(H - 1, Math.round(yc + 1.7 * SP));
              for (let c = ca; c <= cb && !head; c++) {
                let run = 0;
                for (let yy = wy0; yy <= wy1; yy++) {
                  if (bin[yy * W + c]) { run++; if (run >= 0.6 * SP) { head = true; break; } } else run = 0;
                }
              }
              if (head) for (let i = 0; i < segs.length; i++) for (let yy = segs[i][0]; yy <= segs[i][1]; yy++) sym[yy * W + x + i] = 0;
            }
            x = e + 1;
          }
        }
      }
    });
    const staffOf = y => {
      let best = null, bd = 1e9;
      for (const st of staves) { if (y < st.zTop || y > st.zBot) continue; const d = Math.abs(y - st.mid); if (d < bd) { bd = d; best = st; } }
      return best;
    };

    const vlines = findVLines(bin, sym, W, H);
    const hr = halfRuns(bin, W, H);
    // 머리 크기: 오선 가까이의 둥글고 속이 찬 덩어리들의 높이(칸 단위)의 중앙값.
    // 머리를 오선 한 칸보다 크게 그리는 악보체에서는 이 값이 1을 뚜렷이 넘는다.
    const headH = (() => {
      const r = Math.round(0.31 * SP);
      const cc = components(erodeDisk(bin, hr, W, H, r), W, H, 0, 0, W - 1, H - 1).comps.slice(1);
      const hs = [];
      for (const c of cc) {
        const st = staffOf(c.cy);
        if (!st || c.cy < st.top - 4 * SP || c.cy > st.bottom + 4 * SP || c.cx < st.xL + 3 * SP) continue;
        if (c.area < 12 || c.area < 0.6 * c.w * c.h || c.w < 0.9 * c.h || c.w > 2.2 * c.h) continue;
        const h = (c.h + 2 * r) / SP;
        if (h >= 0.8 && h <= 2.1) hs.push(h);
      }
      hs.sort((a, b) => a - b);
      return hs.length >= 4 ? hs[hs.length >> 1] : 1;
    })();
    // 머리 치수의 단위: 보통 악보체는 오선 한 칸, 큰 머리 악보체는 그 배율만큼 큰 값
    const HK = headH >= 1.25 ? Math.min(1.9, headH / 1.1) : 1, HP = SP * HK;
    const er = erodeDisk(bin, hr, W, H, Math.round(0.31 * HP));
    const blobCC = components(er, W, H, 0, 0, W - 1, H - 1);
    const symCC = components(sym, W, H, 0, 0, W - 1, H - 1);
    const lab = symCC.lab, comps = symCC.comps;

    function headFill(cx, cy) {
      let n = 0, s = 0;
      const rx = 0.42 * HP, ry = 0.27 * HP;
      for (let dy = -Math.ceil(ry); dy <= Math.ceil(ry); dy++) {
        const y = Math.round(cy + dy);
        if (y < 0 || y >= H) continue;
        for (let dx = -Math.ceil(rx); dx <= Math.ceil(rx); dx++) {
          if ((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) > 1) continue;
          const x = Math.round(cx + dx);
          if (x < 0 || x >= W) continue;
          n++; s += darkAt(x, y);
        }
      }
      return n ? s / n : 0;
    }

    /* --- 채워진 덩어리 --- */
    const blobs = [];
    const tall = [];
    blobCC.comps.forEach((c, id) => {
      if (!id || c.w > 1.3 * HP) return;
      if (c.h > 0.9 * HP) { if (c.h <= 0.9 * HP + 3.2 * SP && c.w >= 0.3 * HP) tall.push({ c, id }); return; }
      const st = staffOf(c.cy);
      if (!st) return;
      blobs.push({ x: c.cx, y: c.cy, w: c.w, h: c.h, area: c.area, st, used: false });
    });
    // 3도로 쌓인 머리들이 서로 붙어 한 덩어리가 된 것(작은 그림에서 흔함)은 한 칸 간격의 머리들로 나눈다
    if (tall.length) {
      const hs = blobs.filter(b => b.area >= 20).map(b => b.h).sort((a, b) => a - b);
      const h1 = hs.length >= 4 ? hs[hs.length >> 1] : 0.42 * HP;
      for (const { c, id } of tall) {
        const st = staffOf(c.cy);
        if (!st) continue;
        const n = Math.round((c.h - h1) / SP) + 1;
        if (n < 2 || Math.abs(c.h - h1 - (n - 1) * SP) > 0.35 * SP) continue;
        const step = (c.h - h1) / (n - 1);
        const parts = [];
        for (let i = 0; i < n; i++) {
          const yc = c.y0 + h1 / 2 + i * step;
          let m = 0, sx = 0, x0 = W, x1 = -1;
          for (let y = Math.max(c.y0, Math.round(yc - h1 / 2)); y <= Math.min(c.y1, Math.round(yc + h1 / 2)); y++) {
            for (let x = c.x0; x <= c.x1; x++) if (blobCC.lab[y * W + x] === id) { m++; sx += x; if (x < x0) x0 = x; if (x > x1) x1 = x; }
          }
          if (m < 12) { parts.length = 0; break; }
          parts.push({ x: sx / m, y: yc, w: x1 - x0 + 1, h: Math.round(h1), area: m, st, used: false, stacked: true });
        }
        for (const b of parts) blobs.push(b);
      }
    }

    /* --- 빈 머리의 구멍: 흰 화소의 작은 닫힌 영역 --- */
    function findHoles(mask, isBin) {
      const inv = new Uint8Array(W * H);
      for (const st of staves) {
        for (let y = st.zTop; y <= st.zBot; y++) { const o = y * W; for (let x = Math.max(0, st.xL - SP); x <= Math.min(W - 1, st.xR + SP); x++) inv[o + x] = mask[o + x] ? 0 : 1; }
      }
      const out = [];
      for (const c of smallComponents4(inv, W, H, 2 * HP, HP)) {
        if (c.w < 0.3 * SP || c.w > 1.35 * HP || c.h < 0.12 * SP || c.h > 0.9 * HP) continue;
        if (c.area < 0.035 * SP * SP) continue;
        if (c.w < c.h * 0.7) continue;
        // 세로선 둘과 오선 사이의 네모난 틈은 머리의 구멍이 아니다
        if (c.h >= 0.6 * SP && c.area / (c.w * c.h) >= 0.9) continue;
        // 양옆이 모두 곧은 세로선(기둥·마디줄)인 틈은 머리의 구멍이 아니다.
        // 머리의 구멍은 많아야 한쪽만 기둥에 닿는다.
        {
          const ym = Math.round((c.y0 + c.y1) / 2);
          const lineWall = (from, step) => {
            for (let k = 1; k <= 5; k++) {
              const x = from + step * k;
              if (x < 0 || x >= W || !bin[ym * W + x]) continue;
              let a = ym, b2 = ym;
              while (a > 0 && bin[(a - 1) * W + x]) a--;
              while (b2 < H - 1 && bin[(b2 + 1) * W + x]) b2++;
              if (c.y0 - a >= 0.8 * SP || b2 - c.y1 >= 0.8 * SP) return true;
            }
            return false;
          };
          if (lineWall(c.x0, -1) && lineWall(c.x1, 1)) continue;
        }
        const st = staffOf(c.cy);
        if (!st) continue;
        if (c.y0 <= st.zTop || c.y1 >= st.zBot) continue;
        // 오선과 다른 기호 사이의 틈인지: 머리의 구멍은 양 끝 귀퉁이에서 위·아래 경계가 고리라서 두껍다.
        // 틈은 위·아래가 맨 오선이라 얇다.
        if (isBin && c.h >= 0.45 * SP) {
          let thick = 0;
          for (const x of [c.x0 + 1, c.x1 - 1]) {
            let ya = -1, yb = -1;
            for (let y = c.y0; y <= c.y1; y++) if (!mask[y * W + x]) { if (ya < 0) ya = y; yb = y; }
            if (ya < 0) { thick += 2; continue; }
            let up = 0, dn = 0;
            for (let y = ya - 1; y >= 0 && mask[y * W + x] && up < SP; y--) up++;
            for (let y = yb + 1; y < H && mask[y * W + x] && dn < SP; y++) dn++;
            if (up >= st.t + 2) thick++;
            if (dn >= st.t + 2) thick++;
          }
          if (thick < 2) continue;
        }
        out.push({ x: (c.x0 + c.x1) / 2, y: (c.y0 + c.y1) / 2, w: c.w, h: c.h, area: c.area, st });
      }
      return out;
    }
    const holes = [];
    for (const h of findHoles(sym, false).concat(HOLES_BIN ? findHoles(bin, true) : [])) {
      // 같은 머리의 구멍(줄에 갈린 위·아래 반쪽 포함)은 하나로 합친다
      const dup = holes.find(o => o.st === h.st && ((Math.abs(o.x - h.x) <= 0.6 * HP && Math.abs(o.y - h.y) <= 0.42 * HP) ||
        (Math.abs(o.x - h.x) <= 0.58 * HP && Math.abs(o.y - h.y) <= 0.66 * HP && o.h <= 0.5 * HP && h.h <= 0.5 * HP)));
      if (dup) {
        const x0 = Math.min(dup.x - dup.w / 2, h.x - h.w / 2), x1 = Math.max(dup.x + dup.w / 2, h.x + h.w / 2);
        const y0 = Math.min(dup.y - dup.h / 2, h.y - h.h / 2), y1 = Math.max(dup.y + dup.h / 2, h.y + h.h / 2);
        dup.x = (x0 + x1) / 2; dup.y = (y0 + y1) / 2; dup.w = x1 - x0; dup.h = y1 - y0; dup.area += h.area;
        continue;
      }
      if (blobs.some(b => b.area >= 20 && Math.abs(b.x - h.x) <= 0.45 * HP && Math.abs(b.y - h.y) <= 0.35 * HP)) continue;
      holes.push(h);
    }
    // 납작한 틈 하나뿐인 것(붙임줄과 오선 사이 등)은 버린다
    for (let i = holes.length - 1; i >= 0; i--) if (holes[i].h < 0.3 * SP) holes.splice(i, 1);

    /* --- 세로선 분류 --- */
    for (const v of vlines) v.st = staffOf((v.y0 + v.y1) / 2);
    // 오선마다 가는 세로선의 보통 두께를 재서, 그보다 뚜렷이 굵은 것만 굵은 선으로 본다
    for (const st of staves) {
      const ths = vlines.filter(v => v.st === st && v.len >= 2 * SP && v.thin25 <= st.thinMax).map(v => v.thin25).sort((a, b) => a - b);
      st.stemT = ths.length ? ths[ths.length >> 1] : st.t + 1;
      st.thinMax = Math.min(st.thinMax, Math.max(st.stemT + 2, Math.floor(st.stemT * 1.5)));
    }
    for (const v of vlines) {
      if (!v.st) { v.kind = 'none'; continue; }
      const st = v.st;
      v.thinLine = v.thin25 <= st.thinMax && v.cols <= st.thinMax + 2;
      v.thickLine = !v.thinLine && v.cols <= 1.1 * SP && v.thin25 <= 1.2 * SP;
      const spansTop = v.y0 <= st.top + 0.35 * SP, spansBot = v.y1 >= st.bottom - 0.35 * SP;
      const exactTop = v.y0 >= st.top - 0.45 * SP, exactBot = v.y1 <= st.bottom + 0.45 * SP;
      v.long = v.len > 7.5 * SP;
      v.barlike = spansTop && spansBot && ((exactTop && exactBot) || v.long);
      v.kind = v.thinLine ? 'thin' : v.thickLine ? 'thick' : 'none';
    }

    /* --- 기둥 끝의 머리: 잉크 띠로 찾기(흐려서 구멍이 안 보이는 빈 머리용) --- */
    function bandHead(v, end) {
      const left = end === 'bottom';
      const xa = Math.max(0, left ? Math.round(v.xa - 1.6 * HP) : v.xb + 2);
      const xb = Math.min(W - 1, left ? v.xa - 2 : Math.round(v.xb + 1.6 * HP));
      const yr = left ? v.y1 : v.y0;
      const ya = Math.max(0, Math.round(yr - 1.15 * HP)), yb = Math.min(H - 1, Math.round(yr + 1.15 * HP));
      const n = new Int32Array(yb - ya + 1);
      for (let y = ya; y <= yb; y++) { let c = 0; const o = y * W; for (let x = xa; x <= xb; x++) c += sym[o + x]; n[y - ya] = c; }
      let seed = -1, best = 0;
      for (let y = Math.round(yr - 0.7 * HP); y <= Math.round(yr + 0.7 * HP); y++) {
        if (y < ya || y > yb) continue;
        if (n[y - ya] > best) { best = n[y - ya]; seed = y; }
      }
      if (seed < 0 || best < 0.45 * SP) return null;
      let b0 = seed, b1 = seed;
      while (b0 - 1 >= ya && n[b0 - 1 - ya] >= 2) b0--;
      while (b1 + 1 <= yb && n[b1 + 1 - ya] >= 2) b1++;
      const hb = b1 - b0 + 1;
      if (hb < 0.6 * HP || hb > 1.45 * HP) return null;
      const q = inkIn(sym, W, H, xa, b0, xb, b1);
      const width = q.x1 - q.x0 + 1;
      if (width < 0.7 * HP || q.n < 0.14 * SP * SP) return null;
      if (left ? q.x1 < v.xa - 5 : q.x0 > v.xb + 5) return null;
      const xc = left ? Math.max(q.x0, v.xa - 1.45 * HP) : Math.min(q.x1, v.xb + 1.45 * HP);
      return { x: left ? (xc + v.xa) / 2 : (v.xb + xc) / 2, y: (b0 + b1) / 2, w: width, h: hb, n: q.n };
    }

    /* --- 기둥과 머리 잇기 --- */
    const SIDE_MIN = 0.3 * HP, SIDE_MAX = 0.92 * HP, END_TOL = 0.62 * HP;
    const stems = [];
    function linkHeads(v, pool, minArea) {
      const cand = [];
      for (const b of pool) {
        if (b.st !== v.st || (minArea && b.area < minArea)) continue;
        const dx = v.x - b.x;
        if (Math.abs(dx) < SIDE_MIN || Math.abs(dx) > SIDE_MAX) continue;
        if (b.y < v.y0 - 0.6 * HP || b.y > v.y1 + 0.6 * HP) continue;
        cand.push({ b, dx });
      }
      const free = (b, dx) => { const o = dx > 0 ? b.ownerUp : b.ownerDn; return !o || o === v; };
      const up = cand.filter(c => c.dx > 0 && Math.abs(c.b.y - v.y1) <= END_TOL && free(c.b, c.dx));
      const down = cand.filter(c => c.dx < 0 && Math.abs(c.b.y - v.y0) <= END_TOL && free(c.b, c.dx));
      let dir = 0;
      if (up.length && !down.length) dir = 1;
      else if (down.length && !up.length) dir = -1;
      else if (up.length && down.length) {
        const du = Math.min(...up.map(c => Math.abs(c.b.y - v.y1))), dd = Math.min(...down.map(c => Math.abs(c.b.y - v.y0)));
        dir = du <= dd ? 1 : -1;
      }
      if (!dir) return null;
      const prim = (dir > 0 ? up : down).map(c => c.b);
      const heads = prim.slice();
      for (const c of cand) {
        if (prim.includes(c.b) || (c.b.ownerUp && c.b.ownerUp !== v) || (c.b.ownerDn && c.b.ownerDn !== v)) continue;
        if (!minArea && (c.b.h < 0.36 * HP || c.b.w < 0.45 * HP)) continue;
        if (!heads.every(h => Math.abs(h.y - c.b.y) >= 0.4 * SP)) continue;
        const sameSide = (dir > 0) === (c.dx > 0);
        const near = heads.some(h => Math.abs(h.y - c.b.y) >= 0.3 * SP && Math.abs(h.y - c.b.y) <= 0.75 * SP);
        if (sameSide || near) heads.push(c.b);
      }
      return { dir, heads };
    }
    // 머리 하나를 여러 세로선이 다투면 가장 기둥다운 선에 준다
    function settleOwners(pool, minArea) {
      const claims = new Map();
      for (const v of vlines) {
        if (v.kind !== 'thin' || v.isStem || v.inAcc || v.flagPart) continue;
        const r = linkHeads(v, pool, minArea);
        if (!r) continue;
        const endY = r.dir > 0 ? v.y1 : v.y0;
        for (const b of r.heads) {
          const dx = Math.abs(v.x - b.x);
          const score = -Math.abs(b.y - endY) / SP - 0.5 * Math.abs(dx - 0.6 * HP) / SP + 0.3 * Math.min(v.len, 3.5 * SP) / SP;
          const cur = claims.get(b) || [];
          cur.push({ v, score, dir: r.dir });
          claims.set(b, cur);
        }
      }
      // 가장 기둥다운 선이 주인. 반대 방향의 긴 기둥이 하나 더 있으면(두 성부가 같은 음) 그것도 인정한다.
      for (const [b, list] of claims) {
        list.sort((a, c) => c.score - a.score);
        const first = list[0];
        if (first.dir > 0) b.ownerUp = first.v; else b.ownerDn = first.v;
        const other = list.find(c => c.dir !== first.dir && c.v.len >= 2.6 * SP && c.score >= first.score - 0.5);
        if (other && minArea && b.area >= 20) { if (other.dir > 0) b.ownerUp = other.v; else b.ownerDn = other.v; }
        else { if (first.dir > 0) b.ownerDn = first.v; else b.ownerUp = first.v; }
      }
    }
    // 1) 채워진 머리
    settleOwners(blobs, 12);
    for (const v of vlines) {
      if (v.kind !== 'thin') continue;
      const r = linkHeads(v, blobs, 12);
      if (!r) continue;
      v.isStem = true;
      stems.push({ v, st: v.st, dir: r.dir, heads: r.heads.map(b => ({ x: b.x, y: b.y, blob: b })), x: v.x });
    }

    // 꼬리(깃발)에서 생긴 세로선과 닫힌 틈은 음표가 아니다
    for (const s of stems) {
      for (const h of s.heads) h.y = h.blob.y;
      countFlags(s);
      if (!s.flagR.length || s.flagL.length) continue;
      const tip = s.dir > 0 ? s.v.y0 : s.v.y1;
      const za = Math.min(tip, tip + s.dir * 3.3 * SP) - 0.3 * SP, zb = Math.max(tip, tip + s.dir * 3.3 * SP) + 0.3 * SP;
      for (const v of vlines) {
        if (v === s.v || v.isStem || v.st !== s.st) continue;
        if (!(v.x > s.v.xb && v.x <= s.v.xb + 1.3 * SP && v.y1 >= za && v.y0 <= zb)) continue;
        // 꼬리는 기둥과 한 덩어리다
        const idOf = (vv) => { const xc = Math.round(vv.x); for (let y = vv.y0 + 2; y <= vv.y1 - 2; y += 2) { const id = lab[y * W + xc]; if (id) return id; } return 0; };
        const a = idOf(s.v), b2 = idOf(v);
        if (a && a === b2) v.flagPart = true;
      }
      for (const h of holes) {
        if (h.st === s.st && h.x > s.v.x && h.x <= s.v.x + 1.0 * SP && h.y >= za && h.y <= zb) h.used = true;
      }
    }

    /* --- 임시표: 기둥이 아닌 짧은 세로선의 짝과 모서리 잉크로 판정 --- */
    const accidentals = [];
    {
      const free = vlines.filter(v => v.kind === 'thin' && !v.isStem && !v.flagPart && !v.barlike && v.len >= 1.5 * SP && v.len <= 3.5 * SP).sort((a, b) => a.x - b.x);
      for (let i = 0; i < free.length; i++) {
        const a = free[i];
        if (a.inAcc) continue;
        let mate = null;
        for (let j = i + 1; j < free.length && free[j].x - a.x <= 0.8 * SP; j++) {
          const b = free[j];
          if (b.inAcc || b.st !== a.st || b.x - a.x < 0.25 * SP) continue;
          const ov = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
          if (ov >= 0.45 * Math.min(a.len, b.len)) { mate = b; break; }
        }
        if (mate) {
          const dTop = mate.y0 - a.y0, dBot = mate.y1 - a.y1;
          let type = null;
          if (dTop >= 0.4 * SP && dBot >= 0.4 * SP && a.len <= 2.7 * SP && mate.len <= 2.7 * SP) type = 'natural';
          else if (a.len >= 2.1 * SP && mate.len >= 2.1 * SP && Math.abs(dTop) <= 0.6 * SP) type = 'sharp';
          if (type) {
            const mid = inkIn(sym, W, H, a.xb + 1, Math.max(a.y0, mate.y0), mate.xa - 1, Math.min(a.y1, mate.y1));
            const gap = Math.max(1, mate.xa - a.xb - 1);
            if (mid.n >= 0.25 * SP * gap) {
              a.inAcc = mate.inAcc = true;
              const y = type === 'sharp' ? (a.y0 + a.y1 + mate.y0 + mate.y1) / 4 : (a.y0 + mate.y1) / 2;
              accidentals.push({ type, st: a.st, x: (a.x + mate.x) / 2, x0: a.xa - 0.3 * SP, x1: mate.xb + 0.3 * SP, y0: Math.min(a.y0, mate.y0), y1: Math.max(a.y1, mate.y1), y, pos: a.st.stepAt(y) });
              continue;
            }
          }
        }
        if (a.len >= 1.7 * SP && a.len <= 3.3 * SP) {
          const BR = inkIn(sym, W, H, a.xb + 1, a.y1 - 1.3 * SP, a.xb + 0.95 * SP, a.y1 + 0.2 * SP);
          const TR = inkIn(sym, W, H, a.xb + 1, a.y0 - 0.3 * SP, a.xb + 0.65 * SP, a.y1 - 1.45 * SP);
          const BL = inkIn(sym, W, H, a.xa - 0.6 * SP, a.y1 - 1.2 * SP, a.xa - 1, a.y1 - 0.05 * SP);
          const TL = inkIn(sym, W, H, a.xa - 0.65 * SP, a.y0 - 0.3 * SP, a.xa - 1, a.y1 - 1.45 * SP);
          a.corner = { BR: BR.n, TR: TR.n, BL: BL.n, TL: TL.n };
          if (BR.n >= 0.1 * SP * SP && BR.n <= 0.75 * SP * SP && TR.n <= 0.35 * BR.n && BL.n <= 0.5 * BR.n && BL.n <= 0.12 * SP * SP &&
              (BR.x1 - BR.x0 + 1) >= 0.35 * SP && (BR.y1 - BR.y0 + 1) >= 0.5 * SP) {
            a.inAcc = true;
            const y = a.y1 - 0.78 * SP;
            accidentals.push({ type: 'flat', st: a.st, x: a.x + 0.4 * SP, x0: a.xa - 1, x1: a.xb + 1.0 * SP, y0: a.y0, y1: a.y1 + 0.2 * SP, y, pos: a.st.stepAt(y) });
          }
        }
      }
    }

    // 2) 빈 머리(구멍으로) 3) 흐린 빈 머리(잉크 띠로)
    for (const h of holes) if (accidentals.some(a => h.x >= a.x0 - 2 && h.x <= a.x1 + 2 && h.y >= a.y0 && h.y <= a.y1)) h.used = true;
    settleOwners(holes.filter(h => !h.used), 0);
    for (const v of vlines) {
      if (v.kind !== 'thin' || v.isStem || v.inAcc || v.flagPart || v.len < 2.0 * SP) continue;
      let r = linkHeads(v, holes.filter(h => !h.used), 0);
      // 빈 머리에는 구멍을 두른 고리가 있다. 마디줄·붙임줄·오선이 우연히 가둔 틈에는 그만한 잉크가 없다.
      if (r && v.barlike) {
        const ring = h => {
          let n = 0;
          for (let y = Math.max(0, Math.round(h.y - 0.6 * HP)); y <= Math.min(H - 1, Math.round(h.y + 0.6 * HP)); y++) {
            for (let x = Math.max(0, Math.round(h.x - 0.75 * HP)); x <= Math.min(W - 1, Math.round(h.x + 0.75 * HP)); x++) {
              if (x >= v.xa - 1 && x <= v.xb + 1) continue;
              n += sym[y * W + x];
            }
          }
          return n;
        };
        // 고리는 얇다: 기둥 반대쪽 끝에서 바깥으로 이어지는 잉크가 짧다(옆 음표의 찬 머리가 틈을 막은 것이 아니다)
        const farRun = h => {
          const sgn = h.x < v.x ? -1 : 1;
          let best = 1e9;
          for (let dy = -2; dy <= 2; dy++) {
            const y = Math.round(h.y) + dy;
            let x = Math.round(h.x + sgn * (h.w / 2 + 1)), n = 0;
            while (x > 0 && x < W - 1 && !bin[y * W + x] && n > -3) { x += sgn; n--; }
            n = 0;
            while (x > 0 && x < W - 1 && bin[y * W + x]) { x += sgn; n++; }
            best = Math.min(best, n);
          }
          return best;
        };
        if (!r.heads.some(h => ring(h) >= 0.3 * HP * HP && farRun(h) <= 0.45 * HP)) r = null;
      }
      if (r) {
        v.isStem = true;
        stems.push({ v, st: v.st, dir: r.dir, heads: r.heads.map(h => ({ x: h.x, y: h.y, hole: h })), x: v.x });
        for (const h of r.heads) h.used = true;
        continue;
      }
      if (v.barlike || v.len < 2.4 * SP) continue;
      const hb = bandHead(v, 'bottom'), ht = bandHead(v, 'top');
      let pick = null;
      if (hb && ht) pick = hb.n >= ht.n ? [1, hb] : [-1, ht];
      else if (hb) pick = [1, hb];
      else if (ht) pick = [-1, ht];
      if (!pick) continue;
      v.isStem = true;
      stems.push({ v, st: v.st, dir: pick[0], heads: [{ x: pick[1].x, y: pick[1].y, band: pick[1] }], x: v.x });
    }
    // 머리 윤곽 가운데에서 잰 밝은 화소 비율(빈 머리는 속이 밝다)
    function lightFrac(cx, cy) {
      let n = 0, light = 0;
      const rx = 0.5 * HP, ry = 0.33 * HP;
      for (let dy = -Math.ceil(ry); dy <= Math.ceil(ry); dy++) {
        const y = Math.round(cy + dy);
        if (y < 0 || y >= H) continue;
        for (let dx = -Math.ceil(rx); dx <= Math.ceil(rx); dx++) {
          if ((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) > 1) continue;
          const x = Math.round(cx + dx);
          if (x < 0 || x >= W) continue;
          n++; if (darkAt(x, y) < 0.6) light++;
        }
      }
      return n ? light / n : 0;
    }
    for (const s of stems) {
      for (const h of s.heads) {
        if (s.heads.length === 1) {
          const env = bandHead(s.v, s.dir > 0 ? 'bottom' : 'top');
          if (env) { h.env = env; h.light = lightFrac(env.x, env.y); h.envFill = headFill(env.x, env.y); }
        }
        if (h.blob) h.blob.used = true;
        h.fill = headFill(h.x, h.y);
        // 찬 머리: 큰 덩어리이면서 속이 짙거나, 윤곽 가운데가 짙다. 빈 머리: 구멍이 있거나 속이 밝다.
        const solidBlob = h.blob && h.blob.area >= 20 && h.fill >= 0.9;
        h.filled = solidBlob || (!h.hole && (h.env ? h.envFill >= 0.9 : h.fill >= 0.9));
        // 구멍이 반쪽만 보이거나 없는 빈 머리는 윤곽의 가운데를 머리 자리로 삼는다
        if (!h.filled && h.env && (!h.hole || h.hole.h < 0.45 * HP)) { h.x = h.env.x; h.y = h.env.y; }
        h.pos = s.st.stepAt(h.y);
      }
      s.heads.sort((a, b) => b.y - a.y);
      // 같은 쪽에서 너무 가까운 머리는 한 머리다
      for (let i = s.heads.length - 1; i > 0; i--) {
        const a = s.heads[i - 1], b = s.heads[i];
        if (Math.abs(a.y - b.y) < 0.42 * SP && Math.abs(a.x - b.x) < 0.7 * HP) {
          a.x = (a.x + b.x) / 2; a.y = (a.y + b.y) / 2; a.pos = s.st.stepAt(a.y); a.filled = a.filled || b.filled;
          s.heads.splice(i, 1);
        }
      }
    }

    /* --- 꼬리·빔 수 --- */
    function countFlags(s) {
      const v = s.v, st = s.st;
      const tip = s.dir > 0 ? v.y0 : v.y1, inward = s.dir > 0 ? 1 : -1;
      const hy = s.dir > 0 ? Math.min(...s.heads.map(h => h.y)) : Math.max(...s.heads.map(h => h.y));
      const maxLen = Math.round(Math.min(2.4 * SP, Math.abs(hy - tip) - 1.5 * SP));
      const minRun = Math.max(Math.round(0.25 * SP), st.t + 2);
      const scan = x => {
        const runs = [];
        if (x < 0 || x >= W) return runs;
        // 꼬리와 빔은 기둥에 바로 붙어 있다. 기둥과 틈을 두고 옆에 선 잉크(코드 이름의 글자 등)는 세지 않는다.
        const xa = x > v.x ? v.xb + 1 : x + 1, xb = x > v.x ? x - 1 : v.xa - 1;
        const joined = (k0, k1) => {
          for (let k = k0; k <= k1; k++) {
            const y = tip + inward * k;
            let ok = true;
            for (let xx = xa; xx <= xb && ok; xx++) if (!sym[y * W + xx]) ok = false;
            if (ok) return true;
          }
          return false;
        };
        let run = 0;
        for (let k = -3; k <= maxLen + 1; k++) {
          const y = tip + inward * k;
          const b = k <= maxLen && y >= 0 && y < H && sym[y * W + x];
          if (b) run++; else { if (run >= minRun && joined(k - run, k - 1)) runs.push(run); run = 0; }
        }
        return runs;
      };
      const pick = (a, b) => (a.length >= b.length ? a : b);
      // 기둥 바로 옆은 오선 자국이 남으므로 조금 떨어진 열에서 잰다
      const off = Math.max(3, Math.round(0.28 * SP));
      const rr = pick(scan(v.xb + off), scan(v.xb + off + 1)), ll = pick(scan(v.xa - off), scan(v.xa - off - 1));
      let n = Math.max(rr.length, ll.length);
      if (ll.length === 0 && rr.length === 1 && rr[0] >= 1.5 * SP) n = 2;
      s.flags = n; s.flagL = ll; s.flagR = rr; s.beamed = ll.length > 0;
    }
    for (const s of stems) if (s.flags == null) countFlags(s);

    /* --- 음표·임시표에 속한 연결 요소 표시 --- */
    const noteComp = new Set();
    for (const s of stems) {
      const xc = Math.round(s.v.x);
      for (let y = s.v.y0 + 2; y <= s.v.y1 - 2; y += 3) { const id = lab[y * W + xc]; if (id) noteComp.add(id); }
    }
    const noteCompStrong = new Set();
    for (const s of stems) {
      if (!s.heads.some(h => h.blob)) continue;
      const xc = Math.round(s.v.x);
      for (let y = s.v.y0 + 2; y <= s.v.y1 - 2; y += 3) { const id = lab[y * W + xc]; if (id) noteCompStrong.add(id); }
    }
    const inAccBox = c => accidentals.some(a => c.cx >= a.x0 - 2 && c.cx <= a.x1 + 2 && c.cy >= a.y0 - 2 && c.cy <= a.y1 + 2);

    /* --- 연결 요소 모양 재기 --- */
    function shape(c) {
      if (c.shape) return c.shape;
      const rowInk = new Int32Array(c.h);
      let maxCol = 0;
      for (let x = c.x0; x <= c.x1; x++) {
        let run = 0, best = 0;
        for (let y = c.y0; y <= c.y1 + 1; y++) {
          if (y <= c.y1 && lab[y * W + x] === c.id) { run++; rowInk[y - c.y0]++; }
          else { if (run > best) best = run; run = 0; }
        }
        if (best > maxCol) maxCol = best;
      }
      let botInk = 0;
      for (let r = 0; r < c.h; r++) if (r >= c.h * 0.5) botInk += rowInk[r];
      c.shape = { fill: c.area / (c.w * c.h), botRatio: botInk / Math.max(1, c.area), maxCol: maxCol / c.h };
      return c.shape;
    }

    // 오선에 닿은 기호는 오선 토막이 위·아래 끝에 붙어 남는다. 굵은 오선(작은 이미지를 키운 것)에서는 그만큼 빼고 잰다.
    function trimLines(c, st, always) {
      let y0 = c.y0, y1 = c.y1;
      if (st.t >= 3 || always) {
        const B = st.t / 2 + 1;
        for (const ly of st.lines) {
          if (y1 - y0 < 0.3 * SP) break;
          if (y1 >= ly - B && y1 <= ly + B && y0 < ly - B) y1 = Math.round(ly - B) - 1;
          if (y0 >= ly - B && y0 <= ly + B && y1 > ly + B) y0 = Math.round(ly + B) + 1;
        }
      }
      return { y0, y1, h: y1 - y0 + 1, cy: (y0 + y1) / 2 };
    }
    function classify(c, st) {
      const tr = trimLines(c, st), td = trimLines(c, st, c.w <= 0.75 * SP && c.h <= 1.0 * SP);
      const w = c.w / SP;
      let h = c.h / SP;
      const sh = shape(c);
      const relY = (c.cy - st.mid) / SP;
      if (w <= 0.75 && td.h <= 0.75 * SP && c.h > 0.75 * SP && w >= 0.14 && td.h >= 0.25 * SP && c.area >= 5 && sh.fill >= 0.4 && w / (td.h / SP) < 2.2 && td.h / SP / w < 2.2) return 'dot';
      if (w <= 0.75 && tr.h <= 0.75 * SP && w >= 0.14 && tr.h >= 0.14 * SP && c.area >= 5 && sh.fill >= 0.4 && w / (tr.h / SP) < 2.2 && tr.h / SP / w < 2.2) {
        // 오선 밖에서 덧줄 두께밖에 안 되는 납작한 토막은 덧줄 끝이다
        const outside = c.cy < st.top - 0.5 * SP || c.cy > st.bottom + 0.5 * SP;
        const off = Math.abs(c.cy - st.top) / SP, onLine = Math.abs(off - Math.round(off)) <= 0.2;
        if (outside && onLine && c.h <= st.t + 2 && c.w >= 1.5 * c.h) return 'other';
        return 'dot';
      }
      if (h >= 0.28 && h <= 0.82 && w >= 0.8 && w <= 1.9 && sh.fill >= 0.7) return 'block';
      if (w >= 1.3 && h <= 1.6 && c.area / c.w <= 0.36 * SP) return 'arc';
      h = tr.h / SP;
      if (w >= 0.5 && w <= 1.95 && h >= 1.3 && h < 2.28 && Math.abs(relY) <= 3.8 && (w <= 1.75 || st.t >= 3)) return 'rest8';
      // 큼직하게 그린 4분쉼표: 오선 한가운데에 서서 위·아래 줄 가까이까지 닿는다
      if (w > 1.75 && w <= 2.1 && h >= 3.2 && h <= 4.0 && Math.abs(relY) <= 0.5 && sh.fill >= 0.3 && sh.fill <= 0.6 && sh.botRatio >= 0.45) return 'rest4';
      if (w >= 0.5 && w <= 1.75 && Math.abs(relY) <= 3.8) {
        if (h >= 2.28 && h <= 4.0) {
          // 4분쉼표는 좁고 길며 위아래가 고르다. 16분쉼표는 넓고 위쪽이 무겁다.
          if (w < 1.2) return 'rest4';
          if (w >= 1.33) return (h < 3.05 || sh.botRatio < 0.435) ? 'rest16' : 'rest4';
          return (sh.botRatio < 0.435 && h < 3.0) ? 'rest16' : 'rest4';
        }
      }
      return 'other';
    }

    // 오선 밖에서 덧줄에 붙은 온쉼표·2분쉼표: 넓고 얇은 줄 하나 + 그보다 좁은 네모
    function ledgerBlock(c) {
      if (c.h < 0.4 * SP || c.h > 1.0 * SP || c.w < 1.3 * SP || c.w > 2.9 * SP) return false;
      let lineRows = 0, bodyRows = 0, first = -1, last = -1;
      for (let y = c.y0; y <= c.y1; y++) {
        let n = 0;
        for (let x = c.x0; x <= c.x1; x++) if (lab[y * W + x] === c.id) n++;
        if (n >= 0.9 * c.w) { lineRows++; if (first < 0) first = y; last = y; }
        else if (n >= 0.4 * c.w && n <= 0.85 * c.w) bodyRows++;
      }
      if (!lineRows || lineRows > 0.35 * SP || last - first + 1 !== lineRows) return false;
      if (bodyRows < 0.25 * SP || lineRows + bodyRows < 0.85 * c.h) return false;
      return first === c.y0 || last === c.y1;
    }

    /* --- 오선마다 기호 모으기 --- */
    const out = [];
    for (const st of staves) {
      const S = { st, stems: [], rests: [], dots: [], accs: [], wholes: [], barlines: [], keyAccs: [], digits: [], others: [], clef: 'G', xStart: st.xL };
      const mine = comps.slice(1).filter(c => c.cy >= st.zTop && c.cy <= st.zBot && c.x1 >= st.xL - 2 * SP && c.x0 <= st.xR + SP);
      mine.sort((a, b) => a.x0 - b.x0);

      // 음자리표: 오선 왼쪽 끝 바로 뒤에서 시작하는 잉크 열 묶음(단을 잇는 괄호와 붙어 있어도 되게 열 단위로 잰다)
      let clefRight = st.xL;
      {
        const yA = Math.round(st.top + 2), yB = Math.round(st.bottom - 2);
        const colInk = x => { let c = 0; for (let y = yA; y <= yB; y++) c += sym[y * W + x]; return c; };
        let x = Math.max(0, st.xL);
        const lim = Math.min(W - 1, Math.round(st.xL + 2.6 * SP));
        // 단 시작 세로줄(오선 높이를 가득 채우는 열)은 건너뛴다
        while (x < lim && colInk(x) >= 0.8 * (yB - yA)) x++;
        // 짧은 얼룩은 건너뛰고, 폭이 1.2칸 이상인 첫 잉크 묶음을 음자리표로 본다
        while (x < lim) {
          while (x < lim && colInk(x) < 2) x++;
          if (x >= lim) break;
          const start = x;
          let end = x, gap = 0;
          const far = Math.min(W - 1, Math.round(start + 4.2 * HP));
          for (let xx = start; xx <= far; xx++) {
            if (colInk(xx) >= 2) { end = xx; gap = 0; } else if (++gap >= 0.3 * SP) break;
          }
          if (end - start >= 1.2 * SP) {
            clefRight = end;
            // 낮은음자리표는 오선 아래쪽(넷째 줄 아래)에 잉크가 거의 없다
            const low = inkIn(sym, W, H, start, st.lines[3] - 0.2 * SP, end, st.lines[4] + 1);
            const all = inkIn(sym, W, H, start, st.top, end, st.bottom);
            S.clefLow = all.n ? low.n / all.n : 0;
            // 높은음자리표는 꼬리가 오선 아래로, 머리가 오선 위로 나간다. 낮은음자리표는 오선 안 위쪽에 몰려 있다.
            // 단을 묶는 괄호의 갈고리가 왼쪽 아래·위에 걸리므로 음자리표의 왼쪽 끝은 빼고 잰다.
            const inner = Math.round(start + 0.3 * (end - start));
            const tail = inkIn(sym, W, H, inner, st.bottom + 0.35 * SP, end, st.bottom + 1.9 * SP);
            const above = inkIn(sym, W, H, inner, st.top - 1.6 * SP, end, st.top - 0.4 * SP);
            S.clefTail = all.n ? tail.n / all.n : 0; S.clefAbove = all.n ? above.n / all.n : 0;
            S.clef = all.n > 0 && ((S.clefLow < 0.19 && S.clefTail < 0.03) || (S.clefLow < 0.3 && S.clefTail < 0.01 && S.clefAbove < 0.01)) ? 'F' : 'G';
            for (const c of mine) if (c.cx <= clefRight + 1 && c.cx >= st.xL - SP && c.h < 9 * SP) c.kind = 'clef';
            break;
          }
          x = end + 1;
        }
      }
      S.clefRight = clefRight;

      // 박자표 숫자처럼 생긴 덩어리(오선의 위 절반·아래 절반·전체 높이에 꼭 맞는 것)
      const nearY = (a, b) => Math.abs(a - b) <= 0.32 * SP;
      const digitKind = c => {
        if (noteCompStrong.has(c.id)) return null;
        if (c.area / (c.w * c.h) < 0.32) return null; // 숫자는 획이 굵다(기둥 달린 음표와 구별)
        const top = c.y0, bot = c.y1;
        if (nearY(top, st.top) && nearY(bot, st.mid) && c.w >= 0.6 * SP && c.w <= 2.6 * SP) return 'top';
        if (nearY(top, st.mid) && nearY(bot, st.bottom) && c.w >= 0.6 * SP && c.w <= 2.6 * SP) return 'bot';
        if (nearY(top, st.top) && nearY(bot, st.bottom) && c.w >= 0.8 * SP && c.w <= 2.6 * SP && !vlines.some(v => v.barlike && v.x >= c.x0 && v.x <= c.x1)) return 'both';
        if (nearY(top, st.top + SP) && nearY(bot, st.bottom - SP) && c.w >= 1.2 * SP && c.w <= 2.2 * SP) return 'common';
        return null;
      };
      const digitLike = mine.filter(c => c.x0 > clefRight - 2 && c.x0 < clefRight + 10 * SP && digitKind(c));
      const inDigit = (x, y) => digitLike.some(c => x >= c.x0 - 2 && x <= c.x1 + 2 && y >= c.y0 - 2 && y <= c.y1 + 2);

      const allStems = stems.filter(s => s.st === st && s.v.x > clefRight + 2 && !inDigit(s.v.x, (s.v.y0 + s.v.y1) / 2));
      const headNear = (x, pos, maxDx) => allStems.some(s => s.heads.some(h => h.x > x && h.x - x <= maxDx && Math.abs(h.pos - pos) <= 1.3)) ||
        holes.some(h => h.st === st && !h.used && !inDigit(h.x, h.y) && h.x > x && h.x - x <= maxDx && Math.abs(st.stepAt(h.y) - pos) <= 1.3);

      // 조표: 음자리표 뒤에 이어지는, 머리에 붙지 않은 임시표
      const myAcc = accidentals.filter(a => a.st === st && a.x > clefRight - 0.2 * SP).sort((a, b) => a.x - b.x);
      let px = clefRight;
      // 판정하지 못한 임시표 모양 잉크(세로로 길고 좁은 묶음)가 사이에 있으면 그것도 조표 한 자리로 센다
      const blobBetween = (xa, xb) => {
        if (xb - xa < 0.5 * SP) return false;
        let best = 0, run = 0, y0 = H, y1 = -1;
        for (let x = Math.round(xa); x <= Math.round(xb); x++) {
          const q = inkIn(sym, W, H, x, st.top - 1.5 * SP, x, st.bottom + 1.5 * SP);
          if (q.n) { run++; y0 = Math.min(y0, q.y0); y1 = Math.max(y1, q.y1); }
          else { if (run >= 0.5 * SP && run <= 1.3 * SP && y1 - y0 >= 1.8 * SP && y1 - y0 <= 3.6 * SP) best++; run = 0; y0 = H; y1 = -1; }
        }
        if (run >= 0.5 * SP && run <= 1.3 * SP && y1 - y0 >= 1.8 * SP && y1 - y0 <= 3.6 * SP) best++;
        return best === 1;
      };
      S.keyMissed = 0;
      for (const a of myAcc) {
        if (headNear(a.x1 - 0.3 * SP, a.pos, 1.9 * SP + 0.6 * (HP - SP))) break;
        if (a.x0 - px > 1.6 * SP) {
          if (a.x0 - px > 3 * SP || !blobBetween(px + 2, a.x0 - 2)) break;
          S.keyMissed++;
        }
        a.key = true; S.keyAccs.push(a); px = Math.max(px, a.x1 - 0.3 * SP);
      }
      // 조표를 잉크의 높낮이 차례로 한 번 더 센다. 조표는 자리가 정해져 있다:
      // 올림표는 파-도-솔-레-라-미-시, 내림표는 시-미-라-레-솔-도-파 줄·칸에 차례로 놓인다.
      // 세로획이 흐려 임시표로 판정하지 못한 작은 악보에서도 이 차례는 남는다.
      S.keyFifths = null;
      {
        const yA = Math.round(st.top - 2.2 * SP), yB = Math.round(st.bottom + 1.4 * SP);
        const col = x => { let c = 0, sy = 0, y0 = 1e9, y1 = -1; for (let y = yA; y <= yB; y++) if (sym[y * W + x]) { c++; sy += y; if (y < y0) y0 = y; y1 = y; } return c ? { x, cy: (sy / c - st.top) / SP, y0, y1 } : null; };
        const lim = Math.min(W - 1, Math.round(clefRight + 9.5 * SP));
        let x = clefRight + 2;
        // 음자리표에서 떨어져 나온 부스러기는 건너뛴다
        for (;;) {
          while (x < lim && !col(x)) x++;
          let e = x; while (e < lim && col(e)) e++;
          if (x >= lim || e - x >= 0.3 * SP || x - clefRight > 1.7 * SP) break;
          x = e;
        }
        if (x < lim && x - clefRight <= 1.7 * SP) {
          const runs = []; let cur = null, gap = 0;
          for (let xx = x; xx < lim; xx++) {
            const q = col(xx);
            if (!q) { if (++gap >= 0.9 * SP) break; if (gap >= 2) cur = null; continue; }
            gap = 0;
            if (cur && Math.abs(q.cy - cur.sum / cur.n) <= 0.85) { cur.sum += q.cy; cur.n++; cur.x1 = xx; cur.y0 = Math.min(cur.y0, q.y0); cur.y1 = Math.max(cur.y1, q.y1); cur.ext.push(q.y1 - q.y0 + 1); }
            else { cur = { sum: q.cy, n: 1, x0: xx, x1: xx, y0: q.y0, y1: q.y1, ext: [q.y1 - q.y0 + 1] }; runs.push(cur); }
          }
          const off = S.clef === 'F' ? 1 : 0;
          const SH = [0, 1.5, -0.5, 1.0, 2.5, 0.5, 2.0], FL = [1.75, 0.3, 2.3, 0.8, 2.8, 1.3, 3.3];
          const good = runs.filter(r => r.n >= 0.3 * SP);
          const stemIn = r => allStems.some(s2 => s2.v.x >= r.x0 - 2 && s2.v.x <= r.x1 + 0.4 * SP) || digitLike.some(c => c.x0 <= r.x1 && c.x1 >= r.x0);
          const fits = (r, want, flat) => {
            if (Math.abs(r.sum / r.n - off - want) > 0.5) return false;
            const h = (r.y1 - r.y0 + 1) / SP, w = (r.x1 - r.x0 + 1) / SP;
            if (w > 1.9 || stemIn(r)) return false;
            const med = r.ext.slice().sort((a, b) => a - b)[r.ext.length >> 1] / SP;
            // 내림표는 왼쪽 기둥만 길고 나머지 열은 낮다(4분쉼표·숫자와 구별). 올림표는 열마다 높다.
            return flat ? (h >= 1.7 && h <= 3.1 && med <= 1.5) : (h >= 2.0 && h <= 3.4 && med >= 1.2);
          };
          for (const [seq, flat] of [[SH, false], [FL, true]]) {
            let n = 0;
            while (n < 7 && n < good.length && fits(good[n], seq[n], flat)) n++;
            if (n > 0) { S.keyFifths = flat ? -n : n; S.keyEnd = good[n - 1].x1; break; }
          }
        }
        const lineN = S.keyAccs.length + S.keyMissed;
        const lineFlat = S.keyAccs.filter(a => a.type === 'flat').length > S.keyAccs.length / 2;
        const lineF = lineN ? (lineFlat ? -lineN : lineN) : 0;
        if (S.keyFifths === null) S.keyFifths = lineF;
        else if (lineF && (lineF > 0) === (S.keyFifths > 0) && Math.abs(lineF) > Math.abs(S.keyFifths)) S.keyFifths = lineF;
        else if (lineF && (lineF > 0) !== (S.keyFifths > 0) && Math.abs(S.keyFifths) < 2) S.keyFifths = lineF;
        if (S.keyEnd) {
          px = Math.max(px, S.keyEnd);
          for (const a of myAcc) if (!a.key && a.x0 <= S.keyEnd) { a.key = true; S.keyAccs.push(a); }
        }
      }
      // 박자표
      for (const c of mine) {
        if (c.kind || c.x1 <= px) continue;
        if (inAccBox(c)) continue;
        if (c.x0 - px > 2.2 * SP) break;
        const dk = digitKind(c);
        if (dk) {
          c.kind = 'time'; S.digits.push({ c, which: dk });
          px = Math.max(px, c.x1); continue;
        }
        if (noteComp.has(c.id)) break;
        if (c.area < 0.2 * SP * SP && c.x0 - clefRight < 1.0 * SP) { c.kind = 'clefpart'; continue; }
        break;
      }
      S.xStart = px + 2;
      // 박자표 숫자의 닫힌 구멍 수(위·아래): 6/8과 3/4를 가르는 데 쓴다
      if (S.digits.length) {
        let x0 = W, x1 = 0;
        for (const d of S.digits) { x0 = Math.min(x0, d.c.x0); x1 = Math.max(x1, d.c.x1); }
        const count = (ya, yb) => {
          const w2 = x1 - x0 + 5, h2 = Math.round(yb - ya) + 5;
          const m = new Uint8Array(w2 * h2);
          for (let y = 0; y < h2; y++) for (let x = 0; x < w2; x++) {
            const xx = x0 - 2 + x, yy = Math.round(ya) - 2 + y;
            const inside = x >= 2 && x < w2 - 2 && y >= 2 && y < h2 - 2;
            m[y * w2 + x] = inside && sym[yy * W + xx] ? 0 : 1;
          }
          const cc = smallComponents4(m, w2, h2, w2 - 1, h2 - 1);
          return cc.filter(c => c.x0 > 0 && c.y0 > 0 && c.x1 < w2 - 1 && c.y1 < h2 - 1 && c.area >= 0.02 * SP * SP).length;
        };
        S.timeHoles = { top: count(st.top, st.mid), bot: count(st.mid, st.bottom), common: S.digits.some(d => d.which === 'common') };
      }

      S.stems = stems.filter(s => s.st === st && s.v.x > S.xStart);
      S.accs = myAcc.filter(a => !a.key && a.x > S.xStart);

      // 마디줄
      const crosses = v => v.long && v.y0 <= st.top + 0.35 * SP && v.y1 >= st.bottom - 0.35 * SP;
      const bl = vlines.filter(v => (v.kind === 'thin' || v.kind === 'thick') && ((v.st === st && v.barlike) || crosses(v)) && !v.isStem && v.x > st.xL + 0.6 * SP)
        .sort((a, b) => a.x - b.x);
      for (const v of bl) {
        const last = S.barlines[S.barlines.length - 1];
        if (last && v.xa - last.xb <= 0.95 * SP) { last.members.push(v); last.xb = v.xb; }
        else S.barlines.push({ xa: v.xa, xb: v.xb, members: [v] });
      }
      for (const b of S.barlines) {
        b.x = (b.xa + b.xb) / 2;
        b.thick = b.members.some(v => v.kind === 'thick');
        b.long = b.members.some(v => v.long);
        // 도돌이표의 점 두 개: 가운데 줄 위·아래 칸에 하나씩
        const dotsAt = (xa, xb) => {
          const up = inkIn(sym, W, H, xa, st.mid - 0.85 * SP, xb, st.mid - 0.18 * SP);
          const dn = inkIn(sym, W, H, xa, st.mid + 0.18 * SP, xb, st.mid + 0.85 * SP);
          // 점은 뭉친 덩어리다: 꼬리 끝처럼 가늘게 흩어진 잉크는 아니다
          const okHalf = q => q.n >= 0.03 * SP * SP && q.n <= 0.3 * SP * SP && (q.x1 - q.x0 + 1) <= 0.9 * SP && q.n >= 0.36 * (q.x1 - q.x0 + 1) * (q.y1 - q.y0 + 1);
          if (!okHalf(up) || !okHalf(dn)) return false;
          if (Math.abs(up.cx - dn.cx) > 0.25 * SP) return false;
          // 점 바깥(위·아래)은 비어 있어야 한다: 음표 머리나 쉼표가 아닌지
          const above = inkIn(sym, W, H, xa, st.mid - 1.7 * SP, xb, st.mid - 1.2 * SP);
          const below = inkIn(sym, W, H, xa, st.mid + 1.2 * SP, xb, st.mid + 1.7 * SP);
          return above.n <= 0.08 * SP * SP && below.n <= 0.08 * SP * SP;
        };
        const first = b.members[0], lastM = b.members[b.members.length - 1];
        const thickLeft = first.kind === 'thick', thickRight = lastM.kind === 'thick';
        const single = b.members.length === 1;
        b.repStart = b.thick && (thickLeft || single) && dotsAt(b.xb + 0.2 * SP, b.xb + 1.05 * SP);
        b.repEnd = b.thick && (thickRight || single) && dotsAt(b.xa - 1.05 * SP, b.xa - 0.2 * SP);
      }
      const onBar = c => S.barlines.some(b => c.x0 <= b.xb + 2 && c.x1 >= b.xa - 2);

      // 도돌이 괄호(1. 2.): 오선 위의 얇고 긴 가로선 + 왼쪽 끝의 내려오는 세로 토막
      S.voltas = [];
      {
        const minRun = Math.round(2.5 * SP), maxT = Math.max(3, st.t + 2);
        const segs = [];
        for (let y = st.zTop + 1; y <= st.top - 1.2 * SP; y++) {
          let run = 0;
          const o = y * W;
          for (let x = Math.max(0, st.xL - SP); x <= Math.min(W, st.xR + SP); x++) {
            if (x < W && bin[o + x]) { run++; continue; }
            if (run >= minRun) {
              const x0 = x - run, x1 = x - 1;
              const g = segs.find(q => Math.abs(q.x0 - x0) <= 4 && Math.abs(q.x1 - x1) <= 0.5 * SP && y - q.y1 <= 1);
              if (g) { g.y1 = y; g.x1 = Math.max(g.x1, x1); } else segs.push({ x0, x1, y0: y, y1: y });
            }
            run = 0;
          }
        }
        for (const q of segs) {
          if (q.y1 - q.y0 + 1 > maxT) continue;
          // 왼쪽 끝에서 아래로 0.6칸 이상 내려오는 세로 토막
          let tick = 0;
          // 점선으로 그린 괄호는 세로 토막과 가로선 사이가 조금 떨어져 있다
          for (let x = Math.max(0, q.x0 - Math.round(0.5 * SP)); x <= q.x0 + 3; x++) {
            let n = 0;
            for (let y = q.y1 + 1; y <= q.y1 + 2 * SP && y < H && bin[y * W + x]; y++) n++;
            tick = Math.max(tick, n);
          }
          if (tick >= 0.6 * SP) S.voltas.push({ x0: q.x0, x1: q.x1, y: q.y0 });
        }
        S.voltas.sort((a, b) => a.x0 - b.x0);
      }

      // 온음표: 기둥에 붙지 않은 구멍 + 둘레 고리
      const wholeCand = [];
      for (const h of holes) {
        if (h.st !== st || h.used || h.x < S.xStart) continue;
        if (accidentals.some(a => h.x >= a.x0 - 2 && h.x <= a.x1 + 2 && h.y >= a.y0 && h.y <= a.y1)) continue;
        // 바깥 고리 너비와 양옆 두께(오선이 지나는 행을 피해 세 행에서 재고 가장 좁은 값)
        let outer = 1e9, xl = 0, xr = 0, thL = 0, thR = 0;
        for (const dy of [-3, 0, 3]) {
          const yy = Math.round(h.y) + dy;
          let a = Math.round(h.x), b2 = Math.round(h.x);
          if (sym[yy * W + a]) continue;
          while (a > 0 && !sym[yy * W + a]) a--;
          const ia = a;
          while (a > 0 && sym[yy * W + a]) a--;
          while (b2 < W - 1 && !sym[yy * W + b2]) b2++;
          const ib = b2;
          while (b2 < W - 1 && sym[yy * W + b2]) b2++;
          if (b2 - a - 1 < outer) { outer = b2 - a - 1; xl = a; xr = b2; thL = ia - a; thR = b2 - ib; }
        }
        h.outer = outer;
        if (outer < 1.15 * SP || outer > 2.5 * HP) continue;
        const pos = st.stepAt(h.y);
        if (pos < -5.6 || pos > 12.6) continue;
        if (thL < 0.2 * SP || thR < 0.2 * SP) continue;
        let ringId = 0;
        for (const dy of [0, -3, 3]) for (let k = 1; k <= 6 && !ringId; k++) ringId = lab[(Math.round(h.y) + dy) * W + xl + k];
        if (!ringId) continue;
        const rc = comps[ringId];
        if (rc.w > 2.9 * HP) continue;
        if (rc.w >= 1.3 * SP && rc.area / rc.w <= 0.36 * SP) continue;
        if (onBar({ x0: xl, x1: xr })) continue;
        if (S.stems.some(s => Math.abs(s.v.x - h.x) <= 1.1 * HP && h.y >= s.v.y0 - 0.7 * HP && h.y <= s.v.y1 + 0.7 * HP)) continue;
        wholeCand.push({ h, rc });
      }
      // 3도로 쌓인 온음표는 한 덩어리가 된다: 덩어리 높이는 구멍 수만큼 허용한다
      for (const q of wholeCand) {
        const n = wholeCand.filter(o => o.rc === q.rc && Math.abs(o.h.x - q.h.x) <= 0.8 * HP).length;
        if (q.rc.h > 1.6 * HP + 1.1 * (n - 1) * SP) continue;
        // 오선 밖에서 네 귀퉁이까지 찬 고리는 글자의 네모(ㅁ, ㅂ, D, B)다. 온음표의 고리는 둥글다.
        const pos = st.stepAt(q.h.y);
        if (n === 1 && (pos > 8.5 || pos < -0.5)) {
          const c = q.rc, k = Math.max(2, Math.round(0.16 * SP));
          let corners = 0;
          for (const [cx, cy] of [[c.x0, c.y0], [c.x1 - k + 1, c.y0], [c.x0, c.y1 - k + 1], [c.x1 - k + 1, c.y1 - k + 1]]) {
            if (inkIn(sym, W, H, cx, cy, cx + k - 1, cy + k - 1).n >= 0.5 * k * k) corners++;
          }
          if (corners >= 3) continue;
        }
        // 온음표의 고리는 옆으로 넓다(8분쉼표의 머리와 오선 사이에 생긴 틈은 세로로 긴 덩어리 안에 있다)
        if (n === 1 && q.rc.w < 0.95 * q.rc.h && q.rc.h > 1.25 * SP) continue;
        q.h.used = true;
        S.wholes.push({ x: q.h.x, y: q.h.y, pos: st.stepAt(q.h.y) });
      }
      const inWhole = c => S.wholes.some(w => Math.abs(c.cx - w.x) <= 1.2 * HP && Math.abs(c.cy - w.y) <= 0.7 * HP);

      // 오선을 지우며 위·아래 두 토막으로 갈린 4분쉼표·8분쉼표는 하나로 본다
      const restPairs = new Map();
      {
        const free = mine.filter(c => !c.kind && !noteComp.has(c.id) && c.x1 >= S.xStart && c.area >= 0.15 * SP * SP && !inAccBox(c) && !inWhole(c) &&
          c.w <= 1.75 * SP && c.h >= 0.6 * SP && c.h <= 2.6 * SP && c.y0 >= st.top - 0.8 * SP && c.y1 <= st.bottom + 0.8 * SP);
        for (const a of free) for (const b of free) {
          if (a === b || a.cy >= b.cy || restPairs.has(a) || restPairs.has(b)) continue;
          const ov = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) + 1;
          if (ov < 0.5 * Math.min(a.w, b.w) || b.y0 - a.y1 > st.t + 2 || a.y1 - b.y0 > 0.9 * SP) continue;
          const x0 = Math.min(a.x0, b.x0), x1 = Math.max(a.x1, b.x1), hh = (b.y1 - a.y0 + 1) / SP;
          // 8분쉼표: 위 토막이 머리(둥근 덩이), 아래 토막이 가는 꼬리. 오선 한가운데 두 칸에 걸친다.
          const r8 = hh >= 1.6 && hh < 2.4 && a.h >= 0.8 * SP && a.area > b.area && Math.abs((a.y0 + b.y1) / 2 - st.mid) <= 0.8 * SP;
          if (x1 - x0 + 1 > 1.75 * SP || !(r8 || (hh >= 2.6 && hh <= 4.0 && a.h >= 1.0 * SP && b.h >= 1.0 * SP))) continue;
          restPairs.set(a, { x0, x1, y0: a.y0, y1: b.y1, cx: (x0 + x1) / 2, cy: (a.y0 + b.y1) / 2, other: b, kind: r8 ? 'rest8' : 'rest4' });
          restPairs.set(b, null);
        }
      }
      // 나머지 기호
      for (const c of mine) {
        if (c.kind || noteComp.has(c.id) || c.x1 < S.xStart) continue;
        if (c.area < 5 || inAccBox(c) || inWhole(c)) continue;
        if (restPairs.has(c)) {
          const u = restPairs.get(c);
          const u2 = u || restPairs.get([...restPairs.keys()].find(k => restPairs.get(k) && restPairs.get(k).other === c));
          c.kind = u2 ? u2.kind : 'rest4';
          if (u && !onBar(u)) S.rests.push({ x: u.cx, x0: u.x0, x1: u.x1, y: u.cy, kind: u.kind, c: u, far: Math.abs(u.cy - st.mid) > 1.1 * SP });
          continue;
        }
        const k = classify(c, st);
        c.kind = k;
        if (k === 'dot') {
          const rep = S.barlines.some(b => (b.repStart && c.cx > b.xb && c.cx < b.xb + 1.1 * SP) || (b.repEnd && c.cx < b.xa && c.cx > b.xa - 1.1 * SP));
          if (!rep) S.dots.push({ x: c.cx, y: st.t >= 3 || c.h > 0.75 * SP ? trimLines(c, st, true).cy : c.cy, c });
        } else if (k === 'block' || (k === 'other' && ledgerBlock(c))) {
          // 제자리: 온쉼표는 둘째 줄에 매달리고 2분쉼표는 셋째 줄에 앉는다.
          // 두 성부 악보에서는 위·아래로 옮겨 적는다(far): 줄 아래에 매달리면 온쉼표, 줄 위에 앉으면 2분쉼표
          const u = (c.cy - st.top) / SP;
          if (u > 0.7 && u < 2.3 && k === 'block') S.rests.push({ x: c.cx, x0: c.x0, x1: c.x1, y: c.cy, kind: u < 1.5 ? 'whole' : 'half', c });
          else {
            if (u > -1.4 && u < 5.4) S.rests.push({ x: c.cx, x0: c.x0, x1: c.x1, y: c.cy, kind: u - Math.floor(u) < 0.5 ? 'whole' : 'half', c, far: true });
            c.kind = 'other'; S.others.push(c);
          }
        } else if (k === 'rest4' || k === 'rest8' || k === 'rest16') {
          if (onBar(c)) continue;
          const far = Math.abs(c.cy - st.mid) > 1.1 * SP;
          S.rests.push({ x: c.cx, x0: c.x0, x1: c.x1, y: c.cy, kind: k, c, far });
          if (far) { c.kind = 'other'; S.others.push(c); }
        } else S.others.push(c);
      }
      // 머리 바로 옆의 점이 오선 토막을 타고 머리와 한 덩어리가 된 경우: 머리 오른쪽에서 오선 띠를 빼고 뭉친 잉크를 찾는다
      {
        const band = y => st.lines.some(ly => Math.abs(y - ly) <= st.t / 2 + 1);
        const hs = S.stems.flatMap(s2 => s2.heads.map(h => ({ h, s: s2 }))).concat(S.wholes.map(w => ({ h: w, s: null })));
        for (const { h, s: s2 } of hs) {
          let xa = Math.round(h.x + 0.62 * HP);
          if (s2 && s2.v.x > h.x) xa = Math.max(xa, s2.v.xb + 2);
          const xb = Math.min(W - 1, Math.round(xa + 1.2 * SP));
          const ya = Math.max(0, Math.round(h.y - 0.75 * SP)), yb = Math.min(H - 1, Math.round(h.y + 0.45 * SP));
          if (S.dots.some(d => d.x >= xa - 2 && d.x <= xb + 0.4 * SP && d.y >= ya - 2 && d.y <= yb + 2)) continue;
          const col = x => { let n = 0, y0 = H, y1 = -1; for (let y = ya; y <= yb; y++) if (!band(y) && sym[y * W + x]) { n++; if (y < y0) y0 = y; y1 = y; } return { n, y0, y1 }; };
          let x = xa;
          while (x <= xb && col(x).n) x++; // 머리의 가장자리
          while (x <= xb && !col(x).n) x++;
          if (x > xb) continue;
          const x0 = x; let n = 0, y0 = H, y1 = -1;
          for (; x <= xb + 0.6 * SP && x < W; x++) { const q = col(x); if (!q.n) break; n += q.n; y0 = Math.min(y0, q.y0); y1 = Math.max(y1, q.y1); }
          const dw = x - x0, dh = y1 - y0 + 1;
          if (x >= W || col(x).n || dw < 0.2 * SP || dw > 0.75 * SP || dh < 0.2 * SP || dh > 0.75 * SP || n < 0.55 * dw * dh) continue;
          // 점 위·아래는 비어 있다(다른 기호의 한 부분이 아니다)
          const xm = (x0 + x - 1) >> 1;
          let clear = true;
          for (let k = 1; k <= 0.7 * SP && clear; k++) for (const yy of [y0 - k, y1 + k]) {
            if (yy < 0 || yy >= H || band(yy)) continue;
            // 바로 위·아래에 놓인 다른 점(겹음의 다른 머리에 붙은 점)은 괜찮다
            for (let xx = xm - 1; xx <= xm + 1; xx++) if (sym[yy * W + xx] && !(lab[yy * W + xx] && comps[lab[yy * W + xx]].kind === 'dot')) clear = false;
          }
          if (clear) S.dots.push({ x: (x0 + x - 1) / 2, y: (y0 + y1) / 2 });
        }
      }
      // 흐린 이미지 보완: 세로선으로 못 잡은 임시표를 머리 왼쪽의 잉크 덩어리 모양으로 판정한다
      {
        const barCols = S.barlines.flatMap(b => b.members.map(v => [v.xa - 2, v.xb + 2]));
        const inBar = x => barCols.some(c => x >= c[0] && x <= c[1]);
        const stemBoxes = stems.filter(s => s.st === st).map(s => [s.v.xa - 2, s.v.xb + 2, s.v.y0 - 2, s.v.y1 + 2]);
        const inStem = (x, y) => stemBoxes.some(b => x >= b[0] && x <= b[1] && y >= b[2] && y <= b[3]);
        const allHeads = S.stems.flatMap(s => s.heads).concat(S.wholes);
        const okKind = k => k === undefined || k === 'other' || k === null;
        for (const s of S.stems) {
          if (s.heads.length !== 1) continue;
          const h = s.heads[0];
          if (S.accs.some(a => a.x1 > h.x - 1.3 * SP - 1.3 * HP && a.x0 < h.x && Math.abs(a.pos - h.pos) <= 1.5)) continue;
          let myComp = 0;
          for (let y = s.v.y0 + 2; y <= s.v.y1 - 2 && !myComp; y += 2) myComp = lab[y * W + Math.round(s.v.x)];
          const xa = Math.max(S.xStart, Math.round(h.x - 0.8 * HP - 1.3 * SP)), xb = Math.round(h.x - 0.8 * HP);
          const ya = Math.max(0, Math.round(h.y - 2.1 * SP)), yb = Math.min(H - 1, Math.round(h.y + 1.3 * SP));
          if (xb - xa < 0.5 * SP) continue;
          const ok = (x, y) => {
            const i = y * W + x;
            if (!sym[i] || inBar(x) || inStem(x, y)) return false;
            const id = lab[i];
            if (id !== myComp && (noteComp.has(id) || !okKind(comps[id].kind))) return false;
            for (const o of allHeads) if (o !== h && Math.abs(x - o.x) <= 0.78 * HP && Math.abs(y - o.y) <= 0.62 * HP) return false;
            return true;
          };
          // 머리에 가장 가까운 잉크 열 묶음
          const colInk = new Int32Array(xb - xa + 1);
          for (let x = xa; x <= xb; x++) { let c = 0; for (let y = ya; y <= yb; y++) if (ok(x, y)) c++; colInk[x - xa] = c; }
          let x1 = xb;
          while (x1 >= xa && colInk[x1 - xa] < 2) x1--;
          if (x1 < xa || xb - x1 > 0.75 * SP) continue;
          let x0 = x1, gap = 0;
          for (let x = x1 - 1; x >= xa; x--) { if (colInk[x - xa] >= 1) { x0 = x; gap = 0; } else if (++gap > 2) break; }
          let n = 0, y0 = H, y1 = -1, sx = 0;
          const rowInk = new Int32Array(yb - ya + 1), rowSx = new Float64Array(yb - ya + 1);
          for (let y = ya; y <= yb; y++) for (let x = x0; x <= x1; x++) if (ok(x, y)) { n++; sx += x; rowInk[y - ya]++; rowSx[y - ya] += x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
          const bw = (x1 - x0 + 1) / SP, bh = (y1 - y0 + 1) / SP;
          if (n < 0.22 * SP * SP || bh < 1.5 || bh > 3.5 || bw < 0.35 || bw > 1.5) continue;
          // 마디줄 옆에 남은 오선 토막들은 임시표가 아니다: 잉크가 거의 오선 자리에만 있다
          {
            let onLine = 0;
            for (let y = y0; y <= y1; y++) {
              if (!st.lines.some(l => Math.abs(y - l) <= st.t / 2 + 0.6)) continue;
              for (let x = x0; x <= x1; x++) if (ok(x, y)) onLine++;
            }
            if (onLine >= 0.8 * n) continue;
          }
          // 앞 음표의 꼬리는 임시표가 아니다: 그 기둥 끝에서 잉크를 따라가면 닿는다(오선 토막만 타고 이어진 것은 치지 않는다)
          if (S.stems.some(o => {
            if (o === s || !o.flags || o.beamed) return false;
            const tip = o.dir > 0 ? o.v.y0 : o.v.y1, fa = Math.min(tip, tip + o.dir * 3.3 * SP), fb = Math.max(tip, tip + o.dir * 3.3 * SP);
            if (!(x0 >= o.v.xa - 2 && x0 <= o.v.xb + 0.9 * SP && Math.min(y1, fb) - Math.max(y0, fa) >= 0.6 * (y1 - y0))) return false;
            const bx0 = o.v.xb + 1, bx1 = x1, by0 = Math.round(Math.min(fa, y0)), by1 = Math.round(Math.max(fb, y1));
            const bw = bx1 - bx0 + 1, bh2 = by1 - by0 + 1;
            if (bw < 1 || bh2 < 1) return false;
            const B = st.t / 2 + 1;
            const pass = (x, y) => {
              if (!sym[y * W + x]) return false;
              const ly = st.lines.find(l => Math.abs(y - l) <= B);
              if (ly === undefined) return true;
              const ya2 = Math.round(ly - B) - 1, yb2 = Math.round(ly + B) + 1;
              return ya2 >= 0 && yb2 < H && sym[ya2 * W + x] && sym[yb2 * W + x];
            };
            const seen = new Uint8Array(bw * bh2), stack = [];
            for (let k = -2; k <= 0.9 * SP; k++) {
              const y = tip + o.dir * k;
              if (y >= by0 && y <= by1 && pass(bx0, y)) { seen[(y - by0) * bw] = 1; stack.push(bx0, y); }
            }
            let reach = 0;
            while (stack.length) {
              const y = stack.pop(), x = stack.pop();
              if (x >= x0 && x <= x1 && y >= y0 && y <= y1) reach++;
              for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const nx = x + dx, ny = y + dy;
                if (nx < bx0 || nx > bx1 || ny < by0 || ny > by1) continue;
                const i = (ny - by0) * bw + (nx - bx0);
                if (seen[i] || !pass(nx, ny)) continue;
                seen[i] = 1; stack.push(nx, ny);
              }
            }
            return reach >= 0.6 * n;
          })) continue;
          let bot = 0, topN = 0, topSx = 0, botN = 0, botSx = 0, upW = 0, upRows = 0, loW = 0, loRows = 0;
          for (let y = y0; y <= y1; y++) {
            const r = (y - y0) / (y1 - y0 + 1), c = rowInk[y - ya];
            if (r >= 0.55) bot += c;
            if (r < 0.33) { topN += c; topSx += rowSx[y - ya]; }
            if (r >= 0.67) { botN += c; botSx += rowSx[y - ya]; }
            if (r < 0.4) { upW += c; upRows++; } else if (r >= 0.6) { loW += c; loRows++; }
          }
          const botRatio = bot / n;
          const midY = (y0 + y1) / 2;
          let type = null, ay = midY;
          const upMean = upRows ? upW / upRows : 0, loMean = loRows ? loW / loRows : 0;
          if (botRatio >= 0.58 && loMean >= upMean * 1.5 && y1 - h.y >= 0.1 * SP && y1 - h.y <= 1.1 * SP && h.y - y0 >= 1.1 * SP) { type = 'flat'; ay = y1 - 0.55 * SP; }
          else if (Math.abs(midY - h.y) <= 0.6 * SP && bh >= 2.2 && botRatio >= 0.36 && botRatio <= 0.56) {
            const dxTB = topN && botN ? (botSx / botN - topSx / topN) / SP : 0;
            type = dxTB >= 0.16 ? 'natural' : 'sharp';
          }
          if (!type) continue;
          S.accs.push({ type, st, x: (x0 + x1) / 2, x0, x1, y0, y1, y: ay, pos: st.stepAt(ay), soft: true });
        }
      }
      out.push(S);
    }

    return { P, W, H, staves, vlines, blobs, holes, stems, accidentals, comps, lab, per: out, darkAt, headH, HK };
  }

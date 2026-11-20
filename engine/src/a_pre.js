/* 악보 인식기 (OMR)
 * 입력: { width, height, data } — data는 RGBA(Uint8ClampedArray) 또는 회색(Uint8Array, 길이 = width*height)
 * 출력: { parts, meter, fifths, warnings, text }
 * 범위: 인쇄된 5선보, 높은음자리표·낮은음자리표, 단선율과 두 성부까지
 */
(function (root) {
  'use strict';

  const SP = 16; // 정규화한 뒤의 오선 간격(픽셀)
  const HOLES_BIN = true;
  const SHARP = 1.2, THR = 0.5; // 선명화 세기, 흑백 문턱(잉크와 바탕 사이의 비율)

  /* ================= 1. 전처리 ================= */

  function toGray(img) {
    const n = img.width * img.height;
    if (img.data.length === n) return Uint8Array.from(img.data);
    const g = new Uint8Array(n);
    const d = img.data;
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      const a = d[j + 3] / 255;
      const v = 0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2];
      g[i] = Math.round(v * a + 255 * (1 - a));
    }
    return g;
  }

  function levels(g) {
    const h = new Uint32Array(256);
    for (let i = 0; i < g.length; i += 3) h[g[i]]++;
    let tot = 0;
    for (let i = 0; i < 256; i++) tot += h[i];
    // 오츠 문턱
    let sum = 0;
    for (let i = 0; i < 256; i++) sum += i * h[i];
    let sumB = 0, wB = 0, best = 0, thr = 128;
    for (let i = 0; i < 256; i++) {
      wB += h[i];
      if (!wB) continue;
      const wF = tot - wB;
      if (!wF) break;
      sumB += i * h[i];
      const mB = sumB / wB, mF = (sum - sumB) / wF;
      const v = wB * wF * (mB - mF) * (mB - mF);
      if (v > best) { best = v; thr = i; }
    }
    let nb = 0, sb = 0, nw = 0, sw = 0;
    for (let i = 0; i < 256; i++) {
      if (i <= thr) { nb += h[i]; sb += i * h[i]; } else { nw += h[i]; sw += i * h[i]; }
    }
    return { black: nb ? sb / nb : 0, white: nw ? sw / nw : 255, otsu: thr };
  }

  // 원본에서 오선 간격 추정: 세로 방향 흑·백 줄 길이의 최빈값
  function estimateSpacing(g, W, H, thr) {
    const maxRun = Math.min(400, H >> 2);
    const hb = new Uint32Array(maxRun + 1), hw = new Uint32Array(maxRun + 1), hs = new Uint32Array(maxRun * 2 + 2);
    const step = Math.max(1, Math.floor(W / 400));
    for (let x = 0; x < W; x += step) {
      let run = 0, cur = g[x] < thr, prevBlack = 0;
      for (let y = 0; y <= H; y++) {
        const b = y < H ? g[y * W + x] < thr : !cur;
        if (b === cur) { run++; continue; }
        if (run <= maxRun) {
          if (cur) { hb[run]++; prevBlack = run; }
          else { hw[run]++; if (prevBlack) hs[prevBlack + run]++; }
        } else if (cur) prevBlack = 0; else prevBlack = 0;
        cur = b; run = 1;
      }
    }
    // 흑+백 합(= 오선 간격)의 최빈값
    let bs = 0, bv = 0;
    for (let i = 4; i < hs.length; i++) if (hs[i] > bv) { bv = hs[i]; bs = i; }
    // 주변 가중 평균으로 소수점 추정
    let num = 0, den = 0;
    for (let i = Math.max(2, bs - 1); i <= bs + 1 && i < hs.length; i++) { num += i * hs[i]; den += hs[i]; }
    return den ? num / den : 0;
  }

  function resample(g, W, H, k) {
    const W2 = Math.max(1, Math.round(W * k)), H2 = Math.max(1, Math.round(H * k));
    const out = new Uint8Array(W2 * H2);
    if (k >= 1) {
      for (let y = 0; y < H2; y++) {
        const fy = Math.min(H - 1, Math.max(0, (y + 0.5) / k - 0.5));
        const y0 = Math.floor(fy), y1 = Math.min(H - 1, y0 + 1), wy = fy - y0;
        for (let x = 0; x < W2; x++) {
          const fx = Math.min(W - 1, Math.max(0, (x + 0.5) / k - 0.5));
          const x0 = Math.floor(fx), x1 = Math.min(W - 1, x0 + 1), wx = fx - x0;
          const a = g[y0 * W + x0] * (1 - wx) + g[y0 * W + x1] * wx;
          const b = g[y1 * W + x0] * (1 - wx) + g[y1 * W + x1] * wx;
          out[y * W2 + x] = a * (1 - wy) + b * wy;
        }
      }
    } else {
      // 넓이 평균
      const inv = 1 / k;
      for (let y = 0; y < H2; y++) {
        const ya = y * inv, yb = Math.min(H, (y + 1) * inv);
        for (let x = 0; x < W2; x++) {
          const xa = x * inv, xb = Math.min(W, (x + 1) * inv);
          let s = 0, wsum = 0;
          for (let yy = Math.floor(ya); yy < yb; yy++) {
            const wy = Math.min(yy + 1, yb) - Math.max(yy, ya);
            for (let xx = Math.floor(xa); xx < xb; xx++) {
              const wx = Math.min(xx + 1, xb) - Math.max(xx, xa);
              s += g[yy * W + xx] * wx * wy; wsum += wx * wy;
            }
          }
          out[y * W2 + x] = wsum ? s / wsum : 255;
        }
      }
    }
    return { g: out, W: W2, H: H2 };
  }

  // 흐린 이미지를 위한 선명화(언샤프): 상자 흐림을 빼서 가장자리를 세운다
  function sharpen(g, W, H, r, amt) {
    const tmp = new Float32Array(W * H), bl = new Float32Array(W * H);
    const n = 2 * r + 1;
    for (let y = 0; y < H; y++) {
      const o = y * W;
      let s = 0;
      for (let x = -r; x <= r; x++) s += g[o + Math.min(W - 1, Math.max(0, x))];
      for (let x = 0; x < W; x++) {
        tmp[o + x] = s / n;
        s += g[o + Math.min(W - 1, x + r + 1)] - g[o + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < W; x++) {
      let s = 0;
      for (let y = -r; y <= r; y++) s += tmp[Math.min(H - 1, Math.max(0, y)) * W + x];
      for (let y = 0; y < H; y++) {
        bl[y * W + x] = s / n;
        s += tmp[Math.min(H - 1, y + r + 1) * W + x] - tmp[Math.max(0, y - r) * W + x];
      }
    }
    const out = new Uint8Array(W * H);
    for (let i = 0; i < out.length; i++) {
      const v = g[i] + amt * (g[i] - bl[i]);
      out[i] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
    return out;
  }

  function binarize(g, thr) {
    const b = new Uint8Array(g.length);
    for (let i = 0; i < g.length; i++) b[i] = g[i] < thr ? 1 : 0;
    return b;
  }

  // 가는 선 보강: 흐리게 찍힌 가는 선(오선·기둥)은 어두움이 문턱에 못 미친다.
  // 세로 또는 가로 단면에서 좁은 봉우리인 화소를 잉크로 더한다.
  function addRidges(bin, g0, W, H, lv) {
    const span = Math.max(1, lv.white - lv.black);
    const lo = 0.12 * span;
    const r = Math.max(2, Math.round(0.2 * SP));
    // 작은 그림을 키우면 두 화소에 걸친 가는 오선이 넓고 흐린 띠가 된다: 가로선은 조금 더 먼 곳과도 견준다
    const r2 = Math.round(0.36 * SP);
    const D = i => lv.white - g0[i];
    for (let y = r2; y < H - r2; y++) {
      for (let x = r2; x < W - r2; x++) {
        const i = y * W + x;
        if (bin[i]) continue;
        const d = D(i);
        if (d < lo) continue;
        // 가로선의 단면(세로 방향 봉우리)
        // 봉우리와 거의 같은 짙기의 바로 옆 화소도 같은 선이다(두 화소에 걸쳐 흐려진 가는 선의 가운데를 바로 잡는다)
        if (d >= D(i - W) && d >= D(i + W) && (Math.max(D(i - r * W), D(i + r * W)) <= 0.55 * d || Math.max(D(i - r2 * W), D(i + r2 * W)) <= 0.4 * d)) {
          bin[i] = 1;
          if (D(i - W) >= 0.8 * d) bin[i - W] = 1;
          if (D(i + W) >= 0.8 * d) bin[i + W] = 1;
          continue;
        }
        // 세로선의 단면(가로 방향 봉우리)
        if (d >= D(i - 1) && d >= D(i + 1) && Math.max(D(i - r), D(i + r)) <= 0.55 * d) {
          bin[i] = 1;
          if (D(i - 1) >= 0.8 * d) bin[i - 1] = 1;
          if (D(i + 1) >= 0.8 * d) bin[i + 1] = 1;
        }
      }
    }
  }
  function estimateSkew(bin, W, H) {
    const pts = [];
    for (let y = 0; y < H; y += 2) for (let x = (y % 6); x < W; x += 6) if (bin[y * W + x]) pts.push(x, y);
    const score = s => {
      const h = new Float32Array(H + 200);
      for (let i = 0; i < pts.length; i += 2) {
        const yy = Math.round(pts[i + 1] - s * (pts[i] - W / 2)) + 100;
        if (yy >= 0 && yy < h.length) h[yy]++;
      }
      let v = 0;
      for (let i = 0; i < h.length; i++) v += h[i] * h[i];
      return v;
    };
    let best = 0, bv = score(0);
    for (let s = -0.08; s <= 0.0801; s += 0.0025) {
      const v = score(s);
      if (v > bv * 1.02) { bv = v; best = s; }
    }
    for (const step of [0.0005, 0.0001]) {
      const c = best;
      for (let k = -5; k <= 5; k++) {
        const v = score(c + k * step);
        if (v > bv * 1.002) { bv = v; best = c + k * step; }
      }
    }
    return best;
  }

  function shearY(g, W, H, s) {
    const out = new Uint8Array(W * H).fill(255);
    for (let x = 0; x < W; x++) {
      const dy = s * (x - W / 2);
      for (let y = 0; y < H; y++) {
        const fy = y + dy;
        const y0 = Math.floor(fy), wy = fy - y0;
        if (y0 < 0 || y0 + 1 >= H) continue;
        out[y * W + x] = g[y0 * W + x] * (1 - wy) + g[(y0 + 1) * W + x] * wy;
      }
    }
    return out;
  }

  /* ================= 2. 오선 ================= */

  // 다섯 줄에 간격이 고른 격자를 맞춘다: 맨 윗줄 자리, 간격, 어긋남(가장 큰 값과 합)
  function fitGrid(ys) {
    const my = ys.reduce((a, v) => a + v, 0) / 5;
    let num = 0;
    for (let i = 0; i < 5; i++) num += (i - 2) * (ys[i] - my);
    const sp = num / 10, y0 = my - 2 * sp;
    let max = 0, sum = 0;
    for (let i = 0; i < 5; i++) { const e = Math.abs(ys[i] - (y0 + i * sp)); sum += e; if (e > max) max = e; }
    return { y0, sp, max, sum };
  }
  function findStaves(bin, W, H) {
    const minRun = 3 * SP;
    const rowLong = new Float32Array(H);
    const rowMin = new Int32Array(H).fill(W), rowMax = new Int32Array(H).fill(-1);
    // 흐리거나 잡음 낀 사진에서는 가는 오선이 점선처럼 끊긴다: 짧은 틈은 이어진 것으로 센다
    const maxGap = Math.round(0.5 * SP);
    for (let y = 0; y < H; y++) {
      let run = 0, ink = 0, gap = 0;
      const o = y * W;
      for (let x = 0; x <= W; x++) {
        if (x < W && bin[o + x]) { run += gap + 1; ink++; gap = 0; continue; }
        if (run && x < W && gap < maxGap) { gap++; continue; }
        if (run >= minRun && ink >= 0.6 * run) {
          const end = x - gap;
          rowLong[y] += run;
          if (end - run < rowMin[y]) rowMin[y] = end - run;
          if (end - 1 > rowMax[y]) rowMax[y] = end - 1;
        }
        run = 0; ink = 0; gap = 0;
      }
    }
    let mx = 0;
    for (let y = 0; y < H; y++) if (rowLong[y] > mx) mx = rowLong[y];

    // 가로줄 후보: 문턱을 넘는 행 묶음에서 봉우리의 절반 이상인 행만 남긴다
    const linesIn = (thr, ya, yb) => {
      const out = [];
      for (let y = ya; y <= yb; y++) {
        if (rowLong[y] < thr) continue;
        let y1 = y;
        while (y1 + 1 <= yb && rowLong[y1 + 1] >= thr) y1++;
        let pk = y;
        for (let k = y; k <= y1; k++) if (rowLong[k] > rowLong[pk]) pk = k;
        let a = pk, b = pk;
        while (a - 1 >= y && rowLong[a - 1] >= 0.5 * rowLong[pk]) a--;
        while (b + 1 <= y1 && rowLong[b + 1] >= 0.5 * rowLong[pk]) b++;
        if (b - a + 1 <= 0.5 * SP) {
          let num = 0, den = 0, x0 = W, x1 = -1;
          for (let k = a; k <= b; k++) {
            num += k * rowLong[k]; den += rowLong[k];
            if (rowMin[k] < x0) x0 = rowMin[k];
            if (rowMax[k] > x1) x1 = rowMax[k];
          }
          out.push({ y: num / den, t: b - a + 1, x0, x1, w: rowLong[pk] });
        }
        y = y1;
      }
      return out;
    };
    // 간격이 고른 줄 다섯(사이에 낀 다른 가로선은 건너뛴다)
    const chainsOf = (lines, needExtent) => {
      const sameExtent = (a, b) => !needExtent || (Math.abs(a.x0 - b.x0) <= 3 * SP && Math.abs(a.x1 - b.x1) <= 3 * SP);
      // 가능한 다섯 줄 묶음을 모두 만든 뒤, 줄이 길고 간격이 고른 묶음부터 고른다
      // (가로로 긴 빔이나 덧줄이 오선 한 줄 자리를 차지하지 못하게)
      const cands = [];
      for (let i = 0; i < lines.length; i++) {
        for (let j = i + 1; j < lines.length && lines[j].y - lines[i].y <= SP * 1.4; j++) {
          const d = lines[j].y - lines[i].y;
          if (d < SP * 0.7 || !sameExtent(lines[i], lines[j])) continue;
          const c = [i, j];
          let last = j;
          for (let n = 2; n < 5; n++) {
            // 흐린 가는 줄은 한두 화소씩 어긋나 잡힌다: 지금까지의 평균 간격으로 다음 줄을 찾고, 고른 정도는 다섯 줄을 다 모은 뒤에 잰다
            const dm = (lines[last].y - lines[i].y) / (n - 1);
            const want = lines[last].y + dm;
            let best = -1, bd = dm * 0.3;
            for (let k = last + 1; k < lines.length && lines[k].y <= want + bd; k++) {
              if (!sameExtent(lines[i], lines[k])) continue;
              const e = Math.abs(lines[k].y - want);
              if (e < bd) { bd = e; best = k; }
            }
            if (best < 0) break;
            c.push(best); last = best;
          }
          if (c.length < 5) continue;
          const f = fitGrid(c.map(k => lines[k].y));
          if (f.max > 0.11 * f.sp) continue;
          const err = f.sum;
          let w = 0, wMin = Infinity;
          for (const k of c) { w += lines[k].w; wMin = Math.min(wMin, lines[k].w); }
          cands.push({ c, score: w + 4 * wMin - err * SP });
        }
      }
      cands.sort((a, b) => b.score - a.score);
      const used = new Uint8Array(lines.length);
      const res = [];
      for (const q of cands) {
        if (q.c.some(k => used[k])) continue;
        // 이미 고른 오선과 세로로 겹치면 안 된다
        const y0 = lines[q.c[0]].y, y1 = lines[q.c[4]].y;
        if (res.some(L => L[0].y <= y1 && L[4].y >= y0)) continue;
        for (const k of q.c) used[k] = 1;
        res.push(q.c.map(k => lines[k]));
      }
      res.sort((a, b) => a[0].y - b[0].y);
      return res;
    };
    // 1차: 긴 오선. 2차: 남은 빈 구역에서 짧은 단(마지막 단처럼 폭이 좁은 오선)
    const groups = chainsOf(linesIn(Math.max(8 * SP, mx * 0.18), 0, H - 1), false);
    {
      const taken = groups.map(L => [L[0].y - 3 * SP, L[4].y + 3 * SP]).sort((a, b) => a[0] - b[0]);
      let y = 0;
      const gaps = [];
      for (const [a, b] of taken) { if (a - y > 4 * SP) gaps.push([Math.max(0, Math.ceil(y)), Math.floor(a)]); y = Math.max(y, b); }
      if (H - 1 - y > 4 * SP) gaps.push([Math.ceil(y), H - 1]);
      for (const [a, b] of gaps) for (const L of chainsOf(linesIn(Math.max(6 * SP, mx * 0.05), a, b), true)) groups.push(L);
    }
    const staves = [];
    for (const L of groups) {
      const m = (L[4].y - L[0].y) / 4;
      if (m < SP * 0.7 || m > SP * 1.35) continue;
      // 줄 두께: 줄 중심을 지나는 세로 흑 줄 길이의 중앙값
      const runs = [];
      const xa = Math.min(...L.map(l => l.x0)), xb = Math.max(...L.map(l => l.x1));
      for (const l of L) {
        const yc = Math.round(l.y);
        for (let x = xa + 8; x < xb; x += 7) {
          let y = -1;
          for (let d = 0; d <= 3 && y < 0; d++) {
            if (bin[(yc + d) * W + x]) y = yc + d; else if (bin[(yc - d) * W + x]) y = yc - d;
          }
          if (y < 0) continue;
          let a = y, b = y;
          while (a > 0 && bin[(a - 1) * W + x]) a--;
          while (b < H - 1 && bin[(b + 1) * W + x]) b++;
          if (b - a + 1 < SP) runs.push(b - a + 1);
        }
      }
      runs.sort((a, b) => a - b);
      const tMed = runs.length ? runs[runs.length >> 1] : 2;
      // 줄 끝이 기호 옆에서 끊겨 보여도 오선은 이어진다: 짧은 틈을 건너 끝까지 따라간다
      let xL = Math.min(...L.map(l => l.x0)), xR = Math.max(...L.map(l => l.x1));
      const follow = (x, step) => {
        const ends = [];
        for (const l of L) {
          const yc = Math.round(l.y);
          let cur = x, gap = 0;
          for (let xx = x + step; xx >= 0 && xx < W && gap <= 0.6 * SP; xx += step) {
            let ink = false;
            for (let d = -1; d <= 1 && !ink; d++) if (bin[(yc + d) * W + xx]) ink = true;
            if (ink) { cur = xx; gap = 0; } else gap++;
          }
          ends.push(cur);
        }
        ends.sort((a, b) => a - b);
        return ends[2];
      };
      xL = Math.min(xL, follow(xL, -1)); xR = Math.max(xR, follow(xR, 1));
      // 줄마다 어긋나 잡혔으면 고른 격자에 맞춘 자리를 쓴다(음높이는 줄 자리에서 나온다)
      const f = fitGrid(L.map(l => l.y));
      const ys = f.max >= 0.75 ? [0, 1, 2, 3, 4].map(i => f.y0 + i * f.sp) : L.map(l => l.y);
      staves.push({
        lines: ys, sp: (ys[4] - ys[0]) / 4, t: tMed,
        top: ys[0], bottom: ys[4], xL, xR,
      });
    }
    staves.sort((a, b) => a.top - b.top);
    return staves;
  }

  // 오선 지우기: 줄만 지나가는 열만 지운다.
  // 줄에 닿아 있는 기호(위나 아래에서 잉크가 이어지는 열)는 남기고, 짧게 끊긴 틈은 다시 잇는다.
  // 선명화는 짙은 오선 바로 옆 행을 밝게 만든다. 흐린 기둥·마디줄은 그 행에서 한두 화소 끊긴다.
  // 오선에서 한두 화소 떨어져 끝나는 세로 획은 오선까지 이어 준다.
  function bridgeAtLines(bin, W, H, staves) {
    const need = Math.round(0.6 * SP), maxW = Math.max(4, Math.round(0.3 * SP));
    for (const st of staves) {
      const xa = Math.max(0, st.xL - 4), xb = Math.min(W - 1, st.xR + 4);
      for (const ly of st.lines) {
        const yc = Math.round(ly);
        for (let x = xa; x <= xb; x++) {
          let y = -1;
          for (let d = 0; d <= st.t; d++) {
            if (bin[(yc + d) * W + x]) { y = yc + d; break; }
            if (bin[(yc - d) * W + x]) { y = yc - d; break; }
          }
          if (y < 0) continue;
          let a = y, b = y;
          while (a > 0 && bin[(a - 1) * W + x]) a--;
          while (b < H - 1 && bin[(b + 1) * W + x]) b++;
          for (const dir of [-1, 1]) {
            const e = dir < 0 ? a : b;
            for (let g = 1; g <= 2; g++) {
              const y1 = e + dir * (g + 1);
              if (y1 - need < 0 || y1 + need >= H) break;
              if (bin[(e + dir * g) * W + x]) break;
              if (!bin[y1 * W + x]) continue;
              let n = 0;
              while (n < need && bin[(y1 + dir * n) * W + x]) n++;
              // 가는 세로 획만: 머리나 빔처럼 넓은 것은 잇지 않는다
              const thin = yy => { let l = x, r = x; while (l > 0 && bin[yy * W + l - 1]) l--; while (r < W - 1 && bin[yy * W + r + 1]) r++; return r - l + 1 <= maxW; };
              let ok = n >= need;
              for (let k = 0; k < need && ok; k++) if (!thin(y1 + dir * k)) ok = false;
              if (ok) for (let k = 1; k <= g; k++) bin[(e + dir * k) * W + x] = 1;
              break;
            }
          }
        }
      }
    }
  }

  function removeStaves(bin, W, H, staves) {
    const sym = Uint8Array.from(bin);
    for (const st of staves) {
      const xa = Math.max(1, st.xL - 4), xb = Math.min(W - 2, st.xR + 4);
      for (const ly of st.lines) {
        const yc = Math.round(ly);
        // 줄마다 굵기가 다를 수 있다(작은 그림에서는 한 줄만 두 화소에 걸쳐 굵게 나오기도 한다): 이 줄의 굵기를 따로 잰다
        const ts = [];
        for (let x = xa + 8; x <= xb - 8; x += 16) {
          let a = yc, b = yc;
          if (!bin[yc * W + x]) continue;
          while (a > 0 && bin[(a - 1) * W + x]) a--;
          while (b < H - 1 && bin[(b + 1) * W + x]) b++;
          ts.push(b - a + 1);
        }
        ts.sort((p, q) => p - q);
        const lineT = ts.length >= 8 ? ts[ts.length >> 2] : st.t;
        const tol = (lineT >= st.t + 2 ? Math.min(lineT, st.t + 3) : st.t) + 1;
        const erased = new Uint8Array(W);
        const segA = new Int32Array(W), segB = new Int32Array(W);
        for (let x = xa; x <= xb; x++) {
          let y = -1;
          for (let d = 0; d <= st.t; d++) {
            if (bin[(yc + d) * W + x]) { y = yc + d; break; }
            if (bin[(yc - d) * W + x]) { y = yc - d; break; }
          }
          if (y < 0) continue;
          let a = y, b = y;
          while (a > 0 && bin[(a - 1) * W + x]) a--;
          while (b < H - 1 && bin[(b + 1) * W + x]) b++;
          if (b - a + 1 > tol) continue;
          // 위·아래(대각선 포함)에서 잉크가 닿으면 남긴다
          const up = (a - 1) * W + x, dn = (b + 1) * W + x;
          if (a > 0 && (bin[up - 1] || bin[up + 1])) continue;
          if (b < H - 1 && (bin[dn - 1] || bin[dn + 1])) continue;
          erased[x] = 1; segA[x] = a; segB[x] = b;
        }
        // 짧은 틈(양 끝이 남은 잉크)은 지우지 않는다
        const maxGap = Math.max(2, Math.round(0.2 * SP));
        let x = xa;
        while (x <= xb) {
          if (!erased[x]) { x++; continue; }
          let e = x;
          while (e + 1 <= xb && erased[e + 1]) e++;
          const inkAt = xx => { for (let d = -st.t; d <= st.t; d++) if (bin[(yc + d) * W + xx]) return true; return false; };
          if (e - x + 1 <= maxGap && x - 1 >= xa && e + 1 <= xb && inkAt(x - 1) && inkAt(e + 1)) {
            for (let k = x; k <= e; k++) erased[k] = 0;
          }
          x = e + 1;
        }
        for (let x2 = xa; x2 <= xb; x2++) if (erased[x2]) for (let k = segA[x2]; k <= segB[x2]; k++) sym[k * W + x2] = 0;
      }
    }
    // 남은 부스러기: 오선 한 줄의 띠 안에만 있는 덩어리는 울퉁불퉁한 오선의 찌꺼기다
    for (const st of staves) {
      const B = Math.ceil(st.t / 2) + 2;
      const xa = Math.max(0, st.xL - 4), xb = Math.min(W - 1, st.xR + 4);
      for (const ly of st.lines) {
        const yc = Math.round(ly);
        const ya = Math.max(0, yc - B - 2), yb = Math.min(H - 1, yc + B + 2);
        const { lab, comps } = components(sym, W, H, xa, ya, xb, yb);
        const kill = new Uint8Array(comps.length);
        let any = false;
        for (let k = 1; k < comps.length; k++) {
          const c = comps[k];
          if (c.y0 >= yc - B && c.y1 <= yc + B && c.w >= 2) { kill[k] = 1; any = true; }
        }
        if (!any) continue;
        for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) { const i = y * W + x; if (kill[lab[i]]) sym[i] = 0; }
      }
    }
    return sym;
  }

  /* 종이 밝기 고르기: 칸마다 밝은 쪽 값을 종이 밝기로 보고 나눈다(그림자·한쪽이 어두운 사진) */
  function flatten(g, W, H) {
    const B = Math.max(12, Math.round(Math.max(W, H) / 64));
    const bw = Math.ceil(W / B), bh = Math.ceil(H / B);
    let bg = new Float32Array(bw * bh);
    const hist = new Uint32Array(256);
    for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
      hist.fill(0);
      let n = 0;
      const y1 = Math.min(H, (by + 1) * B), x1 = Math.min(W, (bx + 1) * B);
      for (let y = by * B; y < y1; y += 2) for (let x = bx * B; x < x1; x += 2) { hist[g[y * W + x]]++; n++; }
      let acc = 0, v = 255;
      for (let i = 255; i >= 0; i--) { acc += hist[i]; if (acc >= 0.2 * n) { v = i; break; } }
      bg[by * bw + bx] = v;
    }
    // 잉크로 덮인 칸은 이웃의 밝은 값을 쓴다
    const pass = (src, fn) => {
      const out = new Float32Array(src.length);
      for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
        const vals = [];
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const yy = Math.min(bh - 1, Math.max(0, y + dy)), xx = Math.min(bw - 1, Math.max(0, x + dx));
          vals.push(src[yy * bw + xx]);
        }
        out[y * bw + x] = fn(vals);
      }
      return out;
    };
    bg = pass(bg, v => Math.max(...v));
    bg = pass(bg, v => v.reduce((a, c) => a + c, 0) / v.length);
    let lo = 255, hi = 0;
    for (const v of bg) { if (v < lo) lo = v; if (v > hi) hi = v; }
    if (hi - lo < 6 && lo > 236) return g; // 이미 고른 이미지
    const out = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      const fy = Math.min(bh - 1, Math.max(0, (y + 0.5) / B - 0.5)), y0 = Math.floor(fy), y1 = Math.min(bh - 1, y0 + 1), wy = fy - y0;
      for (let x = 0; x < W; x++) {
        const fx = Math.min(bw - 1, Math.max(0, (x + 0.5) / B - 0.5)), x0 = Math.floor(fx), x1 = Math.min(bw - 1, x0 + 1), wx = fx - x0;
        const b = (bg[y0 * bw + x0] * (1 - wx) + bg[y0 * bw + x1] * wx) * (1 - wy) + (bg[y1 * bw + x0] * (1 - wx) + bg[y1 * bw + x1] * wx) * wy;
        const v = g[y * W + x] * 250 / Math.max(40, b);
        out[y * W + x] = v > 255 ? 255 : v;
      }
    }
    return out;
  }

  /* 휜 오선 펴기: 세로 띠마다 가로줄의 높이를 이웃 띠와 맞춰 보고, 어긋난 만큼 위아래로 당긴다.
     회전·원근·종이 휨으로 오선이 기울거나 굽은 사진을 곧은 오선으로 만든다. */
  function straighten(g0, W, H, white) {
    const SW = 10 * SP, STEP = 5 * SP, BH = 8 * SP, BSTEP = 4 * SP;
    const nS = Math.max(1, Math.round((W - SW) / STEP) + 1);
    const nB = Math.max(1, Math.round(H / BSTEP) + 1);
    if (nS < 3) return null;
    // 띠 안에서 행마다 어두움을 더한 뒤, 위아래 이웃보다 도드라진 만큼만 남긴다(가로로 긴 선이 봉우리가 된다)
    const prof = [];
    const hp = Math.round(0.5 * SP);
    for (let i = 0; i < nS; i++) {
      const x0 = Math.min(W - SW, Math.round(i * (W - SW) / Math.max(1, nS - 1))), x1 = x0 + SW;
      const p = new Float32Array(H);
      for (let y = 0; y < H; y++) {
        let sum = 0;
        const o = y * W;
        for (let x = x0; x < x1; x++) sum += white - g0[o + x];
        p[y] = Math.max(0, sum / 255);
      }
      const q = new Float32Array(H);
      for (let y = hp; y < H - hp; y++) {
        const base = Math.min(p[y - hp], p[y + hp]);
        q[y] = Math.max(0, p[y] - base);
      }
      prof.push({ p: q, cx: x0 + SW / 2 });
    }
    const D = [], OK = [];
    for (let i = 0; i < nS; i++) { D.push(new Float32Array(nB)); OK.push(new Uint8Array(nB)); }
    const energy = prof.map(o => { let e = 0; for (const v of o.p) e += v; return e; });
    let ref = 0;
    for (let i = 1; i < nS; i++) if (energy[i] > energy[ref]) ref = i;
    for (let b = 0; b < nB; b++) OK[ref][b] = 1;
    const R = Math.round(0.45 * SP);
    const align = (i, j) => {
      const A = prof[i].p, Bp = prof[j].p;
      for (let b = 0; b < nB; b++) {
        const yc = b * BSTEP, ya = Math.max(R + 2, yc - BH), yb = Math.min(H - R - 3, yc + BH);
        const dj = D[j][b];
        // 두 띠 모두 이 구간에 가로줄이 있어야 맞춰 볼 수 있다
        let eA = 0, eB = 0, sA = 0, sB = 0;
        for (let y = ya; y <= yb; y++) {
          const vb = Bp[Math.min(H - 1, Math.max(0, Math.round(y + dj)))], va = A[Math.min(H - 1, Math.max(0, Math.round(y + dj)))];
          eB += vb; eA += va; sB += vb * vb; sA += va * va;
        }
        if (eB < 0.6 * SW || eA < 0.6 * SW) { OK[i][b] = 0; D[i][b] = dj; continue; }
        let best = -1, bd = 0;
        const cs = [];
        for (let d = -R; d <= R; d++) {
          let c = 0;
          for (let y = ya; y <= yb; y++) {
            const yj = Math.round(y + dj), yi = Math.round(y + dj + d);
            if (yj < 0 || yj >= H || yi < 0 || yi >= H) continue;
            c += Bp[yj] * A[yi];
          }
          cs.push(c);
          if (c > best) { best = c; bd = d; }
        }
        if (best <= 0 || best < 0.45 * Math.sqrt(sA * sB)) { OK[i][b] = 0; D[i][b] = dj; continue; }
        // 꼭대기 주변을 포물선으로 맞춰 소수점 자리까지
        const k = bd + R;
        let frac = 0;
        if (k > 0 && k < cs.length - 1) { const den = cs[k - 1] - 2 * cs[k] + cs[k + 1]; if (den < 0) frac = 0.5 * (cs[k - 1] - cs[k + 1]) / den; }
        D[i][b] = dj + bd + Math.max(-0.5, Math.min(0.5, frac));
        OK[i][b] = 1;
      }
      // 이웃 띠와의 어긋남은 높이에 따라 고르게 변한다(회전·원근): 구간별 값에 곧은 선을 맞추고 튀는 값은 버린다
      const val = [];
      for (let b = 0; b < nB; b++) if (OK[i][b]) val.push([b, D[i][b] - D[j][b]]);
      let a0 = 0, slope = 0;
      if (val.length >= 3) {
        const sl = [];
        for (let p = 0; p < val.length; p++) for (let q = p + 1; q < val.length; q++) if (val[q][0] - val[p][0] >= 2) sl.push((val[q][1] - val[p][1]) / (val[q][0] - val[p][0]));
        if (sl.length) { sl.sort((x, y) => x - y); slope = sl[sl.length >> 1]; }
      }
      if (val.length) {
        const ic = val.map(v => v[1] - slope * v[0]).sort((x, y) => x - y);
        a0 = ic[ic.length >> 1];
      }
      for (let b = 0; b < nB; b++) D[i][b] = D[j][b] + a0 + slope * b;
    };
    for (let i = ref + 1; i < nS; i++) align(i, i - 1);
    for (let i = ref - 1; i >= 0; i--) align(i, i + 1);
    let mx = 0;
    for (let i = 0; i < nS; i++) for (let b = 0; b < nB; b++) mx = Math.max(mx, Math.abs(D[i][b]));
    if (mx < 2) return null; // 이 정도 어긋남은 뒤 단계가 견딘다. 괜히 다시 그리면 가는 선만 흐려진다
    const at = (x, y) => {
      let fi = 0;
      if (x <= prof[0].cx) fi = 0; else if (x >= prof[nS - 1].cx) fi = nS - 1;
      else { let i = 0; while (prof[i + 1].cx < x) i++; fi = i + (x - prof[i].cx) / (prof[i + 1].cx - prof[i].cx); }
      const i0 = Math.floor(fi), i1 = Math.min(nS - 1, i0 + 1), wi = fi - i0;
      const fb = Math.min(nB - 1, Math.max(0, y / BSTEP)), b0 = Math.floor(fb), b1 = Math.min(nB - 1, b0 + 1), wb = fb - b0;
      return (D[i0][b0] * (1 - wi) + D[i1][b0] * wi) * (1 - wb) + (D[i0][b1] * (1 - wi) + D[i1][b1] * wi) * wb;
    };
    const warp = g => {
      const out = new Uint8Array(W * H).fill(255);
      for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) {
        const fy = y + at(x, y);
        const y0 = Math.floor(fy), wy = fy - y0;
        if (y0 < 0 || y0 + 1 >= H) continue;
        out[y * W + x] = g[y0 * W + x] * (1 - wy) + g[(y0 + 1) * W + x] * wy;
      }
      return out;
    };
    // 오선의 평균 기울기(왼쪽 끝 띠에서 오른쪽 끝 띠까지)
    const dl = [];
    for (let b = 0; b < nB; b++) dl.push(D[nS - 1][b] - D[0][b]);
    dl.sort((p, q) => p - q);
    const slope = dl[dl.length >> 1] / (prof[nS - 1].cx - prof[0].cx);
    return { warp, max: mx, slope };
  }

  /* 가로로 밀기: 오선을 수평으로 편 뒤에도 비스듬히 남는 기둥·마디줄을 세운다 */
  function shearX(g, W, H, s) {
    const out = new Uint8Array(W * H).fill(255);
    for (let y = 0; y < H; y++) {
      const dx = s * (y - H / 2), o = y * W;
      for (let x = 0; x < W; x++) {
        const fx = x + dx;
        const x0 = Math.floor(fx), wx = fx - x0;
        if (x0 < 0 || x0 + 1 >= W) continue;
        out[o + x] = g[o + x0] * (1 - wx) + g[o + x0 + 1] * wx;
      }
    }
    return out;
  }

  /* 잡음 줄이기: 종이 바탕의 자글거림을 재서, 심한 만큼만 흐리게 한다(깨끗한 이미지는 그대로) */
  function denoise(g, W, H, white) {
    const res = [];
    for (let y = 2; y < H - 2; y += 5) for (let x = 2 + (y % 3); x < W - 2; x += 5) {
      const i = y * W + x;
      const m = (g[i - 1] + g[i + 1] + g[i - W] + g[i + W]) / 4;
      if (m < white - 40) continue; // 바탕에서만 잰다
      res.push(Math.abs(g[i] - m));
    }
    if (res.length < 100) return { g, noise: 0 };
    res.sort((a, b) => a - b);
    const noise = res[res.length >> 1] * 1.48;
    if (noise < 1.0) return { g, noise };
    const passes = noise < 2.2 ? 1 : 2;
    let cur = g;
    for (let p = 0; p < passes; p++) {
      const tmp = new Float32Array(W * H), out = new Uint8Array(W * H);
      for (let y = 0; y < H; y++) { const o = y * W; for (let x = 0; x < W; x++) tmp[o + x] = (cur[o + Math.max(0, x - 1)] + 2 * cur[o + x] + cur[o + Math.min(W - 1, x + 1)]) / 4; }
      for (let y = 0; y < H; y++) { const o = y * W, a = Math.max(0, y - 1) * W, b = Math.min(H - 1, y + 1) * W; for (let x = 0; x < W; x++) out[o + x] = (tmp[a + x] + 2 * tmp[o + x] + tmp[b + x]) / 4; }
      cur = out;
    }
    return { g: cur, noise };
  }

  function prepare(img) {
    const raw = flatten(toGray(img), img.width, img.height);
    const lv0 = levels(raw);
    const thr0 = lv0.black + (lv0.white - lv0.black) * 0.62;
    const sp0 = estimateSpacing(raw, img.width, img.height, thr0);
    if (!sp0 || sp0 < 4) return { error: '오선을 찾지 못했습니다.' };
    const k = SP / sp0;
    let { g, W, H } = Math.abs(k - 1) < 0.03 ? { g: raw, W: img.width, H: img.height } : resample(raw, img.width, img.height, k);
    const dn = denoise(g, W, H, levels(g).white);
    let g0 = dn.g;
    const lvg0 = levels(g0);
    const rough = () => {
      const gs = sharpen(g0, W, H, 2, SHARP);
      const lv = levels(gs);
      const b = binarize(gs, lv.black + (lv.white - lv.black) * THR);
      addRidges(b, g0, W, H, lvg0);
      return { gs, b, thr: lv.black + (lv.white - lv.black) * THR };
    };
    let r = rough();
    const skew = estimateSkew(r.b, W, H);
    if (Math.abs(skew) > 0.0004) { g0 = shearY(g0, W, H, skew); r = rough(); }
    const st8 = straighten(g0, W, H, lvg0.white);
    if (st8) { g0 = st8.warp(g0); r = rough(); }
    // 사진이 돌아가 있었다면 오선이 기운 만큼 세로선은 반대로 누워 있다
    const lean = -(skew + (st8 ? st8.slope : 0));
    if (Math.abs(lean) >= 0.004) { g0 = shearX(g0, W, H, lean); r = rough(); }
    g = r.gs;
    const bin = r.b;
    const staves = findStaves(bin, W, H);
    bridgeAtLines(bin, W, H, staves);
    const sym = removeStaves(bin, W, H, staves);
    return { g, g0, bin, sym, W, H, staves, scale: k, skew, sp0, bend: st8 ? st8.max : 0, noise: dn.noise, lean };
  }

  function components(mask, W, H, x0, y0, x1, y1) {
    const lab = new Int32Array(W * H);
    const comps = [null];
    const stack = [];
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = y * W + x;
        if (!mask[i] || lab[i]) continue;
        const id = comps.length;
        const c = { id, x0: x, y0: y, x1: x, y1: y, area: 0, sx: 0, sy: 0 };
        lab[i] = id; stack.push(i);
        while (stack.length) {
          const p = stack.pop();
          const px = p % W, py = (p - px) / W;
          c.area++; c.sx += px; c.sy += py;
          if (px < c.x0) c.x0 = px; if (px > c.x1) c.x1 = px;
          if (py < c.y0) c.y0 = py; if (py > c.y1) c.y1 = py;
          for (let dy = -1; dy <= 1; dy++) {
            const ny = py + dy;
            if (ny < y0 || ny > y1) continue;
            for (let dx = -1; dx <= 1; dx++) {
              const nx = px + dx;
              if (nx < x0 || nx > x1) continue;
              const q = ny * W + nx;
              if (mask[q] && !lab[q]) { lab[q] = id; stack.push(q); }
            }
          }
        }
        c.cx = c.sx / c.area; c.cy = c.sy / c.area;
        c.w = c.x1 - c.x0 + 1; c.h = c.y1 - c.y0 + 1;
        comps.push(c);
      }
    }
    return { lab, comps };
  }

  function inkIn(mask, W, H, xa, ya, xb, yb) {
    xa = Math.max(0, Math.round(xa)); ya = Math.max(0, Math.round(ya));
    xb = Math.min(W - 1, Math.round(xb)); yb = Math.min(H - 1, Math.round(yb));
    let n = 0, sx = 0, sy = 0, bx0 = W, bx1 = -1, by0 = H, by1 = -1;
    for (let y = ya; y <= yb; y++) {
      const o = y * W;
      for (let x = xa; x <= xb; x++) if (mask[o + x]) {
        n++; sx += x; sy += y;
        if (x < bx0) bx0 = x; if (x > bx1) bx1 = x;
        if (y < by0) by0 = y; if (y > by1) by1 = y;
      }
    }
    return { n, cx: n ? sx / n : 0, cy: n ? sy / n : 0, x0: bx0, x1: bx1, y0: by0, y1: by1 };
  }

  /* ================= 4. 세로선(기둥·마디줄) ================= */

  function findVLines(bin, sym, W, H) {
    const minLen = Math.round(1.5 * SP);
    const runs = [];
    for (let x = 0; x < W; x++) {
      let run = 0;
      for (let y = 0; y <= H; y++) {
        if (y < H && bin[y * W + x]) { run++; continue; }
        if (run >= minLen) runs.push({ x, y0: y - run, y1: y - 1 });
        run = 0;
      }
    }
    // 이웃한 열끼리 묶기
    const groups = [];
    const open = [];
    for (const r of runs) {
      let g = null;
      for (let i = open.length - 1; i >= 0; i--) {
        const o = open[i];
        if (o.lastX < r.x - 1) continue;
        if (o.lastX === r.x) continue;
        const ov = Math.min(o.y1, r.y1) - Math.max(o.y0, r.y0);
        if (ov >= 0.6 * Math.min(o.y1 - o.y0, r.y1 - r.y0)) { g = o; break; }
      }
      if (!g) { g = { cols: [], y0: r.y0, y1: r.y1, lastX: r.x, best: r }; groups.push(g); open.push(g); }
      g.cols.push(r); g.lastX = r.x;
      if (r.y1 - r.y0 > g.best.y1 - g.best.y0) g.best = r;
      g.y0 = Math.min(g.y0, r.y0); g.y1 = Math.max(g.y1, r.y1);
    }
    const out = [];
    for (const g of groups) {
      const xs = g.cols.map(c => c.x);
      const xa = Math.min(...xs), xb = Math.max(...xs);
      const x = (xa + xb) / 2;
      const y0 = g.best.y0, y1 = g.best.y1;
      // 가로 두께: 오선을 지운 그림에서 여러 행을 재서 중앙값
      const th = [];
      const xc = Math.round(x);
      for (let y = y0 + 2; y <= y1 - 2; y += 2) {
        let a = xc, b = xc;
        if (!sym[y * W + xc]) { if (sym[y * W + xc - 1]) a = b = xc - 1; else if (sym[y * W + xc + 1]) a = b = xc + 1; else { th.push(0); continue; } }
        while (a > 0 && sym[y * W + a - 1]) a--;
        while (b < W - 1 && sym[y * W + b + 1]) b++;
        th.push(b - a + 1);
      }
      th.sort((a, b) => a - b);
      const med = th.length ? th[th.length >> 1] : 0;
      const p25 = th.length ? th[th.length >> 2] : 0;
      out.push({ x, xa, xb, y0, y1, len: y1 - y0 + 1, thick: med, thin25: p25, cols: xb - xa + 1 });
    }
    return out;
  }

  /* ================= 5. 채워진 머리(침식) ================= */

  function halfRuns(bin, W, H) {
    const hr = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      const o = y * W;
      let x = 0;
      while (x < W) {
        if (!bin[o + x]) { x++; continue; }
        let e = x;
        while (e + 1 < W && bin[o + e + 1]) e++;
        for (let k = x; k <= e; k++) { const v = Math.min(k - x, e - k) + 1; hr[o + k] = v > 255 ? 255 : v; }
        x = e + 1;
      }
    }
    return hr;
  }

  function erodeDisk(bin, hr, W, H, r) {
    const hw = [];
    for (let dy = -r; dy <= r; dy++) hw.push(Math.floor(Math.sqrt(r * r - dy * dy)));
    const out = new Uint8Array(W * H);
    for (let y = r; y < H - r; y++) {
      const o = y * W;
      for (let x = r; x < W - r; x++) {
        if (hr[o + x] <= r) continue;
        let ok = true;
        for (let dy = -r; dy <= r; dy++) { if (hr[o + dy * W + x] <= hw[dy + r]) { ok = false; break; } }
        if (ok) out[o + x] = 1;
      }
    }
    return out;
  }


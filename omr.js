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

  const OMR = { SP, prepare, analyze, recognize, toText, components, inkIn, findVLines, halfRuns, erodeDisk };
  if (typeof module !== 'undefined' && module.exports) module.exports = OMR;
  else root.OMR = OMR;
})(typeof self !== 'undefined' ? self : this);

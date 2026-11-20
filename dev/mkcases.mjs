import { init, done, render, randomScore, dyadScore, twoVoiceScore, choirScore, addSlurs } from './gen.mjs';
import fs from 'fs';
const set = process.argv[2] || 'A';
await init();
fs.mkdirSync('cases/' + set, { recursive: true });
const fonts = ['Leipzig', 'Bravura', 'Leland', 'Gootville', 'Petaluma'];
let n = 0;
const mk = async (name, seed, sopt, ropt) => {
  const s = randomScore(seed, sopt);
  const pages = await render(s, `cases/${set}/${name}.png`, ropt);
  n++;
  if (pages > 1) console.log('여러 쪽:', name);
};
if (set === 'A') {
  // 기본: 한 줄 가락, 글꼴·크기·박자·조 다양하게
  let seed = 100;
  for (const font of fonts) {
    for (const [scale, dsf] of [[40, 1], [55, 1], [80, 1], [50, 2]]) {
      for (const level of ['easy', 'mid']) {
        seed++;
        await mk(`${font}_s${scale}x${dsf}_${level}_${seed}`, seed, { bars: 16, level, repeats: seed % 3 === 0 }, { font, scale, dsf });
      }
    }
  }
}
if (set === 'B') {
  // 두 성부(오선 두 줄)
  let seed = 500;
  for (const font of ['Leipzig', 'Leland', 'Bravura']) {
    for (const [scale, dsf] of [[45, 1], [60, 1], [50, 2]]) {
      for (const barThru of [false, true]) {
        seed++;
        await mk(`${font}_s${scale}x${dsf}_${barThru ? 'thru' : 'sep'}_${seed}`, seed, { bars: 12, level: seed % 2 ? 'easy' : 'mid', parts: 2 }, { font, scale, dsf, barThru, brace: barThru });
      }
    }
  }
}
if (set === 'C') {
  // 임시표 집중: 올림→제자리, 내림→제자리
  for (const font of fonts) for (const scale of [40, 55, 80]) {
    const bars = [];
    for (let b = 0; b < 8; b++) {
      const s1 = [1, 4, 6, 8, 3, 5, 0, 9][b], s2 = [5, 2, 9, 3, 7, 1, 4, 6][b];
      bars.push({ ev: [{ s: s1, alt: 1, d: 1 }, { s: s1, alt: 0, d: 1 }, { s: s2, alt: -1, d: 1 }, { s: s2, alt: 0, d: 1 }] });
    }
    await render({ meter: [4, 4], fifths: 0, parts: [{ bars }] }, `cases/C/${font}_s${scale}.png`, { font, scale }); n++;
  }
}
if (set === 'D') {
  // 쉼표·온음표·2분음표 집중
  for (const font of fonts) for (const scale of [40, 55, 80]) {
    const bars = [];
    for (let b = 0; b < 4; b++) bars.push({ ev: [{ rest: true, d: 1 }, { rest: true, d: 0.5 }, { rest: true, d: 0.25 }, { rest: true, d: 0.25 }, { s: 4 + b, alt: 0, d: 2 }] });
    for (let b = 0; b < 8; b++) bars.push({ ev: [{ s: [-2, -1, 0, 1, 2, 3, 6, 7][b], alt: 0, d: 4 }] });
    for (let b = 0; b < 4; b++) bars.push({ ev: [{ s: [-1, 0, 1, 2][b], alt: 0, d: 2 }, { s: [5, 6, 7, 8][b], alt: 0, d: 2 }] });
    bars.push({ ev: [{ rest: true, d: 2 }, { rest: true, d: 2 }] }, { ev: [{ rest: true, d: 4 }] }, { ev: [{ s: 3, alt: 0, d: 3 }, { rest: true, d: 1 }] });
    await render({ meter: [4, 4], fifths: 0, parts: [{ bars }] }, `cases/D/${font}_s${scale}.png`, { font, scale }); n++;
  }
}
if (set === 'E') {
  // 한 기둥에 두 음(같은 리듬의 2부)
  let seed = 700;
  for (const font of ['Leipzig', 'Leland', 'Bravura']) for (const [scale, dsf] of [[50, 1], [70, 1], [50, 2]]) for (const level of ['easy', 'mid']) {
    seed++;
    const sc = dyadScore(seed, { bars: 12, level });
    await render(sc, `cases/E/${font}_s${scale}x${dsf}_${level}_${seed}.png`, { font, scale, dsf }); n++;
  }
}
if (set === 'F') {
  // 한 오선에 두 성부(기둥 방향으로 구분)
  let seed = 800;
  for (const font of ['Leipzig', 'Leland', 'Bravura']) for (const [scale, dsf] of [[50, 1], [70, 1], [50, 2]]) for (const level of ['easy', 'mid']) {
    seed++;
    const sc = twoVoiceScore(seed, { bars: 12, level, pRest: 0.05 });
    await render(sc, `cases/F/${font}_s${scale}x${dsf}_${level}_${seed}.png`, { font, scale, dsf }); n++;
  }
}
if (set === 'G') {
  // 높은음자리표 + 낮은음자리표
  let seed = 900;
  for (const font of ['Leipzig', 'Leland', 'Bravura']) for (const [scale, dsf] of [[50, 1], [70, 1]]) {
    seed++;
    const sc = randomScore(seed, { bars: 12, level: seed % 2 ? 'easy' : 'mid', parts: 2 });
    sc.parts[1].clef = 'F';
    for (const b of sc.parts[1].bars) for (const e of b.ev) if (!e.rest) e.s -= 12;
    await render(sc, `cases/G/${font}_s${scale}x${dsf}_${seed}.png`, { font, scale, dsf, barThru: true, brace: true }); n++;
  }
}
if (set === 'H') {
  // 노래 악보: 가사, 코드 이름, 빠르기말, 셈여림, 이음줄
  let seed = 1000;
  for (const font of ['Leipzig', 'Leland', 'Bravura']) for (const [scale, dsf] of [[50, 1], [70, 1], [50, 2]]) for (const level of ['easy', 'mid']) {
    seed++;
    const sc = randomScore(seed, { bars: 12, level });
    await render(sc, `cases/H/${font}_s${scale}x${dsf}_${level}_${seed}.png`, { font, scale, dsf, song: true }); n++;
  }
}
if (set === 'S') {
  // 이음줄이 있는 가락(절반은 가사도 있음)
  let seed = 1100;
  for (const font of ['Leipzig', 'Leland', 'Bravura']) for (const [scale, dsf] of [[50, 1], [70, 1], [50, 2]]) for (const level of ['easy', 'mid']) {
    seed++;
    const sc = addSlurs(randomScore(seed, { bars: 12, level }), seed, 0.6);
    await render(sc, `cases/S/${font}_s${scale}x${dsf}_${level}_${seed}.png`, { font, scale, dsf, song: seed % 2 === 0 }); n++;
  }
}
if (set === 'KH') {
  // 머리가 오선 칸보다 큰 악보체(찬양 악보에 흔함): 작은 해상도 포함, 절반은 가사·코드 이름도 있음
  let seed = 1200;
  for (const font of ['Leipzig', 'Leland', 'Bravura']) for (const [scale, dsf] of [[45, 1], [70, 1], [50, 2], [85, 1]]) for (const hs of [1.35, 1.6]) {
    seed++;
    const sc = randomScore(seed, { bars: 12, level: seed % 2 ? 'easy' : 'mid', repeats: seed % 3 === 0 });
    await render(sc, `cases/KH/${font}_s${scale}x${dsf}_h${hs * 100}_${seed}.png`, { font, scale, dsf, song: seed % 4 < 2, headScale: hs, spacingLinear: 0.42 }); n++;
  }
}
if (set === 'T') {
  // 합창 악보: 윗 오선 두 성부 + 낮은음자리표 반주, 마디줄은 오선마다 따로, 절반은 가사 포함
  let seed = 1300;
  for (const font of ['Leipzig', 'Leland', 'Bravura']) for (const [scale, dsf] of [[45, 1], [50, 1], [70, 1]]) for (const level of ['easy', 'mid']) {
    seed++;
    const sc = choirScore(seed, { bars: 12, level, pRest: 0.05 });
    await render(sc, `cases/T/${font}_s${scale}x${dsf}_${level}_${seed}.png`, { font, scale, dsf, barThru: false, song: seed % 2 === 0 }); n++;
  }
}
await done();
console.log(set, n, 'cases');

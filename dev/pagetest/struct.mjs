import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const browser = await chromium.launch({ ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}), args: ['--autoplay-policy=no-user-gesture-required'] });
const errs = [];
const ctx = await browser.newContext({ viewport: { width: 1100, height: 800 }, acceptDownloads: true });
const page = await ctx.newPage();
page.on('pageerror', e => errs.push(e.message));
page.on('console', m => { if (m.type() === 'error' && !/fonts\.googleapis|ERR_/.test(m.text())) errs.push(m.text()); });
await page.goto(new URL('../../index.html', import.meta.url).href);
await page.waitForTimeout(300);
const body = async () => (await page.evaluate(() => document.getElementById('src').value)).split('\n').filter(l => !/^(제목|빠르기)/.test(l)).join(' / ');
const setSong = async t => { if (await page.locator('#io').isHidden()) await page.click('#tgIo'); await page.fill('#src', t); await page.click('#xApply'); await page.waitForTimeout(200); };
const vis = () => page.evaluate(() => [...document.querySelectorAll('.foot .bar')].filter(b => !b.hidden).map(b => b.id).join(','));
await setSong("제목 시험\n박자 4/4\n빠르기 200\n도 레 미 파 솔 라 시 도' | 레' 미' 파' 솔' | 도 레 미 파 ||");
await page.click('#tgIo');
await page.click('#mEdit');
console.log('처음', await body(), '| 넘침 표시', await page.evaluate(() => [...document.querySelectorAll('.bn.over')].map(e => e.textContent).join()));
const center = async sel => { const b = await page.locator(sel).first().boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };
// 음 뒤에 마디줄
let [x, y] = await center('.nt[data-n="3"] .hd'); await page.mouse.click(x, y);
await page.click('#eBar'); console.log('파 뒤에 마디줄 →', await body());
// 마디줄 고르기 → 도돌이·괄호
[x, y] = await center('.bhit[data-b="2"]'); await page.mouse.click(x, y);
console.log('마디줄 고름, 아래 막대:', await vis());
await page.click('#bRepEnd'); console.log('도돌이 끝 →', await body());
[x, y] = await center('.bhit[data-b="0"]'); await page.mouse.click(x, y); await page.click('#bRepStart'); console.log('맨 앞 도돌이 시작 →', await body());
[x, y] = await center('.bhit[data-b="1"]'); await page.mouse.click(x, y); await page.click('#bV1'); console.log('둘째 마디 1번 괄호 →', await body());
[x, y] = await center('.bhit[data-b="2"]'); await page.mouse.click(x, y); await page.click('#bV2'); console.log('셋째 마디 2번 괄호 →', await body());
[x, y] = await center('.bhit[data-b="3"]'); await page.mouse.click(x, y); await page.click('#bDel'); console.log('셋째 마디줄 지우기 →', await body());
await page.keyboard.press('Control+z'); console.log('되돌리기 →', await body());
// 박자·조표
[x, y] = await center('.hhit[data-hdr="time"]'); await page.mouse.click(x, y);
console.log('박자표 고름:', await vis()); await page.click('button[data-ts="3/4"]'); console.log('3/4 →', await body(), '|', await page.evaluate(() => [...document.querySelectorAll('.bn.over,.bn.lack')].map(e => e.textContent).join(', ')));
await page.click('button[data-ts="4/4"]');
[x, y] = await center('.hhit[data-hdr="key"]'); await page.mouse.click(x, y);
console.log('조표 고름:', await vis());
const ys0 = await page.evaluate(() => [...document.querySelectorAll('.nt .hd')].slice(0, 6).map(e => +e.getAttribute('cy')));
await page.click('#kUp'); console.log('♯ 하나 →', await body(), '| 표시', await page.evaluate(() => document.getElementById('kVal').textContent));
const ys1 = await page.evaluate(() => [...document.querySelectorAll('.nt .hd')].slice(0, 6).map(e => +e.getAttribute('cy')));
const y0a = await page.evaluate(() => +document.querySelector('.st').getAttribute('y1'));
console.log('머리의 줄·칸 자리 유지:', JSON.stringify(ys0.map((v, i) => Math.round(v - ys0[0]) === Math.round(ys1[i] - ys1[0]))));
await page.click('#kDn');
// 겹음과 머리 지우기
[x, y] = await center('.nt[data-n="0"] .hd'); await page.mouse.click(x, y);
await page.click('#eChord'); console.log('겹음 →', await body());
await page.keyboard.press('Delete'); console.log('얹은 음 지우기 →', await body());
// 제목
await page.click('#title'); await page.keyboard.press('Control+a'); await page.keyboard.type('새 제목'); await page.keyboard.press('Enter');
console.log('제목 →', (await page.evaluate(() => document.getElementById('src').value)).split('\n')[0], '/', await page.evaluate(() => document.getElementById('title').textContent));
await page.screenshot({ path: 'struct1.png', clip: { x: 0, y: 0, width: 1100, height: 300 } });
// 재생 차례 확인(도돌이·괄호가 먹는지)
await page.click('#mListen');
await page.click('#play');
const seen = [];
for (let i = 0; i < 70; i++) { await page.waitForTimeout(60); const on = await page.evaluate(() => [...document.querySelectorAll('.nt.on')].map(e => +e.dataset.n)); for (const n of on) if (seen[seen.length - 1] !== n) seen.push(n); }
console.log('재생 차례', seen.join(' '));
// 내보내기
await page.click('#tgIo');
for (const [id, name] of [['#xXml', 'out.musicxml'], ['#xMidi', 'out.mid']]) { const [d] = await Promise.all([page.waitForEvent('download'), page.click(id)]); await d.saveAs(os.tmpdir() + '/' + name); console.log('받음', d.suggestedFilename(), fs.statSync(os.tmpdir() + '/' + name).size + '바이트'); }
await page.screenshot({ path: 'struct2.png', clip: { x: 0, y: 0, width: 1100, height: 260 } });
console.log('errors', JSON.stringify(errs));
await browser.close();

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const browser = await chromium.launch({ ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}), args: ['--autoplay-policy=no-user-gesture-required'] });
const errs = [];
const mk = async (w, h, touch) => { const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: !!touch }); const page = await ctx.newPage(); page.on('pageerror', e => errs.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !/fonts\.googleapis|ERR_/.test(m.text())) errs.push(m.text()); }); await page.goto(new URL('../../index.html', import.meta.url).href); await page.waitForTimeout(300); return page; };
const page = await mk(1100, 800);
const txt = () => page.evaluate(() => document.getElementById('src').value.split('\n').slice(3).join(' / '));
const st = () => page.evaluate(() => ({ sel: [...document.querySelectorAll('.nt.sel')].map(e => e.dataset.n), lack: [...document.querySelectorAll('.bn.lack')].map(e => e.textContent), over: [...document.querySelectorAll('.bn.over')].map(e => e.textContent), gaps: document.querySelectorAll('.gap').length, overNotes: document.querySelectorAll('.nt.over').length, pressed: [...document.querySelectorAll('#tools button[aria-pressed="true"]')].map(e => e.textContent) }));
const setSong = async t => { if (await page.locator('#io').isHidden()) await page.click('#tgIo'); await page.fill('#src', t); await page.click('#xApply'); await page.waitForTimeout(300); await page.click('#tgIo'); await page.click('#mEdit'); };
console.log('듣기 상태에서 보이는 아래 버튼', await page.evaluate(() => [...document.querySelectorAll('.foot button')].filter(b => b.offsetParent).map(b => b.textContent).join(' ')));
await setSong("제목 시험\n박자 4/4\n빠르기 200\n도 레 미 파 | 솔 라 시 도' | 레' 미' 파' 솔' ||");
console.log('고치기 상태에서 보이는 아래 버튼', await page.evaluate(() => [...document.querySelectorAll('.foot button')].filter(b => b.offsetParent).map(b => b.textContent).join(' ')));
const box = async n => page.locator(`.nt[data-n="${n}"] .hd`).first().boundingBox();
// 고르기와 끌기
let b = await box(2);
await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down(); await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 - 10, { steps: 4 }); await page.mouse.up();
console.log('미를 두 칸 위로 끌기 →', await txt(), JSON.stringify((await st()).sel));
await page.keyboard.press('ArrowDown'); console.log('아래 화살표 →', await txt());
await page.keyboard.press('Shift+ArrowUp'); console.log('Shift+위 →', await txt(), JSON.stringify((await st()).pressed));
await page.click('#eSharp'); console.log('♯ 다시 눌러 풂 →', await txt());
// 길이: 모자람과 넘침(둘째 마디에서)
b = await box(5); await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
await page.click('button[data-dur="0.5"]'); console.log('8분으로 →', await txt(), JSON.stringify(await st()));
await page.click('button[data-dur="2"]'); await page.click('#eDot'); console.log('점2분으로 →', await txt(), JSON.stringify(await st()));
await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z');
console.log('세 번 되돌림 →', await txt(), JSON.stringify(await st()));
// 빈칸 눌러 채우기
await page.click('button[data-dur="0.5"]');
await page.locator('.gap').first().click({ force: true }); console.log('빈칸 누름 →', await txt(), JSON.stringify(await st()));
// 쉼표, 줄, 추가, 지우기
await page.keyboard.press('KeyR'); console.log('쉼표로 →', await txt());
await page.keyboard.press('KeyR'); console.log('다시 음표로 →', await txt());
await page.keyboard.press('ArrowLeft'); await page.keyboard.press('KeyT'); console.log('앞 음에 줄 →', await txt());
await page.keyboard.press('Enter'); console.log('추가 →', await txt());
await page.keyboard.press('Delete'); console.log('지우기 →', await txt(), JSON.stringify((await st()).sel));
await page.screenshot({ path: 'edit1.png', clip: { x: 0, y: 0, width: 1100, height: 330 } });
await page.screenshot({ path: 'edit1b.png', clip: { x: 0, y: 700, width: 1100, height: 100 } });
// 들어보기와 듣기로 돌아가기
await page.click('#ePlay'); await page.waitForTimeout(500);
console.log('들어보기', await page.evaluate(() => document.getElementById('ePlay').textContent + ' / 밝혀진 음 ' + document.querySelectorAll('.nt.on').length));
await page.click('#ePlay');
await page.click('#mListen');
console.log('듣기로', await page.evaluate(() => [...document.querySelectorAll('.foot button')].filter(b => b.offsetParent).map(b => b.textContent).join(' ')));
await page.click('#tgSound'); console.log('소리 설정 펼침', await page.evaluate(() => [...document.querySelectorAll('#sound .lb')].filter(b => b.offsetParent).map(b => b.textContent).join(' ')));
await page.screenshot({ path: 'edit2.png', clip: { x: 0, y: 640, width: 1100, height: 160 } });
// 사진 읽기: 고친 음 표시(악보 사진 경로를 SCORE_IMAGE 환경 변수로 주었을 때만)
if (process.env.SCORE_IMAGE) {
  await page.setInputFiles('#pick', process.env.SCORE_IMAGE);
  await page.waitForFunction(() => /읽음/.test(document.getElementById('msg').textContent), null, { timeout: 30000 });
  await page.waitForTimeout(300);
  console.log('사진 읽기', await page.evaluate(() => document.getElementById('msg').textContent + ' / 고친 음 표시 ' + document.querySelectorAll('.fxm').length));
}
// 폰: 터치로 고르고 끌기
const ph = await mk(390, 780, true);
await ph.click('#mEdit');
const hb = await ph.locator('.nt[data-n="1"] .hd').first().boundingBox();
const before = await ph.evaluate(() => document.getElementById('src').value);
await ph.touchscreen.tap(hb.x + hb.width / 2, hb.y + hb.height / 2);
await ph.waitForTimeout(100);
const cdp = await ph.context().newCDPSession(ph);
const X = hb.x + hb.width / 2, Y = hb.y + hb.height / 2;
await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: X, y: Y }] });
for (let i = 1; i <= 5; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: X, y: Y - i * 3 }] });
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await ph.waitForTimeout(200);
const after = await ph.evaluate(() => document.getElementById('src').value);
console.log('폰: 고른 음을 위로 끌기 → 바뀜', before !== after, '/ 넘침', await ph.evaluate(() => document.documentElement.scrollWidth > innerWidth), '/ 아래 막대 높이', await ph.evaluate(() => document.querySelector('.foot').offsetHeight));
await ph.screenshot({ path: 'edit3.png' });
console.log('errors', JSON.stringify(errs));
await browser.close();

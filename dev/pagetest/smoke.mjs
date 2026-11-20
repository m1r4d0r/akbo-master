import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const browser = await chromium.launch({ ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}), args: ['--autoplay-policy=no-user-gesture-required'] });
const errs = [];
for (const [name, w, h] of [['wide', 980, 900], ['phone', 390, 800]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  page.on('console', m => { if (m.type() === 'error' && !/fonts\.googleapis|ERR_/.test(m.text())) errs.push(name + ': ' + m.text()); });
  page.on('pageerror', e => errs.push(name + ' pageerror: ' + e.message));
  await page.goto(new URL('../../index.html', import.meta.url).href);
  await page.waitForTimeout(400);
  const info = await page.evaluate(() => ({
    notes: document.querySelectorAll('.nt').length,
    rows: document.querySelectorAll('#score svg').length,
    pipes: document.querySelectorAll('.pipe').length,
    title: document.getElementById('title').textContent,
    msg: document.getElementById('msg').textContent,
    overflowX: document.documentElement.scrollWidth > innerWidth
  }));
  console.log(name, JSON.stringify(info));
  await page.screenshot({ path: `${name}.png`, fullPage: true });
  if (name === 'wide') {
    await page.click('#play');
    await page.waitForTimeout(2600);
    const p = await page.evaluate(() => ({ btn: document.getElementById('play').textContent, on: document.querySelector('.nt.on')?.dataset.n, pipeOn: document.querySelector('.pipe.on')?.dataset.step }));
    console.log('playing', JSON.stringify(p));
    await page.click('#play');
    await page.click('.nt[data-n="40"]');
    if (await page.locator('#io').isHidden()) await page.click('#tgIo'); await page.fill('#src', '제목 시험\n박자 4/4\n도 레 미x 파# | 솔2 쉼 라/ 시b/ | 도\'4'); await page.click('#xApply'); await page.waitForTimeout(300); await page.click('#tgIo');
    const q = await page.evaluate(() => ({ msg: document.getElementById('msg').textContent, notes: document.querySelectorAll('.nt').length, title: document.getElementById('title').textContent }));
    console.log('edit', JSON.stringify(q));
    await page.screenshot({ path: 'edit.png', fullPage: true });
  }
  await page.close();
}
console.log('errors', JSON.stringify(errs));
await browser.close();

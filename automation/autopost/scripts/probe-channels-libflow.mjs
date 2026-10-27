// 完全复刻 lib 流程，失败时 dump 详情
import { launchBrowser, loadConfig, abs, sleep } from '../lib/common.js';
const cfg = loadConfig().wechat?.channels?.web || {};
const profileDir = abs(cfg.profileDir || 'state/profiles/channels');
const { browser, context } = await launchBrowser({ profileDir, headless: true });
const page = await context.newPage();
page.on('console', (m) => { if (/error|fail|401|403/i.test(m.text())) console.log('PAGE CONSOLE:', m.text().slice(0, 150)); });
await page.goto('https://channels.weixin.qq.com/platform/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await sleep(3000);  // assertNotLogin
console.log('S1 url:', page.url());
for (const t of ['我知道了', '知道了']) { try { await page.getByText(t, { exact: true }).first().click({ timeout: 2000 }); console.log('popup clicked:', t); } catch {} }
const card = page.frames().find(fr => fr.url().includes('post-card'));
console.log('S2 card:', card?.url());
try {
  await card.waitForFunction(() => /已声明原创|已发布|\d{4}年\d{1,2}月\d{1,2}日/.test(document.body.innerText), null, { timeout: 20000, polling: 1000 });
  console.log('S3 list rendered');
} catch { console.log('S3 list render TIMEOUT (ignored)'); }
const t0 = Date.now();
const preheat = 10000 - (Date.now() - t0);
if (preheat > 0) await sleep(preheat);
await sleep(3000);  // assertNotLogin 2
console.log('S4 pre-click url:', page.url());
await card.evaluate(() => {
  const el = [...document.querySelectorAll('button')].find(el => el.textContent.trim() === '发表视频');
  el && el.click();
});
await page.waitForURL(/\/platform\/post\/create/, { timeout: 30000 });
const ed = page.frames().find(fr => fr.url().includes('micro/content/post/create'));
console.log('S5 ed:', ed?.url());
for (let i = 0; i < 8; i++) {
  await sleep(3000);
  if (!ed) { console.log(`t+${(i+1)*3}s: no ed frame; frames=${JSON.stringify(page.frames().map(f => f.url().slice(40, 90)))}`); continue; }
  const d = await ed.evaluate(() => ({
    text: document.body.innerText.replace(/\n+/g, ' | ').slice(0, 200),
    inputs: document.querySelectorAll('input').length,
    files: document.querySelectorAll('input[type=file]').length,
    ready: document.readyState,
    sub: [...document.querySelectorAll('iframe')].map(f => (f.src || '').slice(0, 50)),
  })).catch(e => 'ERR ' + e.message.slice(0, 60));
  console.log(`t+${(i+1)*3}s:`, JSON.stringify(d));
}
await page.screenshot({ path: 'logs/screenshots/channels-libflow.png' });
await browser.close();

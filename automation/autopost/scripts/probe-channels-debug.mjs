import { launchBrowser, loadConfig, abs, sleep } from '../lib/common.js';
const cfg = loadConfig().wechat?.channels?.web || {};
const stateFile = abs(cfg.stateFile || 'state/wechat-channels.json');
const { browser, context } = await launchBrowser({ stateFile, headless: true });
const page = await context.newPage();
await page.goto('https://channels.weixin.qq.com/platform/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(5000);
for (const t of ['我知道了', '知道了']) { try { await page.getByText(t, { exact: true }).first().click({ timeout: 2000 }); } catch {} }
const card = page.frames().find(fr => fr.url().includes('post-card'));
console.log('card url:', card?.url());
await card.waitForFunction(() => /最近视频|发表视频/.test(document.body.innerText), null, { timeout: 30000 });
await sleep(1500);
await card.evaluate(() => {
  const el = [...document.querySelectorAll('button')].find(el => el.textContent.trim() === '发表视频');
  el && el.click();
});
await page.waitForURL(/\/platform\/post\/create/, { timeout: 30000 });
console.log('navigated to:', page.url());
const ed = page.frames().find(fr => fr.url().includes('micro/content/post/create'));
console.log('ed url:', ed?.url());
for (let i = 0; i < 6; i++) {
  await sleep(3000);
  const dump = await ed.evaluate(() => ({
    text: document.body.innerText.replace(/\n+/g, ' | ').slice(0, 300),
    inputs: document.querySelectorAll('input').length,
    files: document.querySelectorAll('input[type=file]').length,
    readyState: document.readyState,
    iframes: [...document.querySelectorAll('iframe')].map(f => (f.src || '').slice(0, 60)),
  })).catch(e => 'ERR ' + e.message.slice(0, 80));
  console.log(`t+${(i + 1) * 3}s:`, JSON.stringify(dump));
}
await page.screenshot({ path: 'logs/screenshots/channels-debug.png' });
await browser.close();

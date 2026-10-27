// 验证：弹层点击是否破坏编辑器加载
import { launchBrowser, loadConfig, abs, sleep } from '../lib/common.js';
const cfg = loadConfig().wechat?.channels?.web || {};
const profileDir = abs(cfg.profileDir || 'state/profiles/channels');
const round = process.argv[2] || '1';
const { browser, context } = await launchBrowser({ profileDir, headless: true });
const page = await context.newPage();
await page.goto('https://channels.weixin.qq.com/platform/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await sleep(3000);
// 与 lib 完全相同的关弹层代码
let clicked = [];
for (const t of ['我知道了', '知道了']) {
  try {
    await page.getByText(t, { exact: true }).first().click({ timeout: 2000 });
    clicked.push(t);
  } catch {}
}
console.log(`round${round} popup clicked: ${JSON.stringify(clicked)}`);
const card = page.frames().find(fr => fr.url().includes('post-card'));
try { await card.waitForFunction(() => /已声明原创|已发布|\d{4}年\d{1,2}月\d{1,2}日/.test(document.body.innerText), null, { timeout: 20000, polling: 1000 }); } catch {}
await sleep(10000);
await card.evaluate(() => {
  const el = [...document.querySelectorAll('button')].find(el => el.textContent.trim() === '发表视频');
  el && el.click();
});
await page.waitForURL(/\/platform\/post\/create/, { timeout: 30000 });
await sleep(8000);
const ed = page.frames().find(fr => fr.url().includes('micro/content/post/create'));
const fi = ed ? await ed.evaluate(() => document.querySelectorAll('input[type=file]').length).catch(() => 'ERR') : 'NO_ED_FRAME';
console.log(`round${round} RESULT: edFrame=${!!ed} fileInputs=${fi}`);
await browser.close();

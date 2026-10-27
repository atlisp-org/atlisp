// 对比：同 frame 上 locator vs evaluate 找 file input
import { launchBrowser, loadConfig, abs, sleep } from '../lib/common.js';
const cfg = loadConfig().wechat?.channels?.web || {};
const profileDir = abs(cfg.profileDir || 'state/profiles/channels');
const { browser, context } = await launchBrowser({ profileDir, headless: true });
const page = await context.newPage();
await page.goto('https://channels.weixin.qq.com/platform/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await sleep(12000);
const card = page.frames().find(fr => fr.url().includes('post-card'));
await card.evaluate(() => {
  const el = [...document.querySelectorAll('button')].find(el => el.textContent.trim() === '发表视频');
  el && el.click();
});
await page.waitForURL(/\/platform\/post\/create/, { timeout: 30000 });
// 与 lib 完全相同：waitForFrame
const deadline = Date.now() + 30000;
let ed = null;
while (Date.now() < deadline) {
  ed = page.frames().find((fr) => fr.url().includes('micro/content/post/create'));
  if (ed) break;
  await sleep(500);
}
await sleep(8000);  // 等编辑器渲染完
console.log('ed url:', ed.url());
console.log('locator count:', await ed.locator('input[type=file]').count());
console.log('evaluate count:', await ed.evaluate(() => document.querySelectorAll('input[type=file]').length));
// 逐个 input 看 type 属性
const types = await ed.evaluate(() =>
  [...document.querySelectorAll('input')].map(i => ({ type: i.type, attrType: i.getAttribute('type'), tag: i.tagName.toLowerCase() }))
);
console.log('input types:', JSON.stringify(types));
// 试试其他定位方式
console.log('xpath:', await ed.locator('xpath=//input[@type="file"]').count());
console.log('frame.locator via page:', await page.locator('iframe').filter({ has: ed.locator('body') }).count().catch(() => 'n/a'));
await browser.close();

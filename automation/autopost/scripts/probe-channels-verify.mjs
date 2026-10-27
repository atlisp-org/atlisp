// 验证：首页 post-card 列表 + /platform/post/list 的内容
import { launchBrowser, abs, sleep } from '../lib/common.js';
const { browser, context } = await launchBrowser({ profileDir: abs('state/profiles/channels'), headless: true });
const page = await context.newPage();
await page.goto('https://channels.weixin.qq.com/platform/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await sleep(12000);
if (/login\.html/i.test(page.url())) { console.log('SESSION DEAD'); await browser.close(); process.exit(0); }
const card = page.frames().find((fr) => fr.url().includes('post-card'));
if (card) {
  const t = await card.evaluate(() => document.body.innerText.slice(0, 1500)).catch(() => 'ERR');
  console.log('===== post-card =====');
  console.log(t);
} else console.log('no post-card frame');
// 作品列表页
await page.goto('https://channels.weixin.qq.com/platform/post/list', { waitUntil: 'domcontentloaded', timeout: 60000 });
await sleep(10000);
const body = await page.evaluate(() => document.body.innerText.slice(0, 2000)).catch(() => 'ERR');
console.log('===== /platform/post/list =====');
console.log(body);
await browser.close();

// 诊断：点「发表」后页面状态——弹窗/按钮/错误提示
import { launchBrowser, loadConfig, abs, sleep } from '../lib/common.js';
const fs = await import('node:fs');
const path = await import('node:path');
const cfg = loadConfig().wechat?.channels?.web || {};
const profileDir = abs(cfg.profileDir || 'state/profiles/channels');
const { browser, context } = await launchBrowser({ profileDir, headless: true });
const page = await context.newPage();
await page.goto('https://channels.weixin.qq.com/platform/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await sleep(12000);
if (/login\.html/i.test(page.url())) { console.log('SESSION DEAD'); await browser.close(); process.exit(0); }
const card = page.frames().find(fr => fr.url().includes('post-card'));
await card.evaluate(() => {
  const el = [...document.querySelectorAll('button')].find(el => el.textContent.trim() === '发表视频');
  el && el.click();
});
await page.waitForURL(/\/platform\/post\/create/, { timeout: 30000 });
await sleep(10000);
const ed = page.frames().find(fr => fr.url().includes('micro/content/post/create'));
// 上传
const videoAbs = abs('media/test-channels-dryrun.mp4');
const b64 = fs.readFileSync(videoAbs).toString('base64');
await ed.evaluate(([b64, name]) => {
  const bin = atob(b64); const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const file = new File([bytes], name, { type: 'video/mp4', lastModified: Date.now() });
  const input = document.querySelector('input[type=file]');
  const dt = new DataTransfer(); dt.items.add(file);
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}, [b64, path.basename(videoAbs)]);
await sleep(25000); // 等上传+转码
// 填标题
await ed.evaluate((t) => {
  const el = document.querySelector('input[placeholder*="短标题"]');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(el, t);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}, '测试视频-请忽略');
// 点「发表」
await ed.evaluate(() => {
  const el = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '发表');
  console.log('pub disabled before click:', el && el.disabled);
  el && el.click();
});
// 15 秒后 dump 状态
await sleep(15000);
console.log('URL:', page.url());
const dump = await ed.evaluate(() => {
  const pick = (el) => ({ cls: el.className && el.className.toString().slice(0, 80), text: (el.innerText || '').replace(/\n+/g, ' | ').slice(0, 120) });
  const modalish = [...document.querySelectorAll('[class*="modal"], [class*="mask"], [class*="dialog"], [class*="toast"], [class*="tip"], [class*="notice"], [class*="alert"]')]
    .filter((el) => el.offsetParent !== null || getComputedStyle(el).display !== 'none')
    .slice(0, 8).map(pick);
  const btns = [...document.querySelectorAll('button')].slice(0, 20).map((b) => ({ t: b.textContent.trim().slice(0, 20), dis: b.disabled }));
  return { modalish, btns, body: document.body.innerText.slice(0, 400).replace(/\n+/g, ' | ') };
}).catch((e) => 'ED EVAL ERR: ' + e.message.slice(0, 120));
console.log('ED DUMP:', JSON.stringify(dump, null, 1));
const mainDump = await page.evaluate(() => {
  const pick = (el) => ({ cls: (el.className || '').toString().slice(0, 80), text: (el.innerText || '').replace(/\n+/g, ' | ').slice(0, 120) });
  const modalish = [...document.querySelectorAll('[class*="modal"], [class*="mask"], [class*="dialog"], [class*="toast"], [class*="tip"]')]
    .filter((el) => getComputedStyle(el).display !== 'none').slice(0, 5).map(pick);
  return { modalish, text: document.body.innerText.slice(0, 300).replace(/\n+/g, ' | ') };
}).catch((e) => 'MAIN EVAL ERR: ' + e.message.slice(0, 120));
console.log('MAIN DUMP:', JSON.stringify(mainDump, null, 1));
await browser.close();

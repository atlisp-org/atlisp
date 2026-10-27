// 诊断：点「发表」→ 弹窗点「不保存」→ 观察 frames/URL/文本变化
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
let ed = page.frames().find(fr => fr.url().includes('micro/content/post/create'));
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
await sleep(25000);
await ed.evaluate(() => {
  const el = document.querySelector('input[placeholder*="短标题"]');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(el, '测试视频-请忽略');
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
});
const showFrames = async (label) => {
  console.log(`--- ${label} ---`);
  console.log('top URL:', page.url());
  for (const fr of page.frames()) console.log('  frame:', fr.url().slice(0, 90));
};
await showFrames('点发表前');
await ed.evaluate(() => {
  const el = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '发表');
  el && el.click();
});
await sleep(6000);
await showFrames('点发表后6s');
// 点「不保存」
const clicked = await ed.evaluate(() => {
  const dlg = document.querySelector('.weui-desktop-dialog, [class*="dialog"]');
  if (!dlg) return 'NO DIALOG';
  const no = [...dlg.querySelectorAll('button')].find((b) => b.textContent.trim() === '不保存');
  if (!no) return 'NO 不保存 BTN, btns=' + [...dlg.querySelectorAll('button')].map(b => b.textContent.trim()).join(',');
  no.click();
  return 'CLICKED 不保存';
}).catch((e) => 'EVAL ERR: ' + e.message.slice(0, 80));
console.log('dialog action:', clicked);
await sleep(12000);
await showFrames('不保存后12s');
const edNow = page.frames().find(fr => fr.url().includes('micro/content/post/create')) || page.frames().find(fr => fr.url().includes('micro'));
if (edNow) {
  const t = await edNow.evaluate(() => document.body.innerText.slice(0, 300).replace(/\n+/g, ' | ')).catch((e) => 'ERR ' + e.message.slice(0, 80));
  console.log('ed frame text:', t);
}
const cardNow = page.frames().find(fr => fr.url().includes('post-card'));
if (cardNow) {
  const t2 = await cardNow.evaluate(() => document.body.innerText.slice(0, 300).replace(/\n+/g, ' | ')).catch((e) => 'ERR ' + e.message.slice(0, 80));
  console.log('post-card text:', t2);
}
await browser.close();

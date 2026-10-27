// 抓 report-error 的 payload + 完整按钮 class + pageerror
import { launchBrowser, loadConfig, abs, sleep } from '../lib/common.js';
const fs = await import('node:fs');
const path = await import('node:path');
const cfg = loadConfig().wechat?.channels?.web || {};
const profileDir = abs(cfg.profileDir || 'state/profiles/channels');
const { browser, context } = await launchBrowser({ profileDir, headless: true });
const page = await context.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push('PAGEERR: ' + (e.message || String(e)).slice(0, 300)));
const reqs = [];
page.on('request', (r) => {
  if (r.url().includes('report-error')) {
    errs.push('REPORT-ERROR payload: ' + (r.postData() || '').slice(0, 1500));
  }
});
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
await ed.evaluate(() => {
  const el = document.querySelector('input[placeholder*="短标题"]');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(el, '测试视频 请忽略');
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
});
await sleep(25000);
// 完整 class
const cls = await ed.evaluate(() => {
  const pub = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '发表');
  return pub ? pub.className : 'NO';
});
console.log('full cls:', JSON.stringify(cls));
// 点「发表」
await ed.evaluate(() => {
  const el = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '发表');
  el && el.click();
});
await sleep(10000);
console.log('ERRORS/REPORTS:', JSON.stringify(errs, null, 1));
const st = await ed.evaluate(() => ({
  url: location.href,
  hasForm: !!document.querySelector('input[type=file]'),
  wrp: document.querySelector('.weui-desktop-dialog__wrp') ? getComputedStyle(document.querySelector('.weui-desktop-dialog__wrp')).display : 'NO',
})).catch((e) => 'ERR ' + e.message.slice(0, 60));
console.log('state:', JSON.stringify(st), 'TOP:', page.url());
await browser.close();

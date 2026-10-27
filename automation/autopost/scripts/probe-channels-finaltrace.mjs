// 6s 视频上传 done 后点「发表」，追踪 40s：网络/console/弹窗/表单
import { launchBrowser, loadConfig, abs, sleep } from '../lib/common.js';
const fs = await import('node:fs');
const path = await import('node:path');
const cfg = loadConfig().wechat?.channels?.web || {};
const profileDir = abs(cfg.profileDir || 'state/profiles/channels');
const { browser, context } = await launchBrowser({ profileDir, headless: true });
const page = await context.newPage();
const reqs = [];
page.on('request', (r) => { const u = r.url(); if (!/\.(png|jpg|jpeg|gif|svg|css|js|woff2?)(\?|$)/.test(u) && !u.includes('mmdata') && !u.includes('static')) reqs.push(`REQ ${r.method()} ${u.slice(0, 120)}`); });
page.on('response', (r) => { const u = r.url(); if (!/\.(png|jpg|jpeg|gif|svg|css|js|woff2?)(\?|$)/.test(u) && !u.includes('mmdata') && !u.includes('static')) reqs.push(`  -> ${r.status()} ${u.slice(0, 100)}`); });
const consoleMsgs = [];
page.on('console', (m) => consoleMsgs.push(m.type() + ': ' + m.text().slice(0, 150)));
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
// 等 done
let up = null;
for (let i = 0; i < 24; i++) {
  await sleep(5000);
  up = await ed.evaluate(() => {
    const input = document.querySelector('input[type=file]');
    let el = input && input.parentElement;
    while (el) { const v = el.__vue__; if (v && v.$options && v.$options.name === 'AUpload') return ((v.$data && v.$data.sFileList) || []).map((f) => ({ s: f.status, p: f.percent })); el = el.parentElement; }
    return null;
  }).catch(() => null);
  if (up && up.length && up[0].s === 'done') break;
}
console.log('upload state:', JSON.stringify(up));
await ed.evaluate(() => {
  const el = document.querySelector('input[placeholder*="短标题"]');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(el, '测试视频 请忽略');
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
});
reqs.length = 0; consoleMsgs.length = 0;
await ed.evaluate(() => {
  const el = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '发表');
  console.log('PUB cls before:', el.className);
  el && el.click();
});
for (let i = 0; i < 8; i++) {
  await sleep(5000);
  const st = await ed.evaluate(() => ({
    url: location.href,
    hasForm: !!document.querySelector('input[type=file]'),
    wrp: document.querySelector('.weui-desktop-dialog__wrp') ? getComputedStyle(document.querySelector('.weui-desktop-dialog__wrp')).display : 'NO',
    toasts: [...document.querySelectorAll('[class*="toast"]')].map(e => (e.innerText||'').trim()).filter(Boolean).join(' ;; ').slice(0, 150),
  })).catch((e) => ({ err: e.message.slice(0, 80) }));
  console.log(`t+${(i+1)*5}s:`, JSON.stringify(st));
  console.log('  NET:', reqs.slice(0, 10).join(' | '));
  reqs.length = 0;
  if (!/post\/create/.test(page.url())) { console.log('TOP LEFT:', page.url()); break; }
}
console.log('CONSOLE:', JSON.stringify(consoleMsgs.filter(m => !m.includes('mmdata')).slice(-12), null, 1));
console.log('TOP:', page.url());
await browser.close();

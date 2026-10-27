// 点「发表」后 60s 所有 POST（含 URL + 响应体前 200）
import { launchBrowser, loadConfig, abs, sleep } from '../lib/common.js';
const fs = await import('node:fs');
const path = await import('node:path');
const cfg = loadConfig().wechat?.channels?.web || {};
const profileDir = abs(cfg.profileDir || 'state/profiles/channels');
const { browser, context } = await launchBrowser({ profileDir, headless: true });
const page = await context.newPage();
let tClick = 0;
const posts = [];
page.on('response', async (r) => {
  if (r.request().method() !== 'POST') return;
  const u = r.url();
  if (u.includes('mmdata') || u.includes('report-perf')) return;
  let b = '';
  try { b = (await r.text()).slice(0, 200); } catch {}
  posts.push(`[${((Date.now() - tClick) / 1000) | 0}s] ${r.status()} ${u.split('?')[0].replace('https://channels.weixin.qq.com', '')} :: ${b.replace(/\n/g, ' ')}`);
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
await ed.evaluate(() => {
  const el = document.querySelector('input[placeholder*="短标题"]');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(el, '测试视频 请忽略');
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
});
posts.length = 0;
tClick = Date.now();
await ed.evaluate(() => {
  const el = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '发表');
  el && el.click();
});
for (let i = 0; i < 12; i++) {
  await sleep(5000);
  if (!/post\/create/.test(page.url())) { console.log('TOP LEFT AT t+' + ((Date.now() - tClick) / 1000 | 0) + 's:', page.url()); break; }
}
console.log('===== ALL POSTS AFTER CLICK =====');
for (const p of posts) console.log(p);
console.log('TOP:', page.url());
await browser.close();

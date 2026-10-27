// dump 发表按钮真实 click handler（fns 数组）源码
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
const card = page.frames().find((fr) => fr.url().includes('post-card'));
await card.evaluate(() => {
  const el = [...document.querySelectorAll('button')].find((el) => el.textContent.trim() === '发表视频');
  el && el.click();
});
await page.waitForURL(/\/platform\/post\/create/, { timeout: 30000 });
await sleep(10000);
const ed = page.frames().find((fr) => fr.url().includes('micro/content/post/create'));
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
console.log('upload:', JSON.stringify(up));
const dump = `() => {
  const out = { buttons: [] };
  const btns = [...document.querySelectorAll('button')];
  for (const b of btns) {
    const r = b.getBoundingClientRect();
    out.buttons.push({ text: (b.textContent || '').trim().slice(0, 20), cls: (b.className || '').toString().slice(0, 80), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) });
  }
  const btn = btns.find((b) => b.textContent.trim() === '发表');
  let depth0 = 0, d = btn, comp = null;
  while (d && depth0 < 10) { if (d.__vue__) { comp = d.__vue__; break; } d = d.parentElement; depth0++; }
  if (comp && comp.$listeners && comp.$listeners.click) {
    const f = comp.$listeners.click.fns;
    const fns = Array.isArray(f) ? f : [f];
    out.fns = fns.map((fn, i) => ({ i, src: String(fn).slice(0, 4000) }));
  }
  return out;
}`;
const r = await ed.evaluate('(' + dump + ')()').catch((e) => ({ err: e.message.slice(0, 500) }));
if (r.err) { console.log('EVAL ERR:', r.err); await browser.close(); process.exit(0); }
console.log('\n===== BUTTONS =====');
for (const b of r.buttons) console.log(JSON.stringify(b));
console.log('\n===== FNS =====');
for (const f of r.fns || []) {
  console.log(`\n--- fn[${f.i}] ---`);
  console.log(f.src);
}
await browser.close();

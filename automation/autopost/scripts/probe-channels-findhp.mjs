// 组件树 DFS 找 handlePost 并 dump 源码
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
const scan = `() => {
  const out = { found: [], total: 0 };
  let depth0 = 0;
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '发表');
  let d = btn, comp = null;
  while (d && depth0 < 10) { if (d.__vue__) { comp = d.__vue__; break; } d = d.parentElement; depth0++; }
  if (!comp) return { err: 'no comp' };
  // 到根
  let root = comp;
  let guard = 0;
  while (root.$parent && guard < 30) { root = root.$parent; guard++; }
  const seen = new Set();
  const stack = [root];
  while (stack.length && out.total < 3000) {
    const c = stack.pop();
    if (seen.has(c)) continue;
    seen.add(c);
    out.total++;
    try {
      const m = c.$options && c.$options.methods;
      if (m && typeof m.handlePost === 'function') {
        out.found.push({
          name: (c.$options.name || c.$options._componentTag || 'anon'),
          depth: out.total,
          src: String(m.handlePost).slice(0, 6000),
        });
      } else if (typeof c.handlePost === 'function' && !(c.$options.methods && c.$options.methods.handlePost)) {
        out.found.push({ name: (c.$options.name || 'anon'), own: true, src: String(c.handlePost).slice(0, 6000) });
      }
    } catch {}
    (c.$children || []).forEach((ch) => stack.push(ch));
  }
  return out;
}`;
const r = await ed.evaluate('(' + scan + ')()').catch((e) => ({ err: e.message.slice(0, 300) }));
console.log('scanned:', r.total, 'found:', (r.found || []).length);
for (const f of r.found || []) {
  console.log(`\n===== component: ${f.name} (own=${f.own || false}) =====`);
  console.log(f.src);
}
await browser.close();

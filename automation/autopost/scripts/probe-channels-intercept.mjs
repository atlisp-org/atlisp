// 验证原创声明拦截：点发表 → 查 visibleOriginalIntercept → 点「直接发表」→ 看 post_create
import { launchBrowser, loadConfig, abs, sleep } from '../lib/common.js';
const fs = await import('node:fs');
const path = await import('node:path');
const cfg = loadConfig().wechat?.channels?.web || {};
const profileDir = abs(cfg.profileDir || 'state/profiles/channels');
const { browser, context } = await launchBrowser({ profileDir, headless: true });
const page = await context.newPage();
const posts = [];
page.on('response', async (r) => {
  if (r.request().method() !== 'POST') return;
  const u = r.url();
  if (u.includes('mmdata') || u.includes('report-perf') || u.includes('helper_report')) return;
  let b = '';
  try { b = (await r.text()).slice(0, 300); } catch {}
  posts.push(`[${new Date().toISOString().slice(11, 19)}] ${r.status()} ${u.split('?')[0].replace('https://channels.weixin.qq.com', '')} :: ${b.replace(/\n/g, ' ')}`);
});
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
// 找 te 组件（仅用于读状态）
const findTe = `() => {
  let depth0 = 0;
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '发表');
  let d = btn, comp = null;
  while (d && depth0 < 10) { if (d.__vue__) { comp = d.__vue__; break; } d = d.parentElement; depth0++; }
  let root = comp, guard = 0;
  while (root.$parent && guard < 30) { root = root.$parent; guard++; }
  const seen = new Set();
  const stack = [root];
  let n = 0;
  while (stack.length && n < 3000) {
    const c = stack.pop();
    if (seen.has(c)) continue;
    seen.add(c); n++;
    try {
      const m = c.$options && c.$options.methods;
      if (m && typeof m.handlePost === 'function' && String(m.handlePost).includes('frontClickPostButton')) { window.__te = c; return true; }
    } catch {}
    (c.$children || []).forEach((ch) => stack.push(ch));
  }
  return false;
}`;
console.log('te found:', await ed.evaluate('(' + findTe + ')()').catch((e) => 'ERR ' + e.message.slice(0, 100)));
posts.length = 0;
await ed.evaluate(() => {
  const el = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '发表');
  el && el.click();
});
// 等 15s：face check + 等 clip + payload 构建
await sleep(15000);
const st1 = await ed.evaluate(() => ({
  visInt: window.__te ? window.__te.visibleOriginalIntercept : 'NO TE',
  onceInt: window.__te ? window.__te.onceOriginalIntercept : 'NO TE',
  isPosting: window.__te ? window.__te.isPosting : 'NO TE',
  visibleBtns: [...document.querySelectorAll('button')].filter((b) => {
    const r = b.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && (b.textContent || '').trim();
  }).map((b) => ({ text: (b.textContent || '').trim().slice(0, 20), x: Math.round(b.getBoundingClientRect().x), y: Math.round(b.getBoundingClientRect().y) })),
})).catch((e) => ({ err: e.message.slice(0, 200) }));
console.log('\n===== 点击发表 15s 后 =====');
console.log(JSON.stringify(st1, null, 1));
// 点「直接发表」（如果可见）
const clicked = await ed.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => {
    const r = b.getBoundingClientRect();
    return (b.textContent || '').trim() === '直接发表' && r.width > 0;
  });
  if (btn) { btn.click(); return true; }
  return false;
}).catch((e) => 'ERR ' + e.message.slice(0, 100));
console.log('\n直接发表 clicked:', clicked);
// 等 30s 看结果
for (let i = 0; i < 6; i++) {
  await sleep(5000);
  if (!/post\/create/.test(page.url())) {
    console.log(`TOP LEFT AT t+${(i + 1) * 5}s:`, page.url());
    break;
  }
}
console.log('\n===== POSTS =====');
for (const x of posts) console.log(x);
const st2 = await ed.evaluate(() => ({
  visInt: window.__te ? window.__te.visibleOriginalIntercept : 'gone',
  isPosting: window.__te ? window.__te.isPosting : 'gone',
})).catch(() => ({ gone: true }));
console.log('\n最终 te 状态:', JSON.stringify(st2));
console.log('TOP:', page.url());
await browser.close();

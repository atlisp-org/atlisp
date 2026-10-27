// 插桩 te.getPostPayload + 记录 isPosting，点发表后看结果
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
  if (u.includes('mmdata') || u.includes('report-perf')) return;
  let b = '';
  try { b = (await r.text()).slice(0, 250); } catch {}
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
// 找 te 组件（handlePost 源码含 frontClickPostButton）并插桩
const patch = `() => {
  const out = {};
  let depth0 = 0;
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '发表');
  let d = btn, comp = null;
  while (d && depth0 < 10) { if (d.__vue__) { comp = d.__vue__; break; } d = d.parentElement; depth0++; }
  let root = comp, guard = 0;
  while (root.$parent && guard < 30) { root = root.$parent; guard++; }
  const seen = new Set();
  const stack = [root];
  let te = null, n = 0;
  while (stack.length && n < 3000) {
    const c = stack.pop();
    if (seen.has(c)) continue;
    seen.add(c); n++;
    try {
      const m = c.$options && c.$options.methods;
      if (m && typeof m.handlePost === 'function' && String(m.handlePost).includes('frontClickPostButton')) { te = c; break; }
    } catch {}
    (c.$children || []).forEach((ch) => stack.push(ch));
  }
  if (!te) return { err: 'te not found' };
  out.isPostingBefore = te.isPosting;
  out.dataKeys = Object.keys(te.$data || {}).length;
  const m = te.$options.methods;
  const origGP = m.getPostPayload;
  out.hasGP = typeof origGP === 'function';
  window.__gplog = null; window.__gperr = null;
  m.getPostPayload = function () {
    window.__isPostingAtGP = te.isPosting;
    return origGP.apply(this, arguments).then((p) => {
      try { window.__gplog = JSON.stringify(p).slice(0, 3000); } catch (e) { window.__gplog = '<unserializable> ' + e.message; }
      return p;
    }, (err) => {
      window.__gperr = String(err && (err.stack || err.message || err)).slice(0, 600);
      throw err;
    });
  };
  // 也记录 optBtns 与 original 拦截条件
  try {
    out.optBtns = JSON.stringify(te.optBtns).slice(0, 300);
    out.canShowOriginalMark = te.canShowOriginalMark;
    out.inCreatorLeisure = te.inCreatorLeisure;
    out.isForIframe = te.isForIframe;
  } catch (e) { out.optErr = e.message; }
  return out;
}`;
const p = await ed.evaluate('(' + patch + ')()').catch((e) => ({ err: e.message.slice(0, 300) }));
console.log('\n===== PATCH =====');
console.log(JSON.stringify(p, null, 1).slice(0, 2500));
posts.length = 0;
await ed.evaluate(() => {
  const el = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '发表');
  el && el.click();
});
for (let i = 0; i < 10; i++) {
  await sleep(4000);
  const st = await ed.evaluate(() => ({
    gp: window.__gplog, gpe: window.__gperr, isP: window.__isPostingAtGP,
  })).catch(() => ({}));
  if (st.gp || st.gpe) {
    console.log(`\n===== t+${(i + 1) * 4}s GP RESULT =====`);
    console.log('isPosting at GP:', st.isP);
    console.log('payload:', st.gp);
    if (st.gpe) console.log('gperr:', st.gpe);
    break;
  }
  if (i === 9) {
    console.log('\n(getPostPayload 从未被调用！isPosting 卡住了？)');
    const st2 = await ed.evaluate(() => ({ isP: window.__isPostingAtGP })).catch(() => ({}));
    console.log('isPosting at GP:', st2.isP);
  }
}
console.log('\n===== POSTS =====');
for (const x of posts) console.log(x);
console.log('TOP:', page.url());
await browser.close();

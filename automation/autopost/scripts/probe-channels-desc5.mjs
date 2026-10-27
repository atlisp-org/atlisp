// DFS 找真 store（有 updatePostDesc 函数）→ 调 updatePostDesc → 验证
import { launchBrowser, loadConfig, abs, sleep } from '../lib/common.js';
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

const fn = `async () => {
  const out = {};
  // 从「发表」按钮到根
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '发表');
  let d = btn, comp = null, depth0 = 0;
  while (d && depth0 < 10) { if (d.__vue__) { comp = d.__vue__; break; } d = d.parentElement; depth0++; }
  let root = comp, guard = 0;
  while (root.$parent && guard < 30) { root = root.$parent; guard++; }
  // DFS 找真 store
  const seen = new Set(), seenObjs = new Set();
  const stack = [root];
  let real = null, n = 0;
  const checkObj = (o) => {
    if (!o || typeof o !== 'object' || seenObjs.has(o)) return;
    seenObjs.add(o);
    try {
      if (typeof o.updatePostDesc === 'function' && o.postObjDesc && typeof o.postObjDesc === 'object') { real = o; }
    } catch {}
  };
  while (stack.length && n < 3000 && !real) {
    const c = stack.pop();
    if (seen.has(c)) continue;
    seen.add(c); n++;
    try {
      for (const v of Object.values(c.$data || {})) checkObj(v);
      for (const v of Object.values(c.$props || {})) checkObj(v);
    } catch {}
    (c.$children || []).forEach((ch) => stack.push(ch));
  }
  out.realFound = !!real;
  if (!real) return { err: 'real store not found', n };
  const getDesc = () => { try { return JSON.stringify(real.postObjDesc.description); } catch (e) { return 'ERR ' + e.message; } };
  out.before = getDesc();
  real.updatePostDesc({ description: '真store测试' });
  await new Promise((r) => setTimeout(r, 200));
  out.after = getDesc();
  out.mpTitle = JSON.stringify(real.postObjDesc.mpTitle);
  // 找 wrapper 的 getCreateOrPreviewParams 验证 payload 源
  const stack2 = [root];
  let wrap = null, n2 = 0, seen2 = new Set();
  while (stack2.length && n2 < 3000 && !wrap) {
    const c = stack2.pop();
    if (seen2.has(c)) continue;
    seen2.add(c); n2++;
    try {
      if (c.$options.methods && typeof c.$options.methods.getCreateOrPreviewParams === 'function') wrap = c;
    } catch {}
    (c.$children || []).forEach((ch) => stack2.push(ch));
  }
  out.wrapperFound = !!wrap;
  if (wrap) {
    try {
      const p = wrap.getCreateOrPreviewParams();
      out.payloadDesc = p && p.objectDesc ? JSON.stringify(p.objectDesc.description) : JSON.stringify(p).slice(0, 200);
      out.payloadTitle = p && p.objectDesc ? JSON.stringify(p.objectDesc.mpTitle) : '?';
    } catch (e) { out.payloadErr = e.message.slice(0, 200); }
  }
  return out;
}`;
const r = await ed.evaluate('(' + fn + ')()').catch((e) => ({ err: e.message.slice(0, 300) }));
console.log(JSON.stringify(r, null, 1).slice(0, 2500));
await browser.close();

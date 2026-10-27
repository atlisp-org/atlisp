// 标题输入：render 绑定 + handleMpTitle 源码 + 填充后对比 combinedStore 与 payload
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

// 1) render 里标题 input 的绑定 + handleMpTitle 源码
const info = await ed.evaluate(`(() => {
  const out = {};
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '发表');
  let d = btn, comp = null;
  while (d && !d.__vue__) d = d.parentElement;
  comp = d && d.__vue__;
  // 向上找有 handleMpTitle 的组件
  let c = comp, guard = 0, hc = null;
  while (c && guard < 15) {
    if (c.$options.methods && typeof c.$options.methods.handleMpTitle === 'function') { hc = c; break; }
    c = c.$parent; guard++;
  }
  if (hc) {
    out.handleMpTitle = String(hc.$options.methods.handleMpTitle).slice(0, 1000);
    const rs = String(hc.$options.render || '');
    const i = rs.indexOf('短标题');
    out.renderAroundTitle = i >= 0 ? rs.slice(Math.max(0, i - 300), i + 300) : 'no 短标题 in render';
  } else out.err = 'handleMpTitle not found';
  return out;
})()`);
console.log('=== handleMpTitle ===');
console.log(info.handleMpTitle || info.err);
console.log('=== render 标题绑定 ===');
console.log(info.renderAroundTitle || '');

// 2) 找 wrapper（payload 源）
await ed.evaluate(`(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '发表');
  let d = btn, comp = null;
  while (d && !d.__vue__) d = d.parentElement;
  comp = d && d.__vue__;
  let root = comp, guard = 0;
  while (root && root.$parent && guard < 30) { root = root.$parent; guard++; }
  const seen = new Set(); const stack = root ? [root] : [];
  let n = 0;
  while (stack.length && n < 4000) {
    const c = stack.pop();
    if (seen.has(c)) continue;
    seen.add(c); n++;
    try { if (c.$options.methods && typeof c.$options.methods.getCreateOrPreviewParams === 'function') { window.__wrap = c; return; } } catch {}
    (c.$children || []).forEach((ch) => stack.push(ch));
  }
})()`);

// 3) 填标题（edFillInput 同款：native setter + input 事件）
await ed.evaluate(`(() => {
  const el = document.querySelector('input[placeholder*="短标题"]');
  el.focus();
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(el, '标题探针甲');
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
})()`);
await sleep(1500);

// 4) 对比：combinedStore getter 实时值 vs payload
const cmp = await ed.evaluate(`(() => {
  const out = {};
  try {
    const cs = window.__wrap.combinedStore;
    out.combinedTitle = JSON.stringify(cs && cs.postObjDesc && cs.postObjDesc.mpTitle);
    out.combinedDesc = JSON.stringify(cs && cs.postObjDesc && cs.postObjDesc.description);
  } catch (e) { out.csErr = e.message.slice(0, 150); }
  try {
    const p = window.__wrap.getCreateOrPreviewParams();
    const d = (p && p.post && p.post.objectDesc) || {};
    out.payloadTitle = JSON.stringify(d.mpTitle);
    out.payloadDesc = JSON.stringify(d.description);
  } catch (e) { out.pErr = e.message.slice(0, 150); }
  return out;
})()`);
console.log('=== 填充后对比 ===');
console.log(JSON.stringify(cmp, null, 1));

await browser.close();

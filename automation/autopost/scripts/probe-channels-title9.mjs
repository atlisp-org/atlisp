// parseShortTitle 直调 + handleBlur 源码 + blur 触发测试
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

const readTitle = async () => ed.evaluate(`(() => {
  try {
    const pp = window.__wrap.getCreateOrPreviewParams();
    return ((pp && pp.post && pp.post.objectDesc) || {}).mpTitle || '';
  } catch (e) { return 'ERR ' + e.message; }
})()`);

const setup = await ed.evaluate(`(() => {
  const out = {};
  const el = document.querySelector('input[placeholder*="填写短标题"]');
  let d = el, m = null, depth = 0;
  while (d && depth < 10) { if (d.__vue__) { m = d.__vue__; break; } d = d.parentElement; depth++; }
  const ncomp = m.$parent;
  window.__n = ncomp;
  out.handleBlur = String(ncomp.$options.methods.handleBlur);
  out.parentName = ncomp.$parent && ncomp.$parent.$options && (ncomp.$parent.$options.name || ncomp.$parent.$options._componentTag);
  return out;
})()`);
console.log('=== n.handleBlur ===');
console.log(setup.handleBlur);
console.log('n 的父组件:', setup.parentName);
console.log('payload title baseline:', JSON.stringify(await readTitle()));

// 1) 填值 + 直调 parseShortTitle
await ed.evaluate(`(() => { window.__n.handleInput('直调辛'); window.__n.parseShortTitle(); })()`);
await sleep(1000);
console.log('handleInput+parseShortTitle 后:', JSON.stringify(await readTitle()));

// 2) 用真实 blur 事件再试一次
await ed.evaluate(`(() => {
  const el = document.querySelector('input[placeholder*="填写短标题"]');
  el.focus();
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(el, 'blur壬');
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.blur();
})()`);
await sleep(1000);
console.log('input 事件 + el.blur() 后:', JSON.stringify(await readTitle()));

await browser.close();

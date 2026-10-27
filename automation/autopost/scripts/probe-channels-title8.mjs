// n.handleInput / parseShortTitle 源码 + a 侧 updateShortTitle 处理 + 运行时直调
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

const r = await ed.evaluate(`(() => {
  const out = {};
  const el = document.querySelector('input[placeholder*="填写短标题"]');
  let d = el, m = null, depth = 0;
  while (d && depth < 10) { if (d.__vue__) { m = d.__vue__; break; } d = d.parentElement; depth++; }
  const ncomp = m.$parent;      // n
  const acomp = ncomp.$parent;   // a
  out.nHandleInput = String(ncomp.$options.methods.handleInput);
  out.nParseShortTitle = String(ncomp.$options.methods.parseShortTitle);
  out.nHandleBlur = String(ncomp.$options.methods.handleBlur).slice(0, 400);
  out.nShortTitle = JSON.stringify(ncomp.shortTitle);
  // a 的 render 里 updateShortTitle 的绑定
  const rs = String(acomp.$options.render || '');
  const i = rs.indexOf('updateShortTitle');
  out.aRender = i >= 0 ? rs.slice(Math.max(0, i - 300), i + 300) : 'not in a render';
  // a 的方法里找处理函数
  const aMethods = Object.keys(acomp.$options.methods || {});
  out.aMethods = aMethods.filter((k) => /short|title|update/i.test(k));
  // 存引用
  window.__n = ncomp; window.__a = acomp;
  return out;
})()`);
console.log('=== n.handleInput ===');
console.log(r.nHandleInput);
console.log('=== n.parseShortTitle ===');
console.log(r.nParseShortTitle);
console.log('=== n.shortTitle 当前 ===', r.nShortTitle);
console.log('=== a render updateShortTitle 绑定 ===');
console.log(r.aRender);
console.log('=== a 相关方法 ===', JSON.stringify(r.aMethods));

// 运行时：直调 n.handleInput（mp-input 会这样调：handleInput(value)）
await ed.evaluate(`(() => { window.__n.handleInput('直调庚'); })()`);
await sleep(1000);
const p1 = await ed.evaluate(`(() => {
  try {
    const pp = window.__wrap.getCreateOrPreviewParams();
    return ((pp && pp.post && pp.post.objectDesc) || {}).mpTitle || '';
  } catch (e) { return 'ERR ' + e.message; }
})()`);
console.log('直调 n.handleInput 后 payload title:', JSON.stringify(p1));
const nstate = await ed.evaluate(`(() => ({ shortTitle: window.__n.shortTitle }))()`);
console.log('n.shortTitle 现在:', JSON.stringify(nstate));
await browser.close();

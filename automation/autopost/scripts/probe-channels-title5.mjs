// a.handleMpTitle 源码 + 直调 + render 里标题 input 的绑定
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
  const el = document.querySelector('input[placeholder*="短标题"]');
  let d = el, m = null, depth = 0;
  while (d && depth < 10) { if (d.__vue__) { m = d.__vue__; break; } d = d.parentElement; depth++; }
  const a = m && m.$parent && m.$parent.$parent; // mp-input → n → a
  out.aName = a && a.$options && (a.$options.name || a.$options._componentTag);
  out.aHasMpTitle = a && typeof (a.$options.methods || {}).handleMpTitle === 'function';
  if (a && a.$options.methods && a.$options.methods.handleMpTitle) {
    out.handleMpTitle = String(a.$options.methods.handleMpTitle);
  }
  // render 里标题 input 的绑定
  if (a) {
    const rs = String(a.$options.render || '');
    const i = rs.indexOf('handleMpTitle');
    out.renderBinding = i >= 0 ? rs.slice(Math.max(0, i - 400), i + 200) : 'handleMpTitle not in render';
  }
  window.__a = a;
  return out;
})()`);
console.log('a 组件名:', r.aName, '有 handleMpTitle:', r.aHasMpTitle);
console.log('=== handleMpTitle 源码 ===');
console.log(r.handleMpTitle || r.aHasMpTitle);
console.log('=== render 绑定 ===');
console.log((r.renderBinding || '').slice(0, 700));

if (r.aHasMpTitle) {
  await sleep(500);
  await ed.evaluate(`(() => { window.__a.handleMpTitle('直调测试己'); })()`);
  await sleep(1000);
  const p = await ed.evaluate(`(() => {
    try {
      const pp = window.__wrap.getCreateOrPreviewParams();
      const d = (pp && pp.post && pp.post.objectDesc) || {};
      return d.mpTitle || '';
    } catch (e) { return 'ERR ' + e.message; }
  })()`);
  console.log('直调后 payload title:', JSON.stringify(p));
}
await browser.close();

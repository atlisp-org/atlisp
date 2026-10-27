// 标题：找 input 所在组件 + 两种输入方式对比 payload
import { launchBrowser, loadConfig, abs, sleep } from '../lib/common.js';
const cfg = loadConfig().wechat?.channels?.web || {};
const profileDir = abs(cfg.profileDir || 'state/profiles/channels');
const { browser, context } = await launchBrowser({ profileDir, headless: true });
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
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

// 1) 标题 input 的组件 + render 绑定
const info = await ed.evaluate(`(() => {
  const el = document.querySelector('input[placeholder*="短标题"]');
  if (!el) return { err: 'no title input' };
  let d = el, comp = null, depth = 0;
  while (d && depth < 10) { if (d.__vue__) { comp = d.__vue__; break; } d = d.parentElement; depth++; }
  const out = { compName: comp && comp.$options && (comp.$options.name || comp.$options._componentTag) };
  if (comp) {
    out.methodKeys = Object.keys(comp.$options.methods || {});
    out.hasMpTitle = typeof (comp.$options.methods || {}).handleMpTitle === 'function';
    const rs = String(comp.$options.render || '');
    const i = rs.indexOf('短标题');
    out.renderAround = i >= 0 ? rs.slice(Math.max(0, i - 250), i + 250) : 'no 短标题 in this render';
  }
  return out;
})()`);
console.log('=== 标题 input 组件 ===');
console.log(JSON.stringify(info, null, 1).slice(0, 2500));

// 2) 找 wrapper
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

const readPayload = async () => ed.evaluate(`(() => {
  try {
    const p = window.__wrap.getCreateOrPreviewParams();
    const d = (p && p.post && p.post.objectDesc) || {};
    return { title: d.mpTitle || '', desc: d.description || '' };
  } catch (e) { return { err: e.message.slice(0, 120) }; }
})()`);
console.log('baseline:', JSON.stringify(await readPayload()));

// 方式A: native setter + input（现用方式）
await ed.evaluate(`(() => {
  const el = document.querySelector('input[placeholder*="短标题"]');
  el.focus();
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(el, '标题甲');
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
})()`);
await sleep(1500);
console.log('after setter+input:', JSON.stringify(await readPayload()));

// 方式B: CDP 真实按键
await ed.evaluate(`(() => {
  const el = document.querySelector('input[placeholder*="短标题"]');
  el.focus();
  document.execCommand('selectAll', false, null);
})()`);
for (const ch of '标题乙') {
  await cdp.send('Input.dispatchKeyEvent', { type: 'char', text: ch });
}
await sleep(1500);
console.log('after CDP char:', JSON.stringify(await readPayload()));
console.log('input value now:', await ed.evaluate(`(() => document.querySelector('input[placeholder*="短标题"]').value)`));

await browser.close();

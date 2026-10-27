// 运行时定位标题链路断点：mp-input 状态 + 父组件 handleInput + 直调
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

// 找 wrapper（payload 源）
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
    return { title: d.mpTitle || '' };
  } catch (e) { return { err: e.message.slice(0, 120) }; }
})()`);

// 1) mp-input 状态 + 祖先链 handleInput
const r1 = await ed.evaluate(`(() => {
  const out = {};
  const el = document.querySelector('input[placeholder*="短标题"]');
  let d = el, m = null, depth = 0;
  while (d && depth < 10) { if (d.__vue__) { m = d.__vue__; break; } d = d.parentElement; depth++; }
  if (!m) return { err: 'no mp-input comp' };
  out.mpInternal = JSON.stringify(m.internalValue);
  out.mpComposing = m.isComposing;
  out.mpDisabled = m.disabled;
  out.mpReadonly = m.readonly;
  // 祖先链：找 handleInput 源码含 updatePostDesc 的组件
  let c = m, n = 0, chain = [];
  while (c && n < 15) {
    const name = c.$options && (c.$options.name || c.$options._componentTag || '?');
    chain.push(name);
    const hi = c.$options.methods && c.$options.methods.handleInput;
    if (hi && String(hi).includes('updatePostDesc')) {
      out.foundAt = n;
      out.foundName = name;
      out.handleInputSrc = String(hi).slice(0, 500);
      out.valueNow = JSON.stringify(c.value);
      window.__titleComp = c;
      break;
    }
    c = c.$parent; n++;
  }
  out.chain = chain;
  return out;
})()`);
console.log('=== 链路定位 ===');
console.log(JSON.stringify(r1, null, 1));

console.log('payload baseline:', JSON.stringify(await readPayload()));

// 2) 直调 titleComp.handleInput
if (r1.foundAt !== undefined) {
  await ed.evaluate(`(() => { window.__titleComp.handleInput('直调测试丁'); })()`);
  await sleep(1000);
  console.log('after 直调 handleInput:', JSON.stringify(await readPayload()));
}

// 3) 再试 DOM input 事件（此时 isComposing 状态？）
await ed.evaluate(`(() => {
  const el = document.querySelector('input[placeholder*="短标题"]');
  el.focus();
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(el, '事件测试戊');
  el.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await sleep(1000);
const r3 = await ed.evaluate(`(() => {
  const el = document.querySelector('input[placeholder*="短标题"]');
  let d = el, m = null, depth = 0;
  while (d && depth < 10) { if (d.__vue__) { m = d.__vue__; break; } d = d.parentElement; depth++; }
  return { composing: m && m.isComposing, internal: m && JSON.stringify(m.internalValue) };
})()`);
console.log('after 事件 input:', JSON.stringify(await readPayload()), 'mp状态:', JSON.stringify(r3));

await browser.close();

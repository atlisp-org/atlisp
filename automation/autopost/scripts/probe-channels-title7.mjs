// 标题 input 的 placeholder + 父组件 n 的 render/监听
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

const r = await ed.evaluate(`(() => {
  const out = {};
  const el = document.querySelector('input[placeholder*="短标题"]');
  out.placeholder = el && el.placeholder;
  out.allInputs = [...document.querySelectorAll('input')].map((i) => i.placeholder || '(none)').join(' | ');
  let d = el, m = null, depth = 0;
  while (d && depth < 10) { if (d.__vue__) { m = d.__vue__; break; } d = d.parentElement; depth++; }
  const ncomp = m && m.$parent;
  out.nName = ncomp && ncomp.$options && (ncomp.$options.name || ncomp.$options._componentTag);
  out.nMethods = ncomp ? Object.keys(ncomp.$options.methods || {}) : [];
  out.nListeners = ncomp ? Object.keys(ncomp.$listeners || {}) : [];
  if (ncomp) {
    const rs = String(ncomp.$options.render || '');
    out.nRender = rs.slice(0, 1800);
  }
  return out;
})()`);
console.log('placeholder:', r.placeholder);
console.log('all inputs:', r.allInputs);
console.log('n 组件:', r.nName, 'methods:', JSON.stringify(r.nMethods), 'listeners:', JSON.stringify(r.nListeners));
console.log('=== n render ===');
console.log(r.nRender);
await browser.close();

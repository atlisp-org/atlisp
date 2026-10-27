// 全树找 handleMpTitle 组件
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
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '发表');
  let d = btn, comp = null;
  while (d && !d.__vue__) d = d.parentElement;
  comp = d && d.__vue__;
  let root = comp, guard = 0;
  while (root && root.$parent && guard < 30) { root = root.$parent; guard++; }
  const seen = new Set(); const stack = root ? [root] : [];
  let n = 0;
  const found = [];
  while (stack.length && n < 5000) {
    const c = stack.pop();
    if (seen.has(c)) continue;
    seen.add(c); n++;
    try {
      const hi = c.$options.methods && c.$options.methods.handleMpTitle;
      if (typeof hi === 'function') {
        const name = c.$options && (c.$options.name || c.$options._componentTag || '?');
        let p = c.$parent, chain = [name], g2 = 0;
        while (p && g2 < 8) { chain.push(p.$options && (p.$options.name || p.$options._componentTag || '?')); p = p.$parent; g2++; }
        found.push({ name, chain, src: String(hi).slice(0, 800) });
      }
    } catch {}
    (c.$children || []).forEach((ch) => stack.push(ch));
  }
  return found;
})()`);
console.log('found handleMpTitle 组件数:', r.length);
for (const f of r) {
  console.log('\n=== 位置链:', f.chain.join(' < '));
  console.log('=== 源码:');
  console.log(f.src);
}
await browser.close();

// DFS 找 feed 组件的删除相关方法（方法名/源码含 delete + post/objectId）
import { launchBrowser, loadConfig, abs, sleep } from '../lib/common.js';
const cfg = loadConfig().wechat?.channels?.web || {};
const profileDir = abs(cfg.profileDir || 'state/profiles/channels');
const { browser, context } = await launchBrowser({ profileDir, headless: true });
const page = await context.newPage();
await page.goto('https://channels.weixin.qq.com/platform/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await sleep(12000);
if (/login\.html/i.test(page.url())) { console.log('SESSION DEAD'); await browser.close(); process.exit(0); }
const card = page.frames().find((fr) => fr.url().includes('post-card'));

const r = await card.evaluate(() => {
  const out = { items: [] };
  const rootEl = document.querySelector('#app') || document.body;
  let root = null, d = rootEl, g = 0;
  while (d && !d.__vue__ && g < 10) { d = d.parentElement; g++; }
  root = d && d.__vue__;
  if (!root) {
    // 从 feed item 向上找
    const it = document.querySelector('div.post-feed-item');
    d = it; g = 0;
    while (d && !d.__vue__ && g < 15) { d = d.parentElement; g++; }
    root = d && d.__vue__;
  }
  if (!root) return { err: 'no root comp' };
  const seen = new Set(); const stack = [root]; let n = 0;
  while (stack.length && n < 6000) {
    const c = stack.pop();
    if (seen.has(c)) continue;
    seen.add(c); n++;
    try {
      const methods = c.$options.methods || {};
      for (const k of Object.keys(methods)) {
        if (/delet|remove|del_/i.test(k)) {
          const src = String(methods[k]).slice(0, 400);
          out.items.push({ name: c.$options.name || c.$options._componentTag || '?', method: k, src });
        }
      }
    } catch {}
    (c.$children || []).forEach((ch) => stack.push(ch));
  }
  return out;
});
console.log('找到 delete 相关方法数:', r.items.length, r.err || '');
for (const it of r.items.slice(0, 15)) {
  console.log(`\n=== ${it.name} . ${it.method} ===`);
  console.log(it.src);
}
await browser.close();

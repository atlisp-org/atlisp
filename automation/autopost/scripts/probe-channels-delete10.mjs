// dump _ 组件（有 openDeleteDialog）的 render 源码，找 click 绑定位置
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
  const it = document.querySelector('div.post-feed-item');
  let d = it, comp = null, g = 0;
  while (d && !d.__vue__ && g < 15) { d = d.parentElement; g++; }
  comp = d && d.__vue__;
  if (!comp) return { err: 'no comp' };
  const rs = String(comp.$options.render || '');
  const out = { renderLen: rs.length };
  for (const key of ['openDeleteDialog', 'action-content', 'opr-item', 'more-action']) {
    const i = rs.indexOf(key);
    out[key] = i >= 0 ? rs.slice(Math.max(0, i - 350), i + 350) : 'NOT FOUND';
  }
  return out;
});
for (const [k, v] of Object.entries(r)) {
  console.log(`\n===== ${k} (len ${r.renderLen}) =====`);
  console.log(String(v).slice(0, 1200));
}
await browser.close();

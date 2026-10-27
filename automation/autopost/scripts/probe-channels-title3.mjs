// mp-input 组件方法源码
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
  const el = document.querySelector('input[placeholder*="短标题"]');
  let d = el, comp = null, depth = 0;
  while (d && depth < 10) { if (d.__vue__) { comp = d.__vue__; break; } d = d.parentElement; depth++; }
  if (!comp) return { err: 'no comp' };
  const out = {};
  for (const k of ['handleInput', 'handleCompositionEnd', 'handleCompositionUpdate', 'filterValue', 'validate', 'emitValidateOk', 'setCurrentValue', 'handleBlur']) {
    const m = comp.$options.methods && comp.$options.methods[k];
    if (typeof m === 'function') out[k] = String(m).slice(0, 900);
  }
  out.propKeys = Object.keys(comp.$props || {});
  out.listenerKeys = Object.keys(comp.$listeners || {});
  return out;
})()`);
for (const [k, v] of Object.entries(r)) {
  console.log(`\n===== ${k} =====`);
  console.log(v);
}
await browser.close();

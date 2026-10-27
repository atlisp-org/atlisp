// parseShortTitle 后读完整 objectDesc（找 shortTitle 数组字段）
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

const dumpDesc = async () => ed.evaluate(`(() => {
  try {
    const pp = window.__wrap.getCreateOrPreviewParams();
    const d = (pp && pp.post && pp.post.objectDesc) || {};
    return { keys: Object.keys(d), shortTitle: JSON.stringify(d.shortTitle), mpTitle: JSON.stringify(d.mpTitle), description: JSON.stringify((d.description || '').slice(0, 30)) };
  } catch (e) { return { err: e.message.slice(0, 150) }; }
})()`);

console.log('baseline objectDesc:', JSON.stringify(await dumpDesc()));

// 填标题 + parseShortTitle
await ed.evaluate(`(() => {
  const el = document.querySelector('input[placeholder*="填写短标题"]');
  let d = el, m = null, depth = 0;
  while (d && depth < 10) { if (d.__vue__) { m = d.__vue__; break; } d = d.parentElement; depth++; }
  const ncomp = m.$parent;
  ncomp.handleInput('标题探针癸');
  ncomp.parseShortTitle();
  return 'done';
})()`);
await sleep(1200);
console.log('parseShortTitle 后 objectDesc:', JSON.stringify(await dumpDesc()));

await browser.close();

// 直接调 comp.handleNodeChange() / updateDescData() 能否把 DOM 文本提交进 store
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

const fn = `async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = {};
  const el = [...document.querySelectorAll('div.input-editor')].find((e) => e.isContentEditable) || document.querySelector('div.input-editor');
  if (!el) return { err: 'no input-editor' };
  let d = el, comp = null, depth0 = 0;
  while (d && depth0 < 10) { if (d.__vue__) { comp = d.__vue__; break; } d = d.parentElement; depth0++; }
  if (!comp) return { err: 'no comp' };
  let c = comp, store = null, depth = 0;
  while (c && depth < 15) {
    try {
      if (c.$props && c.$props.postStore) { store = c.$props.postStore; break; }
      if (c.$data && c.$data.postStore) { store = c.$data.postStore; break; }
    } catch {}
    c = c.$parent; depth++;
  }
  if (!store) return { err: 'no store' };
  const getDesc = () => { try { return JSON.stringify(store.postObjDesc.description); } catch (e) { return 'ERR ' + e.message; } };
  out.before = getDesc();
  // 写 DOM
  el.focus();
  el.textContent = '直接调用测试';
  await wait(200);
  // 调用 handleNodeChange（完整管线）
  comp.handleNodeChange();
  await wait(1200);
  out.afterHNC = getDesc();
  out.text = el.innerText;
  // 看 render 里 handleNodeChange 绑定在什么事件上
  const rs = String(comp.$options.render || '');
  const i = rs.indexOf('handleNodeChange');
  out.renderBinding = i >= 0 ? rs.slice(Math.max(0, i - 200), i + 100) : 'not in render';
  return out;
}`;
const r = await ed.evaluate('(' + fn + ')()').catch((e) => ({ err: e.message.slice(0, 300) }));
console.log(JSON.stringify(r, null, 1).slice(0, 2500));
await browser.close();

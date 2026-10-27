// 逐级定位：updateDescData / store handler / 直接赋值，哪步能让 store 拿到描述
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
  el.focus();
  el.textContent = '逐级测试';
  await wait(200);
  out.dontCheck = comp.dontCheckChange;
  // 1) 直接 updateDescData
  try { comp.updateDescData(); out.step1_threw = false; } catch (e) { out.step1_threw = e.message; }
  await wait(300);
  out.after1 = getDesc();
  // 2) store 上找 updatePostDesc handler
  const names = [...Object.getOwnPropertyNames(store), ...Object.getOwnPropertyNames(Object.getPrototypeOf(store))];
  out.storeMethods = names.filter((n) => /desc|post/i.test(n));
  if (typeof store.updatePostDesc === 'function') {
    try { store.updatePostDesc({ description: el.innerText }); out.step2_threw = false; } catch (e) { out.step2_threw = e.message; }
    await wait(300);
    out.after2 = getDesc();
  }
  // 3) 直接赋值
  store.postObjDesc.description = el.innerText;
  await wait(200);
  out.after3 = getDesc();
  return out;
}`;
const r = await ed.evaluate('(' + fn + ')()').catch((e) => ({ err: e.message.slice(0, 300) }));
console.log(JSON.stringify(r, null, 1).slice(0, 2000));
await browser.close();

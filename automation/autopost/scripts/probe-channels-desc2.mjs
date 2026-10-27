// 单次 evaluate：dump desc 组件 methods + 两种方式输入 + 读 store
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
  const out = {};
  const el = [...document.querySelectorAll('div.input-editor')].find((e) => e.isContentEditable) || document.querySelector('div.input-editor');
  if (!el) return { err: 'no input-editor' };
  // 组件
  let d = el, comp = null, depth0 = 0;
  while (d && depth0 < 10) { if (d.__vue__) { comp = d.__vue__; break; } d = d.parentElement; depth0++; }
  out.methodKeys = comp ? Object.keys(comp.$options.methods || {}) : [];
  // store
  let c = comp, store = null, depth = 0;
  while (c && depth < 15) {
    try {
      if (c.$props && c.$props.postStore) { store = c.$props.postStore; break; }
      if (c.$data && c.$data.postStore) { store = c.$data.postStore; break; }
    } catch {}
    c = c.$parent; depth++;
  }
  out.storeFound = !!store;
  const getDesc = () => { try { return JSON.stringify(store.postObjDesc.description); } catch (e) { return 'ERR ' + e.message; } };
  out.descBefore = getDesc();
  // 找输入处理函数源码
  if (comp) {
    const srcs = {};
    for (const k of Object.keys(comp.$options.methods || {})) {
      if (/input|change|edit|desc|update/i.test(k)) srcs[k] = String(comp.$options.methods[k]).slice(0, 800);
    }
    out.handlerSrcs = srcs;
  }
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  // 方式A: execCommand
  el.focus();
  document.execCommand('selectAll', false, null);
  await wait(100);
  document.execCommand('insertText', false, '测试描述A');
  await wait(800);
  out.afterA = getDesc();
  out.textA = el.innerText;
  // 方式B: textContent + InputEvent
  el.focus();
  el.textContent = '测试描述B';
  el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: '测试描述B' }));
  await wait(800);
  out.afterB = getDesc();
  out.textB = el.innerText;
  // 方式C: 先 focus，再用 execCommand 插入（先清掉 B）
  el.focus();
  document.execCommand('selectAll', false, null);
  await wait(100);
  document.execCommand('insertText', false, '测试描述C');
  await wait(800);
  out.afterC = getDesc();
  out.textC = el.innerText;
  return out;
}`;
const r = await ed.evaluate('(' + fn + ')()').catch((e) => ({ err: e.message.slice(0, 300) }));
console.log(JSON.stringify(r, null, 1).slice(0, 5000));
await browser.close();

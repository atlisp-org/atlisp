// 研究 desc 编辑器：组件绑定方式 + 哪种输入方式能进 store
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

// 找 desc 组件 + store
const info = await ed.evaluate('(' + `() => {
  const out = {};
  const el = [...document.querySelectorAll('div.input-editor')].find((e) => e.isContentEditable) || document.querySelector('div.input-editor');
  if (!el) return { err: 'no input-editor' };
  out.cls = el.className;
  // 向上找 __vue__
  let d = el, comp = null, depth0 = 0;
  while (d && depth0 < 10) { if (d.__vue__) { comp = d.__vue__; break; } d = d.parentElement; depth0++; }
  out.compName = comp && (comp.$options && (comp.$options.name || comp.$options._componentTag));
  if (comp) {
    out.propKeys = Object.keys(comp.$props || {});
    out.listenerKeys = Object.keys(comp.$listeners || {});
    // 找 store
    let c = comp, store = null, depth = 0;
    while (c && depth < 15) {
      try {
        if (c.$props && c.$props.postStore) { store = c.$props.postStore; break; }
        if (c.$data && c.$data.postStore) { store = c.$data.postStore; break; }
      } catch {}
      c = c.$parent; depth++;
    }
    if (store) { window.__store = store; out.storeFound = true; out.desc0 = JSON.stringify(store.postObjDesc && store.postObjDesc.description); }
    else out.storeFound = false;
  }
  return out;
}` + ')()').catch((e) => ({ err: e.message.slice(0, 300) }));
console.log('INFO:', JSON.stringify(info, null, 1));

// 方式A：execCommand insertText
const rA = await ed.evaluate('(' + `() => {
  const el = [...document.querySelectorAll('div.input-editor')].find((e) => e.isContentEditable) || document.querySelector('div.input-editor');
  el.focus();
  document.execCommand('selectAll', false, null);
  const ok = document.execCommand('insertText', false, '测试描述A');
  return { ok, text: el.innerText };
}` + ')()').catch((e) => ({ err: e.message.slice(0, 200) }));
await sleep(1000);
const stA = await ed.evaluate('() => window.__store ? JSON.stringify(window.__store.postObjDesc && window.__store.postObjDesc.description) : "NO STORE"').catch(() => 'ERR');
console.log('方式A (execCommand):', JSON.stringify(rA), '→ store.desc =', stA);

// 方式B：直接 DOM + input 事件（现用方式）
const rB = await ed.evaluate('(' + `() => {
  const el = [...document.querySelectorAll('div.input-editor')].find((e) => e.isContentEditable) || document.querySelector('div.input-editor');
  el.focus();
  el.textContent = '测试描述B';
  el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: '测试描述B' }));
  return { text: el.innerText };
}` + ')()').catch((e) => ({ err: e.message.slice(0, 200) }));
await sleep(1000);
const stB = await ed.evaluate('() => window.__store ? JSON.stringify(window.__store.postObjDesc && window.__store.postObjDesc.description) : "NO STORE"').catch(() => 'ERR');
console.log('方式B (DOM+input):', JSON.stringify(rB), '→ store.desc =', stB);

await browser.close();

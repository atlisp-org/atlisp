// 运行时内省：「发表」按钮组件链 + handler 源码 + store 状态（点击前后各一次）
import { launchBrowser, loadConfig, abs, sleep } from '../lib/common.js';
const fs = await import('node:fs');
const path = await import('node:path');
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
const videoAbs = abs('media/test-channels-dryrun.mp4');
const b64 = fs.readFileSync(videoAbs).toString('base64');
await ed.evaluate(([b64, name]) => {
  const bin = atob(b64); const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const file = new File([bytes], name, { type: 'video/mp4', lastModified: Date.now() });
  const input = document.querySelector('input[type=file]');
  const dt = new DataTransfer(); dt.items.add(file);
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}, [b64, path.basename(videoAbs)]);
let up = null;
for (let i = 0; i < 24; i++) {
  await sleep(5000);
  up = await ed.evaluate(() => {
    const input = document.querySelector('input[type=file]');
    let el = input && input.parentElement;
    while (el) { const v = el.__vue__; if (v && v.$options && v.$options.name === 'AUpload') return ((v.$data && v.$data.sFileList) || []).map((f) => ({ s: f.status, p: f.percent })); el = el.parentElement; }
    return null;
  }).catch(() => null);
  if (up && up.length && up[0].s === 'done') break;
}
console.log('upload:', JSON.stringify(up));

// 内省函数：组件链 + 疑似 publish handler 源码 + store 状态
const introspect = `() => {
  const out = {};
  let depth0 = 0;
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '发表');
  out.btnCls = btn ? btn.className : 'NO BTN';
  let c = null, d = btn;
  while (d && depth0 < 10) { if (d.__vue__) { c = d.__vue__; break; } d = d.parentElement; depth0++; }
  const chain = [];
  let store = null, handlerSrc = null;
  let depth = 0;
  while (c && depth < 15) {
    const name = (c.$options && (c.$options.name || c.$options._componentTag)) || 'anon';
    chain.push(name);
    // 找 postStore
    if (!store) {
      try {
        if (c.$props && c.$props.postStore) store = c.$props.postStore;
        else if (c.$data && c.$data.postStore) store = c.$data.postStore;
      } catch {}
    }
    // 找疑似发表 handler（组件 methods 里名字含 publish/post/submit/create/confirm 的函数）
    if (!handlerSrc && c.$options && c.$options.methods) {
      for (const k of Object.keys(c.$options.methods)) {
        if (/publish|submit|createPost|handlePost|onPublish|confirmPost|doPost/i.test(k)) {
          handlerSrc = handlerSrc || {};
          handlerSrc[name + '.' + k] = String(c.$options.methods[k]).slice(0, 2000);
        }
      }
    }
    c = c.$parent; depth++;
  }
  out.chain = chain;
  if (store) {
    const j = (v) => {
      try { const s = JSON.stringify(v); return s == null ? 'UNDEF' : String(s).slice(0, 500); }
      catch (e) { return 'ERR ' + e.message; }
    };
    out.storeKeys = Object.keys(store).slice(0, 80);
    out.createPostStatus = j(store.createPostStatus);
    out.clipTicket = j(store.clipTicket);
    out.tempPost = j(store.tempPost);
    out.postObjDesc = j(store.postObjDesc);
    out.canPost = store.canPost;
    out.cannotPostWording = store.cannotPostWording;
    out.disabled = store.disabled;
  }
  out.handlers = handlerSrc;
  return out;
}`;
const before = await ed.evaluate('(' + introspect + ')()').catch((e) => ({ err: e.message.slice(0, 200) }));
console.log('\n===== BEFORE CLICK =====');
console.log(JSON.stringify(before, null, 1).slice(0, 6000));

await ed.evaluate(() => {
  const el = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '发表');
  el && el.click();
});
await sleep(30000);
const after = await ed.evaluate('(' + introspect + ')()').catch((e) => ({ err: e.message.slice(0, 200) }));
console.log('\n===== AFTER 30s =====');
console.log(JSON.stringify(after, null, 1).slice(0, 6000));
console.log('TOP:', page.url());
await browser.close();

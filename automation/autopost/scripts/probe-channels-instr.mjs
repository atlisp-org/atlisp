// 插桩：包装 onChange/beforeUpload/onStart/onError，看 change 后的链路
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
const card = page.frames().find(fr => fr.url().includes('post-card'));
await card.evaluate(() => {
  const el = [...document.querySelectorAll('button')].find(el => el.textContent.trim() === '发表视频');
  el && el.click();
});
await page.waitForURL(/\/platform\/post\/create/, { timeout: 30000 });
await sleep(10000);
const ed = page.frames().find(fr => fr.url().includes('micro/content/post/create'));
// 插桩
await ed.evaluate(() => {
  window.__uplog = [];
  const L = (s) => window.__uplog.push(s.slice(0, 300));
  const input = document.querySelector('input[type=file]');
  const ajax = input.parentElement.__vue__;
  if (ajax && ajax.onChange) {
    const orig = ajax.onChange;
    ajax.onChange = function (e) {
      L('AJAX.onChange files=' + (e && e.target ? e.target.files.length : '??'));
      return orig.apply(this, arguments);
    };
  }
  if (ajax && ajax.$props.beforeUpload) {
    const ob = ajax.$props.beforeUpload;
    // 不能直接改 props（可能只读），试试
    try {
      ajax.$props.beforeUpload = function (file) {
        L('beforeUpload(' + (file && file.name) + ' size=' + (file && file.size) + ' type=' + (file && file.type) + ')');
        const r = ob.apply(this, arguments);
        L('beforeUpload => ' + String(r).slice(0, 80));
        return r;
      };
    } catch (e) { L('wrap beforeUpload fail: ' + e.message); }
  }
  // AUpload
  let el = input.parentElement;
  let au = null;
  while (el) {
    const v = el.__vue__;
    if (v && v.$options.name === 'AUpload') { au = v; break; }
    el = el.parentElement;
  }
  if (au) {
    for (const m of ['onStart', 'onSuccess', 'onError', 'onReject', 'onProgress']) {
      if (typeof au[m] === 'function') {
        const orig = au[m];
        au[m] = function (...a) {
          L('AU.' + m + '(' + a.map((x) => (x && x.name ? x.name : typeof x)).join(',') + ')');
          return orig.apply(this, a);
        };
      }
    }
  }
  // 全局 fetch/XHR
  const of = window.fetch;
  window.fetch = function (...a) { L('fetch ' + String(a[0]).slice(0, 120)); return of.apply(this, a); };
  const oo = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (m, u) { L('XHR ' + m + ' ' + String(u).slice(0, 120)); return oo.apply(this, arguments); };
});
// 上传
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
await sleep(15000);
const log = await ed.evaluate(() => window.__uplog).catch((e) => 'ERR ' + e.message.slice(0, 80));
console.log('UPLOAD LOG:');
for (const l of log) console.log(' ', l);
await browser.close();

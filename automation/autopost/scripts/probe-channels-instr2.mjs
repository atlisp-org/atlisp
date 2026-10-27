// 插桩v2：beforeUpload Promise 结果 + 隐藏 video 状态 + wasm 请求
import { launchBrowser, loadConfig, abs, sleep } from '../lib/common.js';
const fs = await import('node:fs');
const path = await import('node:path');
const cfg = loadConfig().wechat?.channels?.web || {};
const profileDir = abs(cfg.profileDir || 'state/profiles/channels');
const { browser, context } = await launchBrowser({ profileDir, headless: true });
const page = await context.newPage();
const consoleMsgs = [];
page.on('console', (m) => consoleMsgs.push(m.type() + ': ' + m.text().slice(0, 150)));
const wasmReqs = [];
page.on('request', (r) => { if (r.url().includes('.wasm')) wasmReqs.push(r.url().slice(0, 120)); });
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
await ed.evaluate(() => {
  window.__uplog = [];
  const L = (s) => window.__uplog.push(String(s).slice(0, 300));
  const input = document.querySelector('input[type=file]');
  const ajax = input.parentElement.__vue__;
  if (ajax && ajax.$props.beforeUpload) {
    const ob = ajax.$props.beforeUpload;
    try {
      ajax.$props.beforeUpload = function (file) {
        L('beforeUpload(' + (file && file.name) + ' size=' + (file && file.size) + ')');
        const r = ob.apply(this, arguments);
        if (r && typeof r.then === 'function') {
          r.then(
            (v) => L('RESOLVED: ' + JSON.stringify(v, (k, x) => (typeof x === 'function' ? '[fn]' : x)).slice(0, 250)),
            (e) => L('REJECTED: ' + String(e && (e.stack || e.message || e)).slice(0, 300)),
          );
        } else L('=> ' + String(r));
        return r;
      };
    } catch (e) { L('wrap fail: ' + e.message); }
  }
});
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
for (let i = 0; i < 12; i++) {
  await sleep(5000);
  const st = await ed.evaluate(() => {
    const v = document.querySelector('video');
    return {
      uplog: (window.__uplog || []).slice(),
      video: v ? {
        src: (v.currentSrc || v.src || '').slice(-50), ready: v.readyState, net: v.networkState,
        err: v.error ? v.error.code : null, dur: v.duration, w: v.videoWidth, h: v.videoHeight,
      } : 'NO video',
    };
  }).catch((e) => ({ err: e.message.slice(0, 80) }));
  if (st.err) { console.log(`t+${(i + 1) * 5}s ERR`, st.err); continue; }
  console.log(`t+${(i + 1) * 5}s uplog=${st.uplog.length} video=${JSON.stringify(st.video)}`);
  for (const l of st.uplog) console.log('   ', l);
}
console.log('WASM reqs:', JSON.stringify(wasmReqs));
console.log('CONSOLE last15:', JSON.stringify(consoleMsgs.slice(-15), null, 1));
await browser.close();

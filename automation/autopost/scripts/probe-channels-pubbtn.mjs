// 诊断「发表」按钮：disabled 状态 / 点击后网络(含GET) / console / 瞬态 toast
import { launchBrowser, loadConfig, abs, sleep } from '../lib/common.js';
const fs = await import('node:fs');
const path = await import('node:path');
const cfg = loadConfig().wechat?.channels?.web || {};
const profileDir = abs(cfg.profileDir || 'state/profiles/channels');
const { browser, context } = await launchBrowser({ profileDir, headless: true });
const page = await context.newPage();
const net = [];
page.on('request', (r) => net.push(`REQ ${r.method()} ${r.url().slice(0, 110)}`));
const consoleMsgs = [];
page.on('console', (m) => consoleMsgs.push(m.type() + ': ' + m.text().slice(0, 120)));
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
// 轮询：上传后按钮 disabled 变化 + 上传区状态
for (let i = 0; i < 12; i++) {
  await sleep(5000);
  const st = await ed.evaluate(() => {
    const pub = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '发表');
    const upload = document.querySelector('.ant-upload');
    const videoCard = document.querySelector('[class*="video-card"], [class*="cover"], [class*="preview"]');
    return {
      pubDisabled: pub ? pub.disabled : 'NO',
      pubCls: pub ? pub.className.slice(0, 60) : '',
      uploadText: upload ? (upload.parentElement.innerText || '').slice(0, 60).replace(/\n+/g, ' | ') : 'NO',
      videoCard: videoCard ? (videoCard.className || '').toString().slice(0, 50) + ' ' + (videoCard.innerText || '').slice(0, 40).replace(/\n+/g, ' | ') : 'NO',
    };
  }).catch((e) => 'ERR ' + e.message.slice(0, 60));
  console.log(`t+${(i + 1) * 5}s:`, JSON.stringify(st));
}
// 此刻点「发表」，监控 15s
net.length = 0;
consoleMsgs.length = 0;
const before = await ed.evaluate(() => {
  const pub = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '发表');
  return { disabled: pub && pub.disabled };
});
console.log('发表 before click:', JSON.stringify(before));
await ed.evaluate(() => {
  const el = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '发表');
  el && el.click();
});
// 每 500ms 抓瞬态文本 15s
let prev = '';
const toasts = [];
for (let i = 0; i < 30; i++) {
  await sleep(500);
  const t = await ed.evaluate(() => {
    const cand = [...document.querySelectorAll('[class*="toast"], [class*="toast"], [class*="notice"], [class*="tip"], [class*="msg"], [class*="message"]')]
      .filter((el) => el.innerText && el.innerText.trim().length > 0);
    return cand.map((el) => el.innerText.trim().replace(/\n+/g, ' | ')).join(' ;; ').slice(0, 200);
  }).catch(() => '');
  if (t && t !== prev) toasts.push(`t+${((i + 1) * 0.5).toFixed(1)}s: ${t}`);
  prev = t;
}
console.log('TOASTS:', JSON.stringify(toasts, null, 1));
console.log('NET after click:', JSON.stringify(net.filter(n => !n.includes('.png') && !n.includes('.js')), null, 1));
console.log('CONSOLE:', JSON.stringify(consoleMsgs.slice(-15), null, 1));
const finalSt = await ed.evaluate(() => ({
  url: location.href,
  dlgWrpx: document.querySelector('.weui-desktop-dialog__wrp') ? getComputedStyle(document.querySelector('.weui-desktop-dialog__wrp')).display : 'NO',
  hasForm: !!document.querySelector('input[type=file]'),
})).catch((e) => 'ERR ' + e.message.slice(0, 60));
console.log('final:', JSON.stringify(finalSt), 'TOP:', page.url());
await browser.close();

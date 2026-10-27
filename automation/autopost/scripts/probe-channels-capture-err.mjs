// 挂 window.onerror + unhandledrejection 钩子，点「发表」后读捕获到的异常
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
// 挂钩子（在编辑器 frame 的 window 上）
await ed.evaluate(() => {
  window.__captured = [];
  window.addEventListener('error', (e) => {
    window.__captured.push('ONERROR: ' + String(e.message).slice(0, 300) + (e.error ? ' STACK: ' + String(e.error.stack || '').slice(0, 400) : ''));
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    window.__captured.push('REJECTION: ' + String(r && (r.stack || r.message || r)).slice(0, 500));
  });
  // 也 hook console.error（有些错误只走 console）
  const origErr = console.error;
  console.error = (...args) => {
    window.__captured.push('CONSOLE.ERROR: ' + args.map((a) => (typeof a === 'object' ? JSON.stringify(a).slice(0, 300) : String(a).slice(0, 300))).join(' ').slice(0, 500));
    return origErr.apply(console, args);
  };
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
await ed.evaluate(() => {
  const el = document.querySelector('input[placeholder*="短标题"]');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(el, '测试视频 请忽略');
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
});
await sleep(25000);
await ed.evaluate(() => { window.__captured.length = 0; });
await ed.evaluate(() => {
  const el = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '发表');
  el && el.click();
});
await sleep(12000);
const captured = await ed.evaluate(() => window.__captured).catch((e) => 'ERR ' + e.message.slice(0, 80));
console.log('CAPTURED:', JSON.stringify(captured, null, 1));
const st = await ed.evaluate(() => ({
  url: location.href,
  hasForm: !!document.querySelector('input[type=file]'),
  wrp: document.querySelector('.weui-desktop-dialog__wrp') ? getComputedStyle(document.querySelector('.weui-desktop-dialog__wrp')).display : 'NO',
}));
console.log('state:', JSON.stringify(st), 'TOP:', page.url());
await browser.close();

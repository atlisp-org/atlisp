// 1) 点「不保存」时的网络请求  2) 按钮样式链  3) visibilityState  4) focus+CDP可信回车
import { launchBrowser, loadConfig, abs, sleep } from '../lib/common.js';
const fs = await import('node:fs');
const path = await import('node:path');
const cfg = loadConfig().wechat?.channels?.web || {};
const profileDir = abs(cfg.profileDir || 'state/profiles/channels');
const { browser, context } = await launchBrowser({ profileDir, headless: true });
const page = await context.newPage();
const net = [];
page.on('request', (r) => { if (r.method() !== 'GET') net.push(`REQ ${r.method()} ${r.url().slice(0, 110)}`); });
page.on('response', (r) => { if (r.request().method() !== 'GET') net.push(`RES ${r.status()} ${r.url().slice(0, 110)}`); });
await page.goto('https://channels.weixin.qq.com/platform/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await sleep(12000);
if (/login\.html/i.test(page.url())) { console.log('SESSION DEAD'); await browser.close(); process.exit(0); }
console.log('main visibility:', await page.evaluate(() => ({ vis: document.visibilityState, wh: `${innerWidth}x${innerHeight}` })));
const card = page.frames().find(fr => fr.url().includes('post-card'));
await card.evaluate(() => {
  const el = [...document.querySelectorAll('button')].find(el => el.textContent.trim() === '发表视频');
  el && el.click();
});
await page.waitForURL(/\/platform\/post\/create/, { timeout: 30000 });
await sleep(10000);
const ed = page.frames().find(fr => fr.url().includes('micro/content/post/create'));
console.log('ed visibility:', await ed.evaluate(() => ({ vis: document.visibilityState, wh: `${innerWidth}x${innerHeight}`, dpr: devicePixelRatio })).catch(e => 'ERR ' + e.message.slice(0, 60)));
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
await sleep(25000);
await ed.evaluate(() => {
  const el = document.querySelector('input[placeholder*="短标题"]');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(el, '测试视频 请忽略');
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
});
await ed.evaluate(() => {
  const el = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '发表');
  el && el.click();
});
await sleep(6000);
// 按钮样式链
const chain = await ed.evaluate(() => {
  const no = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '不保存');
  if (!no) return 'NO BTN';
  const out = [];
  let el = no;
  while (el && out.length < 6) {
    const cs = getComputedStyle(el);
    out.push(`${el.tagName}.${(el.className || '').toString().slice(0, 30)} display=${cs.display} vis=${cs.visibility} pos=${cs.position} size=${Math.round(cs.width)}x${Math.round(cs.height)}`);
    el = el.parentElement;
  }
  return out;
}).catch((e) => 'ERR ' + e.message.slice(0, 80));
console.log('style chain:', JSON.stringify(chain, null, 1));
// focus 测试
const focusOk = await ed.evaluate(() => {
  const no = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '不保存');
  no && no.focus();
  return no ? document.activeElement === no : false;
}).catch((e) => 'ERR ' + e.message.slice(0, 60));
console.log('focus ok:', focusOk);
// 网络监控下的 JS click
net.length = 0;
await ed.evaluate(() => {
  const no = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '不保存');
  no && no.click();
});
await sleep(6000);
console.log('NET after JS click:', JSON.stringify(net, null, 1));
// CDP 可信回车
if (focusOk) {
  const cdp = await context.newCDPSession(page);
  for (const type of ['keyDown', 'keyUp']) {
    await cdp.send('Input.dispatchKeyEvent', {
      type,
      key: 'Enter',
      code: 'Enter',
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
    });
  }
  await sleep(8000);
  const after = await ed.evaluate(() => ({
    url: location.href,
    dlg: !!document.querySelector('.weui-desktop-dialog, [class*="dialog"]'),
    hasForm: !!document.querySelector('input[type=file]'),
  })).catch((e) => 'ERR ' + e.message.slice(0, 60));
  console.log('after CDP Enter:', JSON.stringify(after));
  console.log('TOP URL:', page.url());
  net.length = 0;
  // 再看下网络
  await sleep(3000);
  console.log('NET after Enter:', JSON.stringify(net, null, 1));
}
await browser.close();

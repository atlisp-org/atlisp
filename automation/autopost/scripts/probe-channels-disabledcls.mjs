// 等「发表」按钮去掉 weui-desktop-btn_disabled class（= 转码完成），再点发表观察
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
await ed.evaluate(() => {
  const el = document.querySelector('input[placeholder*="短标题"]');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(el, '测试视频 请忽略');
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
});
// 轮询 disabled class
const t0 = Date.now();
let enabled = false;
for (let i = 0; i < 60; i++) {
  await sleep(5000);
  const st = await ed.evaluate(() => {
    const pub = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '发表');
    if (!pub) return null;
    return { cls: pub.className, dis: pub.disabled };
  }).catch(() => null);
  if (!st) { console.log(`t+${((Date.now() - t0) / 1000).toFixed(0)}s: 按钮消失`); break; }
  const hasDisCls = /weui-desktop-btn_disabled/.test(st.cls);
  console.log(`t+${((Date.now() - t0) / 1000).toFixed(0)}s: disCls=${hasDisCls} disProp=${st.dis} cls=${st.cls.slice(0, 90)}`);
  if (!hasDisCls && !st.dis) { enabled = true; break; }
}
if (!enabled) { console.log('5 分钟仍未解除 disabled'); await browser.close(); process.exit(0); }
console.log('>>> 按钮已启用，点「发表」');
net.length = 0;
await ed.evaluate(() => {
  const el = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '发表');
  el && el.click();
});
// 观察 40s
let prevDlg = null;
for (let i = 0; i < 8; i++) {
  await sleep(5000);
  const st = await ed.evaluate(() => {
    const wrp = document.querySelector('.weui-desktop-dialog__wrp');
    const dlg = document.querySelector('.weui-desktop-dialog, [class*="dialog"]');
    return {
      url: location.href,
      hasForm: !!document.querySelector('input[type=file]'),
      dlgVisible: dlg ? (wrp ? getComputedStyle(wrp).display : 'no-wrp') : 'no-dlg',
      dlgText: dlg ? (dlg.innerText || '').slice(0, 80).replace(/\n+/g, ' | ') : '',
    };
  }).catch((e) => ({ err: e.message.slice(0, 60) }));
  console.log(`after t+${(i + 1) * 5}s:`, JSON.stringify(st));
  // 若弹窗可见则点「不保存」
  if (st.dlgVisible && st.dlgVisible !== 'none') {
    const c = await ed.evaluate(() => {
      const no = [...document.querySelectorAll('.weui-desktop-dialog button, [class*="dialog"] button')].find((b) => b.textContent.trim() === '不保存');
      if (no) { no.click(); return 'clicked'; }
      return 'no-btn';
    }).catch(() => 'err');
    console.log('  -> dialog action:', c);
  }
  if (!/post\/create/.test(page.url())) { console.log('TOP URL LEFT:', page.url()); break; }
}
console.log('NET:', JSON.stringify(net.filter(n => !n.includes('merlin')), null, 1));
console.log('TOP:', page.url());
for (const fr of page.frames()) console.log('  frame:', fr.url().slice(0, 90));
const cardNow = page.frames().find(fr => fr.url().includes('post-card'));
if (cardNow) {
  const t2 = await cardNow.evaluate(() => document.body.innerText.slice(0, 200).replace(/\n+/g, ' | ')).catch(() => 'err');
  console.log('post-card:', t2);
}
await browser.close();

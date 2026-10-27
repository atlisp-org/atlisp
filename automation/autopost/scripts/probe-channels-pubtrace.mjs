// 追踪：点「发表」后每 5s dump 状态 60s，看卡在哪
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
// 点「发表」
await ed.evaluate(() => {
  const el = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '发表');
  el && el.click();
});
let prevText = '';
for (let i = 0; i < 12; i++) {
  await sleep(5000);
  const d = await ed.evaluate(() => {
    const dlg = document.querySelector('.weui-desktop-dialog, [class*="dialog"]');
    const dlgInfo = dlg ? {
      title: (dlg.querySelector('[class*="title"]') || {}).innerText || '',
      btns: [...dlg.querySelectorAll('button')].map(b => b.textContent.trim()),
    } : null;
    const busy = (document.body.innerText.match(/上传中|处理中|转码中|失败|错误|\d+(\.\d+)?%/g) || []).slice(0, 6);
    return { url: location.href, dlg: dlgInfo, busy, text: document.body.innerText.replace(/\n+/g, ' | ') };
  }).catch((e) => ({ err: e.message.slice(0, 80) }));
  if (d.err) { console.log(`t+${(i + 1) * 5}s: ED ERR ${d.err}`); continue; }
  // 只打印与上次不同的文本片段
  const newFrag = d.text.split(' | ').filter(s => !prevText.includes(s) && s.length > 1).slice(0, 6).join(' | ');
  console.log(`t+${(i + 1) * 5}s: dlg=${d.dlg ? JSON.stringify(d.dlg) : 'null'} busy=${JSON.stringify(d.busy)} NEW: ${newFrag.slice(0, 150)}`);
  prevText = d.text;
  // 有弹窗就点「不保存」
  if (d.dlg && d.dlg.btns.includes('不保存')) {
    await ed.evaluate(() => {
      const dlg = document.querySelector('.weui-desktop-dialog, [class*="dialog"]');
      const no = [...dlg.querySelectorAll('button')].find((b) => b.textContent.trim() === '不保存');
      no && no.click();
    });
    console.log(`  -> 已点 不保存`);
  }
  if (!/post\/create/.test(page.url())) { console.log('TOP URL LEFT:', page.url()); break; }
}
console.log('FINAL TOP URL:', page.url());
await browser.close();

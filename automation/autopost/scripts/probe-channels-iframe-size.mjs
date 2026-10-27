// 检查编辑器 iframe 的布局：为何 0x0？手动撑大后能否鼠标点击？
import { launchBrowser, loadConfig, abs, sleep } from '../lib/common.js';
const fs = await import('node:fs');
const path = await import('node:path');
const cfg = loadConfig().wechat?.channels?.web || {};
const profileDir = abs(cfg.profileDir || 'state/profiles/channels');
const { browser, context } = await launchBrowser({ profileDir, headless: true, viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
await page.goto('https://channels.weixin.qq.com/platform/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await sleep(12000);
if (/login\.html/i.test(page.url())) { console.log('SESSION DEAD'); await browser.close(); process.exit(0); }
console.log('viewport:', JSON.stringify(page.viewportSize()));
// 主页面所有 iframe 的布局
const ifrInfo = await page.evaluate(() => {
  return [...document.querySelectorAll('iframe')].map((f, i) => {
    const cs = getComputedStyle(f);
    const r = f.getBoundingClientRect();
    return { i, src: (f.src || '').slice(0, 60), rect: `${Math.round(r.width)}x${Math.round(r.height)}@${Math.round(r.left)},${Math.round(r.top)}`,
      css: `pos=${cs.position} w=${cs.width} h=${cs.height} display=${cs.display} vis=${cs.visibility} transform=${cs.transform.slice(0, 40)}`,
      parent: f.parentElement ? f.parentElement.tagName + '.' + (f.parentElement.className || '').toString().slice(0, 40) : '' };
  });
});
console.log(JSON.stringify(ifrInfo, null, 1));
const card = page.frames().find(fr => fr.url().includes('post-card'));
await card.evaluate(() => {
  const el = [...document.querySelectorAll('button')].find(el => el.textContent.trim() === '发表视频');
  el && el.click();
});
await page.waitForURL(/\/platform\/post\/create/, { timeout: 30000 });
await sleep(10000);
// 编辑器 iframe 布局
const edIf = await page.evaluate(() => {
  return [...document.querySelectorAll('iframe')].map((f, i) => {
    const cs = getComputedStyle(f);
    const r = f.getBoundingClientRect();
    return { i, src: (f.src || '').slice(0, 70), rect: `${Math.round(r.width)}x${Math.round(r.height)}@${Math.round(r.left)},${Math.round(r.top)}`,
      css: `pos=${cs.position} w=${cs.width} h=${cs.height} display=${cs.display}` };
  });
});
console.log('editor iframes:', JSON.stringify(edIf, null, 1));
// 找到编辑器 frame，检查「不保存」按钮出现后的坐标
const ed = page.frames().find(fr => fr.url().includes('micro/content/post/create'));
// 先上传+填标题+点发表，让弹窗出现
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
// 弹窗出现后：读「不保存」按钮在 frame 内的坐标
const btnRect = await ed.evaluate(() => {
  const dlg = document.querySelector('.weui-desktop-dialog, [class*="dialog"]');
  if (!dlg) return null;
  const no = [...dlg.querySelectorAll('button')].find((b) => b.textContent.trim() === '不保存');
  if (!no) return null;
  const r = no.getBoundingClientRect();
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), w: Math.round(r.width), h: Math.round(r.height) };
}).catch((e) => 'ERR ' + e.message.slice(0, 80));
console.log('不保存 btn rect (frame coords):', JSON.stringify(btnRect));
if (btnRect && typeof btnRect === 'object') {
  // 尝试：先把编辑器 iframe 撑到 viewport 大小（如果它是 0x0）
  const resized = await page.evaluate(() => {
    const eds = [...document.querySelectorAll('iframe')].filter(f => (f.src || '').includes('empty') || !f.src);
    let n = 0;
    for (const f of eds) {
      const r = f.getBoundingClientRect();
      if (r.width < 100) { f.style.cssText += ';position:fixed;left:0;top:0;width:100vw;height:100vh;z-index:1;border:0;'; n++; }
    }
    return n;
  });
  console.log('resized iframes:', resized);
  await sleep(1000);
  // 重新读按钮坐标（frame 内容坐标不变，iframe 移到 0,0 后 page 坐标 == frame 坐标）
  const btnRect2 = await ed.evaluate(() => {
    const no = [...document.querySelectorAll('.weui-desktop-dialog button, [class*="dialog"] button')].find((b) => b.textContent.trim() === '不保存');
    if (!no) return null;
    const r = no.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  }).catch((e) => 'ERR ' + e.message.slice(0, 80));
  console.log('btn rect after resize:', JSON.stringify(btnRect2));
  if (btnRect2 && typeof btnRect2 === 'object') {
    console.log('mouse click at', JSON.stringify(btnRect2));
    await page.mouse.click(btnRect2.x, btnRect2.y);
    await sleep(8000);
    const after = await ed.evaluate(() => ({
      url: location.href,
      dlg: !!document.querySelector('.weui-desktop-dialog, [class*="dialog"]'),
      hasForm: !!document.querySelector('input[type=file]'),
      text: document.body.innerText.slice(0, 200).replace(/\n+/g, ' | '),
    })).catch((e) => 'ERR ' + e.message.slice(0, 80));
    console.log('after trusted click:', JSON.stringify(after, null, 1));
    console.log('TOP URL:', page.url());
    for (const fr of page.frames()) console.log('  frame:', fr.url().slice(0, 90));
  }
}
await browser.close();

import { launchBrowser, loadConfig, abs } from '../lib/common.js';
const cfg = loadConfig().wechat?.channels?.web || {};
const stateFile = abs(cfg.stateFile || 'state/wechat-channels.json');
const { browser, context } = await launchBrowser({ stateFile, headless: true });
const page = await context.newPage();
let fc = null, popup = null;
page.on('filechooser', (x) => { fc = x; });
context.on('page', (p) => { popup = p; });
await page.goto('https://channels.weixin.qq.com/platform/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(12000);
const f = page.frames().find(fr => fr.url().includes('post-card'));

// 精确找「发表视频」元素：dump 属性 + 可见性
const elInfo = await f.evaluate(() => {
  const cands = [...document.querySelectorAll('*')].filter(el => {
    const t = (el.childNodes.length === 1 && el.childNodes[0].nodeType === 3 ? el.childNodes[0].textContent.trim() : (el.innerText || '').trim());
    return t === '发表视频' || el.textContent.trim() === '发表视频' && el.children.length === 0;
  });
  return cands.map(el => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return {
      tag: el.tagName.toLowerCase(),
      cls: (el.className?.toString() || '').slice(0, 60),
      rect: `${Math.round(r.width)}x${Math.round(r.height)}@${Math.round(r.left)},${Math.round(r.top)}`,
      display: s.display, visibility: s.visibility, opacity: s.opacity,
      parentCls: (el.parentElement?.className?.toString() || '').slice(0, 60),
    };
  });
});
console.log('EL INFO:', JSON.stringify(elInfo, null, 1));

// JS 直接点击
const clicked = await f.evaluate(() => {
  const el = [...document.querySelectorAll('*')].find(el => el.children.length === 0 && el.textContent.trim() === '发表视频');
  if (!el) return 'not found';
  el.click();
  return 'clicked ' + el.tagName.toLowerCase() + '.' + (el.className?.toString() || '').slice(0, 40);
});
console.log('CLICK:', clicked);
await page.waitForTimeout(10000);
console.log('filechooser:', !!fc);
console.log('popup:', popup ? popup.url() : '无');
console.log('主URL:', page.url());
console.log('FRAMES:', page.frames().map(fr => fr.url().slice(0, 110)));
await browser.close();

// 深入探测：找到「说点儿什么吧」提示，定位真正的说说输入框
import { chromium } from 'playwright';

const stateFile = '/home/vitalgg/atlisp/automation/autopost/state/qzone.json';
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  locale: 'zh-CN', timezoneId: 'Asia/Shanghai',
  viewport: { width: 1366, height: 900 }, storageState: stateFile,
});
const page = await ctx.newPage();
await page.goto('https://qzone.qq.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForURL(/qzone\.qq\.com\/\d{5,}/, { timeout: 30000 });
await page.waitForTimeout(5000);

const info = await page.evaluate(() => {
  const out = {};
  // 1) 所有 contenteditable 元素的详细尺寸
  out.editables = [...document.querySelectorAll('[contenteditable]')].map((e) => {
    const r = e.getBoundingClientRect();
    return {
      tag: e.tagName,
      cls: (e.className || '').slice(0, 80),
      ce: e.getAttribute('contenteditable'),
      ph: e.getAttribute('placeholder'),
      w: Math.round(r.width), h: Math.round(r.height),
      x: Math.round(r.x), y: Math.round(r.y),
      display: getComputedStyle(e).display,
      visibility: getComputedStyle(e).visibility,
    };
  }).filter((e) => e.w > 0 || e.h > 0 || e.cls.includes('textarea'));

  // 2) 找「说点儿什么吧」文字所在的元素及其 contenteditable 祖先
  const all = [...document.querySelectorAll('*')];
  const hintEl = all.find((e) => e.children.length === 0 && (e.textContent || '').includes('说点儿什么吧'));
  if (hintEl) {
    out.hint = { tag: hintEl.tagName, cls: (hintEl.className || '').slice(0, 80) };
    let p = hintEl, chain = [];
    for (let i = 0; i < 6 && p; i++) {
      chain.push({ tag: p.tagName, cls: (p.className || '').slice(0, 80), ce: p.getAttribute && p.getAttribute('contenteditable') });
      p = p.parentElement;
    }
    out.hintAncestors = chain;
  } else {
    out.hint = null;
  }
  return out;
});
console.log(JSON.stringify(info, null, 1));
await browser.close();

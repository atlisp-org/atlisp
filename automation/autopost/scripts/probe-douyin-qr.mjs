// 探测：找登录页上真正的二维码元素（方形 img / canvas）
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  locale: 'zh-CN', timezoneId: 'Asia/Shanghai', viewport: { width: 1366, height: 900 },
  args: ['--disable-blink-features=AutomationControlled'],
});
const page = await context.newPage();
await page.goto('https://creator.douyin.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(8000);

const info = await page.evaluate(() => {
  const all = [...document.querySelectorAll('img, canvas')].map((i) => {
    const r = i.getBoundingClientRect();
    return {
      tag: i.tagName.toLowerCase(),
      src: (i.src || i.id || '').slice(0, 50),
      natural: `${i.naturalWidth || 0}x${i.naturalHeight || 0}`,
      rect: `${Math.round(r.width)}x${Math.round(r.height)} @ ${Math.round(r.left)},${Math.round(r.top)}`,
      cls: (i.className && i.className.toString ? i.className.toString() : '').slice(0, 80),
      id: i.id || undefined,
      parentCls: (i.parentElement && i.parentElement.className ? i.parentElement.className.toString() : '').slice(0, 80),
    };
  });
  // 方形且足够大的候选（QR 特征）
  const qrCands = all.filter((x) => {
    const m = x.rect.match(/(\d+)x(\d+)/);
    if (!m) return false;
    const [w, h] = [Number(m[1]), Number(m[2])];
    return w >= 100 && h >= 100 && Math.abs(w - h) <= 20;
  });
  return { total: all.length, qrCands, sample: all.filter((x) => x.src.startsWith('data:') || x.tag === 'canvas') };
});
console.log(JSON.stringify(info, null, 1));
await browser.close();

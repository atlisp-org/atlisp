// 探测：视频号助手（channels.weixin.qq.com）登录页的二维码元素与页面结构
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve('logs/screenshots');
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  locale: 'zh-CN', timezoneId: 'Asia/Shanghai', viewport: { width: 1366, height: 900 },
  args: ['--disable-blink-features=AutomationControlled'],
});
const page = await context.newPage();
const target = process.argv[2] || 'https://channels.weixin.qq.com/';
console.log('goto:', target);
await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(8000);

console.log('URL:', page.url());
console.log('TITLE:', await page.title());

const info = await page.evaluate(() => {
  const all = [...document.querySelectorAll('img, canvas, iframe')].map((i) => {
    const r = i.getBoundingClientRect();
    return {
      tag: i.tagName.toLowerCase(),
      src: (i.src || i.id || (i.contentWindow ? 'iframe' : '')).slice(0, 80),
      natural: i.naturalWidth ? `${i.naturalWidth}x${i.naturalHeight}` : undefined,
      rect: `${Math.round(r.width)}x${Math.round(r.height)} @ ${Math.round(r.left)},${Math.round(r.top)}`,
      cls: (i.className && i.className.toString ? i.className.toString() : '').slice(0, 80),
      id: i.id || undefined,
    };
  });
  const qrCands = all.filter((x) => {
    const m = x.rect.match(/(\d+)x(\d+)/);
    if (!m) return false;
    const [w, h] = [Number(m[1]), Number(m[2])];
    return w >= 100 && h >= 100 && Math.abs(w - h) <= 20;
  });
  return {
    total: all.length,
    qrCands,
    dataImgs: all.filter((x) => x.src.startsWith('data:')).map((x) => x.src.slice(0, 60)),
    iframes: all.filter((x) => x.tag === 'iframe'),
    bodyText: document.body ? document.body.innerText.replace(/\n+/g, ' | ').slice(0, 500) : '',
  };
});
console.log(JSON.stringify(info, null, 1));
await page.screenshot({ path: path.join(OUT, 'channels-login-probe.png') });
await browser.close();

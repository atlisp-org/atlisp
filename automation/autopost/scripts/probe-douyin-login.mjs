// 探测抖音创作者平台登录页：QR 在哪、页面长什么样
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  locale: 'zh-CN', timezoneId: 'Asia/Shanghai', viewport: { width: 1366, height: 900 },
  args: ['--disable-blink-features=AutomationControlled'],
});
const page = await context.newPage();
await page.goto('https://creator.douyin.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(8000);
console.log('URL:', page.url());
console.log('TITLE:', await page.title());
const info = await page.evaluate(() => {
  const imgs = [...document.querySelectorAll('img')].map((i) => ({
    src: (i.src || '').slice(0, 60),
    w: i.naturalWidth, h: i.naturalHeight,
    disp: `${i.offsetWidth}x${i.offsetHeight}`,
    pos: `${i.offsetLeft},${i.offsetTop}`,
    cls: (i.className || '').toString().slice(0, 60),
    alt: (i.alt || '').slice(0, 40),
  }));
  const iframes = [...document.querySelectorAll('iframe')].map((f) => (f.src || '').slice(0, 100));
  return {
    text: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 600),
    imgs: imgs.slice(0, 25),
    iframes,
  };
});
console.log(JSON.stringify(info, null, 1));
await page.screenshot({ path: '/home/vitalgg/atlisp/automation/autopost/logs/screenshots/douyin-login-probe.png', fullPage: true });
console.log('截图: logs/screenshots/douyin-login-probe.png');
await browser.close();

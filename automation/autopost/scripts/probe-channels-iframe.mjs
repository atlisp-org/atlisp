import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  locale: 'zh-CN', timezoneId: 'Asia/Shanghai', viewport: { width: 1366, height: 900 },
  args: ['--disable-blink-features=AutomationControlled'],
});
const page = await context.newPage();
await page.goto('https://channels.weixin.qq.com/login.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(6000);
const frame = page.frameLocator('iframe').first();
const imgInfo = await frame.locator('img').evaluateAll((els) =>
  els.map((i) => ({
    id: i.id || undefined,
    src: (i.src || '').slice(0, 80),
    natural: `${i.naturalWidth}x${i.naturalHeight}`,
    rect: (() => { const r = i.getBoundingClientRect(); return `${Math.round(r.width)}x${Math.round(r.height)}`; })(),
  }))
);
console.log('IFRAME URL:', page.frames().find(f => f.url().includes('qrconnect'))?.url().slice(0, 120));
console.log(JSON.stringify(imgInfo, null, 1));
await browser.close();

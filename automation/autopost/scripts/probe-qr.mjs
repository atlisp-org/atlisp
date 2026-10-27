// 探测 QQ空间登录 iframe 内二维码元素
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ locale: 'zh-CN' })).newPage();
await page.goto('https://qzone.qq.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(5000);

const frames = page.frames().map((f) => f.url().slice(0, 80));
console.log('frames:', JSON.stringify(frames, null, 1));

for (const f of page.frames()) {
  if (!/ptlogin2|qq\.com/.test(f.url())) continue;
  try {
    const imgs = await f.evaluate(() =>
      [...document.querySelectorAll('img')]
        .map((i) => ({ w: i.naturalWidth, h: i.naturalHeight, cls: (i.className || '').slice(0, 50), alt: i.alt, id: i.id }))
        .filter((i) => i.w > 50),
    );
    console.log(`frame [${f.url().slice(0, 60)}] imgs>50px:`, JSON.stringify(imgs));
    const bodyText = await f.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 150));
    console.log('  body:', bodyText);
  } catch (e) {
    console.log('  frame eval failed:', e.message.slice(0, 80));
  }
}

// 顶层 iframe 元素截图测试
const iframe = page.locator('iframe').first();
await iframe.screenshot({ path: '/tmp/opencode/qzone-iframe-test.png' }).catch((e) => console.log('iframe shot failed:', e.message.slice(0, 80)));
const fs = await import('node:fs');
const st = fs.statSync('/tmp/opencode/qzone-iframe-test.png');
console.log('iframe screenshot bytes:', st.size);
await browser.close();

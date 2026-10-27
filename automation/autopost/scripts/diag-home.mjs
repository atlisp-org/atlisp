// 诊断：带登录态打开空间，看最终停留位置 + 页面特征
import { chromium } from 'playwright';

const stateFile = '/home/vitalgg/atlisp/automation/autopost/state/qzone.json';
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  locale: 'zh-CN', timezoneId: 'Asia/Shanghai',
  viewport: { width: 1366, height: 900 }, storageState: stateFile,
});
const page = await ctx.newPage();
page.on('framenavigated', (f) => { if (f === page.mainFrame()) console.log('nav:', f.url().slice(0, 90)); });
await page.goto('https://qzone.qq.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
for (let i = 0; i < 8; i++) {
  await page.waitForTimeout(2500);
  console.log(`t+${(i + 1) * 2.5}s url:`, page.url().slice(0, 90));
}
const info = await page.evaluate(() => ({
  title: document.title,
  text: document.body.innerText.replace(/\s+/g, ' ').slice(0, 400),
  hasCaptcha: /验证码|安全验证|扫码|登录/.test(document.body.innerText.slice(0, 1500)),
}));
console.log(JSON.stringify(info, null, 1));
await page.screenshot({ path: '/tmp/opencode/qzone-diag.png' });
await browser.close();

// 验证：点击说说输入框后页面发生什么变化（弹窗？跳转？原框隐藏？）
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

const box = page.locator('div.textinput.textarea').nth(1); // c_tx3
console.log('点击前 URL:', page.url());
console.log('点击前 c_tx3 可见:', await box.isVisible());

await box.click();
await page.waitForTimeout(3000);

console.log('点击后 URL:', page.url());
const info = await page.evaluate(() => {
  const out = {};
  out.editables = [...document.querySelectorAll('[contenteditable]')].map((e) => {
    const r = e.getBoundingClientRect();
    return { cls: (e.className || '').slice(0, 60), w: Math.round(r.width), h: Math.round(r.height), display: getComputedStyle(e).display };
  }).filter((e) => e.h > 0);
  // 弹窗/新面板
  out.dialogs = [...document.querySelectorAll('[class*="dialog"], [class*="modal"], [class*="mask"], [class*="popup"], [class*="expand"]')]
    .filter((e) => e.offsetParent !== null)
    .map((e) => e.tagName + '.' + (e.className || '').slice(0, 80))
    .slice(0, 8);
  // 发布按钮
  out.publishBtns = [...document.querySelectorAll('button, a, div, span')]
    .filter((e) => e.offsetParent !== null && (e.textContent || '').trim() === '发布')
    .map((e) => e.tagName + '.' + (e.className || '').slice(0, 60))
    .slice(0, 8);
  return out;
});
console.log(JSON.stringify(info, null, 1));
await page.screenshot({ path: '/tmp/opencode/qzone-after-click.png' });
console.log('screenshot: /tmp/opencode/qzone-after-click.png');
await browser.close();

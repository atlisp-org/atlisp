// 直接访问个人主页（不走 qzone.qq.com/ 重定向），验证会话是否仍有效
import { chromium } from 'playwright';

const stateFile = '/home/vitalgg/atlisp/automation/autopost/state/qzone.json';
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  locale: 'zh-CN', timezoneId: 'Asia/Shanghai',
  viewport: { width: 1366, height: 900 }, storageState: stateFile,
});
const page = await ctx.newPage();
await page.goto('https://user.qzone.qq.com/405842561', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(5000);
console.log('最终 URL:', page.url());
const ok = /user\.qzone\.qq\.com\/\d{5,}/.test(page.url());
console.log('会话有效:', ok);
if (ok) {
  const has = await page.locator('div.textinput.textarea').count();
  console.log('说说输入框数量:', has);
}
await page.screenshot({ path: '/tmp/opencode/qzone-direct.png' });
await browser.close();

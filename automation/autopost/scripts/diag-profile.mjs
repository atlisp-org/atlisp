// 探测：用持久 profile 打开个人主页，看会话是否还活着
import { chromium } from 'playwright';

const profileDir = '/home/vitalgg/atlisp/automation/autopost/state/profiles/qzone';
const context = await chromium.launchPersistentContext(profileDir, {
  headless: true,
  locale: 'zh-CN',
  timezoneId: 'Asia/Shanghai',
  viewport: { width: 1366, height: 900 },
  args: ['--disable-blink-features=AutomationControlled'],
});
const page = await context.newPage();
page.on('framenavigated', (f) => { if (f === page.mainFrame()) console.log('nav:', f.url().slice(0, 90)); });
await page.goto('https://user.qzone.qq.com/405842561', { waitUntil: 'domcontentloaded', timeout: 60000 });
for (let i = 0; i < 6; i++) {
  await page.waitForTimeout(2500);
  console.log(`t+${(i + 1) * 2.5}s url:`, page.url().slice(0, 90));
}
const ok = /user\.qzone\.qq\.com\/\d{5,}/.test(page.url());
console.log('会话有效:', ok);
if (ok) {
  const n = await page.locator('div.textinput.textarea').count().catch(() => -1);
  console.log('说说输入框数量:', n);
}
await context.close();

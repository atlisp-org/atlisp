// 查询：创作者平台作品列表（确认测试视频是否真的发布出去了）
import { chromium } from 'playwright';
import fs from 'node:fs';

const STATE = '/home/vitalgg/atlisp/automation/autopost/state/douyin-web.json';
if (!fs.existsSync(STATE)) {
  console.log('未登录');
  process.exit(1);
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  storageState: STATE,
  locale: 'zh-CN',
  timezoneId: 'Asia/Shanghai',
  viewport: { width: 1366, height: 900 },
  args: ['--disable-blink-features=AutomationControlled'],
});
const page = await context.newPage();
await page.goto('https://creator.douyin.com/creator-micro/content/manage', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(8000);
console.log('URL:', page.url());

const info = await page.evaluate(() => {
  const text = (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 1500);
  return { text };
});
console.log(JSON.stringify(info, null, 1));
await browser.close();

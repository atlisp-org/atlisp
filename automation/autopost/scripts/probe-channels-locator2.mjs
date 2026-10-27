import { launchBrowser, loadConfig, abs, sleep } from '../lib/common.js';
const cfg = loadConfig().wechat?.channels?.web || {};
const profileDir = abs(cfg.profileDir || 'state/profiles/channels');
const { browser, context } = await launchBrowser({ profileDir, headless: true });
const page = await context.newPage();
await page.goto('https://channels.weixin.qq.com/platform/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await sleep(12000);
const card = page.frames().find(fr => fr.url().includes('post-card'));
await card.evaluate(() => {
  const el = [...document.querySelectorAll('button')].find(el => el.textContent.trim() === '发表视频');
  el && el.click();
});
await page.waitForURL(/\/platform\/post\/create/, { timeout: 30000 });
const deadline = Date.now() + 30000;
let ed = null;
while (Date.now() < deadline) {
  ed = page.frames().find((fr) => fr.url().includes('micro/content/post/create'));
  if (ed) break;
  await sleep(500);
}
await sleep(8000);
// 1) locator 查所有 input
console.log('locator input count:', await ed.locator('input').count());
console.log('locator body count:', await ed.locator('body').count());
console.log('locator text=视频描述:', await ed.getByText('视频描述').count());
// 2) frameElement 检查
const fe = await ed.frameElement().catch(e => 'ERR ' + e.message.slice(0, 60));
if (fe) {
  const info = await fe.evaluate((el) => ({
    tag: el.tagName,
    src: (el.src || '').slice(0, 80),
    contentDoc: el.contentDocument ? 'yes' : 'no',
    docInputs: el.contentDocument ? el.contentDocument.querySelectorAll('input').length : -1,
    docFiles: el.contentDocument ? el.contentDocument.querySelectorAll('input[type=file]').length : -1,
  })).catch(e => 'ERR ' + e.message.slice(0, 60));
  console.log('frameElement:', JSON.stringify(info));
  // frameElement 里直接找 file input 试试
  const fi = fe.locator('input[type=file]').first();
  console.log('frameElement locator file count:', await fi.count());
}
// 3) 当前所有 frames（数一下同 URL 的有几个）
const all = page.frames().map(f => f.url());
console.log('frames:', JSON.stringify(all));
await browser.close();

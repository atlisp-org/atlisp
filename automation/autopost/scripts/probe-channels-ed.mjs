import { launchBrowser, loadConfig, abs } from '../lib/common.js';
const cfg = loadConfig().wechat?.channels?.web || {};
const stateFile = abs(cfg.stateFile || 'state/wechat-channels.json');
const { browser, context } = await launchBrowser({ stateFile, headless: true });
const page = await context.newPage();
await page.goto('https://channels.weixin.qq.com/platform/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(5000);
const card = page.frames().find(fr => fr.url().includes('post-card'));
await card.evaluate(() => {
  const el = [...document.querySelectorAll('button')].find(el => el.textContent.trim() === '发表视频');
  el && el.click();
});
await page.waitForURL(/\/platform\/post\/create/, { timeout: 30000 });
// 用与 lib 相同的方式取 ed
const ed = page.frames().find(fr => fr.url().includes('micro/content/post/create'));
console.log('ed url:', ed?.url());
console.log('detached:', ed?.isDetached());
for (let i = 0; i < 6; i++) {
  const n = await ed.locator('input').count().catch(e => 'ERR ' + e.message.slice(0, 60));
  const nf = await ed.locator('input[type=file]').count().catch(e => 'ERR ' + e.message.slice(0, 60));
  console.log(`t+${i * 3}s: inputs=${n} fileInputs=${nf} detached=${ed.isDetached()} allFrames=${page.frames().length}`);
  await page.waitForTimeout(3000);
}
await browser.close();

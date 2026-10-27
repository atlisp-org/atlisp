import { launchBrowser, loadConfig, abs, sleep } from '../lib/common.js';
const cfg = loadConfig().wechat?.channels?.web || {};
const stateFile = abs(cfg.stateFile || 'state/wechat-channels.json');
const { browser, context } = await launchBrowser({ stateFile, headless: true });
const page = await context.newPage();
await page.goto('https://channels.weixin.qq.com/platform/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(5000);
const card = page.frames().find(fr => fr.url().includes('post-card'));
await sleep(5000);
await card.evaluate(() => {
  const el = [...document.querySelectorAll('button')].find(el => el.textContent.trim() === '发表视频');
  el && el.click();
});
// 按 lib 的方式：waitForURL 后立刻取 Frame
await page.waitForURL(/\/platform\/post\/create/, { timeout: 30000 });
const ed = page.frames().find(fr => fr.url().includes('micro/content/post/create'));
console.log('ed captured:', ed ? ed.url() : 'NONE');
for (let i = 0; i < 8; i++) {
  await sleep(3000);
  const allEd = page.frames().filter(f => f.url().includes('micro/content/post/create'));
  const fiCount = allEd.map(f => {
    try { return f.evaluate(() => document.querySelectorAll('input[type=file]').length); } catch (e) { return 'ERR' + e.message.slice(0, 30); }
  });
  console.log(`t+${(i+1)*3}s: edDetached=${ed?.isDetached()} edCount=${allEd.length} fileInputs=${JSON.stringify(fiCount)} totalFrames=${page.frames().length}`);
}
await browser.close();

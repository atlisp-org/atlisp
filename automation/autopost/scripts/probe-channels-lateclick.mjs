import { launchBrowser, loadConfig, abs, sleep } from '../lib/common.js';
const cfg = loadConfig().wechat?.channels?.web || {};
const stateFile = abs(cfg.profileDir || 'state/profiles/channels');
const { browser, context } = await launchBrowser({ profileDir: stateFile, headless: true });
const page = await context.newPage();
await page.goto('https://channels.weixin.qq.com/platform/', { waitUntil: 'domcontentloaded', timeout: 60000 });
const waitMs = Number(process.argv[2] || 16000);
await page.waitForTimeout(waitMs);
console.log('click at +' + waitMs + 'ms, url=', page.url());
const f = page.frames().find(fr => fr.url().includes('post-card'));
if (!f) { console.log('RESULT: NO post-card frame'); await browser.close(); process.exit(1); }
await f.evaluate(() => {
  const el = [...document.querySelectorAll('button')].find(el => el.textContent.trim() === '发表视频');
  el && el.click();
});
await sleep(8000);
const ed = page.frames().find(fr => fr.url().includes('micro/content/post/create'));
const fi = ed ? await ed.evaluate(() => document.querySelectorAll('input[type=file]').length).catch(() => 'ERR') : 'NO_ED_FRAME';
console.log(`RESULT: edFrame=${!!ed} fileInputs=${fi} url=${page.url()}`);
await browser.close();

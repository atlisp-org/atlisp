import { launchBrowser, loadConfig, abs } from '../lib/common.js';
const cfg = loadConfig().wechat?.channels?.web || {};
const stateFile = abs(cfg.stateFile || 'state/wechat-channels.json');
const { browser, context } = await launchBrowser({ stateFile, headless: true });
const page = await context.newPage();
await page.goto('https://channels.weixin.qq.com/platform/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(10000);
const f = page.frames().find(fr => fr.url().includes('post-card'));
await f.evaluate(() => {
  const el = [...document.querySelectorAll('button')].find(el => el.textContent.trim() === '发表视频');
  el && el.click();
});
for (const delay of [5000, 10000, 20000]) {
  await page.waitForTimeout(delay);
  console.log('--- 等待后 FRAMES ---');
  for (const fr of page.frames()) {
    let fi = 0;
    try { fi = await fr.evaluate(() => document.querySelectorAll('input[type=file]').length); } catch {}
    const nInp = await fr.evaluate(() => document.querySelectorAll('input').length).catch(() => -1);
    console.log(`  ${fr.url().slice(0, 90)}  fileInputs=${fi} allInputs=${nInp}`);
  }
  console.log('URL:', page.url());
}
await browser.close();

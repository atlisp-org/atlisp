import { launchBrowser, loadConfig, abs, sleep } from '../lib/common.js';
const cfg = loadConfig().wechat?.channels?.web || {};
const stateFile = abs(cfg.stateFile || 'state/wechat-channels.json');
const doPopup = process.argv[2] === 'popup';
const { browser, context } = await launchBrowser({ stateFile, headless: true });
const page = await context.newPage();
await page.goto('https://channels.weixin.qq.com/platform/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(10000);
if (doPopup) {
  for (const t of ['我知道了', '知道了']) { try { await page.getByText(t, { exact: true }).first().click({ timeout: 2000 }); console.log('clicked popup:', t); } catch { console.log('no popup:', t); } }
}
const f = page.frames().find(fr => fr.url().includes('post-card'));
await f.evaluate(() => {
  const el = [...document.querySelectorAll('button')].find(el => el.textContent.trim() === '发表视频');
  el && el.click();
});
await sleep(8000);
const ed = page.frames().find(fr => fr.url().includes('micro/content/post/create'));
const fi = ed ? await ed.evaluate(() => document.querySelectorAll('input[type=file]').length).catch(() => 'ERR') : 'NO_ED_FRAME';
console.log(`RESULT(${doPopup ? 'with-popup' : 'no-popup'}): edFrame=${!!ed} fileInputs=${fi}`);
await browser.close();

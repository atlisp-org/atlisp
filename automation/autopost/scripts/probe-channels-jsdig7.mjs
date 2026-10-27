// 找 videoMinDuration / videoMaxDuration / videoMaxSize 的值
import { launchBrowser, loadConfig, abs, sleep } from '../lib/common.js';
const { browser, context } = await launchBrowser({ profileDir: abs('state/profiles/channels'), headless: true });
const page = await context.newPage();
const text = await page.request.get('https://res.wx.qq.com/t/wx_fed/finder/helper/finder-helper-web/res/static/js/chunk-common.7dbff146.js').then((r) => r.text());
for (const k of ['videoMinDuration', 'videoMaxDuration', 'videoMaxHour', 'videoMaxSize']) {
  let idx = -1, n = 0;
  while ((idx = text.indexOf(k, idx + 1)) !== -1 && n < 4) {
    console.log(`\n--- ${k} @${idx} ---`);
    console.log(text.slice(Math.max(0, idx - 150), idx + 200).replace(/\n/g, ' '));
    n++;
  }
}
await browser.close();

// checkFinderCommFace 全部出现处（404）
import { launchBrowser, abs } from '../lib/common.js';
const { browser, context } = await launchBrowser({ profileDir: abs('state/profiles/channels'), headless: true });
const page = await context.newPage();
const t = await page.request.get('https://res.wx.qq.com/t/wx_fed/finder/helper/finder-helper-web/res/static/js/404.e44d862a.js').then((r) => r.text());
await browser.close();
let idx = -1, n = 0;
while ((idx = t.indexOf('checkFinderCommFace', idx + 1)) !== -1 && n < 5) {
  console.log(`\n===== @${idx} =====`);
  console.log(t.slice(Math.max(0, idx - 1200), idx + 1800).replace(/\n/g, ' '));
  n++;
}

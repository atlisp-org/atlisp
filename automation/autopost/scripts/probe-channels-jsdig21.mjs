// chunk-common 里 handlePost 两处上下文
import { launchBrowser, abs } from '../lib/common.js';
const { browser, context } = await launchBrowser({ profileDir: abs('state/profiles/channels'), headless: true });
const page = await context.newPage();
const t = await page.request.get('https://res.wx.qq.com/t/wx_fed/finder/helper/finder-helper-web/res/static/js/chunk-common.7dbff146.js').then((r) => r.text());
await browser.close();
let idx = -1, n = 0;
while ((idx = t.indexOf('handlePost', idx + 1)) !== -1 && n < 3) {
  console.log(`\n===== @${idx} =====`);
  console.log(t.slice(Math.max(0, idx - 2500), idx + 4000).replace(/\n/g, ' '));
  n++;
}

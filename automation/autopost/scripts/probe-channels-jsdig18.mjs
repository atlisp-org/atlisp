// 挖 fullVideo / processedResponse 的填充逻辑
import { launchBrowser, abs } from '../lib/common.js';
const { browser, context } = await launchBrowser({ profileDir: abs('state/profiles/channels'), headless: true });
const page = await context.newPage();
const urls = ['chunk-common.7dbff146.js', '404.e44d862a.js'];
for (const f of urls) {
  const t = await page.request.get('https://res.wx.qq.com/t/wx_fed/finder/helper/finder-helper-web/res/static/js/' + f).then((r) => r.text());
  for (const k of ['processedResponse', 'fullVideo']) {
    let idx = -1, n = 0;
    while ((idx = t.indexOf(k, idx + 1)) !== -1 && n < 4) {
      console.log(`\n===== ${f} ${k} @${idx} =====`);
      console.log(t.slice(Math.max(0, idx - 500), idx + 500).replace(/\n/g, ' '));
      n++;
    }
  }
}
await browser.close();

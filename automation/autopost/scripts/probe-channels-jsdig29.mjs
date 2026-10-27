// parseShortTitle 的调用点
import { launchBrowser, abs } from '../lib/common.js';
const { browser, context } = await launchBrowser({ profileDir: abs('state/profiles/channels'), headless: true });
const page = await context.newPage();
for (const f of ['chunk-common.7dbff146.js', '404.e44d862a.js']) {
  const t = await page.request.get('https://res.wx.qq.com/t/wx_fed/finder/helper/finder-helper-web/res/static/js/' + f).then((r) => r.text());
  let idx = -1, n = 0;
  while ((idx = t.indexOf('parseShortTitle', idx + 1)) !== -1 && n < 10) {
    console.log(`\n===== ${f} @${idx} =====`);
    console.log(t.slice(Math.max(0, idx - 350), idx + 250).replace(/\n/g, ' '));
    n++;
  }
  console.log(`\n[${f}] parseShortTitle total: ${n}`);
}
await browser.close();

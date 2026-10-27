// openDeleteDialog 在 bundle 里的实现（postProcessStore）
import { launchBrowser, abs } from '../lib/common.js';
const { browser, context } = await launchBrowser({ profileDir: abs('state/profiles/channels'), headless: true });
const page = await context.newPage();
const base = 'https://res.wx.qq.com/t/wx_fed/finder/helper/finder-helper-web/res/static/js/';
for (const f of ['chunk-common.7dbff146.js', '404.e44d862a.js']) {
  const t = await page.request.get(base + f).then((r) => r.text());
  let idx = -1, n = 0;
  while ((idx = t.indexOf('openDeleteDialog', idx + 1)) !== -1 && n < 8) {
    console.log(`\n===== ${f} @${idx} =====`);
    console.log(t.slice(Math.max(0, idx - 200), idx + 700).replace(/\n/g, ' '));
    n++;
  }
  console.log(`\n[${f}] openDeleteDialog total: ${n}`);
}
await browser.close();

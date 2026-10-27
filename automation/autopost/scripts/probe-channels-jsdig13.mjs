// 挖 postService.create 调用点（chunk-common + 404）
import { launchBrowser, abs } from '../lib/common.js';
const { browser, context } = await launchBrowser({ profileDir: abs('state/profiles/channels'), headless: true });
const page = await context.newPage();
for (const f of ['chunk-common.7dbff146.js', '404.e44d862a.js']) {
  const t = await page.request.get('https://res.wx.qq.com/t/wx_fed/finder/helper/finder-helper-web/res/static/js/' + f).then((r) => r.text());
  let idx = -1, n = 0;
  while ((idx = t.indexOf('postService.create', idx + 1)) !== -1 && n < 3) {
    console.log(`\n===== ${f} postService.create @${idx} =====`);
    console.log(t.slice(Math.max(0, idx - 2500), idx + 800).replace(/\n/g, ' '));
    n++;
  }
}
await browser.close();

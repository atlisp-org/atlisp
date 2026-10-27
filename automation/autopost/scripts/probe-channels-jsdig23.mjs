// 挖 updatePostDesc 的 $on 监听器
import { launchBrowser, abs } from '../lib/common.js';
const { browser, context } = await launchBrowser({ profileDir: abs('state/profiles/channels'), headless: true });
const page = await context.newPage();
for (const f of ['chunk-common.7dbff146.js', '404.e44d862a.js']) {
  const t = await page.request.get('https://res.wx.qq.com/t/wx_fed/finder/helper/finder-helper-web/res/static/js/' + f).then((r) => r.text());
  let idx = -1, n = 0;
  while ((idx = t.indexOf('updatePostDesc', idx + 1)) !== -1 && n < 8) {
    const ctx = t.slice(Math.max(0, idx - 400), idx + 400).replace(/\n/g, ' ');
    if (/\$on|addListener|subscribe/.test(ctx) || /postObjDesc\.description|description=/.test(ctx)) {
      console.log(`\n===== ${f} @${idx} =====\n${ctx}`);
    }
    n++;
  }
  console.log(`\n[${f}] updatePostDesc total: ${n}`);
}
await browser.close();

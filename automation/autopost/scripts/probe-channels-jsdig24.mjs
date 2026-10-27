// 挖 combinedStore 的构建 + 真 store 的实例化位置
import { launchBrowser, abs } from '../lib/common.js';
const { browser, context } = await launchBrowser({ profileDir: abs('state/profiles/channels'), headless: true });
const page = await context.newPage();
for (const f of ['chunk-common.7dbff146.js', '404.e44d862a.js', 'chunk-pc.fc4a9227.js']) {
  const t = await page.request.get('https://res.wx.qq.com/t/wx_fed/finder/helper/finder-helper-web/res/static/js/' + f).then((r) => r.text());
  let idx = -1, n = 0;
  while ((idx = t.indexOf('combinedStore', idx + 1)) !== -1 && n < 6) {
    console.log(`\n===== ${f} combinedStore @${idx} =====`);
    console.log(t.slice(Math.max(0, idx - 500), idx + 500).replace(/\n/g, ' '));
    n++;
  }
  if (!n) console.log(`[${f}] no combinedStore`);
}
await browser.close();

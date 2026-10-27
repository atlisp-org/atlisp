// 找 combinedStore 的定义（computed/getter）
import { launchBrowser, abs } from '../lib/common.js';
const { browser, context } = await launchBrowser({ profileDir: abs('state/profiles/channels'), headless: true });
const page = await context.newPage();
const t = await page.request.get('https://res.wx.qq.com/t/wx_fed/finder/helper/finder-helper-web/res/static/js/chunk-common.7dbff146.js').then((r) => r.text());
await browser.close();
for (const k of ['combinedStore(){', 'combinedStore:function', 'get combinedStore(', 'combinedStore(){return', 'Object(ke.b)("combinedStore"']) {
  let idx = -1, n = 0;
  while ((idx = t.indexOf(k, idx + 1)) !== -1 && n < 3) {
    console.log(`\n===== ${k} @${idx} =====`);
    console.log(t.slice(Math.max(0, idx - 300), idx + 700).replace(/\n/g, ' '));
    n++;
  }
}
// 兜底：搜 combinedStore 出现次数
console.log('\ntotal combinedStore:', t.split('combinedStore').length - 1);

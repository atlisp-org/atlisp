// 列出 combinedStore 全部 20 处，找定义
import { launchBrowser, abs } from '../lib/common.js';
const { browser, context } = await launchBrowser({ profileDir: abs('state/profiles/channels'), headless: true });
const page = await context.newPage();
const t = await page.request.get('https://res.wx.qq.com/t/wx_fed/finder/helper/finder-helper-web/res/static/js/chunk-common.7dbff146.js').then((r) => r.text());
await browser.close();
let idx = -1, n = 0;
while ((idx = t.indexOf('combinedStore', idx + 1)) !== -1 && n < 20) {
  const before = t.slice(Math.max(0, idx - 60), idx);
  const after = t.slice(idx + 'combinedStore'.length, idx + 'combinedStore'.length + 80);
  console.log(`@${idx}: ...${before}||${after}`);
  n++;
}

// getCreateOrPreviewParams 完整源码 + mpTitle 的写入路径
import { launchBrowser, abs } from '../lib/common.js';
const { browser, context } = await launchBrowser({ profileDir: abs('state/profiles/channels'), headless: true });
const page = await context.newPage();
const t = await page.request.get('https://res.wx.qq.com/t/wx_fed/finder/helper/finder-helper-web/res/static/js/chunk-common.7dbff146.js').then((r) => r.text());
await browser.close();
const i = t.indexOf('getCreateOrPreviewParams');
console.log('=== getCreateOrPreviewParams ===');
console.log(t.slice(i, i + 2200).replace(/\n/g, ' '));
// mpTitle 赋值点
console.log('\n=== mpTitle 出现点（chunk-common）===');
let idx = -1, n = 0;
while ((idx = t.indexOf('mpTitle', idx + 1)) !== -1 && n < 30) {
  const ctx = t.slice(Math.max(0, idx - 150), idx + 150).replace(/\n/g, ' ');
  if (/mpTitle\s*[:=]|\.mpTitle\s*=|mpTitle:/.test(ctx)) {
    console.log(`@${idx}: ...${ctx}...`);
    n++;
  }
}

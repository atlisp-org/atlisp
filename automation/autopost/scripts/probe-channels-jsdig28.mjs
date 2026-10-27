// 短标题 input 的 render 绑定（哪个组件渲染它）
import { launchBrowser, abs } from '../lib/common.js';
const { browser, context } = await launchBrowser({ profileDir: abs('state/profiles/channels'), headless: true });
const page = await context.newPage();
const t = await page.request.get('https://res.wx.qq.com/t/wx_fed/finder/helper/finder-helper-web/res/static/js/chunk-common.7dbff146.js').then((r) => r.text());
await browser.close();
let idx = -1, n = 0;
while ((idx = t.indexOf('短标题', idx + 1)) !== -1 && n < 12) {
  console.log(`\n===== 短标题 @${idx} =====`);
  console.log(t.slice(Math.max(0, idx - 600), idx + 300).replace(/\n/g, ' '));
  n++;
}

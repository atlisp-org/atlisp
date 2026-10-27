import { launchBrowser, abs } from '../lib/common.js';
const { browser, context } = await launchBrowser({ profileDir: abs('state/profiles/channels'), headless: true });
const page = await context.newPage();
const t = await page.request.get('https://res.wx.qq.com/t/wx_fed/finder/helper/finder-helper-web/res/static/js/chunk-common.7dbff146.js').then((r) => r.text());
await browser.close();
let idx = -1, n = 0;
while ((idx = t.indexOf('handlePost', idx + 1)) !== -1 && n < 4) {
  console.log(`\n===== @${idx} =====\n` + t.slice(Math.max(0, idx - 100), idx + 250).replace(/\n/g, ' '));
  n++;
}
// 也搜 handlePost 的调用形式
for (const k of ['handlePost(!1)', 'handlePost(!0)', '.handlePost(', 'handlePost:']) {
  console.log(`\nCOUNT ${k}: ${t.split(k).length - 1}`);
}

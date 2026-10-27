// 找 this.createPost( / .createPost( 调用点
import { launchBrowser, abs } from '../lib/common.js';
const { browser, context } = await launchBrowser({ profileDir: abs('state/profiles/channels'), headless: true });
const page = await context.newPage();
const t = await page.request.get('https://res.wx.qq.com/t/wx_fed/finder/helper/finder-helper-web/res/static/js/404.e44d862a.js').then((r) => r.text());
await browser.close();
for (const k of ['this.createPost(', '.createPost(']) {
  let idx = -1, n = 0;
  while ((idx = t.indexOf(k, idx + 1)) !== -1 && n < 6) {
    console.log(`\n===== ${k} @${idx} =====`);
    console.log(t.slice(Math.max(0, idx - 400), idx + 400).replace(/\n/g, ' '));
    n++;
  }
}

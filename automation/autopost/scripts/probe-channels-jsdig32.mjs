// 找 getApiUrl 的 "delete" 映射
import { launchBrowser, abs } from '../lib/common.js';
const { browser, context } = await launchBrowser({ profileDir: abs('state/profiles/channels'), headless: true });
const page = await context.newPage();
const base = 'https://res.wx.qq.com/t/wx_fed/finder/helper/finder-helper-web/res/static/js/';
for (const f of ['404.e44d862a.js', 'chunk-common.7dbff146.js']) {
  const t = await page.request.get(base + f).then((r) => r.text());
  // 找 "delete":" 的映射（对象字面量键值）
  for (const pat of ['delete":"', '"delete":', 'post_delete']) {
    let idx = -1, n = 0;
    while ((idx = t.indexOf(pat, idx + 1)) !== -1 && n < 4) {
      console.log(`\n===== ${f} ${pat} @${idx} =====`);
      console.log(t.slice(Math.max(0, idx - 300), idx + 300).replace(/\n/g, ' '));
      n++;
    }
    if (n) console.log(`[${f} "${pat}"] total: ${n}`);
  }
}
await browser.close();

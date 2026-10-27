// getApiUrl base + post_list 映射全貌
import { launchBrowser, abs } from '../lib/common.js';
const { browser, context } = await launchBrowser({ profileDir: abs('state/profiles/channels'), headless: true });
const page = await context.newPage();
const base = 'https://res.wx.qq.com/t/wx_fed/finder/helper/finder-helper-web/res/static/js/';
for (const f of ['404.e44d862a.js', 'chunk-common.7dbff146.js']) {
  const t = await page.request.get(base + f).then((r) => r.text());
  for (const pat of ['getApiUrl(e){', 'getApiUrl(t){', 'cgi-bin', '/micro/content']) {
    let idx = -1, n = 0;
    while ((idx = t.indexOf(pat, idx + 1)) !== -1 && n < 3) {
      console.log(`\n===== ${f} "${pat}" @${idx} =====`);
      console.log(t.slice(Math.max(0, idx - 250), idx + 400).replace(/\n/g, ' '));
      n++;
    }
    if (n) console.log(`[${f} "${pat}"] total: ${n}`);
  }
}
await browser.close();

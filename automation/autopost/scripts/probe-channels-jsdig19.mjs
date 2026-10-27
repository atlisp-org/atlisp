// 挖 handlePost 定义
import { launchBrowser, abs } from '../lib/common.js';
const { browser, context } = await launchBrowser({ profileDir: abs('state/profiles/channels'), headless: true });
const page = await context.newPage();
const urls = ['404.e44d862a.js', 'chunk-common.7dbff146.js', 'chunk-pc.fc4a9227.js', 'chunk-dynamic.5b5aa6ef.js'];
for (const f of urls) {
  const t = await page.request.get('https://res.wx.qq.com/t/wx_fed/finder/helper/finder-helper-web/res/static/js/' + f).then((r) => r.text());
  for (const m of t.matchAll(/handlePost\(/g)) {
    const ctx = t.slice(Math.max(0, m.index - 300), m.index + 300).replace(/\n/g, ' ');
    if (!/handlePost\(!1\)|handlePost\(e\)/.test(ctx) || true) {
      console.log(`\n===== ${f} @${m.index} =====\n${ctx}`);
    }
  }
}
await browser.close();

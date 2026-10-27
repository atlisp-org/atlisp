// 找调用点：checkFinderCommFace({ / postService.create(
import { launchBrowser, abs } from '../lib/common.js';
const { browser, context } = await launchBrowser({ profileDir: abs('state/profiles/channels'), headless: true });
const page = await context.newPage();
const text = await page.request.get('https://res.wx.qq.com/t/wx_fed/finder/helper/finder-helper-web/res/static/js/404.e44d862a.js').then((r) => r.text());
await browser.close();
for (const k of ['checkFinderCommFace({', 'checkFinderCommFace(e)', 'postService.create(', '.create({']) {
  let idx = -1, n = 0;
  while ((idx = text.indexOf(k, idx + 1)) !== -1 && n < 4) {
    console.log(`\n===== ${k} @${idx} =====`);
    console.log(text.slice(Math.max(0, idx - 800), idx + 1200).replace(/\n/g, ' '));
    n++;
  }
}

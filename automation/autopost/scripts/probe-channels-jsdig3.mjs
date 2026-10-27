// 挖 beforeUpload 链路：nameTest/judgeImageList/updateVideoInfoByBroswer 附近代码
import { launchBrowser, loadConfig, abs, sleep } from '../lib/common.js';
const { browser, context } = await launchBrowser({ profileDir: abs('state/profiles/channels'), headless: true });
const page = await context.newPage();
const url = 'https://res.wx.qq.com/t/wx_fed/finder/helper/finder-helper-web/res/static/js/404.e44d862a.js';
const text = await page.request.get(url).then((r) => r.text());
console.log('bundle size:', (text.length / 1024).toFixed(0), 'KB');
for (const k of ['nameTest]beforeUpload', 'judgeImageList', 'updateVideoInfoByBroswer']) {
  let idx = -1, n = 0;
  while ((idx = text.indexOf(k, idx + 1)) !== -1 && n < 2) {
    const ctx = text.slice(Math.max(0, idx - 600), idx + 900).replace(/\n/g, ' ');
    console.log(`\n===== ${k} @${idx} =====\n${ctx}`);
    n++;
  }
}
await browser.close();

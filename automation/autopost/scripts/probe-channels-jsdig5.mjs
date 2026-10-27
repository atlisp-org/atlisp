// 挖 chunk-common 里 beforeUpload 链路代码
import { launchBrowser, loadConfig, abs, sleep } from '../lib/common.js';
const { browser, context } = await launchBrowser({ profileDir: abs('state/profiles/channels'), headless: true });
const page = await context.newPage();
const text = await page.request.get('https://res.wx.qq.com/t/wx_fed/finder/helper/finder-helper-web/res/static/js/chunk-common.7dbff146.js').then((r) => r.text());
for (const k of ['nameTest]beforeUpload', 'updateVideoInfoByBroswer']) {
  let idx = -1, n = 0;
  while ((idx = text.indexOf(k, idx + 1)) !== -1 && n < 2) {
    const ctx = text.slice(Math.max(0, idx - 800), idx + 1500).replace(/\n/g, ' ');
    console.log(`\n===== ${k} @${idx} =====\n${ctx}\n`);
    n++;
  }
}
await browser.close();

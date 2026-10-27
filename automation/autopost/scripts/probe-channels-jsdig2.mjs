// 找 uploadParams 调用点 + startUpload 入口
import { launchBrowser, loadConfig, abs, sleep } from '../lib/common.js';
const { browser, context } = await launchBrowser({ profileDir: abs('state/profiles/channels'), headless: true });
const page = await context.newPage();
const urls = [
  'https://res.wx.qq.com/t/wx_fed/finder/helper/finder-helper-web/res/static/js/404.e44d862a.js',
  'https://res.wx.qq.com/t/wx_fed/finder/helper/finder-helper-web/res/static/js/chunk-common.7dbff146.js',
];
for (const u of urls) {
  const text = await page.request.get(u).then((r) => r.text());
  console.log(`\n########## ${u.split('/').pop()} ##########`);
  const keys = ['.uploadParams(', 'startUpload', 'uploadVideo(', 'accept:', 'video/mp4'];
  for (const k of keys) {
    let idx = -1, count = 0;
    while ((idx = text.indexOf(k, idx + 1)) !== -1 && count < 3) {
      const ctx = text.slice(Math.max(0, idx - 400), idx + 400).replace(/\n/g, ' ');
      console.log(`\n--- ${k} @${idx} ---\n${ctx}`);
      count++;
    }
  }
}
await browser.close();

// 挖 post_clip_video 轮询 + 完成后动作 + 真正的发布 API
import { launchBrowser, abs } from '../lib/common.js';
const { browser, context } = await launchBrowser({ profileDir: abs('state/profiles/channels'), headless: true });
const page = await context.newPage();
const urls = [
  'https://res.wx.qq.com/t/wx_fed/finder/helper/finder-helper-web/res/static/js/chunk-common.7dbff146.js',
  'https://res.wx.qq.com/t/wx_fed/finder/helper/finder-helper-web/res/static/js/404.e44d862a.js',
  'https://res.wx.qq.com/t/wx_fed/finder/helper/finder-helper-web/res/static/js/chunk-pc.fc4a9227.js',
];
const all = {};
for (const u of urls) {
  all[u.split('/').pop()] = await page.request.get(u).then((r) => r.text());
}
await browser.close();

// 1. post_clip_video_result 轮询处
for (const [f, text] of Object.entries(all)) {
  let idx = -1, n = 0;
  while ((idx = text.indexOf('post_clip_video_result', idx + 1)) !== -1 && n < 3) {
    console.log(`\n===== ${f} post_clip_video_result @${idx} =====`);
    console.log(text.slice(Math.max(0, idx - 900), idx + 1200).replace(/\n/g, ' '));
    n++;
  }
}

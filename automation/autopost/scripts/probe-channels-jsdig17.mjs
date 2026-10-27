// 全 bundle 找 checkFinderCommFace 调用点（非定义）
import { launchBrowser, abs } from '../lib/common.js';
const { browser, context } = await launchBrowser({ profileDir: abs('state/profiles/channels'), headless: true });
const page = await context.newPage();
const urls = [
  'chunk-pc.fc4a9227.js', 'chunk-dynamic.5b5aa6ef.js', '816.c7a59812.js', '821.c95fe8bf.js',
  '924.ecedeb72.js', '558.6bce79bb.js', '942.e5dfd487.js', 'index.0aaa6523.js',
  'chunk-common.7dbff146.js',
];
for (const f of urls) {
  const t = await page.request.get('https://res.wx.qq.com/t/wx_fed/finder/helper/finder-helper-web/res/static/js/' + f).then((r) => r.text());
  let idx = -1, n = 0;
  while ((idx = t.indexOf('checkFinderCommFace', idx + 1)) !== -1 && n < 4) {
    const ctx = t.slice(Math.max(0, idx - 300), idx + 300).replace(/\n/g, ' ');
    if (!/async checkFinderCommFace|path:"\/post\/check/.test(ctx)) {
      console.log(`\n===== ${f} @${idx} =====\n${ctx}`);
    }
    n++;
  }
}
await browser.close();

// 全 bundle 搜 beforeUpload 链路日志
import { launchBrowser, loadConfig, abs, sleep } from '../lib/common.js';
const { browser, context } = await launchBrowser({ profileDir: abs('state/profiles/channels'), headless: true });
const page = await context.newPage();
const urls = [
  'https://res.wx.qq.com/t/wx_fed/finder/helper/finder-helper-web/res/static/js/chunk-pc.fc4a9227.js',
  'https://res.wx.qq.com/t/wx_fed/finder/helper/finder-helper-web/res/static/js/chunk-common.7dbff146.js',
  'https://res.wx.qq.com/t/wx_fed/finder/helper/finder-helper-web/res/static/js/chunk-dynamic.5b5aa6ef.js',
  'https://res.wx.qq.com/t/wx_fed/finder/helper/finder-helper-web/res/static/js/816.c7a59812.js',
  'https://res.wx.qq.com/t/wx_fed/finder/helper/finder-helper-web/res/static/js/821.c95fe8bf.js',
  'https://res.wx.qq.com/t/wx_fed/finder/helper/finder-helper-web/res/static/js/924.ecedeb72.js',
  'https://res.wx.qq.com/t/wx_fed/finder/helper/finder-helper-web/res/static/js/558.6bce79bb.js',
  'https://res.wx.qq.com/t/wx_fed/finder/helper/finder-helper-web/res/static/js/942.e5dfd487.js',
  'https://res.wx.qq.com/t/wx_fed/finder/helper/finder-helper-web/res/static/js/index.0aaa6523.js',
];
for (const u of urls) {
  const text = await page.request.get(u).then((r) => r.text());
  for (const k of ['nameTest]beforeUpload', 'judgeImageList', 'updateVideoInfoByBroswer']) {
    if (text.includes(k)) console.log(`FOUND ${k} in ${u.split('/').pop()}`);
  }
}
await browser.close();

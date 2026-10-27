// 全 bundle 搜 handlePost
import { launchBrowser, abs } from '../lib/common.js';
const { browser, context } = await launchBrowser({ profileDir: abs('state/profiles/channels'), headless: true });
const page = await context.newPage();
const urls = ['chunk-common.7dbff146.js','404.e44d862a.js','chunk-pc.fc4a9227.js','chunk-dynamic.5b5aa6ef.js','816.c7a59812.js','821.c95fe8bf.js','924.ecedeb72.js','558.6bce79bb.js','942.e5dfd487.js','index.0aaa6523.js'];
for (const f of urls) {
  const t = await page.request.get('https://res.wx.qq.com/t/wx_fed/finder/helper/finder-helper-web/res/static/js/' + f).then((r) => r.text());
  const c = t.split('handlePost').length - 1;
  if (c) console.log(f, 'handlePost ×', c);
}
await browser.close();

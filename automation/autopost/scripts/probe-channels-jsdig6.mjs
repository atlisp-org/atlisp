// 找 validator 实现 + judgeImageList 上下文
import { launchBrowser, loadConfig, abs, sleep } from '../lib/common.js';
const { browser, context } = await launchBrowser({ profileDir: abs('state/profiles/channels'), headless: true });
const page = await context.newPage();
const text = await page.request.get('https://res.wx.qq.com/t/wx_fed/finder/helper/finder-helper-web/res/static/js/chunk-common.7dbff146.js').then((r) => r.text());
// judgeImageList
let idx = text.indexOf('judgeImageList');
console.log('===== judgeImageList =====\n' + text.slice(Math.max(0, idx - 1200), idx + 800).replace(/\n/g, ' ') + '\n');
// validator 作为 prop 传参的地方
for (const m of text.matchAll(/validator\s*:\s*[a-zA-Z_$][\w$]{0,30}/g)) {
  console.log('VALIDATOR PROP @' + m.index + ': ' + text.slice(Math.max(0, m.index - 200), m.index + 120).replace(/\n/g, ' '));
}
await browser.close();

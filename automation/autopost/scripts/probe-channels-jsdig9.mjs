// 挖 getClipVideoResult 消费处 + post_create 调用处
import { launchBrowser, abs } from '../lib/common.js';
const { browser, context } = await launchBrowser({ profileDir: abs('state/profiles/channels'), headless: true });
const page = await context.newPage();
const all = {};
for (const u of [
  'https://res.wx.qq.com/t/wx_fed/finder/helper/finder-helper-web/res/static/js/chunk-common.7dbff146.js',
  'https://res.wx.qq.com/t/wx_fed/finder/helper/finder-helper-web/res/static/js/404.e44d862a.js',
]) {
  all[u.split('/').pop()] = await page.request.get(u).then((r) => r.text());
}
await browser.close();

for (const [f, text] of Object.entries(all)) {
  // getClipVideoResult 作为方法被调用: .getClipVideoResult(
  for (const m of text.matchAll(/\.getClipVideoResult\(/g)) {
    console.log(`\n===== ${f} .getClipVideoResult( @${m.index} =====`);
    console.log(text.slice(Math.max(0, m.index - 700), m.index + 900).replace(/\n/g, ' '));
  }
  // post_create 被调用: .create( 或 name "create" 的 api 调用
  for (const m of text.matchAll(/getFinderPostTraceKey\(|\.create\(\{/g)) {
    console.log(`\n===== ${f} create/traceKey @${m.index} =====`);
    console.log(text.slice(Math.max(0, m.index - 500), m.index + 700).replace(/\n/g, ' '));
  }
}

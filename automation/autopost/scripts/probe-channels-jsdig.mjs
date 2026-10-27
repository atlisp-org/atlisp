// 挖 404/index bundle 中 upload 相关代码上下文
import { launchBrowser, loadConfig, abs, sleep } from '../lib/common.js';
const fs = await import('node:fs');
const { browser, context } = await launchBrowser({ profileDir: abs('state/profiles/channels'), headless: true });
const page = await context.newPage();
const urls = [
  'https://res.wx.qq.com/t/wx_fed/finder/helper/finder-helper-web/res/static/js/404.e44d862a.js',
  'https://res.wx.qq.com/t/wx_fed/finder/helper/finder-helper-web/res/static/js/index.0aaa6523.js',
];
for (const u of urls) {
  const text = await page.request.get(u).then((r) => r.text());
  console.log(`\n########## ${u.split('/').pop()} (${(text.length / 1024).toFixed(0)}KB) ##########`);
  const keys = ['helper_upload_params', 'uploadVideo', 'snsuploadbig', 'isTrusted'];
  for (const k of keys) {
    let idx = -1;
    while ((idx = text.indexOf(k, idx + 1)) !== -1) {
      const ctx = text.slice(Math.max(0, idx - 350), idx + 350).replace(/\n/g, ' ');
      console.log(`\n--- ${k} @${idx} ---\n${ctx}`);
      if (k === 'isTrusted') break; // isTrusted 只找第一处
    }
  }
}
await browser.close();

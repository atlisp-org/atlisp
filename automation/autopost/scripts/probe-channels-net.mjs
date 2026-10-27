import { launchBrowser, loadConfig, abs } from '../lib/common.js';
const cfg = loadConfig().wechat?.channels?.web || {};
const stateFile = abs(cfg.stateFile || 'state/wechat-channels.json');
const { browser, context } = await launchBrowser({ stateFile, headless: true });
const page = await context.newPage();
const bad = [];
page.on('response', (r) => {
  if (r.status() >= 400 || /captcha|verify|security/i.test(r.url())) {
    bad.push(`${r.status()} ${r.url().slice(0, 120)}`);
  }
});
await page.goto('https://channels.weixin.qq.com/platform/', { waitUntil: 'domcontentloaded', timeout: 60000 });
for (let i = 0; i < 6; i++) {
  await page.waitForTimeout(5000);
  const frames = page.frames().map(f => f.url().slice(30, 80));
  const text = await page.evaluate(() => document.body.innerText.replace(/\n+/g, ' | ').slice(0, 120)).catch(() => 'ERR');
  console.log(`t+${(i+1)*5}s: frames=${JSON.stringify(frames)} body=${text}`);
}
console.log('BAD REQUESTS:', JSON.stringify(bad, null, 1));
await page.screenshot({ path: 'logs/screenshots/channels-net.png' });
await browser.close();

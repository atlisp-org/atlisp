import { launchBrowser, loadConfig, abs } from '../lib/common.js';
import fs from 'node:fs';
const cfg = loadConfig().wechat?.channels?.web || {};
const stateFile = abs(cfg.stateFile || 'state/wechat-channels.json');
const { browser, context } = await launchBrowser({ stateFile, headless: true });
const page = await context.newPage();
let fileChooser = null;
page.on('filechooser', (fc) => { fileChooser = fc; console.log('FILECHOOSER 出现!'); });
await page.goto('https://channels.weixin.qq.com/platform/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(12000);
const f = page.frames().find(fr => fr.url().includes('post-card'));
// 点「发表视频」
try {
  await f.getByText('发表视频', { exact: true }).first().click({ timeout: 8000 });
  console.log('已点击 发表视频');
} catch (e) { console.log('点击失败:', e.message.slice(0, 120)); }
await page.waitForTimeout(8000);
console.log('主URL:', page.url());
console.log('FRAMES:', page.frames().map(fr => fr.url().slice(0, 110)));
console.log('fileChooser:', !!fileChooser);
if (fileChooser) {
  const inputs = await fileChooser.fileInput().catch(() => null);
  console.log('fileInput:', inputs ? '有' : '无');
  // 不真上传，只把上传框的信息 dump 出来
  const accepts = await inputs?.evaluate?.(el => el.accept).catch(() => null);
  console.log('accept:', accepts);
}
// 看主页面和 iframe 的新文本
for (const fr of page.frames()) {
  const u = fr.url();
  if (u.includes('platform/') || u.includes('micro/')) {
    const t = await fr.evaluate(() => document.body.innerText.replace(/\n+/g, ' | ').slice(0, 300)).catch(() => '');
    console.log('FRAME TEXT', u.slice(40, 100), '=>', t.slice(0, 250));
  }
}
await page.screenshot({ path: 'logs/screenshots/channels-after-click.png' });
await browser.close();

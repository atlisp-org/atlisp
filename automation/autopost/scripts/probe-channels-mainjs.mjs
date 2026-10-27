// 主文档 JS bundle 找上传逻辑
import { launchBrowser, loadConfig, abs, sleep } from '../lib/common.js';
const cfg = loadConfig().wechat?.channels?.web || {};
const profileDir = abs(cfg.profileDir || 'state/profiles/channels');
const { browser, context } = await launchBrowser({ profileDir, headless: true });
const page = await context.newPage();
await page.goto('https://channels.weixin.qq.com/platform/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await sleep(12000);
if (/login\.html/i.test(page.url())) { console.log('SESSION DEAD'); await browser.close(); process.exit(0); }
const card = page.frames().find(fr => fr.url().includes('post-card'));
await card.evaluate(() => {
  const el = [...document.querySelectorAll('button')].find(el => el.textContent.trim() === '发表视频');
  el && el.click();
});
await page.waitForURL(/\/platform\/post\/create/, { timeout: 30000 });
await sleep(8000);
const scripts = await page.evaluate(() => [...document.querySelectorAll('script[src]')].map(s => s.src));
console.log('main scripts:', scripts.length);
for (const s of scripts) console.log('  ', s.slice(0, 120));
for (const s of scripts) {
  try {
    const resp = await page.request.get(s);
    const text = await resp.text();
    if (text.length < 2000) continue;
    const found = new Set();
    for (const m of text.matchAll(/["'](\/[a-zA-Z0-9_\-\/]*upload[a-zA-Z0-9_\-]*)["']/g)) found.add(m[1]);
    for (const m of text.matchAll(/(wxtupload|qqlive|uploadVideo|uploadToken|getUpload|beforeUpload|customRequest|finderassistant[a-zA-Z]*upload[a-zA-Z]*)/g)) found.add(m[1]);
    for (const m of text.matchAll(/["']((?:https?:)?\/\/[a-z0-9.\-]*qq\.com[a-zA-Z0-9_\-\/]*upload[a-zA-Z0-9_\-]*)["']/g)) found.add(m[1]);
    if (found.size) {
      console.log(`\n=== ${s.split('/').pop().slice(0, 40)} (${(text.length / 1024).toFixed(0)}KB) ===`);
      for (const f of [...found].slice(0, 25)) console.log('  ', f.slice(0, 110));
    }
  } catch (e) { console.log('fetch err', e.message.slice(0, 60)); }
}
await browser.close();

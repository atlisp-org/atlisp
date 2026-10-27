// 拉编辑器 JS bundle，找上传逻辑
import { launchBrowser, loadConfig, abs, sleep } from '../lib/common.js';
const fs = await import('node:fs');
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
const ed = page.frames().find(fr => fr.url().includes('micro/content/post/create'));
const scripts = await ed.evaluate(() => [...document.querySelectorAll('script[src]')].map(s => s.src));
console.log('scripts:');
for (const s of scripts) console.log('  ', s);
// 拉取每个 bundle 搜索 upload 相关
for (const s of scripts) {
  try {
    const resp = await page.request.get(s);
    const text = await resp.text();
    if (text.length < 1000) continue;
    const found = [];
    const patterns = [/upload[a-zA-Z]*\s*[:=]\s*["'][^"']{3,80}["']/g, /["'](\/[a-z0-9\/\-_]*upload[a-z0-9\/\-_]*)["']/g, /beforeUpload|customRequest|wxtupload|qqlive|uploadVideo|getUploadToken|uploadToken/g];
    for (const p of patterns) {
      const m = text.match(p);
      if (m) found.push(...[...new Set(m)].slice(0, 15));
    }
    if (found.length) {
      console.log(`\n=== ${s.split('/').pop().slice(0, 50)} (${(text.length / 1024).toFixed(0)}KB) ===`);
      for (const f of found) console.log('  ', f.slice(0, 100));
    }
  } catch (e) { console.log('fetch err', s.slice(0, 60), e.message.slice(0, 60)); }
}
await browser.close();

import { launchBrowser, loadConfig, abs, sleep } from '../lib/common.js';
const cfg = loadConfig().wechat?.channels?.web || {};
const profileDir = abs(cfg.profileDir || 'state/profiles/channels');
const { browser, context } = await launchBrowser({ profileDir, headless: true });
const page = await context.newPage();
const net = [];
page.on('request', (r) => { if (/upload|post-create|create/i.test(r.url()) && r.method() !== 'GET') net.push('REQ ' + r.method() + ' ' + r.url().slice(0, 100)); });
page.on('response', (r) => { if (/upload|post-create|create/i.test(r.url()) && r.request().method() !== 'GET') net.push('RES ' + r.status() + ' ' + r.url().slice(0, 100)); });
await page.goto('https://channels.weixin.qq.com/platform/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await sleep(12000);
const card = page.frames().find(fr => fr.url().includes('post-card'));
await card.evaluate(() => {
  const el = [...document.querySelectorAll('button')].find(el => el.textContent.trim() === '发表视频');
  el && el.click();
});
await page.waitForURL(/\/platform\/post\/create/, { timeout: 30000 });
await sleep(8000);
const ed = page.frames().find(fr => fr.url().includes('micro/content/post/create'));
// 标记文档稳定性
await ed.evaluate(() => { window.__marker = 42; });
for (let i = 0; i < 10; i++) {
  await sleep(2000);
  const d = await ed.evaluate(() => ({
    marker: window.__marker ?? 'GONE(文档被换)',
    files: document.querySelectorAll('input[type=file]').length,
    uploads: document.querySelectorAll('.ant-upload').length,
    uploadText: (document.querySelector('.ant-upload')?.parentElement?.innerText || '').replace(/\n+/g, ' ').slice(0, 80),
    ready: document.readyState,
  })).catch(e => 'ERR ' + e.message.slice(0, 60));
  console.log(`t+${(i + 1) * 2}s:`, JSON.stringify(d));
}
console.log('NET:', JSON.stringify(net.slice(-10), null, 1));
await browser.close();

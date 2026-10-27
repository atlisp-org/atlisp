// DataTransfer 上传后，监控 90s 内所有非静态请求，确认视频是否真的上传到服务器
import { launchBrowser, loadConfig, abs, sleep } from '../lib/common.js';
const fs = await import('node:fs');
const path = await import('node:path');
const cfg = loadConfig().wechat?.channels?.web || {};
const profileDir = abs(cfg.profileDir || 'state/profiles/channels');
const { browser, context } = await launchBrowser({ profileDir, headless: true });
const page = await context.newPage();
const reqs = [];
let tUpload = Date.now();
page.on('request', (r) => {
  const u = r.url();
  if (!/\.(png|jpg|jpeg|gif|svg|css|js|woff2?)(\?|$)/.test(u) && !u.includes('static')) {
    reqs.push(`${(Date.now() - tUpload) / 1000 | 0}s ${r.method()} ${u.slice(0, 120)}`);
  }
});
page.on('response', (r) => {
  const u = r.url();
  if (!/\.(png|jpg|jpeg|gif|svg|css|js|woff2?)(\?|$)/.test(u)) {
    reqs.push(`  -> ${r.status()} ${u.slice(0, 100)}`);
  }
});
await page.goto('https://channels.weixin.qq.com/platform/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await sleep(12000);
if (/login\.html/i.test(page.url())) { console.log('SESSION DEAD'); await browser.close(); process.exit(0); }
const card = page.frames().find(fr => fr.url().includes('post-card'));
await card.evaluate(() => {
  const el = [...document.querySelectorAll('button')].find(el => el.textContent.trim() === '发表视频');
  el && el.click();
});
await page.waitForURL(/\/platform\/post\/create/, { timeout: 30000 });
await sleep(10000);
const ed = page.frames().find(fr => fr.url().includes('micro/content/post/create'));
const videoAbs = abs('media/test-channels-dryrun.mp4');
const b64 = fs.readFileSync(videoAbs).toString('base64');
reqs.length = 0;
tUpload = Date.now();
await ed.evaluate(([b64, name]) => {
  const bin = atob(b64); const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const file = new File([bytes], name, { type: 'video/mp4', lastModified: Date.now() });
  const input = document.querySelector('input[type=file]');
  const dt = new DataTransfer(); dt.items.add(file);
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}, [b64, path.basename(videoAbs)]);
for (let i = 0; i < 18; i++) {
  await sleep(5000);
  const st = await ed.evaluate(() => {
    const up = document.querySelector('.ant-upload');
    const input = document.querySelector('input[type=file]');
    return {
      inputFiles: input ? input.files.length : 'NO-INPUT',
      uploadText: up ? (up.parentElement.innerText || '').slice(0, 100).replace(/\n+/g, ' | ') : '',
      progressEls: [...document.querySelectorAll('[class*="progress"]')].map(e => (e.innerText || '').slice(0, 30)).slice(0, 4),
      videoCardText: (document.querySelector('.cover') || {}).innerText || '',
    };
  }).catch((e) => 'ERR ' + e.message.slice(0, 60));
  console.log(`t+${(i + 1) * 5}s:`, JSON.stringify(st));
  console.log('  NET so far:');
  for (const r of reqs) console.log('   ', r);
  reqs.length = 0;
}
await browser.close();

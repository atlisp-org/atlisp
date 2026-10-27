// 抓 post_list API 响应，看新帖的真实数据（标题/状态/审核）
import { launchBrowser, abs, sleep } from '../lib/common.js';
const { browser, context } = await launchBrowser({ profileDir: abs('state/profiles/channels'), headless: true });
const page = await context.newPage();
const hits = [];
page.on('response', async (r) => {
  const u = r.url();
  if (r.request().method() === 'POST' && /post_list|post_mcn_list|megaList/.test(u)) {
    let b = '';
    try { b = await r.text(); } catch {}
    hits.push({ u: u.split('?')[0].replace('https://channels.weixin.qq.com', ''), body: b.slice(0, 3000) });
  }
});
await page.goto('https://channels.weixin.qq.com/platform/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await sleep(15000);
if (/login\.html/i.test(page.url())) { console.log('SESSION DEAD'); await browser.close(); process.exit(0); }
// 再触发一次（刷新 post-card 区域：整页刷新最可靠）
await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
await sleep(12000);
console.log('hits:', hits.length);
for (const h of hits.slice(0, 2)) {
  console.log('\n=====', h.u, '=====');
  console.log(h.body);
}
await browser.close();

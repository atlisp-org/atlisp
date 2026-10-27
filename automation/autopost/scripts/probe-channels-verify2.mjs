// 抓 post_list 最新条目完整 dump（验证 desc 全文 + shortTitle + status）
import { launchBrowser, loadConfig, abs, sleep } from '../lib/common.js';
const cfg = loadConfig().wechat?.channels?.web || {};
const profileDir = abs(cfg.profileDir || 'state/profiles/channels');
const { browser, context } = await launchBrowser({ profileDir, headless: true });
const page = await context.newPage();
let listData = null;
const onResp = async (r) => {
  try {
    if (r.request().method() === 'POST' && r.url().includes('/post/post_list')) {
      const j = JSON.parse(await r.text());
      if (j && j.data && Array.isArray(j.data.list) && j.data.list.length) listData = j.data.list;
    }
  } catch {}
};
page.on('response', onResp);
await page.goto('https://channels.weixin.qq.com/platform/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
for (let i = 0; i < 8 && !listData; i++) await sleep(3000);
page.off('response', onResp);
if (!listData) { console.log('NO DATA'); await browser.close(); process.exit(0); }
for (const item of listData.slice(0, 3)) {
  const d = item.desc || {};
  console.log('---');
  console.log('objectId:', item.objectId);
  console.log('createTime:', item.createTime, new Date(item.createTime * 1000).toISOString());
  console.log('status:', item.status, 'visibleType:', item.visibleType);
  console.log('shortTitle:', JSON.stringify(d.shortTitle));
  console.log('description:', JSON.stringify(d.description));
}
await browser.close();

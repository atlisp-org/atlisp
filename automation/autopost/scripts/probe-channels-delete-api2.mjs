// 正确 base: /cgi-bin/mmfinderassistant-bin/post/post_delete
import { launchBrowser, loadConfig, abs, sleep } from '../lib/common.js';
const cfg = loadConfig().wechat?.channels?.web || {};
const profileDir = abs(cfg.profileDir || 'state/profiles/channels');
const TARGETS = [
  'export/UzFfBgAAxLSvRGttGGa6k8zT4DCaeL0eYc-z3ueufB0xOAxVaQ',
  'export/UzFfBgAAxISvLFRiD2m6k8zT4DCa_2Qh-BRKhsToXgOwokKcJQ',
  'export/UzFfBgAAxLavCAVFOWi6k8zT4DCaBg_qPUdibJtEdJdS5q6I2w',
];
const URL = 'https://channels.weixin.qq.com/cgi-bin/mmfinderassistant-bin/post/post_delete';
const { browser, context } = await launchBrowser({ profileDir, headless: true });
const page = await context.newPage();
await page.goto('https://channels.weixin.qq.com/platform/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await sleep(8000);
if (/login\.html/i.test(page.url())) { console.log('SESSION DEAD'); await browser.close(); process.exit(0); }

for (const id of TARGETS) {
  const r = await page.request.post(URL, {
    data: { objectId: id },
    headers: { 'content-type': 'application/json' },
  });
  const body = await r.text().catch(() => '');
  console.log('DELETE', id.slice(-12), r.status(), body.slice(0, 200));
  await sleep(1500);
}

// 验证
let listData = null;
const onResp = async (r) => {
  try {
    if (r.request().method() === 'POST' && r.url().includes('/post_list')) {
      const j = JSON.parse(await r.text());
      if (j && j.data && Array.isArray(j.data.list) && j.data.list.length) listData = j.data.list;
    }
  } catch {}
};
page.on('response', onResp);
await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
for (let i = 0; i < 8 && !listData; i++) await sleep(3000);
page.off('response', onResp);
if (!listData) { console.log('NO post_list DATA'); await browser.close(); process.exit(0); }
console.log('剩余帖子数:', listData.length);
for (const item of listData.slice(0, 5)) {
  const d = item.desc || {};
  console.log('-', new Date(item.createTime * 1000).toISOString(),
    'title:', JSON.stringify(((d.shortTitle || [])[0] || {}).shortTitle || '').slice(0, 30),
    'desc:', JSON.stringify((d.description || '').slice(0, 25)));
}
console.log('3 条测试帖全部删除:', listData.every((i) => !TARGETS.includes(i.objectId)) ? 'YES' : 'NO');
await browser.close();

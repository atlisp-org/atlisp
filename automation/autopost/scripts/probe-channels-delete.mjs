// 删除最近 3 条测试帖（feed 内「删除」是叶子元素；逐条删第一条，列表重渲染后继续）
import { launchBrowser, loadConfig, abs, sleep } from '../lib/common.js';
const cfg = loadConfig().wechat?.channels?.web || {};
const profileDir = abs(cfg.profileDir || 'state/profiles/channels');
const { browser, context } = await launchBrowser({ profileDir, headless: true });
const page = await context.newPage();
await page.goto('https://channels.weixin.qq.com/platform/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await sleep(12000);
if (/login\.html/i.test(page.url())) { console.log('SESSION DEAD'); await browser.close(); process.exit(0); }
const card = page.frames().find((fr) => fr.url().includes('post-card'));
if (!card) { console.log('NO CARD FRAME'); await browser.close(); process.exit(0); }

async function firstItemInfo() {
  return card.evaluate(() => {
    const it = document.querySelector('div.post-feed-item');
    if (!it) return null;
    const d = it.querySelector('.desc');
    const t = it.querySelector('.title, [class*="title"]');
    return {
      desc: (d && d.innerText || '').trim().slice(0, 40),
      title: (t && t.innerText || '').trim().slice(0, 40),
      text: (it.innerText || '').replace(/\s+/g, ' ').slice(0, 80),
    };
  });
}

async function clickDeleteOnFirst() {
  // 第一条 feed 项内的「删除」叶子元素
  const r = await card.evaluate(() => {
    const it = document.querySelector('div.post-feed-item');
    if (!it) return { err: 'no item' };
    const del = [...it.querySelectorAll('*')].find((e) => e.children.length === 0 && (e.textContent || '').trim() === '删除');
    if (!del) return { err: 'no 删除 leaf' };
    del.click();
    return { ok: true };
  });
  if (!r.ok) return r;
  // 等确认对话框，点「删除/确定/确认」（排除 取消）
  for (let i = 0; i < 10; i++) {
    await sleep(1000);
    const dlg = await card.evaluate(() => {
      const vis = (b) => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      const btns = [...document.querySelectorAll('button')].filter(vis);
      const b = btns.find((x) => ['删除', '确定', '确认', '确认删除'].includes(x.textContent.trim()));
      if (b) { b.click(); return { clicked: b.textContent.trim() }; }
      return null;
    }).catch(() => null);
    if (dlg && dlg.clicked) return { ok: true, dlg: dlg.clicked };
  }
  return { err: 'no confirm dialog' };
}

for (let i = 1; i <= 3; i++) {
  const info = await firstItemInfo();
  console.log(`第${i}条待删:`, JSON.stringify(info));
  if (!info) { console.log('列表已空'); break; }
  const r = await clickDeleteOnFirst();
  console.log(`  删除结果:`, JSON.stringify(r));
  await sleep(5000); // 等列表重渲染
}
await sleep(3000);
const after = await firstItemInfo();
console.log('删除后第一条:', JSON.stringify(after));
await browser.close();

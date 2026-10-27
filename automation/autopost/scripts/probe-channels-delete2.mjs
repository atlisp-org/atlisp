// 点「删除」后：dump 删除元素结构 + 顶层文档与 card frame 的对话框/弹层
import { launchBrowser, loadConfig, abs, sleep } from '../lib/common.js';
const cfg = loadConfig().wechat?.channels?.web || {};
const profileDir = abs(cfg.profileDir || 'state/profiles/channels');
const { browser, context } = await launchBrowser({ profileDir, headless: true });
const page = await context.newPage();
await page.goto('https://channels.weixin.qq.com/platform/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await sleep(12000);
if (/login\.html/i.test(page.url())) { console.log('SESSION DEAD'); await browser.close(); process.exit(0); }
const card = page.frames().find((fr) => fr.url().includes('post-card'));

// 1) 「删除」叶子的 DOM 结构
const struct = await card.evaluate(() => {
  const it = document.querySelector('div.post-feed-item');
  const del = [...it.querySelectorAll('*')].find((e) => e.children.length === 0 && (e.textContent || '').trim() === '删除');
  if (!del) return { err: 'no del' };
  let out = 'LEAF: <' + del.tagName.toLowerCase() + ' class="' + del.className + '">';
  let p = del.parentElement, d = 0;
  while (p && d < 4) { out += '\n  PARENT: <' + p.tagName.toLowerCase() + ' class="' + (p.className || '').toString().slice(0, 80) + '">'; p = p.parentElement; d++; }
  // 同级的其它动作
  const sib = del.parentElement ? [...del.parentElement.children].map((c) => c.textContent.trim().slice(0, 10)) : [];
  return { html: out, siblings: sib, parentHTML: (del.parentElement && del.parentElement.outerHTML || '').slice(0, 600) };
});
console.log('=== 删除叶子结构 ===');
console.log(struct.html);
console.log('siblings:', JSON.stringify(struct.siblings));
console.log('parentHTML:', (struct.parentHTML || '').replace(/\s+/g, ' '));

// 2) 点击
await card.evaluate(() => {
  const it = document.querySelector('div.post-feed-item');
  const del = [...it.querySelectorAll('*')].find((e) => e.children.length === 0 && (e.textContent || '').trim() === '删除');
  del.click();
});
await sleep(2500);

// 3) card frame 内新出现的弹层
const cardDlg = await card.evaluate(() => {
  const vis = (b) => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const btns = [...document.querySelectorAll('button')].filter(vis).map((b) => b.textContent.trim());
  const dlgs = [...document.querySelectorAll('[class*="dialog"],[class*="Dialog"],[class*="popover"],[class*="modal"],[class*="mask"]')].filter((e) => e.offsetParent !== null).map((e) => (e.className || '').toString().slice(0, 60));
  return { visibleButtons: btns, dlgEls: dlgs, bodyText: (document.body.innerText || '').replace(/\s+/g, ' ').slice(-300) };
});
console.log('=== card frame 弹层 ===');
console.log(JSON.stringify(cardDlg, null, 1));

// 4) 顶层文档的弹层
const topDlg = await page.evaluate(() => {
  const vis = (b) => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const btns = [...document.querySelectorAll('button')].filter(vis).map((b) => b.textContent.trim());
  const dlgs = [...document.querySelectorAll('[class*="dialog"],[class*="Dialog"],[class*="popover"],[class*="modal"]')].filter((e) => e.offsetParent !== null).map((e) => (e.className || '').toString().slice(0, 60));
  return { visibleButtons: btns.slice(0, 20), dlgEls: dlgs };
});
console.log('=== 顶层文档弹层 ===');
console.log(JSON.stringify(topDlg, null, 1));
await browser.close();

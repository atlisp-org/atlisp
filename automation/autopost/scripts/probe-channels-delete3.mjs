// 点 .opr-item（图标）触发删除 → 找真可见的确认对话框
import { launchBrowser, loadConfig, abs, sleep } from '../lib/common.js';
const cfg = loadConfig().wechat?.channels?.web || {};
const profileDir = abs(cfg.profileDir || 'state/profiles/channels');
const { browser, context } = await launchBrowser({ profileDir, headless: true });
const page = await context.newPage();
await page.goto('https://channels.weixin.qq.com/platform/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await sleep(12000);
if (/login\.html/i.test(page.url())) { console.log('SESSION DEAD'); await browser.close(); process.exit(0); }
const card = page.frames().find((fr) => fr.url().includes('post-card'));

const visibleDialogs = () => card.evaluate(() => {
  const isVis = (e) => {
    const s = getComputedStyle(e);
    return s.display !== 'none' && s.visibility !== 'hidden' && e.getBoundingClientRect().width > 0;
  };
  return [...document.querySelectorAll('[class*="dialog"],[class*="Dialog"]')]
    .filter(isVis)
    .map((e) => ({ cls: (e.className || '').toString().slice(0, 60), text: (e.innerText || '').replace(/\s+/g, ' ').slice(0, 120) }));
});

// 第一条的「删除」对应的 opr-item-wrap（按 action-content 文本匹配）
const clickDel = async () => card.evaluate(() => {
  const it = document.querySelector('div.post-feed-item');
  if (!it) return { err: 'no item' };
  const wraps = [...it.querySelectorAll('.opr-item-wrap')];
  const w = wraps.find((x) => (x.querySelector('.action-content') || {}).textContent.trim() === '删除');
  if (!w) return { err: 'no del wrap' };
  const target = w.querySelector('.opr-item') || w;
  target.click();
  return { ok: true, tag: target.tagName };
});

const info = () => card.evaluate(() => {
  const it = document.querySelector('div.post-feed-item');
  return it ? (it.innerText || '').replace(/\s+/g, ' ').slice(0, 60) : null;
});

console.log('删除前第一条:', await info());
const r = await clickDel();
console.log('点击结果:', JSON.stringify(r));
await sleep(2500);
const dlgs = await visibleDialogs();
console.log('可见对话框:', JSON.stringify(dlgs, null, 1));

// 如果对话框出现，点确认（删除/确定）
const clicked = await card.evaluate(() => {
  const isVis = (e) => {
    const s = getComputedStyle(e);
    const r = e.getBoundingClientRect();
    return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0;
  };
  const btns = [...document.querySelectorAll('button')].filter(isVis);
  const b = btns.find((x) => ['删除', '确定', '确认', '确认删除'].includes(x.textContent.trim()));
  if (b) { const t = b.textContent.trim(); b.click(); return t; }
  return null;
});
console.log('确认按钮点击:', clicked);
await sleep(4000);
console.log('删除后第一条:', await info());
await browser.close();

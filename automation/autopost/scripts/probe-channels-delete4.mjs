// 找 post-card iframe 在顶层的坐标 + 删除图标的 frame 内坐标 → CDP 真实点击
import { launchBrowser, loadConfig, abs, sleep } from '../lib/common.js';
const cfg = loadConfig().wechat?.channels?.web || {};
const profileDir = abs(cfg.profileDir || 'state/profiles/channels');
const { browser, context } = await launchBrowser({ profileDir, headless: true });
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await page.goto('https://channels.weixin.qq.com/platform/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await sleep(12000);
if (/login\.html/i.test(page.url())) { console.log('SESSION DEAD'); await browser.close(); process.exit(0); }

// 顶层文档里的 iframe 列表（找 post-card）
const iframes = await page.evaluate(() =>
  [...document.querySelectorAll('iframe')].map((f) => {
    const r = f.getBoundingClientRect();
    return { src: (f.src || '').slice(0, 90), x: r.x, y: r.y, w: r.width, h: r.height, visible: r.width > 0 && r.height > 0 };
  }),
);
console.log('iframes:', JSON.stringify(iframes, null, 1));

const card = page.frames().find((fr) => fr.url().includes('post-card'));
// 删除图标在 frame 内的坐标
const iconBox = await card.evaluate(() => {
  const it = document.querySelector('div.post-feed-item');
  const wraps = [...it.querySelectorAll('.opr-item-wrap')];
  const w = wraps.find((x) => (x.querySelector('.action-content') || {}).textContent.trim() === '删除');
  if (!w) return null;
  const t = w.querySelector('.opr-item') || w;
  const r = t.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height };
});
console.log('icon box (frame 内):', JSON.stringify(iconBox));
const cardF = iframes.find((f) => f.src.includes('post-card'));
console.log('card iframe (顶层):', JSON.stringify(cardF));
await browser.close();

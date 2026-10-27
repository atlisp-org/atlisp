// dump post-card 第一条的 HTML（不限元素类型找「删除」）
import { launchBrowser, abs, sleep } from '../lib/common.js';
const { browser, context } = await launchBrowser({ profileDir: abs('state/profiles/channels'), headless: true });
const page = await context.newPage();
await page.goto('https://channels.weixin.qq.com/platform/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await sleep(12000);
if (/login\.html/i.test(page.url())) { console.log('SESSION DEAD'); await browser.close(); process.exit(0); }
const card = page.frames().find((fr) => fr.url().includes('post-card'));
const html = await card.evaluate(() => {
  const els = [...document.querySelectorAll('*')].filter((e) => (e.textContent || '').trim() === '删除' && e.children.length === 0);
  if (!els.length) return 'NO 删除 LEAF';
  let el = els[0];
  for (let i = 0; i < 10 && el.parentElement; i++) {
    if (/2026年10月27日 21:48/.test(el.textContent || '')) break;
    el = el.parentElement;
  }
  return el.outerHTML.slice(0, 5000);
}).catch((e) => 'ERR ' + e.message);
console.log(html);
await browser.close();

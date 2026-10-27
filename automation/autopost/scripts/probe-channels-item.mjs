// dump post-card 第一条的 HTML（看标题在哪、是否审核中）
import { launchBrowser, abs, sleep } from '../lib/common.js';
const { browser, context } = await launchBrowser({ profileDir: abs('state/profiles/channels'), headless: true });
const page = await context.newPage();
await page.goto('https://channels.weixin.qq.com/platform/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await sleep(12000);
if (/login\.html/i.test(page.url())) { console.log('SESSION DEAD'); await browser.close(); process.exit(0); }
const card = page.frames().find((fr) => fr.url().includes('post-card'));
const html = await card.evaluate(() => {
  // 找含「删除」的条目容器（每个视频条目都有）
  const dels = [...document.querySelectorAll('button')].filter((b) => b.textContent.trim() === '删除');
  if (!dels.length) return 'NO ITEMS';
  // 向上找到条目容器：包含日期文本的最近祖先
  let el = dels[0];
  for (let i = 0; i < 8 && el.parentElement; i++) {
    if (/2026年10月27日/.test(el.textContent || '')) break;
    el = el.parentElement;
  }
  return el.outerHTML.slice(0, 4000);
}).catch((e) => 'ERR ' + e.message);
console.log(html);
await browser.close();

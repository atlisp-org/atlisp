import { launchBrowser, loadConfig, abs, sleep } from '../lib/common.js';
const cfg = loadConfig().wechat?.channels?.web || {};
const profileDir = abs(cfg.profileDir || 'state/profiles/channels');
const { browser, context } = await launchBrowser({ profileDir, headless: true });
const page = await context.newPage();
await page.goto('https://channels.weixin.qq.com/platform/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await sleep(12000);
const card = page.frames().find(fr => fr.url().includes('post-card'));
await card.evaluate(() => {
  const el = [...document.querySelectorAll('button')].find(el => el.textContent.trim() === '发表视频');
  el && el.click();
});
await page.waitForURL(/\/platform\/post\/create/, { timeout: 30000 });
await sleep(8000);
// 主页面里的所有 iframe 元素
const ifEls = await page.evaluate(() =>
  [...document.querySelectorAll('iframe')].map((el, i) => ({
    i,
    src: (el.src || '').slice(0, 90),
    id: el.id || undefined,
    rect: (() => { const r = el.getBoundingClientRect(); return `${Math.round(r.width)}x${Math.round(r.height)}`; })(),
  }))
);
console.log('IFRAME ELEMENTS:', JSON.stringify(ifEls, null, 1));
// 每个 frame：url + 内容特征 + frameElement 的 src
for (const f of page.frames()) {
  const u = f.url();
  const c = await f.evaluate(() => ({
    inputs: document.querySelectorAll('input').length,
    files: document.querySelectorAll('input[type=file]').length,
    text: document.body ? document.body.innerText.replace(/\n+/g, ' ').slice(0, 60) : '(no body)',
  })).catch(() => 'ERR');
  const fe = await f.frameElement().catch(() => null);
  const feSrc = fe ? await fe.evaluate((el) => (el.src || '').slice(0, 70)).catch(() => '?') : '?';
  console.log(`FRAME url=${u.slice(30, 80)}\n  content=${JSON.stringify(c)}\n  frameElementSrc=${feSrc}`);
}
await browser.close();

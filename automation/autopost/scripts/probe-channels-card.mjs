import { launchBrowser, loadConfig, abs } from '../lib/common.js';
const cfg = loadConfig().wechat?.channels?.web || {};
const stateFile = abs(cfg.stateFile || 'state/wechat-channels.json');
const { browser, context } = await launchBrowser({ stateFile, headless: true });
const page = await context.newPage();
await page.goto('https://channels.weixin.qq.com/platform/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(12000);
const f = page.frames().find(fr => fr.url().includes('post-card'));
if (!f) { console.log('no post-card frame'); await browser.close(); process.exit(1); }
console.log('FRAME URL:', f.url());
const info = await f.evaluate(() => ({
  text: document.body.innerText.replace(/\n+/g, ' | ').slice(0, 500),
  clickables: [...document.querySelectorAll('div, span, a, button, img')].map(el => ({
    tag: el.tagName.toLowerCase(),
    t: (el.innerText || el.title || el.getAttribute('alt') || '').trim().slice(0, 20),
    cls: (el.className?.toString() || '').slice(0, 50),
    rect: (() => { const r = el.getBoundingClientRect(); return `${Math.round(r.width)}x${Math.round(r.height)}`; })(),
  })).filter(x => x.t && x.t.length <= 20 && x.rect !== '0x0').slice(0, 30),
}));
console.log(JSON.stringify(info, null, 1));
await browser.close();

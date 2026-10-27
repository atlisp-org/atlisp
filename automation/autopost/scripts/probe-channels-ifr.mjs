import { launchBrowser, loadConfig, abs } from '../lib/common.js';
const cfg = loadConfig().wechat?.channels?.web || {};
const stateFile = abs(cfg.stateFile || 'state/wechat-channels.json');
const { browser, context } = await launchBrowser({ stateFile, headless: true });
const page = await context.newPage();
await page.goto('https://channels.weixin.qq.com/platform/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(12000);
const info = await page.evaluate(() => ({
  iframes: [...document.querySelectorAll('iframe')].map(f => ({ src: (f.src||'').slice(0,100), id: f.id||undefined, rect: (() => { const r = f.getBoundingClientRect(); return `${Math.round(r.width)}x${Math.round(r.height)}`; })() })),
  fixedEls: [...document.querySelectorAll('*')].filter(el => {
    const s = getComputedStyle(el);
    return (s.position === 'fixed' || s.position === 'sticky') && el.getBoundingClientRect().width > 0;
  }).map(el => ({ tag: el.tagName.toLowerCase(), t: (el.innerText||'').trim().slice(0,15), cls: (el.className?.toString()||'').slice(0,50) })).slice(0, 15),
  ariaBtns: [...document.querySelectorAll('[aria-label], [title]')].map(el => ({ tag: el.tagName.toLowerCase(), label: el.getAttribute('aria-label') || el.getAttribute('title') })).filter(x => /发表|创作|上传|发布/.test(x.label)).slice(0, 10),
}));
console.log(JSON.stringify(info, null, 1));
console.log('FRAMES:', page.frames().map(f => f.url().slice(0, 100)));
await browser.close();

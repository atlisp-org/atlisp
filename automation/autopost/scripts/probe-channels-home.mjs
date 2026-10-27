// 探测：视频号助手平台首页（已登录态）
import { launchBrowser, loadConfig, abs } from '../lib/common.js';

const cfg = loadConfig().wechat?.channels?.web || {};
const stateFile = abs(cfg.stateFile || 'state/wechat-channels.json');
const { browser, context } = await launchBrowser({ stateFile, headless: true });
const page = await context.newPage();
await page.goto('https://channels.weixin.qq.com/platform/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(8000);
console.log('URL:', page.url());
console.log('TITLE:', await page.title());
const info = await page.evaluate(() => ({
  bodyText: document.body.innerText.replace(/\n+/g, ' | ').slice(0, 900),
  buttons: [...document.querySelectorAll('button, [class*="btn"], [role="button"]')].map(b => b.innerText.trim()).filter(t => t && t.length < 20).slice(0, 30),
  links: [...document.querySelectorAll('a[href]')].map(a => ({ t: (a.innerText||'').trim().slice(0,15), h: a.getAttribute('href')?.slice(0,60) })).filter(x => x.t || (x.h||'').includes('post')).slice(0, 25),
}));
console.log(JSON.stringify(info, null, 1));
await browser.close();

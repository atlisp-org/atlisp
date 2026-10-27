// 顶层文档是否也渲染了 feed？+ 截图
import { launchBrowser, loadConfig, abs, sleep } from '../lib/common.js';
const cfg = loadConfig().wechat?.channels?.web || {};
const profileDir = abs(cfg.profileDir || 'state/profiles/channels');
const { browser, context } = await launchBrowser({ profileDir, headless: true });
const page = await context.newPage();
await page.setViewportSize({ width: 1440, height: 900 });
await page.goto('https://channels.weixin.qq.com/platform/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await sleep(12000);
if (/login\.html/i.test(page.url())) { console.log('SESSION DEAD'); await browser.close(); process.exit(0); }
const topText = await page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 400));
console.log('顶层 body 文本:', topText);
const html = await page.evaluate(() => document.body.innerHTML.slice(0, 1500));
console.log('顶层 body HTML 头部:', html.replace(/\s+/g, ' '));
await page.screenshot({ path: 'state/shot-platform-top.png' });
console.log('screenshot saved');
await browser.close();

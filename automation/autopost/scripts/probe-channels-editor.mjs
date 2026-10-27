import { launchBrowser, loadConfig, abs } from '../lib/common.js';
const cfg = loadConfig().wechat?.channels?.web || {};
const stateFile = abs(cfg.stateFile || 'state/wechat-channels.json');
const { browser, context } = await launchBrowser({ stateFile, headless: true });
const page = await context.newPage();
let fc = null;
page.on('filechooser', (x) => { fc = x; });
await page.goto('https://channels.weixin.qq.com/platform/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(10000);
const f = page.frames().find(fr => fr.url().includes('post-card'));
await f.evaluate(() => {
  const el = [...document.querySelectorAll('button')].find(el => el.textContent.trim() === '发表视频');
  el && el.click();
});
await page.waitForTimeout(8000);
console.log('URL:', page.url());
const e = page.frames().find(fr => fr.url().includes('micro/content/post/create'));
if (!e) { console.log('未找到编辑器 iframe'); await browser.close(); process.exit(1); }
console.log('编辑器 URL:', e.url());
const info = await e.evaluate(() => ({
  text: document.body.innerText.replace(/\n+/g, ' | ').slice(0, 600),
  fileInputs: [...document.querySelectorAll('input[type=file]')].map(i => ({
    accept: i.accept || '', multiple: i.multiple, cls: (i.className?.toString() || '').slice(0, 40),
    parentCls: (i.parentElement?.className?.toString() || '').slice(0, 60),
  })),
  textareas: [...document.querySelectorAll('textarea')].map(t => ({
    ph: t.placeholder || '', cls: (t.className?.toString() || '').slice(0, 50),
  })),
  inputs: [...document.querySelectorAll('input:not([type=file])')].map(i => ({
    type: i.type, ph: i.placeholder || '', cls: (i.className?.toString() || '').slice(0, 40),
  })).slice(0, 10),
  buttons: [...document.querySelectorAll('button')].map(b => b.innerText.trim()).filter(t => t).slice(0, 25),
}));
console.log(JSON.stringify(info, null, 1));
await page.screenshot({ path: 'logs/screenshots/channels-editor.png' });
await browser.close();

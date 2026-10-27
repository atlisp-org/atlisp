// 爬 Vue 组件树：找上传组件，看状态/方法
import { launchBrowser, loadConfig, abs, sleep } from '../lib/common.js';
const fs = await import('node:fs');
const path = await import('node:path');
const cfg = loadConfig().wechat?.channels?.web || {};
const profileDir = abs(cfg.profileDir || 'state/profiles/channels');
const { browser, context } = await launchBrowser({ profileDir, headless: true });
const page = await context.newPage();
await page.goto('https://channels.weixin.qq.com/platform/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await sleep(12000);
if (/login\.html/i.test(page.url())) { console.log('SESSION DEAD'); await browser.close(); process.exit(0); }
const card = page.frames().find(fr => fr.url().includes('post-card'));
await card.evaluate(() => {
  const el = [...document.querySelectorAll('button')].find(el => el.textContent.trim() === '发表视频');
  el && el.click();
});
await page.waitForURL(/\/platform\/post\/create/, { timeout: 30000 });
await sleep(10000);
const ed = page.frames().find(fr => fr.url().includes('micro/content/post/create'));
// 从 file input 向上爬找 Vue 实例
const info = await ed.evaluate(() => {
  const out = [];
  let el = document.querySelector('input[type=file]');
  let depth = 0;
  while (el && depth < 15) {
    const v = el.__vue__;
    if (v) {
      out.push({
        depth,
        tag: el.tagName + '.' + (el.className || '').toString().slice(0, 40),
        name: v.$options && v.$options.name,
        props: Object.keys(v.$props || {}),
        methods: Object.keys(v.$options.methods || {}).slice(0, 20),
        dataKeys: Object.keys(v.$data || {}).slice(0, 20),
      });
    }
    el = el.parentElement;
    depth++;
  }
  return out;
}).catch((e) => 'ERR ' + e.message.slice(0, 100));
console.log(JSON.stringify(info, null, 1));
// 也检查 input 的 Vue 事件监听（getEventListeners 不可用，但可以看 __vue__ 的 $el 链）
await browser.close();

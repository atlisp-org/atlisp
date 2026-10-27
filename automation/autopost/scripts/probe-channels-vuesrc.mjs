// dump ajaxUploader/AUpload/父组件的 beforeUpload + customRequest 源码
import { launchBrowser, loadConfig, abs, sleep } from '../lib/common.js';
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
const info = await ed.evaluate(() => {
  const out = {};
  const input = document.querySelector('input[type=file]');
  const ajax = input.parentElement.__vue__;
  out.ajaxName = ajax.$options.name;
  out.ajaxBeforeUpload = (ajax.$props.beforeUpload || '').toString().slice(0, 800);
  out.ajaxCustomRequest = (ajax.$props.customRequest || '').toString().slice(0, 1200);
  // AUpload
  let el = input.parentElement;
  let au = null;
  while (el) {
    const v = el.__vue__;
    if (v && v.$options.name === 'AUpload') { au = v; break; }
    el = el.parentElement;
  }
  if (au) {
    out.auDataKeys = Object.keys(au.$data || {});
    out.auFileList = JSON.stringify(au.$data.fileList || au.fileList || null).slice(0, 300);
    out.auBeforeUpload = (au.$props.beforeUpload || '').toString().slice(0, 800);
    // 再往上找 post-upload-wrap 的组件
    let el2 = el;
    for (let i = 0; i < 8 && el2; i++) {
      const v2 = el2.__vue__;
      if (v2 && v2 !== au) {
        const name = v2.$options.name;
        if (name && /upload|post/i.test(name)) {
          out.parentName = name;
          out.parentDataKeys = Object.keys(v2.$data || {});
          out.parentValue = JSON.stringify(v2.$data.value || v2.value || null).slice(0, 300);
          const m = Object.keys(v2.$options.methods || {});
          out.parentMethods = m.slice(0, 25);
          const cu = (v2.$options.methods.customUpload || v2.customUpload);
          if (cu) out.parentCustomUpload = cu.toString().slice(0, 1500);
          break;
        }
      }
      el2 = el2.parentElement;
    }
  }
  return out;
}).catch((e) => 'ERR ' + e.message.slice(0, 200));
console.log(JSON.stringify(info, null, 1));
await browser.close();

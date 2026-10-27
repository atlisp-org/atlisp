// 探测已登录的 QQ空间首页 DOM，找「写说说」输入框
import { chromium } from 'playwright';
import fs from 'node:fs';

const stateFile = '/home/vitalgg/atlisp/automation/autopost/state/qzone.json';
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  locale: 'zh-CN',
  timezoneId: 'Asia/Shanghai',
  viewport: { width: 1366, height: 900 },
  storageState: stateFile,
});
const page = await ctx.newPage();
await page.goto('https://qzone.qq.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForURL(/qzone\.qq\.com\/\d{5,}/, { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(5000);
console.log('URL:', page.url());
console.log('TITLE:', await page.title());

const info = await page.evaluate(() => {
  const out = {};
  out.textareas = [...document.querySelectorAll('textarea')].map((t) => ({
    ph: t.placeholder, cls: (t.className || '').slice(0, 60), vis: t.offsetParent !== null,
  })).slice(0, 8);
  out.editables = [...document.querySelectorAll('[contenteditable="true"]')].map((e) => ({
    ph: e.getAttribute('placeholder'), cls: (e.className || '').slice(0, 60),
    tag: e.tagName, vis: e.offsetParent !== null,
  })).slice(0, 8);
  // 找 placeholder 含「写」的元素
  out.writePh = [...document.querySelectorAll('[placeholder]')]
    .filter((e) => (e.placeholder || '').includes('写'))
    .map((e) => ({ tag: e.tagName, ph: e.placeholder, cls: (e.className || '').slice(0, 60) }))
    .slice(0, 8);
  // 页面顶部 3000 字符的可见文字（看有没有「说说」相关 UI）
  out.topText = document.body.innerText.replace(/\n+/g, ' | ').slice(0, 1200);
  return out;
});
console.log(JSON.stringify(info, null, 1));
await page.screenshot({ path: '/tmp/opencode/qzone-home-probe.png' });
console.log('screenshot: /tmp/opencode/qzone-home-probe.png');
await browser.close();

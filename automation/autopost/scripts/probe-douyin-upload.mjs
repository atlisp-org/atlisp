// 探测：抖音创作者平台「上传视频后」的编辑页 DOM 结构
// 目的：确认真实「发布」按钮、标题输入框、「仅自己」选项的位置与结构
import { chromium } from 'playwright';
import fs from 'node:fs';

const STATE = '/home/vitalgg/atlisp/automation/autopost/state/douyin-web.json';
const VIDEO = '/home/vitalgg/atlisp/automation/autopost/test-demo.mp4';
if (!fs.existsSync(STATE)) {
  console.log('未登录，退出');
  process.exit(1);
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  storageState: STATE,
  locale: 'zh-CN',
  timezoneId: 'Asia/Shanghai',
  viewport: { width: 1366, height: 900 },
  args: ['--disable-blink-features=AutomationControlled'],
});
const page = await context.newPage();
await page.goto('https://creator.douyin.com/creator-micro/content/upload', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(5000);
console.log('初始 URL:', page.url());

const fileInput = page.locator('input[type=file]').first();
await fileInput.setInputFiles(VIDEO);
console.log('视频已提交，等待编辑页渲染（60 秒）...');
await page.waitForTimeout(60000);
console.log('当前 URL:', page.url());

const info = await page.evaluate(() => {
  const btns = [...document.querySelectorAll('button')].map((b) => ({
    text: (b.innerText || '').trim().slice(0, 30),
    cls: (b.className || '').toString().slice(0, 60),
    rect: (() => { const r = b.getBoundingClientRect(); return `${Math.round(r.width)}x${Math.round(r.height)} @ ${Math.round(r.left)},${Math.round(r.top)}`; })(),
    visible: !!(b.offsetWidth || b.offsetHeight),
  })).filter((x) => x.text);
  const editables = [...document.querySelectorAll('[contenteditable="true"], textarea, input[type="text"]')].map((e) => ({
    tag: e.tagName.toLowerCase(),
    ph: (e.getAttribute('placeholder') || '').slice(0, 40),
    cls: (e.className || '').toString().slice(0, 60),
    rect: (() => { const r = e.getBoundingClientRect(); return `${Math.round(r.width)}x${Math.round(r.height)} @ ${Math.round(r.left)},${Math.round(r.top)}`; })(),
  }));
  const priv = [...document.querySelectorAll('*')].filter((e) => {
    const t = (e.childElementCount === 0 ? (e.innerText || '').trim() : '');
    return t && t.length <= 8 && /仅自己|公开|好友/.test(t);
  }).slice(0, 10).map((e) => ({
    tag: e.tagName.toLowerCase(),
    text: (e.innerText || '').trim(),
    cls: (e.className || '').toString().slice(0, 60),
    parentCls: (e.parentElement && e.parentElement.className ? e.parentElement.className.toString() : '').slice(0, 60),
  }));
  return { btns: btns.slice(0, 30), editables, priv };
});
console.log(JSON.stringify(info, null, 1));
await page.screenshot({ path: '/home/vitalgg/atlisp/automation/autopost/logs/screenshots/douyin-upload-probe.png', fullPage: true });
console.log('截图: logs/screenshots/douyin-upload-probe.png');
await browser.close();

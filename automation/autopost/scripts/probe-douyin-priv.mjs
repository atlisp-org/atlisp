// 探测 2：编辑页「仅自己」等可见性选项的 DOM 结构
// 先直接访问编辑页（若上次上传的待处理视频还在就直接用），否则重新上传
import { chromium } from 'playwright';
import fs from 'node:fs';

const STATE = '/home/vitalgg/atlisp/automation/autopost/state/douyin-web.json';
const VIDEO = '/home/vitalgg/atlisp/automation/autopost/test-demo.mp4';

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  storageState: STATE,
  locale: 'zh-CN',
  timezoneId: 'Asia/Shanghai',
  viewport: { width: 1366, height: 1400 },
  args: ['--disable-blink-features=AutomationControlled'],
});
const page = await context.newPage();
await page.goto('https://creator.douyin.com/creator-micro/content/post/video', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(8000);
console.log('URL:', page.url());

const titleExists = async () =>
  (await page.locator('input[placeholder*="填写作品标题"]').count()) > 0;

if (!(await titleExists())) {
  console.log('编辑页为空，重新上传视频...');
  await page.goto('https://creator.douyin.com/creator-micro/content/upload', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4000);
  await page.locator('input[type=file]').first().setInputFiles(VIDEO);
  await page.waitForURL(/content\/post\/video/, { timeout: 5 * 60 * 1000 });
  await page.waitForTimeout(5000);
  console.log('上传后 URL:', page.url());
}

// 关掉可能挡路的引导弹层
const know = page.getByRole('button', { name: '我知道了' });
if ((await know.count()) > 0) await know.click().catch(() => {});
await page.waitForTimeout(1500);

const info = await page.evaluate(() => {
  // 找所有包含「仅自己/公开/好友可见」文本的最深层元素及其父级结构
  const out = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  let n;
  while ((n = walker.nextNode())) {
    const t = (n.innerText || '').trim();
    if (t && t.length <= 10 && /仅自己|公开|好友可见/.test(t) && n.childElementCount <= 1) {
      const chain = [];
      let cur = n;
      for (let i = 0; i < 5 && cur; i++) {
        chain.push(`${cur.tagName.toLowerCase()}${cur.className ? '.' + cur.className.toString().split(' ').slice(0, 2).join('.') : ''}${cur.type ? '[type=' + cur.type + ']' : ''}`);
        cur = cur.parentElement;
      }
      out.push({ text: t, chain });
    }
  }
  // 「仅自己」附近区域 HTML（取第一个匹配的 label 或它的父容器）
  const first = [...document.querySelectorAll('label')].find((l) => /仅自己/.test(l.innerText || ''));
  return { matches: out.slice(0, 8), labelHtml: first ? first.outerHTML.slice(0, 600) : null };
});
console.log(JSON.stringify(info, null, 1));
await browser.close();

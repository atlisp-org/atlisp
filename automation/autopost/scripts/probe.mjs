// 探测登录页 DOM 关键元素（验证选择器假设）
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ locale: 'zh-CN' });

// --- QQ空间 ---
{
  const page = await ctx.newPage();
  await page.goto('https://qzone.qq.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4000);
  const info = await page.evaluate(() => {
    const out = {};
    out.url = location.href;
    out.textareas = [...document.querySelectorAll('textarea')].map((t) => t.placeholder || '(no placeholder)').slice(0, 5);
    out.editables = [...document.querySelectorAll('[contenteditable]')].map((e) => (e.getAttribute('placeholder') || e.className || '').slice(0, 60)).slice(0, 5);
    out.iframes = [...document.querySelectorAll('iframe')].map((f) => (f.src || '').slice(0, 80)).slice(0, 5);
    const imgs = [...document.querySelectorAll('img')].filter((i) => /qr|code|scan/i.test(i.src + i.alt + i.className));
    out.qrImgs = imgs.map((i) => (i.src || i.alt).slice(0, 80)).slice(0, 3);
    out.hasLoginText = /登录/.test(document.body.innerText.slice(0, 2000));
    return out;
  });
  console.log('QZONE:', JSON.stringify(info, null, 1));
  await page.close();
}

// --- 抖音创作者平台 ---
{
  const page = await ctx.newPage();
  await page.goto('https://creator.douyin.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4000);
  const info = await page.evaluate(() => {
    const out = {};
    out.url = location.href;
    out.fileInputs = document.querySelectorAll('input[type=file]').length;
    const imgs = [...document.querySelectorAll('img')].filter((i) => /qr|code|scan/i.test(i.src + i.alt + i.className));
    out.qrImgs = imgs.map((i) => (i.src || i.alt).slice(0, 80)).slice(0, 3);
    out.bodySnippet = document.body.innerText.replace(/\s+/g, ' ').slice(0, 200);
    return out;
  });
  console.log('DOUYIN:', JSON.stringify(info, null, 1));
  await page.close();
}

await browser.close();

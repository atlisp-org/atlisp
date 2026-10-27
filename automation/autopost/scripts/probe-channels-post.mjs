// 探测：找「发表」入口 + 发布页 DOM（上传/标题/描述/发布按钮）
import { launchBrowser, loadConfig, abs } from '../lib/common.js';

const cfg = loadConfig().wechat?.channels?.web || {};
const stateFile = abs(cfg.stateFile || 'state/wechat-channels.json');
const { browser, context } = await launchBrowser({ stateFile, headless: true });
const page = await context.newPage();
await page.goto('https://channels.weixin.qq.com/platform/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(8000);

// 关引导弹层
for (const t of ['我知道了', '知道了', '关闭']) {
  try { await page.getByText(t, { exact: false }).first().click({ timeout: 3000 }); } catch {}
}
await page.waitForTimeout(1000);

// 1) 找含「发表/创作/上传」文字的可点元素
const entries = await page.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll('div, span, a, button')) {
    const t = (el.innerText || '').trim();
    if (t && t.length <= 8 && /发表|创作|上传|发布/.test(t)) {
      const r = el.getBoundingClientRect();
      out.push({ text: t, tag: el.tagName.toLowerCase(), rect: `${Math.round(r.width)}x${Math.round(r.height)}@${Math.round(r.left)},${Math.round(r.top)}`, cls: (el.className?.toString() || '').slice(0, 60) });
    }
  }
  return out.slice(0, 20);
});
console.log('ENTRIES:', JSON.stringify(entries, null, 1));

// 2) 直接试发布页 URL
const urls = [
  'https://channels.weixin.qq.com/platform/post/video',
  'https://channels.weixin.qq.com/platform/video/publish',
];
for (const u of urls) {
  await page.goto(u, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(5000);
  const st = await page.evaluate(() => ({
    url: location.href,
    text: document.body.innerText.replace(/\n+/g, ' | ').slice(0, 400),
    fileInputs: document.querySelectorAll('input[type=file]').length,
    textareas: document.querySelectorAll('textarea').length,
  }));
  console.log('URL TRY:', u, '->', JSON.stringify(st));
  if (st.fileInputs > 0 || /上传|发表/.test(st.text)) break;
}
await browser.close();

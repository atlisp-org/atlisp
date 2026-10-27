// 弹层流程修正：限定第一条 feed 项，点可见「删除」→ 确认
import { launchBrowser, loadConfig, abs, sleep } from '../lib/common.js';
const cfg = loadConfig().wechat?.channels?.web || {};
const profileDir = abs(cfg.profileDir || 'state/profiles/channels');
const { browser, context } = await launchBrowser({ profileDir, headless: true });
const page = await context.newPage();
await page.goto('https://channels.weixin.qq.com/platform/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await sleep(12000);
if (/login\.html/i.test(page.url())) { console.log('SESSION DEAD'); await browser.close(); process.exit(0); }
const card = page.frames().find((fr) => fr.url().includes('post-card'));

const isVisFn = `
  const isVis = (e) => {
    const s = getComputedStyle(e);
    const r = e.getBoundingClientRect();
    return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0;
  };
`;

// 1) 打开第一条的弹层
await card.evaluate(`(() => {
  const it = document.querySelector('div.post-feed-item');
  const t = it.querySelector('.weui-desktop-popover__target');
  t && t.click();
})()`);
await sleep(1200);

// 2) 第一条内点可见「删除」（叶子+祖先逐级 click）
const delR = await card.evaluate(`(() => {
  ${isVisFn}
  const it = document.querySelector('div.post-feed-item');
  const leaf = [...it.querySelectorAll('*')].find((e) => e.children.length === 0 && isVis(e) && (e.textContent || '').trim() === '删除');
  if (!leaf) return { err: 'no visible 删除 in first item' };
  let t = leaf, g = 0, clicked = [];
  while (t && g < 4) { t.click(); clicked.push(t.tagName + '.' + (t.className || '').toString().split(' ')[0]); t = t.parentElement; g++; }
  return { ok: true, clicked };
})()`);
console.log('点删除:', JSON.stringify(delR));
await sleep(2500);

// 3) 确认对话框（frame + 顶层）
const frameBtns = await card.evaluate(`(() => {
  ${isVisFn}
  return [...document.querySelectorAll('button')].filter(isVis).map((b) => b.textContent.trim()).filter(Boolean);
})()`).catch(() => []);
const topBtns = await page.evaluate(`(() => {
  ${isVisFn}
  return [...document.querySelectorAll('button')].filter(isVis).map((b) => b.textContent.trim()).filter(Boolean);
})()`).catch(() => []);
console.log('frame 可见按钮:', JSON.stringify(frameBtns));
console.log('顶层可见按钮:', JSON.stringify(topBtns));

const dlgTexts = await page.evaluate(`(() => {
  ${isVisFn}
  return [...document.querySelectorAll('[class*="dialog"],[class*="Dialog"],[class*="confirm"],[class*="Confirm"]')]
    .filter(isVis)
    .map((e) => (e.innerText || '').replace(/\\s+/g, ' ').slice(0, 120))
    .filter(Boolean);
})()`).catch(() => []);
console.log('顶层对话框:', JSON.stringify(dlgTexts));
const frameDlgTexts = await card.evaluate(`(() => {
  ${isVisFn}
  return [...document.querySelectorAll('[class*="dialog"],[class*="Dialog"],[class*="confirm"],[class*="Confirm"]')]
    .filter(isVis)
    .map((e) => (e.innerText || '').replace(/\\s+/g, ' ').slice(0, 120))
    .filter(Boolean);
})()`).catch(() => []);
console.log('frame 对话框:', JSON.stringify(frameDlgTexts));
await browser.close();

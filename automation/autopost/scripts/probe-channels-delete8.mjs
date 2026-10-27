// 完整流程：点「更多」弹出层 → 层内点「删除」→ 确认对话框（frame + 顶层都查）
import { launchBrowser, loadConfig, abs, sleep } from '../lib/common.js';
const cfg = loadConfig().wechat?.channels?.web || {};
const profileDir = abs(cfg.profileDir || 'state/profiles/channels');
const { browser, context } = await launchBrowser({ profileDir, headless: true });
const page = await context.newPage();
await page.goto('https://channels.weixin.qq.com/platform/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await sleep(12000);
if (/login\.html/i.test(page.url())) { console.log('SESSION DEAD'); await browser.close(); process.exit(0); }
const card = page.frames().find((fr) => fr.url().includes('post-card'));

const dumpDlg = async (where, fn) => {
  const r = await fn().catch(() => null);
  console.log(where, ':', JSON.stringify(r));
};

// 1) 找第一条的「更多」触发器（popover target，⋯ 图标）
const trig = await card.evaluate(() => {
  const it = document.querySelector('div.post-feed-item');
  const cands = [...it.querySelectorAll('[class*="popover"], [class*="more"], [class*="dot"], [class*="ellipsis"]')];
  return cands.map((e) => ({ cls: (e.className || '').toString().slice(0, 70), tag: e.tagName, text: (e.textContent || '').trim().slice(0, 20) }));
});
console.log('第一条内 popover 相关元素:', JSON.stringify(trig, null, 1));

// 点 popover target（more-action）
const clicked = await card.evaluate(() => {
  const it = document.querySelector('div.post-feed-item');
  const t = it.querySelector('.weui-desktop-popover__target');
  if (!t) return { err: 'no popover target' };
  t.click();
  return { ok: true };
});
console.log('点更多:', JSON.stringify(clicked));
await sleep(1500);

// 弹出层打开后的可见按钮（frame 内）
const popBtns = await card.evaluate(() => {
  const isVis = (e) => {
    const s = getComputedStyle(e);
    const r = e.getBoundingClientRect();
    return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0;
  };
  return [...document.querySelectorAll('button, [role="menuitem"], .opr-item, .action-content')]
    .filter(isVis)
    .map((e) => (e.textContent || '').trim().slice(0, 12))
    .filter(Boolean);
});
console.log('弹出层后可见元素:', JSON.stringify(popBtns));

// 在弹出层里点「删除」
const delClicked = await card.evaluate(() => {
  const isVis = (e) => {
    const s = getComputedStyle(e);
    const r = e.getBoundingClientRect();
    return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0;
  };
  const it = document.querySelector('div.post-feed-item');
  // 可见的、文本为 删除 的叶子（限定在可见的 popover 容器内优先）
  const pop = [...document.querySelectorAll('[class*="popover"]')].filter(isVis);
  let scope = pop[0] || it;
  const leaf = [...scope.querySelectorAll('*')].find((e) => e.children.length === 0 && (e.textContent || '').trim() === '删除');
  if (!leaf) return { err: 'no visible 删除' };
  // 从叶子向上找带 click handler 的祖先（试 3 级）
  let t = leaf, g = 0;
  while (t && g < 3) { t.click(); t = t.parentElement; g++; }
  return { ok: true };
});
console.log('弹层内点删除:', JSON.stringify(delClicked));
await sleep(2500);

// 确认对话框：frame + 顶层
await dumpDlg('frame 可见按钮', () => card.evaluate(() => {
  const isVis = (e) => {
    const s = getComputedStyle(e);
    const r = e.getBoundingClientRect();
    return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0;
  };
  return [...document.querySelectorAll('button')].filter(isVis).map((b) => b.textContent.trim()).filter(Boolean);
}));
await dumpDlg('顶层可见按钮', () => page.evaluate(() => {
  const isVis = (e) => {
    const s = getComputedStyle(e);
    const r = e.getBoundingClientRect();
    return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0;
  };
  return [...document.querySelectorAll('button')].filter(isVis).map((b) => b.textContent.trim()).filter(Boolean);
}));
await dumpDlg('顶层对话框文本', () => page.evaluate(() => {
  const isVis = (e) => {
    const s = getComputedStyle(e);
    return s.display !== 'none' && s.visibility !== 'hidden' && e.getBoundingClientRect().width > 0;
  };
  return [...document.querySelectorAll('[class*="dialog"],[class*="Dialog"],[class*="modal"],[class*="confirm"]')]
    .filter(isVis)
    .map((e) => (e.innerText || '').replace(/\s+/g, ' ').slice(0, 100))
    .filter(Boolean);
}));
await browser.close();

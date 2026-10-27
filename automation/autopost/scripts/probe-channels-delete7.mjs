// 直调 feed 项组件 openDeleteDialog(post) → 点确认「删除」
import { launchBrowser, loadConfig, abs, sleep } from '../lib/common.js';
const cfg = loadConfig().wechat?.channels?.web || {};
const profileDir = abs(cfg.profileDir || 'state/profiles/channels');
const { browser, context } = await launchBrowser({ profileDir, headless: true });
const page = await context.newPage();
await page.goto('https://channels.weixin.qq.com/platform/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await sleep(12000);
if (/login\.html/i.test(page.url())) { console.log('SESSION DEAD'); await browser.close(); process.exit(0); }
const card = page.frames().find((fr) => fr.url().includes('post-card'));

// 找第一条 feed 项的组件 + 它的 post 对象
const probe = await card.evaluate(() => {
  const it = document.querySelector('div.post-feed-item');
  let d = it, comp = null, g = 0;
  while (d && !d.__vue__ && g < 15) { d = d.parentElement; g++; }
  comp = d && d.__vue__;
  if (!comp) return { err: 'no comp' };
  const info = {
    name: comp.$options.name || comp.$options._componentTag,
    hasOpenDelete: typeof comp.openDeleteDialog === 'function',
    dataKeys: Object.keys(comp.$data || {}).slice(0, 30),
    propKeys: Object.keys(comp.$props || {}).slice(0, 30),
  };
  // 找 post 对象（含 objectId）
  const findPost = (o) => o && typeof o === 'object' && (o.objectId || (o.object && o.object.objectId));
  let post = null;
  for (const k of info.dataKeys) { if (findPost(comp.$data[k])) { post = comp.$data[k]; info.postFrom = 'data.' + k; break; } }
  if (!post) for (const k of info.propKeys) { if (findPost(comp.$props[k])) { post = comp.$props[k]; info.postFrom = 'props.' + k; break; } }
  if (!post) {
    // 可能整个组件实例就是 post 的包装
    for (const k of Object.keys(comp.$data || {})) {
      const v = comp.$data[k];
      if (v && typeof v === 'object' && JSON.stringify(v).includes('objectId')) { info.cand = k + ':' + JSON.stringify(v).slice(0, 150); break; }
    }
  }
  info.objectId = post && (post.objectId || (post.object && post.object.objectId));
  window.__postItem = comp;
  window.__postObj = post;
  return info;
});
console.log('组件信息:', JSON.stringify(probe, null, 1));
if (!probe.hasOpenDelete) { await browser.close(); process.exit(0); }

// 直调 openDeleteDialog(postObj)
const called = await card.evaluate(() => {
  try {
    window.__postItem.openDeleteDialog(window.__postObj || {});
    return { ok: true };
  } catch (e) { return { err: e.message }; }
});
console.log('调用结果:', JSON.stringify(called));
await sleep(2500);

// 找可见确认对话框并点「删除」
const dlg = await card.evaluate(() => {
  const isVis = (e) => {
    const s = getComputedStyle(e);
    const r = e.getBoundingClientRect();
    return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0;
  };
  const btns = [...document.querySelectorAll('button')].filter(isVis);
  const texts = btns.map((b) => b.textContent.trim()).filter(Boolean);
  const b = btns.find((x) => ['删除', '确定', '确认'].includes(x.textContent.trim()));
  if (b) { const t = b.textContent.trim(); b.click(); return { clicked: t, all: texts.slice(0, 12) }; }
  return { clicked: null, all: texts.slice(0, 12) };
});
console.log('对话框按钮:', JSON.stringify(dlg, null, 1));
await sleep(5000);
const after = await card.evaluate(() => {
  const it = document.querySelector('div.post-feed-item');
  return it ? (it.innerText || '').replace(/\s+/g, ' ').slice(0, 60) : null;
});
console.log('操作后第一条:', after);
await browser.close();

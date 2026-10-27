// feed 文本在顶层文档里吗？showConfirm 监听组件在哪？
import { launchBrowser, loadConfig, abs, sleep } from '../lib/common.js';
const cfg = loadConfig().wechat?.channels?.web || {};
const profileDir = abs(cfg.profileDir || 'state/profiles/channels');
const { browser, context } = await launchBrowser({ profileDir, headless: true });
const page = await context.newPage();
await page.goto('https://channels.weixin.qq.com/platform/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await sleep(12000);
if (/login\.html/i.test(page.url())) { console.log('SESSION DEAD'); await browser.close(); process.exit(0); }

const topHasFeed = await page.evaluate(() => {
  const txt = document.body.innerText || '';
  const i = txt.indexOf('自动化发布测试');
  return { has: i >= 0, ctx: i >= 0 ? txt.slice(Math.max(0, i - 60), i + 80).replace(/\s+/g, ' ') : '', len: txt.length };
});
console.log('顶层文档含 feed 文本:', JSON.stringify(topHasFeed));

// 顶层文档里的所有 iframe（含嵌套）+ 它们的尺寸
const allIframes = await page.evaluate(() => {
  const walk = (doc, path, out) => {
    for (const f of doc.querySelectorAll('iframe')) {
      const r = f.getBoundingClientRect();
      out.push({ path: path + '/' + (f.id || (f.src || '').slice(-30)), w: r.width, h: r.height });
    }
  };
  const out = [];
  walk(document, 'top', out);
  return out;
});
console.log('顶层 iframes:', JSON.stringify(allIframes));

// showConfirm 监听组件：顶层 + frame 的组件树里找
const findConfirm = async (label, evaluate) => {
  const r = await evaluate(() => {
    const findRoot = (doc) => {
      for (const sel of ['#app', '[id*="app"]', 'body']) {
        const el = doc.querySelector(sel);
        let d = el, g = 0;
        while (d && !d.__vue__ && g < 8) { d = d.parentElement || (d === doc.body ? null : d); g++; }
        if (d && d.__vue__) return d.__vue__;
      }
      return null;
    };
    const root = findRoot(document);
    if (!root) return { err: 'no root' };
    const seen = new Set(); const stack = [root]; const hits = []; let n = 0;
    while (stack.length && n < 8000) {
      const c = stack.pop();
      if (seen.has(c)) continue;
      seen.add(c); n++;
      try {
        const name = c.$options && (c.$options.name || c.$options._componentTag || '');
        if (/confirm|dialog|Dialog/i.test(name)) {
          hits.push({ name, listeners: Object.keys(c.$listeners || {}) });
        }
        const methods = c.$options.methods || {};
        for (const k of Object.keys(methods)) {
          if (String(methods[k]).includes('showConfirm')) {
            hits.push({ name: name || '?', method: k, src: String(methods[k]).slice(0, 300) });
          }
        }
      } catch {}
      (c.$children || []).forEach((ch) => stack.push(ch));
    }
    return { count: n, hits: hits.slice(0, 8) };
  }).catch((e) => ({ err: e.message }));
  console.log(`\n=== ${label} showConfirm 相关组件 ===`);
  console.log(JSON.stringify(r, null, 1).slice(0, 2500));
};

const card = page.frames().find((fr) => fr.url().includes('post-card'));
await findConfirm('frame', (fn) => card.evaluate(fn));
await findConfirm('顶层', (fn) => page.evaluate(fn));
await browser.close();

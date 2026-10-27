// 修正层级：p.post.objectDesc.{description,mpTitle}
import { launchBrowser, loadConfig, abs, sleep } from '../lib/common.js';
const cfg = loadConfig().wechat?.channels?.web || {};
const profileDir = abs(cfg.profileDir || 'state/profiles/channels');
const { browser, context } = await launchBrowser({ profileDir, headless: true });
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await page.goto('https://channels.weixin.qq.com/platform/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await sleep(12000);
if (/login\.html/i.test(page.url())) { console.log('SESSION DEAD'); await browser.close(); process.exit(0); }
const card = page.frames().find((fr) => fr.url().includes('post-card'));
await card.evaluate(() => {
  const el = [...document.querySelectorAll('button')].find((el) => el.textContent.trim() === '发表视频');
  el && el.click();
});
await page.waitForURL(/\/platform\/post\/create/, { timeout: 30000 });
await sleep(10000);
const ed = page.frames().find((fr) => fr.url().includes('micro/content/post/create'));

await ed.evaluate(`(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '发表');
  let d = btn, comp = null;
  while (d && !d.__vue__) d = d.parentElement;
  comp = d && d.__vue__;
  let root = comp, guard = 0;
  while (root && root.$parent && guard < 30) { root = root.$parent; guard++; }
  const seen = new Set(); const stack = root ? [root] : [];
  let n = 0;
  while (stack.length && n < 4000) {
    const c = stack.pop();
    if (seen.has(c)) continue;
    seen.add(c); n++;
    try { if (c.$options.methods && typeof c.$options.methods.getCreateOrPreviewParams === 'function') { window.__wrap = c; return; } } catch {}
    (c.$children || []).forEach((ch) => stack.push(ch));
  }
})()`);
console.log('wrapper found:', await ed.evaluate('!!window.__wrap'));

const readPayload = async () => ed.evaluate(`(() => {
  try {
    const p = window.__wrap.getCreateOrPreviewParams();
    const d = (p && p.post && p.post.objectDesc) || {};
    return { desc: JSON.stringify(d.description), title: JSON.stringify(d.mpTitle) };
  } catch (e) { return { err: e.message.slice(0, 150) }; }
})()`);

console.log('baseline (editor 空):', JSON.stringify(await readPayload()));

// 方式1: execCommand
await ed.evaluate(`(() => {
  const el = [...document.querySelectorAll('div.input-editor')].find((e) => e.isContentEditable) || document.querySelector('div.input-editor');
  el.focus();
  document.execCommand('selectAll', false, null);
  document.execCommand('insertText', false, '测试甲exec');
})()`);
await sleep(1500);
console.log('after execCommand:', JSON.stringify(await readPayload()));

// 方式2: textContent + InputEvent
await ed.evaluate(`(() => {
  const el = [...document.querySelectorAll('div.input-editor')].find((e) => e.isContentEditable) || document.querySelector('div.input-editor');
  el.focus();
  el.textContent = '测试乙dom';
  el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: '测试乙dom' }));
})()`);
await sleep(1500);
console.log('after textContent+input:', JSON.stringify(await readPayload()));

// 方式3: CDP char
await ed.evaluate(`(() => {
  const el = [...document.querySelectorAll('div.input-editor')].find((e) => e.isContentEditable) || document.querySelector('div.input-editor');
  el.focus();
  document.execCommand('selectAll', false, null);
})()`);
for (const ch of '测试丙键盘') {
  await cdp.send('Input.dispatchKeyEvent', { type: 'char', text: ch });
}
await sleep(1500);
console.log('after CDP char:', JSON.stringify(await readPayload()));

await browser.close();

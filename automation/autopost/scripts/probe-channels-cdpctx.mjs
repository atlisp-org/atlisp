// 遍历所有 CDP execution contexts，找有 file input 的那个，用 CDP 设置文件
import { launchBrowser, loadConfig, abs, sleep } from '../lib/common.js';
const cfg = loadConfig().wechat?.channels?.web || {};
const profileDir = abs(cfg.profileDir || 'state/profiles/channels');
const { browser, context } = await launchBrowser({ profileDir, headless: true });
const page = await context.newPage();
const reqs = [];
page.on('request', (r) => {
  const u = r.url();
  if (!/\.(png|jpg|jpeg|gif|svg|css|js|woff2?)(\?|$)/.test(u) && !u.includes('static') && !u.includes('mmdata') && r.method() !== 'GET') {
    reqs.push(`${((Date.now() - tUp) / 1000) | 0}s ${r.method()} ${u.slice(0, 130)}`);
  }
});
let tUp = Date.now();
await page.goto('https://channels.weixin.qq.com/platform/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await sleep(12000);
if (/login\.html/i.test(page.url())) { console.log('SESSION DEAD'); await browser.close(); process.exit(0); }
const card = page.frames().find(fr => fr.url().includes('post-card'));
await card.evaluate(() => {
  const el = [...document.querySelectorAll('button')].find(el => el.textContent.trim() === '发表视频');
  el && el.click();
});
await page.waitForURL(/\/platform\/post\/create/, { timeout: 30000 });
await sleep(10000);
const cdp = await context.newCDPSession(page);
const contexts = new Map();
cdp.on('Runtime.executionContextCreated', (e) => contexts.set(e.context.id, e.context));
await cdp.send('Runtime.enable');
await cdp.send('Page.enable');
await sleep(500);
console.log('total contexts:', contexts.size);
let targetCtx = null;
let targetObjectId = null;
for (const [id, c] of contexts) {
  const r = await cdp.send('Runtime.evaluate', {
    expression: 'typeof document !== "undefined" && document.querySelector("input[type=file]")',
    contextId: id,
    returnByValue: false,
  }).catch((e) => ({ err: e.message.slice(0, 60) }));
  const hasInput = r.result && r.result.objectId;
  console.log(`ctx ${id}: aux=${JSON.stringify(c.auxData || {}).slice(0, 60)} url=${(c.url || '').slice(0, 50)} hasFileInput=${!!hasInput}`);
  if (hasInput) { targetCtx = id; targetObjectId = r.result.objectId; }
}
if (!targetObjectId) { console.log('FAIL: no context has file input'); await browser.close(); process.exit(0); }
console.log('>>> target ctx:', targetCtx);
const videoAbs = abs('media/test-channels-dryrun.mp4');
reqs.length = 0;
tUp = Date.now();
const setRes = await cdp.send('DOM.setFileInputFiles', { files: [videoAbs], objectId: targetObjectId }).catch((e) => ({ err: e.message }));
console.log('setFileInputFiles:', JSON.stringify(setRes));
for (let i = 0; i < 10; i++) {
  await sleep(5000);
  console.log(`t+${(i + 1) * 5}s NET:`);
  for (const r of reqs) console.log('   ', r);
  reqs.length = 0;
}
await browser.close();

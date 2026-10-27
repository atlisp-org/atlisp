// CDP DOM.setFileInputFiles 设置文件，监控上传请求
import { launchBrowser, loadConfig, abs, sleep } from '../lib/common.js';
import path from 'node:path';
const cfg = loadConfig().wechat?.channels?.web || {};
const profileDir = abs(cfg.profileDir || 'state/profiles/channels');
const { browser, context } = await launchBrowser({ profileDir, headless: true });
const page = await context.newPage();
const reqs = [];
page.on('request', (r) => {
  const u = r.url();
  if (!/\.(png|jpg|jpeg|gif|svg|css|js|woff2?)(\?|$)/.test(u) && !u.includes('static') && !u.includes('mmdata')) {
    reqs.push(`${((Date.now() - tUp) / 1000) | 0}s ${r.method()} ${u.slice(0, 130)}`);
  }
});
page.on('response', (r) => {
  const u = r.url();
  if (!/\.(png|jpg|jpeg|gif|svg|css|js|woff2?)(\?|$)/.test(u) && !u.includes('mmdata')) {
    reqs.push(`  -> ${r.status()} ${u.slice(0, 110)}`);
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
const ed = page.frames().find(fr => fr.url().includes('micro/content/post/create'));
// CDP: 找编辑器 frame 的 execution context
const cdp = await context.newCDPSession(page);
const contexts = new Map();
cdp.on('Runtime.executionContextCreated', (e) => contexts.set(e.context.id, e.context));
await cdp.send('Runtime.enable');
await cdp.send('Page.enable');
await sleep(500);
const { frameTree } = await cdp.send('Page.getFrameTree');
const findFrameId = (node) => {
  if (node.frame.url.includes('micro/content/post/create')) return node.frame.id;
  for (const c of node.childFrames || []) {
    const f = findFrameId(c);
    if (f) return f;
  }
  return null;
};
const frameId = findFrameId(frameTree);
console.log('CDP frameId:', frameId, 'contexts:', contexts.size);
if (!frameId) { console.log('FAIL: no frame'); await browser.close(); process.exit(0); }
let ctx = null;
for (const c of contexts.values()) {
  if (c.auxData && c.auxData.frameId === frameId) { ctx = c; break; }
}
console.log('ctx found:', ctx ? ctx.id : null, 'url:', ctx && ctx.url);
if (!ctx) { console.log('FAIL: no context'); await browser.close(); process.exit(0); }
const { result } = await cdp.send('Runtime.evaluate', {
  expression: 'document.querySelector("input[type=file]")',
  contextId: ctx.id,
  returnByValue: false,
});
console.log('eval result:', JSON.stringify(result).slice(0, 120));
if (!result.objectId) { console.log('FAIL: no objectId'); await browser.close(); process.exit(0); }
const videoAbs = abs('media/test-channels-dryrun.mp4');
reqs.length = 0;
tUp = Date.now();
await cdp.send('DOM.setFileInputFiles', { files: [videoAbs], objectId: result.objectId });
console.log('>>> CDP setFileInputFiles 完成，监控上传...');
for (let i = 0; i < 12; i++) {
  await sleep(5000);
  const st = await ed.evaluate(() => {
    const input = document.querySelector('input[type=file]');
    const up = document.querySelector('.ant-upload');
    return {
      inputFiles: input ? input.files.length : 'NO',
      inputVal: input ? (input.value || '') : '',
      uploadText: up ? (up.parentElement.innerText || '').slice(0, 80).replace(/\n+/g, ' | ') : '',
      progress: [...document.querySelectorAll('[class*="progress"]')].map(e => (e.innerText || '').slice(0, 20)).slice(0, 3),
    };
  }).catch((e) => 'ERR ' + e.message.slice(0, 60));
  console.log(`t+${(i + 1) * 5}s:`, JSON.stringify(st));
  console.log('  NET:');
  for (const r of reqs) console.log('   ', r);
  reqs.length = 0;
}
await browser.close();

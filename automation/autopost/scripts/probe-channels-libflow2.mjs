// 复刻 lib 流程；每 3s 重新搜索编辑器 frame 并 dump 输入框
import { launchBrowser, loadConfig, abs, sleep } from '../lib/common.js';
const cfg = loadConfig().wechat?.channels?.web || {};
const profileDir = abs(cfg.profileDir || 'state/profiles/channels');
const { browser, context } = await launchBrowser({ profileDir, headless: true });
const page = await context.newPage();
await page.goto('https://channels.weixin.qq.com/platform/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await sleep(3000);
const card = page.frames().find(fr => fr.url().includes('post-card'));
try { await card.waitForFunction(() => /已声明原创|已发布|\d{4}年\d{1,2}月\d{1,2}日/.test(document.body.innerText), null, { timeout: 20000, polling: 1000 }); } catch {}
await sleep(10000);
await card.evaluate(() => {
  const el = [...document.querySelectorAll('button')].find(el => el.textContent.trim() === '发表视频');
  el && el.click();
});
await page.waitForURL(/\/platform\/post\/create/, { timeout: 30000 });
console.log('clicked, at', page.url());
for (let i = 0; i < 12; i++) {
  await sleep(3000);
  const eds = page.frames().filter(fr => fr.url().includes('micro/content/post/create'));
  let detail = 'no ed frame';
  if (eds.length) {
    const d = await eds[0].evaluate(() => ({
      text: document.body.innerText.replace(/\n+/g, ' | ').slice(0, 150),
      inputs: document.querySelectorAll('input').length,
      files: document.querySelectorAll('input[type=file]').length,
      ready: document.readyState,
    })).catch(e => 'ERR ' + e.message.slice(0, 60));
    detail = `edCount=${eds.length} ` + JSON.stringify(d);
  }
  console.log(`t+${(i + 1) * 3}s: ${detail}`);
}
await browser.close();

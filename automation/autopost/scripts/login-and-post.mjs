// 实验：登录 + 发布在同一浏览器进程内完成（不跨重启）
// 目的：验证「会话在单次浏览器生命周期内有效，但跨重启失效」假设
// 用法: node scripts/login-and-post.mjs "内容"
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const text = process.argv[2] || '自动化发布测试（同一进程登录+发布，验证后删除）';
const profileDir = '/home/vitalgg/atlisp/automation/autopost/state/profiles/qzone';
const QR_FILE = '/home/vitalgg/atlisp/automation/autopost/logs/qrcode/qzone.png';
const HOME_RE = /user\.qzone\.qq\.com\/\d{5,}/;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const context = await chromium.launchPersistentContext(profileDir, {
  headless: true,
  locale: 'zh-CN',
  timezoneId: 'Asia/Shanghai',
  viewport: { width: 1366, height: 900 },
  args: ['--disable-blink-features=AutomationControlled'],
});
const page = await context.newPage();
await page.goto('https://user.qzone.qq.com/405842561', { waitUntil: 'domcontentloaded', timeout: 60000 });

// 等跳转落地（最多 20s）
let logged = false;
for (let i = 0; i < 20; i++) {
  if (HOME_RE.test(page.url())) { logged = true; break; }
  await sleep(1000);
}

if (!logged) {
  console.log('需要扫码。QR 截图:', QR_FILE);
  fs.mkdirSync(path.dirname(QR_FILE), { recursive: true });
  const snap = async () => {
    try {
      const qr = page.locator('#qrcode img, #qrcode canvas, #qrcode, #qrlogin_img, img.qrImg').first();
      if ((await qr.count()) > 0 && (await qr.isVisible())) {
        await qr.screenshot({ path: QR_FILE, timeout: 10000 });
        return fs.statSync(QR_FILE).size > 1000;
      }
    } catch {}
    try {
      await page.screenshot({ path: QR_FILE, timeout: 10000 });
      return fs.statSync(QR_FILE).size > 1000;
    } catch { return false; }
  };
  await sleep(2000);
  if (await snap()) console.log('二维码已保存，请刷新 http://192.168.1.100:8123/qzone.png 扫码');
  const deadline = Date.now() + 10 * 60 * 1000;
  let lastReload = Date.now();
  while (Date.now() < deadline) {
    if (HOME_RE.test(page.url())) { logged = true; break; }
    const expired = await page
      .evaluate(() => /二维码已失效|已过期|点击刷新/.test((document.body && document.body.innerText.slice(0, 2000)) || ''))
      .catch(() => false);
    if (Date.now() - lastReload > 75000 || expired) {
      lastReload = Date.now();
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
      await sleep(2000);
      if (await snap()) console.log('二维码已换新，请刷新浏览器重新扫码');
    }
    await sleep(2000);
  }
  if (!logged) {
    console.error('扫码超时');
    await context.close();
    process.exit(1);
  }
  console.log('登录成功，同一进程内继续发布...');
  await sleep(3000);
}

// —— 发布（与 lib/qzone.js 相同的选择器逻辑）——
const BOX_SELECTORS = [
  'div.textinput.textarea',
  'div[contenteditable="true"][placeholder*="写"]',
  'textarea[placeholder*="写"]',
  'div.tips-textarea',
  'div[contenteditable="true"]',
  'textarea',
];
async function findVisible(p, sels) {
  for (const s of sels) {
    const loc = p.locator(s);
    const n = await loc.count().catch(() => 0);
    for (let i = 0; i < n; i++) {
      const el = loc.nth(i);
      if (await el.isVisible().catch(() => false)) return el;
    }
  }
  return null;
}

await sleep(4000 + Math.random() * 4000);
await page.mouse.wheel(0, 150).catch(() => {});

const box = await findVisible(page, BOX_SELECTORS);
if (!box) {
  console.error('找不到输入框');
  await page.screenshot({ path: '/home/vitalgg/atlisp/automation/autopost/logs/screenshots/exp-no-box.png' });
  await context.close();
  process.exit(1);
}
await box.click();
await sleep(800);
const activeBox = (await findVisible(page, BOX_SELECTORS)) || box;
await activeBox.fill(text);
await sleep(1500);

const SEND_SELECTORS = ['button:has-text("发布")', 'div.send-btn', 'div.tips-btn:has-text("发布")', 'a:has-text("发布")', 'span:has-text("发布")'];
const send = await findVisible(page, SEND_SELECTORS);
if (!send) {
  console.error('找不到发布按钮');
  await page.screenshot({ path: '/home/vitalgg/atlisp/automation/autopost/logs/screenshots/exp-no-send.png' });
  await context.close();
  process.exit(1);
}
console.log('点击发布...');
await send.click();
await sleep(6000);
const boxText = (await activeBox.innerText().catch(() => '')) || '';
const cleared = boxText.trim().length === 0;
await page.screenshot({ path: '/home/vitalgg/atlisp/automation/autopost/logs/screenshots/exp-post.png' });
console.log(cleared ? '✅ 发布成功（输入框已清空）' : '⚠️ 已点发布但输入框未清空，请看 exp-post.png');

// 保持浏览器再活 60 秒：验证「登录后不关闭」时页面是否仍停留（风控是否秒踢）
console.log('保持浏览器 60 秒观察是否被踢出登录...');
let kicked = false;
for (let i = 0; i < 6; i++) {
  await sleep(10000);
  if (!HOME_RE.test(page.url())) { kicked = true; console.log(`t+${(i + 1) * 10}s 被踢: ${page.url().slice(0, 80)}`); break; }
}
if (!kicked) console.log('60 秒内会话稳定，未被踢出');

await context.close();
process.exit(cleared ? 0 : 2);

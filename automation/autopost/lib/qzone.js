// QQ空间网页版自动化：扫码登录 + 发布说说（文字 + 图片）
// 支持无图形环境（服务器）：headless 打开登录页，把二维码截图存到 logs/qrcode/qzone.png，
// 轮询等待扫码（QR 过期自动刷新截图），登录成功后保存登录态。
// 注意：页面 DOM 会随空间改版变化，选择器集中放在下方常量里，
// 失效时用 --debug / --dry-run 打开页面排查后更新。
import fs from 'node:fs';
import path from 'node:path';
import {
  ROOT, loadConfig, abs, launchBrowser, log, sleep, randomDelay, shot, autoHeadless,
  clearQr, cleanStaleQr,
} from './common.js';

const HOME_URL = 'https://qzone.qq.com/';
const HOME_RE = /qzone\.qq\.com\/\d{5,}/;
const LOGIN_RE = /i\.qq\.com|passport\.qq\.com/; // 被重定向到登录页 = 登录态失效/风控

// 持久化 profile：登录态就存在浏览器目录里（跨次运行保留 cookies/历史，
// 比"每次冷启动 + 注入 cookies"更接近真实用户，降低风控概率）
const profileDirOf = (cfg) => abs(cfg.profileDir || 'state/profiles/qzone');
const markerOf = (dir) => path.join(dir, '.login');

function readMarker(dir) {
  try {
    return JSON.parse(fs.readFileSync(markerOf(dir), 'utf8'));
  } catch {
    return null;
  }
}

function writeMarker(dir, marker) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(markerOf(dir), JSON.stringify({ ...marker, at: new Date().toISOString() }));
}

// 「写说说」输入框候选选择器（按优先级；实际匹配时遍历所有命中项取第一个可见的）
const BOX_SELECTORS = [
  'div.textinput.textarea', // 当前空间网页版：contenteditable div，提示「说点儿什么吧」
  'div[contenteditable="true"][placeholder*="写"]',
  'textarea[placeholder*="写"]',
  'div.tips-textarea',
  'div[contenteditable="true"]',
  'textarea',
];

// 「发布」按钮候选选择器（按优先级）
const SEND_SELECTORS = [
  'button:has-text("发布")',
  'div.send-btn',
  'div.tips-btn:has-text("发布")',
  'a:has-text("发布")',
  'span:has-text("发布")',
];

/** 在候选选择器中找第一个「可见」的元素（每个选择器遍历所有命中项） */
async function findVisible(page, selectors) {
  for (const s of selectors) {
    const loc = page.locator(s);
    const n = await loc.count().catch(() => 0);
    for (let i = 0; i < n; i++) {
      const el = loc.nth(i);
      if (await el.isVisible().catch(() => false)) return el;
    }
  }
  return null;
}

const QR_FILE = path.join(ROOT, 'logs', 'qrcode', 'qzone.png');

// 登录二维码元素候选（新版统一登录页 i.qq.com 是顶层页面，旧版在 iframe 里）
const QR_SELECTORS = [
  '#qrcode img', '#qrcode canvas', '#qrcode',
  '#qrlogin_img', 'img.qrImg', 'img[id*="qr"]', 'canvas[id*="qr"]',
  '.qrcode img', '[class*="qr"] img',
];

/** headless 下截取登录二维码（QR 元素 → iframe 元素 → 整页，逐级降级）；成功返回 true */
async function snapQr(page) {
  fs.mkdirSync(path.dirname(QR_FILE), { recursive: true });
  const good = () => fs.existsSync(QR_FILE) && fs.statSync(QR_FILE).size > 1000;

  // 1) QR 元素（要求可见，10s 超时）
  for (const s of QR_SELECTORS) {
    try {
      const qr = page.locator(s).first();
      if ((await qr.count()) > 0 && (await qr.isVisible())) {
        await qr.screenshot({ path: QR_FILE, timeout: 10000 });
        if (good()) return true;
        log(`[qzone] QR 元素(${s})截图无效，降级到 iframe 截图`);
        break;
      }
    } catch (e) {
      log(`[qzone] QR 元素(${s})截图失败: ${e.message.slice(0, 120)}`);
    }
  }

  // 2) 整个登录 iframe
  try {
    const iframe = page.locator('iframe').first();
    if ((await iframe.count()) > 0) {
      await iframe.screenshot({ path: QR_FILE, timeout: 10000 });
      if (good()) return true;
    }
  } catch (e) {
    log(`[qzone] iframe 截图失败: ${e.message.slice(0, 120)}`);
  }

  // 3) 整页兜底
  try {
    await page.screenshot({ path: QR_FILE, timeout: 10000 });
    return good();
  } catch (e) {
    log(`[qzone] 整页截图失败: ${e.message.slice(0, 120)}`);
    return false;
  }
}

/**
 * 扫码登录 QQ空间，登录态存到持久化 profile（state/profiles/qzone/）
 * 已有登录态且有效时直接复用（无需扫码）。
 * @param {boolean|undefined} [headless] 显式覆盖；缺省时 Linux 无显示环境自动 headless
 */
export async function qzoneLogin(opts = {}) {
  // 二维码 2 分钟过期：登录流程一结束（成功/失败/超时）就删掉
  cleanStaleQr();
  try {
    return await qzoneLoginInner(opts);
  } finally {
    if (clearQr('qzone.png')) log('[qzone] 已删除二维码截图');
  }
}

async function qzoneLoginInner({ headless } = {}) {
  const cfg = loadConfig().qzone || {};
  const profileDir = profileDirOf(cfg);
  const marker = readMarker(profileDir);
  const hl = autoHeadless(headless);
  const { browser, context } = await launchBrowser({ profileDir, headless: hl });
  const page = await context.newPage();

  // 优先直接访问个人主页（比 qzone.qq.com/ 少一跳）
  const start = marker?.uin ? `https://user.qzone.qq.com/${marker.uin}` : HOME_URL;
  await page.goto(start, { waitUntil: 'domcontentloaded', timeout: 60000 });

  // 未登录时页面会重定向到 i.qq.com，已登录则停在个人主页；轮询等跳转落地
  let logged = false;
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (HOME_RE.test(page.url())) {
      logged = true;
      break;
    }
    await sleep(1000);
  }

  if (logged) {
    writeMarker(profileDir, { uin: marker?.uin || page.url().match(/(\d{5,})/)[1] });
    log('[qzone] 登录态仍有效，无需重新登录');
    await shot(page, 'qzone-home.png');
    await browser.close();
    return { ok: true };
  }

  // 需要扫码
  if (fs.existsSync(markerOf(profileDir))) fs.unlinkSync(markerOf(profileDir));

  if (!hl) {
    // 有图形环境：直接扫码
    log('[qzone] 请用手机版 QQ 扫码登录（最多等待 3 分钟）...');
    await shot(page, 'qzone-login-qr.png');
    await page.waitForURL(HOME_RE, { timeout: 180000 });
  } else {
    // 无图形环境：截图二维码，轮询等待
    await sleep(2000);
    if (await snapQr(page)) {
      log(`[qzone] 二维码已保存: ${QR_FILE}`);
      log(`[qzone] 请将该文件拷到本地/手机，用手机 QQ「扫一扫」打开图片扫码`);
    } else {
      log('[qzone] 二维码截图失败，90 秒后自动重试');
    }
    log('[qzone] QR 约 2 分钟过期，脚本每 75 秒重载页面换新 QR；最多等待 10 分钟');

    const waitDeadline = Date.now() + 10 * 60 * 1000;
    let lastReload = Date.now();
    let ok = false;
    while (Date.now() < waitDeadline) {
      if (HOME_RE.test(page.url())) {
        ok = true;
        break;
      }
      // 重截旧图没用：QR 过期必须重载页面，让 QQ 生成新码
      const expired = await page
        .evaluate(() =>
          /二维码已失效|已过期|点击刷新|刷新二维码/.test(
            (document.body && document.body.innerText.slice(0, 2000)) || ''
          )
        )
        .catch(() => false);
      if (Date.now() - lastReload > 75000 || expired) {
        lastReload = Date.now();
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
        await sleep(2000);
        if (await snapQr(page)) log('[qzone] 二维码已换新（页面已重载），请刷新浏览器页面重新扫码');
        else log('[qzone] 二维码截图仍失败，继续等待重试');
      }
      await sleep(2000);
    }
    if (!ok) {
      await browser.close();
      throw new Error('扫码超时（10 分钟未检测到登录）。请重新运行登录命令，尽快扫码');
    }
  }

  await sleep(3000);
  const m = page.url().match(/qzone\.qq\.com\/(\d{5,})/);
  const uin = m ? m[1] : '';
  writeMarker(profileDir, { uin });
  log(`[qzone] 登录成功，状态已保存: ${path.relative(ROOT, profileDir)}${uin ? `（uin=${uin}）` : ''}`);

  await shot(page, 'qzone-home.png');
  await browser.close();
  return { ok: true };
}

/**
 * 发布一条说说
 * @param {object} p
 * @param {string} p.text 文字内容
 * @param {string[]} [p.images] 图片路径
 * @param {boolean} [p.dryRun] 只填写不点发布（调试用）
 * @param {boolean} [p.debug] 打开页面后停留 30 秒供人工检查 DOM（需图形环境）
 */
export async function qzonePost({ text, images = [], dryRun = false, debug = false }) {
  const cfg = loadConfig().qzone || {};
  const profileDir = profileDirOf(cfg);
  const marker = readMarker(profileDir);
  if (!marker || !marker.uin) throw new Error('QQ空间未登录（或登录态失效），请先运行: npm run qzone-login');

  const { browser, context } = await launchBrowser({ profileDir, headless: autoHeadless(cfg.headless) });
  const page = await context.newPage();
  // 直接访问个人主页（比 qzone.qq.com/ 重定向少一跳，降低风控特征）
  await page.goto(`https://user.qzone.qq.com/${marker.uin}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  // 空间首页资源多（广告/图片），load 事件常超过 30s；只等 URL 到达即可
  try {
    await page.waitForURL(HOME_RE, { timeout: 30000 });
  } catch {
    if (!HOME_RE.test(page.url())) {
      await shot(page, 'qzone-home-fail.png');
      await browser.close();
      if (LOGIN_RE.test(page.url())) {
        throw new Error('登录态已失效（或被风控），请重新扫码: npm run qzone-login');
      }
      throw new Error('空间首页未打开（网络慢或触发了风控），请看 logs/screenshots/qzone-home-fail.png 后重试');
    }
    // URL 已到但 load 被慢资源拖住，确保 DOM 可用即可
    await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
  }
  // 模拟真人浏览节奏：先停留看页面、轻轻滚动，再开始操作
  await randomDelay(3000, 8000);
  await page.mouse.wheel(0, 150).catch(() => {});
  await randomDelay(500, 1500);

  if (debug) {
    log('[qzone] --debug: 浏览器保持 30 秒，请检查页面 DOM 后更新 lib/qzone.js 里的选择器');
    await sleep(30000);
  }

  // 1) 找到「写说说」输入框
  const box = await findVisible(page, BOX_SELECTORS);
  if (!box) {
    const f = await shot(page, 'qzone-no-box.png');
    await browser.close();
    throw new Error(`找不到「写说说」输入框（截图: ${f}）。请用 --debug 打开页面检查 DOM，更新 BOX_SELECTORS`);
  }
  await box.click();
  await randomDelay(500, 1500);
  // 点击后空间会把输入框切换成聚焦态元素（c_tx2 获得 input_focus，原框隐藏），重新找可见的那个
  const activeBox = (await findVisible(page, BOX_SELECTORS)) || box;
  await activeBox.fill(text);
  await randomDelay(800, 2000);

  // 2) 图片（可选）
  if (images.length) {
    const files = images.map(abs).filter((f) => fs.existsSync(f));
    if (files.length < images.length) log(`[qzone] 警告: ${images.length - files.length} 张图片路径不存在，已跳过`);
    if (files.length) {
      const imgBtn = page
        .locator('[title="图片"], [alt="图片"], [aria-label*="图片"], .tips-icon-img, [class*="upload"] [class*="img"]')
        .first();
      if ((await imgBtn.count()) > 0) {
        await imgBtn.click();
        await randomDelay(800, 2000);
        const input = page.locator('input[type=file]').first();
        if ((await input.count()) > 0) {
          await input.setInputFiles(files);
          log('[qzone] 图片已选择，等待上传...');
          await randomDelay(4000, 8000);
        }
      } else {
        log('[qzone] 未找到图片上传按钮，本次只发文字');
      }
    }
  }

  if (dryRun) {
    const f = await shot(page, 'qzone-dryrun.png');
    log(`[qzone] --dry-run: 内容已填写，未实际发布。截图: ${f}`);
    await browser.close();
    return { ok: true, dryRun: true };
  }

  // 3) 点「发布」
  const send = await findVisible(page, SEND_SELECTORS);
  if (!send) {
    const f = await shot(page, 'qzone-no-send.png');
    await browser.close();
    throw new Error(`找不到「发布」按钮（截图: ${f}）。请用 --debug 打开页面检查 DOM，更新 SEND_SELECTORS`);
  }
  await send.click();

  // 4) 验证：发布成功后输入框会被清空
  await sleep(6000);
  const boxText = (await activeBox.innerText().catch(() => '')) || '';
  const cleared = boxText.trim().length === 0;
  const f = await shot(page, `qzone-post-${Date.now()}.png`);
  if (cleared) log(`[qzone] 发布成功（输入框已清空）。截图: ${f}`);
  else log(`[qzone] 已点击发布，但输入框未清空，请人工核对截图: ${f}`);
  await browser.close();
  return { ok: cleared, verified: cleared, screenshot: f };
}

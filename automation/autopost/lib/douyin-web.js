// 抖音创作者平台（creator.douyin.com）网页自动化：扫码登录 + 上传发布
// 用途：没有官方 API 权限（个人开发者）时的兜底方案。
// 支持无图形环境（服务器）：headless 打开登录页，二维码截图存到 logs/qrcode/douyin.png，
// 轮询等待扫码（QR 过期自动刷新截图），登录成功后保存登录态。
// 注意：页面 DOM 会改版，选择器失效时用 --debug 打开页面排查。
import fs from 'node:fs';
import path from 'node:path';
import {
  ROOT, loadConfig, abs, launchBrowser, saveState, log, sleep, randomDelay, shot, autoHeadless,
} from './common.js';

const LOGIN_URL = 'https://creator.douyin.com/';
const UPLOAD_URL = 'https://creator.douyin.com/creator-micro/content/upload';
const HOME_RE = /creator\.douyin\.com\/(creator-micro|home)/;

const QR_FILE = path.join(ROOT, 'logs', 'qrcode', 'douyin.png');

/** headless 下截取登录二维码（页面上的 QR 大图 → 整页降级）；成功返回 true */
async function snapQr(page) {
  fs.mkdirSync(path.dirname(QR_FILE), { recursive: true });
  const good = () => fs.existsSync(QR_FILE) && fs.statSync(QR_FILE).size > 1000;

  try {
    // QR 是方形 data:image（512x512）；页面上还有 893x188 的品牌图，必须排除非方形
    // 直接取 base64 原图（比按显示尺寸 178px 截图清晰得多，手机扫码更稳）
    const src = await page.evaluate(() => {
      const qr = [...document.querySelectorAll('img')].find(
        (i) =>
          (i.src || '').startsWith('data:image') &&
          i.naturalWidth >= 100 &&
          i.naturalWidth === i.naturalHeight,
      );
      return qr ? qr.src : null;
    });
    if (src && src.startsWith('data:image/png;base64,')) {
      fs.writeFileSync(QR_FILE, Buffer.from(src.slice('data:image/png;base64,'.length), 'base64'));
      if (good()) return true;
    }
    log('[douyin-web] QR 原图提取无效，降级到整页截图');
  } catch (e) {
    log(`[douyin-web] QR 原图提取失败: ${e.message.slice(0, 120)}`);
  }

  try {
    await page.screenshot({ path: QR_FILE, timeout: 10000 });
    return good();
  } catch (e) {
    log(`[douyin-web] 整页截图失败: ${e.message.slice(0, 120)}`);
    return false;
  }
}

/**
 * 扫码登录创作者平台，登录态保存到 state/douyin-web.json
 * 已有登录态且有效时直接复用（无需扫码）。
 * @param {boolean|undefined} [headless] 显式覆盖；缺省时 Linux 无显示环境自动 headless
 */
export async function douyinWebLogin({ headless } = {}) {
  const cfg = loadConfig().douyin?.web || {};
  const stateFile = abs(cfg.stateFile || 'state/douyin-web.json');
  const hl = autoHeadless(headless);
  const { browser, context } = await launchBrowser({ stateFile, headless: hl });
  const page = await context.newPage();
  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

  let needScan = true;
  if (fs.existsSync(stateFile)) {
    await page.waitForTimeout(6000);
    if (HOME_RE.test(page.url()) && !/login/i.test(page.url())) {
      needScan = false;
      log('[douyin-web] 登录态仍有效，无需重新登录');
    }
  }

  if (needScan) {
    if (fs.existsSync(stateFile)) fs.unlinkSync(stateFile);

    if (!hl) {
      log('[douyin-web] 请用手机版抖音扫码登录（最多等待 3 分钟）...');
      await page.waitForURL(HOME_RE, { timeout: 180000 });
    } else {
      // 等二维码出现（方形 data:image；页面初始可能还在加载）
      await page
        .waitForFunction(
          () =>
            [...document.querySelectorAll('img')].some(
              (i) =>
                (i.src || '').startsWith('data:image') &&
                i.naturalWidth >= 100 &&
                i.naturalWidth === i.naturalHeight,
            ),
          { timeout: 30000 },
        )
        .catch(() => {});
      await sleep(1500);
      if (await snapQr(page)) {
        log(`[douyin-web] 二维码已保存: ${QR_FILE}`);
        log('[douyin-web] 请将该文件拷到本地/手机，用手机抖音「扫一扫」打开图片扫码');
      } else {
        log('[douyin-web] 二维码截图失败，90 秒后自动重试');
      }
      log('[douyin-web] QR 约 2 分钟过期，脚本每 75 秒重载页面换新 QR；最多等待 10 分钟');

      const deadline = Date.now() + 10 * 60 * 1000;
      let lastReload = Date.now();
      let ok = false;
      while (Date.now() < deadline) {
        if (HOME_RE.test(page.url()) && !/login/i.test(page.url())) {
          ok = true;
          break;
        }
        // QR 过期必须重载页面换新码（只重截旧图没用）
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
          // 等 QR 图重新出现（方形 data:image）
          await page
            .waitForFunction(
              () =>
                [...document.querySelectorAll('img')].some(
                  (i) =>
                    (i.src || '').startsWith('data:image') &&
                    i.naturalWidth >= 100 &&
                    i.naturalWidth === i.naturalHeight
                ),
              { timeout: 30000 }
            )
            .catch(() => {});
          await sleep(1000);
          if (await snapQr(page)) log('[douyin-web] 二维码已换新（页面已重载），请刷新浏览器页面重新扫码');
          else log('[douyin-web] 二维码截图仍失败，继续等待重试');
        }
        await sleep(2000);
      }
      if (!ok) {
        await browser.close();
        throw new Error('扫码超时（10 分钟未检测到登录）。请重新运行登录命令，尽快扫码');
      }
    }

    await sleep(3000);
    await saveState(context, stateFile);
    log(`[douyin-web] 登录成功，状态已保存: ${path.relative(ROOT, stateFile)}`);
  }

  await shot(page, 'douyin-home.png');
  await browser.close();
  return { ok: true };
}

/**
 * 通过创作者平台网页上传并发布视频
 * @param {object} p
 * @param {string} p.video 本地视频文件路径
 * @param {string} [p.title] 标题
 * @param {string[]} [p.topics] 话题（写入标题，自动加 #）
 * @param {boolean} [p.private] 仅自己可见
 * @param {boolean} [p.dryRun] 准备到发布前一步为止，不点「发布」
 * @param {boolean} [p.debug] 打开页面后停留 30 秒供人工检查 DOM（需图形环境）
 */
export async function douyinWebPublish({ video, title = '', topics = [], private: isPrivate = false, dryRun = false, debug = false }) {
  const cfg = loadConfig().douyin?.web || {};
  const stateFile = abs(cfg.stateFile || 'state/douyin-web.json');
  if (!fs.existsSync(stateFile)) throw new Error('创作者平台未登录，请先运行: npm run douyin-web-login');
  const v = abs(video);
  if (!fs.existsSync(v)) throw new Error(`视频文件不存在: ${v}`);

  const { browser, context } = await launchBrowser({ stateFile, headless: autoHeadless(cfg.headless) });
  const page = await context.newPage();
  await page.goto(UPLOAD_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  // 未登录会被重定向到登录页；已登录则 URL 停留在 creator-micro 下
  try {
    await page.waitForURL(HOME_RE, { timeout: 30000 });
  } catch {
    if (!HOME_RE.test(page.url()) || /login/i.test(page.url())) {
      await shot(page, 'douyin-not-logged-in.png');
      await browser.close();
      throw new Error('创作者平台未登录（或登录态失效），请先运行: npm run douyin-web-login');
    }
    await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
  }
  await randomDelay(2000, 4000);

  if (debug) {
    log('[douyin-web] --debug: 浏览器保持 30 秒，请检查页面 DOM 后更新选择器');
    await sleep(30000);
  }

  // 1) 上传视频文件
  const fileInput = page.locator('input[type=file]').first();
  if ((await fileInput.count()) === 0) {
    const f = await shot(page, 'douyin-no-file-input.png');
    await browser.close();
    throw new Error(`找不到文件上传控件（截图: ${f}）。请用 --debug 打开页面检查 DOM`);
  }
  await fileInput.setInputFiles(v);
  log('[douyin-web] 视频已提交，等待平台处理（转码中，最长等 10 分钟）...');

  // 转码完成后平台自动跳到编辑页 /content/post/video —— 这才是「处理完成」的可靠信号
  // （不能只等含「发布」字样的按钮：侧边栏有「作品发布」会误匹配）
  try {
    await page.waitForURL(/content\/post\/video/, { timeout: 10 * 60 * 1000 });
  } catch {
    const f = await shot(page, 'douyin-timeout.png');
    await browser.close();
    throw new Error(`等待编辑页超时（当前 URL: ${page.url()}，截图: ${f}），可能上传失败或页面已改版`);
  }

  // 关掉可能挡路的引导弹层
  const know = page.getByRole('button', { name: '我知道了' });
  if ((await know.count()) > 0) await know.click().catch(() => {});
  await randomDelay(2000, 4000);

  // 2) 标题 + 话题（标题是 input，placeholder「填写作品标题…」；网页版没有独立话题框，写进标题）
  const text = [title, ...topics.map((t) => (t.startsWith('#') ? t : `#${t}`))].join(' ');
  if (text) {
    let titleBox = page.locator('input[placeholder*="填写作品标题"]').first();
    if ((await titleBox.count()) === 0) titleBox = page.locator('input[placeholder*="标题"]').first();
    if ((await titleBox.count()) > 0 && (await titleBox.isVisible().catch(() => false))) {
      await titleBox.fill(text);
      await randomDelay(800, 2000);
    } else {
      log('[douyin-web] 未找到标题输入框，跳过（可用 --debug 检查）');
    }
  }

  // 3) 仅自己可见（可选）：选项是 <label class="radio-*"> 包 checkbox，必须点 label
  if (isPrivate) {
    const priv = page.locator('label:has-text("仅自己")').first();
    if ((await priv.count()) > 0 && (await priv.isVisible().catch(() => false))) {
      await priv.click();
      log('[douyin-web] 已选择「仅自己可见」');
    } else {
      log('[douyin-web] 未找到「仅自己」选项，按默认可见性发布');
    }
  }

  if (dryRun) {
    const f = await shot(page, 'douyin-dryrun.png');
    log(`[douyin-web] --dry-run: 已准备到发布前一步，未点发布。截图: ${f}`);
    await browser.close();
    return { ok: true, dryRun: true };
  }

  // 4) 点「发布」（accessible name 恰为「发布」，避开侧边栏的「作品发布」）
  const publishBtn = page.getByRole('button', { name: '发布', exact: true }).first();
  await publishBtn.waitFor({ state: 'visible', timeout: 60000 });
  await publishBtn.click();

  // 5) 验证结果：点发布后页面可能跳转甚至崩溃，全部包容错
  let verified = false;
  try {
    await sleep(5000);
    const navigated = await page
      .waitForURL(/content\/manage/, { timeout: 30000 })
      .then(() => true)
      .catch(() => false);
    verified = navigated || (await page.getByText('发布成功', { exact: false }).count().catch(() => 0)) > 0;
  } catch {
    verified = false; // 页面崩溃，走下面的作品列表验证
  }

  // 页面内验证不了（崩溃/未跳转）时，另起独立浏览器查作品列表（最可靠）
  if (!verified) {
    try {
      const { chromium } = await import('playwright');
      const b2 = await chromium.launch({ headless: true });
      const c2 = await b2.newContext({ storageState: stateFile, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });
      const p2 = await c2.newPage();
      await p2.goto('https://creator.douyin.com/creator-micro/content/manage', { waitUntil: 'domcontentloaded', timeout: 60000 });
      await sleep(8000);
      const body = await p2.evaluate(() => (document.body.innerText || '').slice(0, 3000));
      const titleKey = (title || '').slice(0, 12);
      verified = titleKey ? body.includes(titleKey) : /作品 \(\d+\)/.test(body);
      await b2.close();
    } catch {
      verified = false;
    }
  }

  let f;
  try {
    f = await shot(page, `douyin-post-${Date.now()}.png`);
  } catch {
    f = '';
  }
  log(verified ? `[douyin-web] 发布成功（作品列表已确认，进入平台审核）。截图: ${f}` : `[douyin-web] 已点发布，请人工核对作品列表。截图: ${f}`);
  await browser.close().catch(() => {});
  return { ok: true, verified, screenshot: f };
}

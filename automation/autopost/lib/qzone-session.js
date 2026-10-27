// QQ空间会话管理器：保持浏览器常驻，登录态在进程内始终有效
// （实测：该账号被风控后，会话无法跨浏览器重启保留；同一进程内则稳定）
// 用法见 bin/qzone-daemon.js（HTTP API 封装）
import fs from 'node:fs';
import path from 'node:path';
import {
  ROOT, abs, launchBrowser, log, sleep, randomDelay, shot, autoHeadless,
} from './common.js';

const HOME_URL = 'https://qzone.qq.com/';
const HOME_RE = /user\.qzone\.qq\.com\/\d{5,}/;
const LOGIN_RE = /i\.qq\.com|passport\.qq\.com/;

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

// —— 说说发布相关选择器 ——
const BOX_SELECTORS = [
  'div.textinput.textarea',
  'div[contenteditable="true"][placeholder*="写"]',
  'textarea[placeholder*="写"]',
  'div.tips-textarea',
  'div[contenteditable="true"]',
  'textarea',
];
const SEND_SELECTORS = [
  'button:has-text("发布")',
  'div.send-btn',
  'div.tips-btn:has-text("发布")',
  'a:has-text("发布")',
  'span:has-text("发布")',
];
const QR_FILE = path.join(ROOT, 'logs', 'qrcode', 'qzone.png');
const QR_SELECTORS = [
  '#qrcode img', '#qrcode canvas', '#qrcode',
  '#qrlogin_img', 'img.qrImg', 'img[id*="qr"]', 'canvas[id*="qr"]',
  '.qrcode img', '[class*="qr"] img',
];

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

/**
 * 找「发布」按钮：先用固定选择器；失败则在输入框向上 6 层的容器里
 * 找文字恰为「发布/发表/发送」的最深层可见元素（类名改版也能命中）
 */
async function findSendButton(page, activeBox) {
  const el = await findVisible(page, SEND_SELECTORS);
  if (el) return el;
  try {
    const handle = await activeBox.elementHandle();
    const marked = await page.evaluate((h) => {
      let cur = h;
      for (let i = 0; i < 6 && cur.parentElement; i++) cur = cur.parentElement;
      const cands = [...cur.querySelectorAll('div, span, a, button')].filter((e) => {
        const t = (e.innerText || '').trim();
        return t && t.length <= 6 && /发布|发表|发送/.test(t) && (e.offsetWidth || e.offsetHeight);
      });
      if (!cands.length) return false;
      // 取最深层（不包含其他候选项的）
      const deepest = cands.filter((c) => !cands.some((o) => o !== c && c.contains(o)));
      deepest[0].setAttribute('data-autopost-send', '1');
      return true;
    }, handle);
    if (marked) {
      const send = page.locator('[data-autopost-send="1"]').first();
      if ((await send.count()) > 0 && (await send.isVisible().catch(() => false))) return send;
    }
  } catch {}
  return null;
}

/** 截取登录二维码（QR 元素 → 整页，逐级降级）；成功返回 true */
async function snapQr(page) {
  fs.mkdirSync(path.dirname(QR_FILE), { recursive: true });
  const good = () => fs.existsSync(QR_FILE) && fs.statSync(QR_FILE).size > 1000;
  for (const s of QR_SELECTORS) {
    try {
      const qr = page.locator(s).first();
      if ((await qr.count()) > 0 && (await qr.isVisible())) {
        await qr.screenshot({ path: QR_FILE, timeout: 10000 });
        if (good()) return true;
        break;
      }
    } catch (e) {
      log(`[qzone-session] QR 元素(${s})截图失败: ${e.message.slice(0, 100)}`);
    }
  }
  try {
    await page.screenshot({ path: QR_FILE, timeout: 10000 });
    return good();
  } catch {
    return false;
  }
}

export class QzoneSession {
  constructor(cfg) {
    this.cfg = cfg || {};
    this.profileDir = profileDirOf(this.cfg);
    this.browser = null;
    this.context = null;
    this.page = null;
    this.uin = readMarker(this.profileDir)?.uin || '';
    this.loggedIn = false;
  }

  get uinFromUrl() {
    if (!this.page) return '';
    const m = this.page.url().match(/qzone\.qq\.com\/(\d{5,})/);
    return m ? m[1] : '';
  }

  /** 启动浏览器并打开个人主页；未登录则进入扫码流程（阻塞直到扫完） */
  async start() {
    this.context = (await launchBrowser({
      profileDir: this.profileDir,
      headless: autoHeadless(this.cfg.headless),
    })).context;
    this.browser = this.context; // 持久 context 用 context.close() 关闭
    this.page = await this.context.newPage();
    const startUrl = this.uin ? `https://user.qzone.qq.com/${this.uin}` : HOME_URL;
    await this.page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

    if (await this._waitForHome(20000)) {
      this.loggedIn = true;
      log(`[qzone-session] 会话已就绪（uin=${this.uinFromUrl}）`);
      return;
    }
    await this._qrLogin();
  }

  async _waitForHome(timeout) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (HOME_RE.test(this.page.url())) return true;
      await sleep(1000);
    }
    return HOME_RE.test(this.page.url());
  }

  /** 扫码登录（headless：QR 存 logs/qrcode/qzone.png，每 75 秒重载页面换新码） */
  async _qrLogin() {
    if (fs.existsSync(markerOf(this.profileDir))) fs.unlinkSync(markerOf(this.profileDir));
    log('[qzone-session] 需要扫码登录，生成二维码...');
    await sleep(2000);
    if (await snapQr(this.page)) log(`[qzone-session] 二维码已保存: ${QR_FILE}`);
    log('[qzone-session] 手机打开 http://192.168.1.100:8123/qzone.png 扫码；最多等 10 分钟');

    const deadline = Date.now() + 10 * 60 * 1000;
    let lastReload = Date.now();
    while (Date.now() < deadline) {
      if (HOME_RE.test(this.page.url())) break;
      const expired = await this.page
        .evaluate(() =>
          /二维码已失效|已过期|点击刷新|刷新二维码/.test(
            (document.body && document.body.innerText.slice(0, 2000)) || ''
          )
        )
        .catch(() => false);
      if (Date.now() - lastReload > 75000 || expired) {
        lastReload = Date.now();
        await this.page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
        await sleep(2000);
        if (await snapQr(this.page)) log('[qzone-session] 二维码已换新，请刷新浏览器重新扫码');
      }
      await sleep(2000);
    }
    if (!HOME_RE.test(this.page.url())) {
      throw new Error('扫码超时（10 分钟未检测到登录）');
    }
    await sleep(3000);
    this.uin = this.uinFromUrl;
    writeMarker(this.profileDir, { uin: this.uin });
    this.loggedIn = true;
    log(`[qzone-session] 登录成功（uin=${this.uin}）`);
  }

  /** 确保已登录：被风控踢出时自动重新扫码 */
  async ensureLoggedIn() {
    if (this.page && HOME_RE.test(this.page.url())) return true;
    if (this.page && LOGIN_RE.test(this.page.url())) {
      log('[qzone-session] 检测到会话失效（被踢到登录页），重新扫码...');
      try {
        await this.page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
      } catch {}
    }
    if (!(await this._waitForHome(15000))) await this._qrLogin();
    return this.loggedIn;
  }

  /**
   * 发布一条说说（在常驻会话内）
   * @returns {{ok:boolean, verified:boolean, screenshot:string}}
   */
  async post({ text, images = [], dryRun = false }) {
    if (!(await this.ensureLoggedIn())) throw new Error('登录态不可用');
    const page = this.page;
    // 确保在个人主页（可能被踢出过，重新导航一次）
    if (!HOME_RE.test(page.url())) {
      await page.goto(`https://user.qzone.qq.com/${this.uin}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await this._waitForHome(20000);
    }
    // 拟人节奏
    await randomDelay(3000, 8000);
    await page.mouse.wheel(0, 150).catch(() => {});
    await randomDelay(500, 1500);

    // 1) 输入框
    const box = await findVisible(page, BOX_SELECTORS);
    if (!box) {
      const f = await shot(page, 'qzone-no-box.png');
      throw new Error(`找不到「写说说」输入框（截图: ${f}）`);
    }
    await box.click();
    await randomDelay(500, 1500);
    const activeBox = (await findVisible(page, BOX_SELECTORS)) || box;
    await activeBox.fill(text);
    await randomDelay(800, 2000);

    // 2) 图片（可选）
    if (images.length) {
      const files = images.map(abs).filter((f) => fs.existsSync(f));
      if (files.length < images.length) log(`[qzone-session] 警告: ${images.length - files.length} 张图片路径不存在，已跳过`);
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
            log('[qzone-session] 图片已选择，等待上传...');
            await randomDelay(4000, 8000);
          }
        } else {
          log('[qzone-session] 未找到图片上传按钮，本次只发文字');
        }
      }
    }

    if (dryRun) {
      const f = await shot(page, 'qzone-dryrun.png');
      log(`[qzone-session] --dry-run: 内容已填写，未实际发布。截图: ${f}`);
      return { ok: true, dryRun: true, screenshot: f };
    }

    // 3) 点「发布」（固定选择器 + 动态兜底：输入框容器内文字恰为「发布」的可见元素）
    const send = await findSendButton(page, activeBox);
    if (!send) {
      const f = await shot(page, 'qzone-no-send.png');
      throw new Error(`找不到「发布」按钮（截图: ${f}，可用 /probe 查 DOM）`);
    }
    await send.click();

    // 4) 验证：发布成功后输入框被清空
    await sleep(6000);
    const boxText = (await activeBox.innerText().catch(() => '')) || '';
    const cleared = boxText.trim().length === 0;
    const f = await shot(page, `qzone-post-${Date.now()}.png`);
    if (cleared) log(`[qzone-session] 发布成功（输入框已清空）。截图: ${f}`);
    else log(`[qzone-session] 已点发布，但输入框未清空，请人工核对截图: ${f}`);
    return { ok: cleared, verified: cleared, screenshot: f };
  }

  /** 探测发布相关 DOM（调试选择器用）：点输入框、填字、返回页面上所有按钮类元素 */
  async probeComposer({ text = '探测用文字，不会发布' } = {}) {
    if (!(await this.ensureLoggedIn())) throw new Error('登录态不可用');
    const page = this.page;
    await randomDelay(2000, 4000);
    const box = await findVisible(page, BOX_SELECTORS);
    if (!box) throw new Error('找不到输入框，无法探测');
    await box.click();
    await sleep(800);
    const activeBox = (await findVisible(page, BOX_SELECTORS)) || box;
    await activeBox.fill(text);
    await sleep(1500);

    return page.evaluate(() => {
      const pick = (el) => ({
        tag: el.tagName.toLowerCase(),
        id: el.id || undefined,
        cls: (el.className || '').toString().slice(0, 200) || undefined,
        text: (el.innerText || '').trim().slice(0, 40) || undefined,
        visible: !!(el.offsetWidth || el.offsetHeight),
      });
      // 所有可见的 button/a 以及含「发布」文字的元素
      const btns = [...document.querySelectorAll('button, a')].filter((e) => e.offsetWidth || e.offsetHeight).slice(0, 60).map(pick);
      const withText = [...document.querySelectorAll('div, span')].filter((e) => {
        const t = (e.innerText || '').trim();
        return t && t.length <= 12 && /发布|发送/.test(t) && (e.offsetWidth || e.offsetHeight);
      }).slice(0, 30).map(pick);
      // 输入框所在容器（向上 4 层）的 HTML 结构
      let node = null;
      for (const s of ['div.textinput.textarea', 'div[contenteditable="true"]']) {
        const n = [...document.querySelectorAll(s)].find((e) => e.offsetWidth || e.offsetHeight);
        if (n) { node = n; break; }
      }
      let html = '';
      if (node) {
        let cur = node;
        for (let i = 0; i < 4 && cur.parentElement; i++) cur = cur.parentElement;
        html = cur.outerHTML.slice(0, 12000);
      }
      return { url: location.href, btns, withText, containerHtml: html };
    });
  }

  status() {
    return {
      loggedIn: !!(this.page && HOME_RE.test(this.page.url())),
      url: this.page ? this.page.url() : '',
      uin: this.uin,
    };
  }

  async close() {
    try {
      await this.context?.close();
    } catch {}
  }
}

/**
 * 通过常驻守护进程发布（守护进程未运行时自动拉起；首次登录需人工扫码）
 * @param {{text:string, images?:string[], dryRun?:boolean}} p
 * @param {object} [cfg] config.json 的 qzone 段
 */
export async function postViaDaemon({ text, images = [], dryRun = false }, cfg = {}) {
  const PORT = cfg.daemonPort || 8124;
  const daemonScript = path.join(ROOT, 'bin', 'qzone-daemon.js');
  const up = async () => {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/status`);
      return r.ok;
    } catch {
      return false;
    }
  };
  if (!(await up())) {
    log('[qzone] 守护进程未运行，正在启动（首次登录需要扫码）...');
    const { spawn } = await import('node:child_process');
    const child = spawn(process.execPath, [daemonScript, '--port', String(PORT)], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    // 等待就绪（含可能的扫码登录，最多 12 分钟）
    for (let k = 0; k < 360; k++) {
      await sleep(2000);
      if (await up()) break;
    }
    if (!(await up())) throw new Error('守护进程启动失败，请手动运行: node bin/qzone-daemon.js');
  }
  const r = await fetch(`http://127.0.0.1:${PORT}/post`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text, images, dryRun }),
  });
  const body = await r.json();
  if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
  if (!body.ok && !body.dryRun) throw new Error('发布未确认（输入框未清空），请核对 logs/screenshots');
  return body;
}

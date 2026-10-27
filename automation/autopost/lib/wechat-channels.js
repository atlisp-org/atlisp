// 微信视频号（视频号助手 channels.weixin.qq.com）网页自动化
// 个人账号通道（官方 API 需企业主体）：扫码登录 + 网页发布
//
// 登录事实（2026-10-27 实测 DOM）：
//   - https://channels.weixin.qq.com/ 会跳 /login.html
//   - 二维码在 iframe: https://open.weixin.qq.com/connect/qrconnect?appid=...
//   - QR 图: iframe 内 <img src="https://open.weixin.qq.com/connect/qrcode/<token>">（470x470）
//   - 扫码确认后父页面跳转 /platform/
//
// 风险：微信系风控严格，频率每天 1 条封顶；网页自动化违反平台协议，账号风险自担。
import fs from 'node:fs';
import path from 'node:path';
import {
  ROOT, loadConfig, abs, launchBrowser, saveState, log, sleep, shot, autoHeadless,
} from './common.js';

const LOGIN_URL = 'https://channels.weixin.qq.com/login.html';
const HOME_RE = /channels\.weixin\.qq\.com\/platform\//;
const QR_FILE = path.join(ROOT, 'logs', 'qrcode', 'wechat.png');

/** 短标题清洗：视频号只允许 书名号/引号/冒号/加号/问号/百分号/摄氏度 等符号，
 *  其余符号（如 -、#、&）会触发「标题包含特殊字符」校验拦截发表。
 *  不允许的字符替换为空格，连续空格合并，截 25 字。 */
function sanitizeTitle(t) {
  const keep = /[\u4e00-\u9fff\u3400-\u4dbfA-Za-z0-9\s《》〈〉「」『』“”‘’“”:：+?？%℃]/;
  let out = '';
  for (const ch of t || '') out += keep.test(ch) ? ch : ' ';
  return out.replace(/\s+/g, ' ').trim().slice(0, 25);
}

/** 取 iframe 里的 QR 原图（470x470 直链）到 logs/qrcode/wechat.png
 *  注意：iframe 里有多个同 src 的 img（含 0x0 隐藏的），不能 locator.first()，
 *  改为读 DOM 找 naturalWidth 足够的 img，直接下载其 URL（不依赖可见性） */
async function snapQr(page) {
  fs.mkdirSync(path.dirname(QR_FILE), { recursive: true });
  try {
    const frame = page.frames().find((f) => f.url().includes('qrconnect'));
    if (!frame) return false;
    const src = await frame.evaluate(() => {
      const el = [...document.querySelectorAll('img[src*="/connect/qrcode/"]')].find(
        (i) => i.naturalWidth >= 100,
      );
      return el ? el.src : null;
    });
    if (!src) return false;
    const resp = await page.request.get(src);
    if (!resp.ok()) return false;
    const body = await resp.body();
    if (body.length < 1000) return false;
    fs.writeFileSync(QR_FILE, body);
    return true;
  } catch {
    return false;
  }
}

/** iframe 里的「二维码已过期/已失效」文案检测（立即换新码） */
async function qrExpired(page) {
  const f = page.frames().find((x) => x.url().includes('qrconnect'));
  if (!f) return false;
  try {
    return await f.evaluate(() => /二维码已过期|已失效|点击刷新/.test(document.body.innerText.slice(0, 500)));
  } catch {
    return true; // frame 没了/崩了，按过期处理
  }
}

/** 检查页面是否被踢回登录页（微信会话失效通常是几秒后的延迟重定向） */
async function assertNotLogin(page, what) {
  await page.waitForTimeout(3000);
  if (/login\.html/i.test(page.url())) {
    throw new Error(`视频号登录态已失效（${what} 时被踢回登录页），请重新运行 node bin/channels-login.js 扫码`);
  }
}

/**
 * 视频号扫码登录。登录态存持久化 profile（同 qzone daemon 模式，比 storageState 更稳）。
 * @param {{headless?: boolean}} [p]
 */
export async function channelsWebLogin({ headless } = {}) {
  const cfg = loadConfig().wechat?.channels?.web || {};
  const profileDir = abs(cfg.profileDir || 'state/profiles/channels');
  const hl = autoHeadless(headless);
  const { browser, context } = await launchBrowser({ profileDir, headless: hl });
  const page = await context.newPage();
  await page.goto('https://channels.weixin.qq.com/platform/', { waitUntil: 'domcontentloaded', timeout: 60000 });

  let needScan = true;
  // 微信踢出是延迟重定向（约 3~6s），等 8s 并校验页面内容确实是平台
  await page.waitForTimeout(8000);
  const loggedIn =
    HOME_RE.test(page.url()) &&
    !/login\.html/i.test(page.url()) &&
    (await page.evaluate(() => /视频号/.test(document.body.innerText)).catch(() => false));
  if (loggedIn) {
    needScan = false;
    log('[channels] 登录态仍有效，无需重新登录');
  }

  if (needScan) {
    // 登录态失效：回登录页走扫码
    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    if (hl) {
      await sleep(3000);
      if (await snapQr(page)) {
        log(`[channels] 二维码已保存: ${QR_FILE}`);
        log('[channels] 手机微信「扫一扫」打开 http://192.168.1.100:8123/wechat.png 并确认');
      } else {
        log('[channels] 二维码截图失败，90 秒后自动重试');
      }
      log('[channels] QR 约 2 分钟过期，每 75 秒重载页面换新码；最多等待 10 分钟');

      const deadline = Date.now() + 10 * 60 * 1000;
      let lastReload = Date.now();
      let ok = false;
      while (Date.now() < deadline) {
        if (HOME_RE.test(page.url())) {
          ok = true;
          break;
        }
        const expired = await qrExpired(page);
        if (Date.now() - lastReload > 75000 || expired) {
          lastReload = Date.now();
          await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
          await sleep(2000);
          if (await snapQr(page)) log('[channels] 二维码已换新（页面已重载），请重新扫码');
          else log('[channels] 二维码截图仍失败，继续等待重试');
        }
        await sleep(2000);
      }
      if (!ok) {
        await browser.close();
        throw new Error('扫码超时（10 分钟未检测到登录）。请重新运行登录命令，尽快扫码');
      }
    } else {
      log('[channels] 请用微信扫码登录（最多等待 3 分钟）...');
      await page.waitForURL(HOME_RE, { timeout: 180000 });
    }

    await sleep(3000);
    // 登录态已存进持久化 profile（cookies 自动保留）；另存一份 storageState 快照便于排查
    const stateFile = abs(cfg.stateFile || 'state/wechat-channels.json');
    await saveState(context, stateFile).catch(() => {});
    log(
      `[channels] 登录成功，状态已保存: ${path.relative(ROOT, profileDir)}（快照: ${path.relative(ROOT, stateFile)}）`,
    );
  }

  await shot(page, 'channels-home.png');
  await browser.close();
  return { ok: true };
}

/** 等待匹配 URL 的 iframe 出现 */
async function waitForFrame(page, pred, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const f = page.frames().find((fr) => pred(fr.url()));
    if (f) return f;
    await sleep(500);
  }
  throw new Error('等待 iframe 超时: ' + String(pred));
}

/**
 * 编辑器 frame 内交互一律用纯 JS（evaluate）。
 * 实测：微前端用 src=empty.html 的 iframe + contentWindow.location 换文档，
 * Playwright 对该 frame 的内部文档状态与真实文档脱节——locator 恒指向旧文档
 * （input 数量为 0），ElementHandle 的 setInputFiles/fill/click 的 detached 检测
 * 也对着旧文档，一律报 "Cannot set input files to detached element"。
 * 只有 evaluate 作用于真实文档，所以全部交互在页面内用原生 JS 完成。
 */

/** 上传视频：Node 读文件 base64 → 页面内构造 File + DataTransfer 赋给 input[type=file] 并触发 change（ant-upload 监听 change 开始上传） */
async function edUploadVideo(ed, videoAbs) {
  const b64 = fs.readFileSync(videoAbs).toString('base64');
  const name = path.basename(videoAbs);
  await ed.evaluate(
    ([b64, name]) => {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const file = new File([bytes], name, { type: 'video/mp4', lastModified: Date.now() });
      const input = document.querySelector('input[type=file]');
      if (!input) throw new Error('上传框不存在');
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    },
    [b64, name],
  );
}

/** React 受控 input 赋值：native value setter + input/change 事件（selector 字符串参数） */
async function edFillInput(ed, selector, value) {
  await ed.evaluate(
    ([selector, value]) => {
      const el = document.querySelector(selector);
      if (!el) throw new Error('输入框不存在: ' + selector);
      el.focus();
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    },
    [selector, value],
  );
}

/** contenteditable 描述框赋值（selector 字符串参数；优先取 isContentEditable 的元素，
 *  因为 contenteditable 属性可能是空字符串，[contenteditable="true"] 匹配不到）。
 *  必须走浏览器编辑管线 execCommand('insertText')：组件监听真实输入管线
 *  （DOMSubtreeModified → handleNodeChange → updateDescData → store），
 *  直接 textContent 赋值 + 合成 input 事件不会进入发表 payload（实测确认）。 */
async function edFillEditable(ed, selector, text) {
  await ed.evaluate(
    ([selector, text]) => {
      const cands = [...document.querySelectorAll(selector)];
      const el = cands.find((e) => e.isContentEditable) || cands[0];
      if (!el) throw new Error('编辑区不存在: ' + selector);
      el.focus();
      document.execCommand('selectAll', false, null);
      document.execCommand('insertText', false, text);
    },
    [selector, text],
  );
}

/** 找含 getCreateOrPreviewParams（发表 payload 构建器）的表单 wrapper 组件，
 *  存到 frame 的 window.__wrap。返回 true = 找到 */
async function edFindPayloadWrapper(ed) {
  return ed
    .evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '发表');
      let d = btn;
      while (d && !d.__vue__) d = d.parentElement;
      let root = d && d.__vue__;
      let guard = 0;
      while (root && root.$parent && guard < 30) {
        root = root.$parent;
        guard++;
      }
      if (!root) return false;
      const seen = new Set();
      const stack = [root];
      let n = 0;
      while (stack.length && n < 4000) {
        const c = stack.pop();
        if (seen.has(c)) continue;
        seen.add(c);
        n++;
        try {
          if (c.$options.methods && typeof c.$options.methods.getCreateOrPreviewParams === 'function') {
            window.__wrap = c;
            return true;
          }
        } catch {}
        (c.$children || []).forEach((ch) => stack.push(ch));
      }
      return false;
    })
    .catch(() => false);
}

/** 读发表 payload 里的真实标题/描述（post.objectDesc；DOM 里有 ≠ payload 里有）。
 *  注意：视频帖标题在 shortTitle 数组（[{shortTitle}]），mpTitle 是图文模式字段（视频模式恒空） */
async function edPayloadTexts(ed) {
  return ed
    .evaluate(() => {
      try {
        const p = window.__wrap.getCreateOrPreviewParams();
        const d = (p && p.post && p.post.objectDesc) || {};
        const st =
          (d.shortTitle && d.shortTitle[0] && d.shortTitle[0].shortTitle) ||
          d.mpTitle ||
          '';
        return { desc: d.description || '', title: st };
      } catch {
        return null;
      }
    })
    .catch(() => null);
}

/** 提交短标题到 store：input 事件只更新组件本地 shortTitle，
 *  须调 parseShortTitle()（emit updateShortTitle）才进发表 payload。
 *  返回 { ok, titleError }（titleError 为组件校验信息：超 30 字/特殊字符等） */
async function edCommitShortTitle(ed) {
  return ed
    .evaluate(() => {
      const el = document.querySelector('input[placeholder*="短标题"]');
      let d = el, m = null, depth = 0;
      while (d && depth < 10) {
        if (d.__vue__) {
          m = d.__vue__;
          break;
        }
        d = d.parentElement;
        depth++;
      }
      const n = m && m.$parent;
      if (!n || typeof n.parseShortTitle !== 'function') {
        return { ok: false, titleError: '短标题组件未找到' };
      }
      n.parseShortTitle();
      return { ok: true, titleError: n.titleError || '' };
    })
    .catch((e) => ({ ok: false, titleError: e.message }));
}

/** JS 点击按钮（按精确文本匹配；普通按钮 untrusted click 即可生效） */
async function edClickButton(ed, text) {
  await ed.evaluate((text) => {
    const el = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === text);
    if (!el) throw new Error('按钮不存在: ' + text);
    el.click();
  }, text);
}

/** 读上传组件（Vue AUpload）的真实文件状态：sFileList 的 status/percent。
 *  纯文本判断不可靠：文件不达标（如时长 <3s）时 validator 静默拒绝，
 *  不发上传请求、页面只有瞬态 toast，「发表」按钮甚至可点，点了才报错。 */
async function edUploadState(ed) {
  return ed
    .evaluate(() => {
      const input = document.querySelector('input[type=file]');
      let el = input && input.parentElement;
      while (el) {
        const v = el.__vue__;
        if (v && v.$options && v.$options.name === 'AUpload') {
          const fl = (v.$data && v.$data.sFileList) || [];
          return fl.map((f) => ({ name: (f.name || '').slice(-40), status: f.status, percent: f.percent }));
        }
        el = el.parentElement;
      }
      return null;
    })
    .catch(() => null);
}

/** 在编辑器 frame 内挂 MutationObserver，捕获校验错误 toast（瞬态，3s 消失） */
async function edInstallErrWatcher(ed) {
  await ed
    .evaluate(() => {
      window.__verrs = [];
      const RE =
        /视频时长需\d+秒以上|请上传\d+小时以内的视频|视频宽高比需在[^，。]*|文件大小超过限制|最多上传\d+个视频|最多上传\d+张图片|不可同时选择图片和视频|只允许上传图片|当前浏览器不支持此视频格式|当前环境不支持此视频格式|视频文件解析失败/;
      const scan = () => {
        const els = [...document.querySelectorAll('div,span,li,p')].filter(
          (e) => /toast|tip|notice|message|alert/i.test((e.className || '').toString()) && e.offsetParent !== null,
        );
        for (const e of els) {
          const s = (e.innerText || '').trim();
          if (s && RE.test(s) && !window.__verrs.includes(s)) window.__verrs.push(s.slice(0, 150));
        }
      };
      new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
      scan();
    })
    .catch(() => {});
}

/** 轮询直到 fn() 在编辑器 frame 内返回真值 */
async function edWaitFor(ed, fn, timeout, what) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await ed.evaluate(fn).catch(() => false)) return;
    await sleep(3000);
  }
  throw new Error(`${what} ${Math.round(timeout / 1000)} 秒内未就绪`);
}

/**
 * 视频号网页发布视频（2026-10-27 实测 DOM）
 * 流程: /platform/ → 点「发表视频」(post-card 微前端 iframe)
 *   → /platform/post/create（编辑器 iframe /micro/content/post/create）
 *   → ant-upload input[type=file] 传视频，等「发表」按钮解除 disabled（上传+服务端转码）
 *   → 短标题 input[placeholder*="短标题"] + 描述 div.input-editor[contenteditable=true]
 *   → 点「发表」→ 跳回 /platform/，最近视频列表出现新条目即验证成功
 * @param {{video:string, title?:string, desc?:string, dryRun?:boolean}} p
 */
export async function channelsWebPublish({ video, title = '', desc = '', dryRun = false } = {}) {
  const cfg = loadConfig().wechat?.channels?.web || {};
  const profileDir = abs(cfg.profileDir || 'state/profiles/channels');
  if (!fs.existsSync(profileDir)) {
    throw new Error('未登录视频号：先运行 node bin/channels-login.js 扫码');
  }
  const { browser, context } = await launchBrowser({ profileDir, headless: true });
  const page = await context.newPage();
  try {
    await page.goto('https://channels.weixin.qq.com/platform/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await assertNotLogin(page, '进入平台首页');
    log('[channels] 已进入平台首页');

    // 关闭可能出现的引导弹层
    for (const t of ['我知道了', '知道了']) {
      try { await page.getByText(t, { exact: true }).first().click({ timeout: 2000 }); } catch {}
    }

    // 点「发表视频」（iframe 内 Playwright click 会被判定超时，用 JS click）
    let card = await waitForFrame(page, (u) => u.includes('post-card'), 30000);
    // 等 post-card 微前端真正初始化完成：视频列表渲染出来。
    // 实测：列表未渲染完（约 10s 内）就点「发表视频」，跳转后编辑器微前端不加载
    const cardReady = Date.now();
    try {
      await card.waitForFunction(
        () => /已声明原创|已发布|\d{4}年\d{1,2}月\d{1,2}日/.test(document.body.innerText),
        null,
        { timeout: 20000, polling: 1000 },
      );
    } catch {}
    const preheat = 10000 - (Date.now() - cardReady);
    if (preheat > 0) await sleep(preheat);
    await assertNotLogin(page, '点「发表视频」前');
    await card.evaluate(() => {
      const el = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '发表视频');
      if (!el) throw new Error('未找到「发表视频」按钮');
      el.click();
    });
    await page.waitForURL(/\/platform\/post\/create/, { timeout: 30000 });
    let ed = await waitForFrame(page, (u) => u.includes('micro/content/post/create'), 30000);
    log('[channels] 已进入发布编辑器');

    const videoAbs = abs(video);
    if (!fs.existsSync(videoAbs)) throw new Error('视频文件不存在: ' + videoAbs);

    // 等上传框出现后上传视频（纯 JS：File + DataTransfer + change 事件）
    await edWaitFor(ed, () => !!document.querySelector('input[type=file]'), 30000, '上传框');
    if (/login\.html/i.test(page.url())) {
      throw new Error('视频号登录态已失效（编辑器加载时被踢回登录页），请重新运行 node bin/channels-login.js 扫码');
    }
    await edInstallErrWatcher(ed);
    await edUploadVideo(ed, videoAbs);
    log(`[channels] 已选择视频: ${path.basename(videoAbs)}，等待上传完成（最长 15 分钟）...`);

    // 等上传完成：真实信号 = Vue 组件 sFileList 里文件 status=done + 「发表」按钮无
    // disabled 属性且无 weui-desktop-btn_disabled class（应用认为可发表）。
    // 至少观察 20s（小文件上传很快，转码在后台，防止刚点完就发）。
    // 同时捕获校验错误 toast（时长<3s/大小/比例等不达标）→ 快速失败，不傻等 15 分钟。
    const tUpload = Date.now();
    const deadline = Date.now() + 15 * 60 * 1000;
    let lastInfo = '';
    let uploadSeen = false;
    let ready = false;
    while (Date.now() < deadline) {
      const st = await ed
        .evaluate(() => ({
          pub: (() => {
            const el = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '发表');
            return el ? !el.disabled && !/weui-desktop-btn_disabled/.test(el.className) : false;
          })(),
        }))
        .catch(() => ({ pub: false }));
      const verrs = await ed.evaluate(() => (window.__verrs || []).slice()).catch(() => []);
      if (verrs.length) {
        throw new Error(`视频未通过平台校验: ${verrs[0]}（要求: H.264 MP4、≥3 秒、≤8 小时、720p 以上）`);
      }
      const fl = await edUploadState(ed);
      if (Array.isArray(fl) && fl.length) {
        uploadSeen = true;
        const info = fl.map((f) => `${f.name}:${f.status}${f.percent != null ? f.percent + '%' : ''}`).join(' ');
        if (info !== lastInfo) {
          log('[channels] 上传状态: ' + info);
          lastInfo = info;
        }
        if (fl.some((f) => f.status === 'error')) throw new Error('上传失败: ' + info);
        ready = fl.some((f) => f.status === 'done') && st.pub && Date.now() - tUpload >= 20000;
      }
      if (ready) break;
      if (/login\.html/i.test(page.url())) {
        throw new Error('视频号登录态已失效（上传等待时被踢回登录页），请重新运行 node bin/channels-login.js 扫码');
      }
      await sleep(5000);
    }
    if (!ready) {
      throw new Error(`上传 15 分钟未完成（uploadSeen=${uploadSeen}，最后: ${lastInfo || '未被上传组件接受'}），请人工查看`);
    }
    log('[channels] 上传完成，开始填写信息');

    // 短标题（清洗特殊符号，否则触发「标题包含特殊字符」拦截发表）
    const safeTitle = sanitizeTitle(title);
    if (safeTitle) {
      if (safeTitle.length < 6) {
        throw new Error('短标题不足 6 字（平台要求至少 6 字）: ' + JSON.stringify(safeTitle));
      }
      await edFillInput(ed, 'input[placeholder*="短标题"]', safeTitle);
      const tWritten = await ed
        .evaluate(() => {
          const el = document.querySelector('input[placeholder*="短标题"]');
          return el ? el.value : '';
        })
        .catch(() => '');
      if (!tWritten.includes(safeTitle.slice(0, 8))) {
        throw new Error('短标题填写校验失败: ' + JSON.stringify(tWritten.slice(0, 40)));
      }
      // input 事件只更新组件本地 shortTitle；须调 parseShortTitle() 提交到 store
      // 才进发表 payload（实测：不提交则发布的帖子没有标题）
      const committed = await edCommitShortTitle(ed);
      if (!committed.ok) {
        throw new Error('短标题提交失败: ' + committed.titleError);
      }
      if (committed.titleError) {
        throw new Error('短标题校验未通过: ' + committed.titleError);
      }
    }
    // 描述（contenteditable，走 execCommand 编辑管线）
    if (desc) {
      await edFillEditable(ed, 'div.input-editor', desc);
      const written = await ed
        .evaluate(() => {
          const cands = [...document.querySelectorAll('div.input-editor')];
          const el = cands.find((e) => e.isContentEditable) || cands[0];
          return el ? el.innerText : '';
        })
        .catch(() => '');
      if (!written.includes(desc.slice(0, 8))) {
        throw new Error('描述填写校验失败: ' + JSON.stringify(written.slice(0, 40)));
      }
    }

    // 用 payload 构建器验证标题/描述真的进了发表数据（DOM 里有 ≠ payload 里有，
    // 之前实测 textContent 方式描述只留在 DOM、发布后 description 为空）
    if (await edFindPayloadWrapper(ed)) {
      let pTitle = '';
      let pDesc = '';
      for (let i = 0; i < 10; i++) {
        const p = (await edPayloadTexts(ed)) || {};
        pTitle = p.title || '';
        pDesc = p.desc || '';
        const tOk = !safeTitle || pTitle.includes(safeTitle.slice(0, 8));
        const dOk = !desc || pDesc.includes(desc.slice(0, 8));
        if (tOk && dOk) break;
        await sleep(1000);
      }
      if (safeTitle && !pTitle.includes(safeTitle.slice(0, 8))) {
        throw new Error('标题在 DOM 但未进发表 payload: ' + JSON.stringify(pTitle.slice(0, 40)));
      }
      if (desc && !pDesc.includes(desc.slice(0, 8))) {
        throw new Error('描述在 DOM 但未进发表 payload: ' + JSON.stringify(pDesc.slice(0, 40)));
      }
      log('[channels] 标题/描述已登记进发表 payload');
    }

    await shot(page, 'channels-editor-filled.png');

    if (dryRun) {
      log('[channels] dry-run：字段已填好，未点「发表」');
      return { ok: true, dryRun: true };
    }

    await edClickButton(ed, '发表');
    log('[channels] 已点「发表」，等待跳转/确认...');
    // 实测完整链路（bundle 反编译 + 运行时插桩确认）：
    //   点「发表」→ check_finder_comm_face → 应用内部轮询 post_clip_video_result
    //   （视频裁剪/转码，约 11-16s）→ getPostPayload 构建成功 →
    //   弹「原创声明」拦截对话框（canShowOriginalMark && inCreatorLeisure && 未声明原创，
    //   首次点发表必现，headless 下无人点击会永远卡住）→ 点「直接发表」→
    //   post_create → 跳回 /platform/post/list。
    // 因此自动处理流程中的对话框：优先「直接发表」（推广视频不声明原创），
    // 保留「不保存/确定/确认发表」兜底（「将此次编辑保留?」弹窗等）。
    // 完成判定：顶层 URL 跳离 /post/create，或编辑器 frame 换文档/表单消失
    // （微前端发表成功后可能只换 frame 内文档，顶层 URL 不变）。
    const navDeadline = Date.now() + 150000;
    let leftEditor = false;
    while (Date.now() < navDeadline) {
      const topUrl = page.url();
      if (/login\.html/i.test(topUrl)) {
        throw new Error('视频号登录态已失效（点发表后被踢回登录页），请重新运行 node bin/channels-login.js 扫码');
      }
      if (!/post\/create/.test(topUrl)) {
        leftEditor = true;
        break;
      }
      const edState = await ed
        .evaluate(() => ({
          url: location.href,
          hasForm: !!document.querySelector('input[type=file]') || !!document.querySelector('input[placeholder*="短标题"]'),
        }))
        .catch(() => null);
      if (!edState) {
        leftEditor = true; // frame 上下文销毁 = 文档被换
        break;
      }
      if (/login/i.test(edState.url)) {
        throw new Error('视频号登录态已失效（编辑器 frame 被踢回登录页），请重新运行 node bin/channels-login.js 扫码');
      }
      if (!edState.hasForm) {
        leftEditor = true; // 表单消失 = 发表动作已完成
        break;
      }
      try {
        await ed.evaluate(() => {
          const vis = (b) => {
            const r = b.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          };
          const inDialog = (b) =>
            !!b.closest('.weui-desktop-dialog, [class*="dialog"], [class*="Dialog"]');
          const btns = [...document.querySelectorAll('button')].filter(vis);
          // 1) 「原创声明」拦截 → 直接发表（每次新页面首次点「发表」必现）
          const direct = btns.find((b) => b.textContent.trim() === '直接发表');
          if (direct) return void direct.click();
          // 2) 「将此次编辑保留?」→ 不保存（不留草稿）
          const no = btns.find((b) => b.textContent.trim() === '不保存');
          if (no) return void no.click();
          // 3) 兜底：对话框内的 确定/确认发表
          const ok = btns.find((b) =>
            inDialog(b) && ['确定', '确认发表'].includes(b.textContent.trim()),
          );
          if (ok) return void ok.click();
        });
      } catch {}
      await sleep(3000);
    }
    if (!leftEditor) {
      throw new Error('点击「发表」后 150 秒未跳离编辑器（可能卡在原创声明弹窗之外的未知对话框），请人工查看');
    }
    log('[channels] 已跳回平台，验证新视频是否出现在作品列表...');
    // 验证：抓 post_list API 响应（feed 列表 UI 不渲染短标题，只有 API 数据可靠）
    let listData = null;
    const onResp = async (r) => {
      try {
        if (r.request().method() === 'POST' && r.url().includes('/post/post_list')) {
          const j = JSON.parse(await r.text());
          if (j && j.data && Array.isArray(j.data.list) && j.data.list.length) listData = j.data.list;
        }
      } catch {}
    };
    page.on('response', onResp);
    await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
    for (let i = 0; i < 6 && !listData; i++) await sleep(3000);
    page.off('response', onResp);
    let verified = false;
    let verifyInfo = '';
    if (listData && listData.length) {
      const d = listData[0].desc || {};
      const t = (d.shortTitle && d.shortTitle[0] && d.shortTitle[0].shortTitle) || '';
      const dd = d.description || '';
      const key = (safeTitle || desc || '').slice(0, 12);
      verified = !!key && (t.includes(key) || dd.includes(key));
      verifyInfo = `首条: title=${JSON.stringify(t.slice(0, 20))} desc=${JSON.stringify(dd.slice(0, 20))}`;
    }
    log(verified
      ? '[channels] 发布成功（作品列表已确认新条目，' + verifyInfo + '）'
      : '[channels] 已点发表但未能在作品列表确认（' + (verifyInfo || '未拿到 post_list 数据') + '），请人工查看');
    return { ok: true, verified };
  } finally {
    await browser.close();
  }
}

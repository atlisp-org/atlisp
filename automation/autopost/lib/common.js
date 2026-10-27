// 通用工具：配置 / 日志 / 随机延时 / 浏览器启动 / 登录状态 / 内容解析
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');

export function loadConfig() {
  const file = path.join(ROOT, 'config.json');
  if (!fs.existsSync(file)) {
    console.error('[config] 未找到 config.json，请先执行: cp config.example.json config.json');
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** 相对路径按项目根目录解析 */
export function abs(p) {
  return path.isAbsolute(p) ? p : path.join(ROOT, p);
}

export function log(msg) {
  const line = `[${new Date().toISOString().replace('T', ' ').slice(0, 19)}] ${msg}`;
  console.log(line);
  const dir = path.join(ROOT, 'logs');
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(path.join(dir, 'run.log'), line + '\n');
}

/**
 * 自动判断是否无头模式：显式值优先；Linux 下无 DISPLAY 时默认 headless
 * @param {boolean|undefined} override 显式覆盖（true/false），undefined 则自动判断
 */
export function autoHeadless(override) {
  if (override === true || override === false) return override;
  return process.platform === 'linux' && !process.env.DISPLAY;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 随机延时，模拟人工操作节奏，降低风控概率 */
export const randomDelay = (min = 1500, max = 4000) => sleep(min + Math.random() * (max - min));

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

/**
 * 启动浏览器
 * @param {string} [stateFile] 登录态文件（存在则作为 storageState 加载）
 * @param {string} [profileDir] 持久化 profile 目录（优先于 stateFile）。
 *   用 launchPersistentContext：cookies/localStorage/浏览历史跨次运行保留，
 *   浏览器表现为"长期连续使用"，显著降低被平台风控标记的概率。
 * @param {boolean} [headless] 是否无头模式
 */
export async function launchBrowser({ stateFile, profileDir, headless = false } = {}) {
  const opts = {
    args: ['--disable-blink-features=AutomationControlled'],
    userAgent: UA,
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    viewport: { width: 1366, height: 900 },
  };
  if (profileDir) {
    fs.mkdirSync(abs(profileDir), { recursive: true });
    const context = await chromium.launchPersistentContext(abs(profileDir), { ...opts, headless });
    // headless 下 context.browser() 可能为 null，统一成 { close() } 接口
    const browser = context.browser() || { close: () => context.close() };
    return { browser, context };
  }
  if (stateFile && fs.existsSync(stateFile)) opts.storageState = stateFile;
  const browser = await chromium.launch({ headless });
  const context = await browser.newContext(opts);
  return { browser, context };
}

/** 保存浏览器登录态（cookies + localStorage）到文件 */
export async function saveState(context, stateFile) {
  const f = abs(stateFile);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  await context.storageState({ path: f });
}

/** 保存调试截图，返回文件路径 */
export async function shot(page, name) {
  const dir = path.join(ROOT, 'logs', 'screenshots');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  await page.screenshot({ path: file }).catch(() => {});
  return file;
}

/**
 * 解析 QQ空间内容文件（queue/qzone/*.txt）
 * 第一行 = 说说文字；以 img: 开头的行 = 图片路径
 */
export function parseQzoneFile(file) {
  const lines = fs.readFileSync(abs(file), 'utf8').split(/\r?\n/);
  const text = (lines[0] || '').trim();
  const images = lines
    .slice(1)
    .map((l) => l.trim())
    .filter((l) => /^img:\s*\S/.test(l))
    .map((l) => l.replace(/^img:\s*/, '').trim());
  return { text, images };
}

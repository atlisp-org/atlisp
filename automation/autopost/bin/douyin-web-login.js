#!/usr/bin/env node
// 抖音创作者平台：扫码登录（无官方 API 权限时的网页自动化兜底方案）
// 无图形环境（服务器）下自动 headless：二维码截图存 logs/qrcode/douyin.png，轮询等待扫码
//
// 用法:
//   node bin/douyin-web-login.js             # 自动判断（Linux 无 DISPLAY 时 headless）
//   node bin/douyin-web-login.js --headless  # 强制无头
//   node bin/douyin-web-login.js --gui       # 强制有头
import { douyinWebLogin } from '../lib/douyin-web.js';

const flags = new Set(process.argv.slice(2));
const headless = flags.has('--headless') ? true : flags.has('--gui') ? false : undefined;

douyinWebLogin({ headless }).catch((e) => {
  console.error('[douyin-web] 登录失败:', e.message);
  process.exit(1);
});

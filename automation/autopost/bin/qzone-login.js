#!/usr/bin/env node
// QQ空间：扫码登录（首次 / 登录态过期时）
// 无图形环境（服务器）下自动 headless：二维码截图存 logs/qrcode/qzone.png，轮询等待扫码
//
// 用法:
//   node bin/qzone-login.js             # 自动判断（Linux 无 DISPLAY 时 headless）
//   node bin/qzone-login.js --headless  # 强制无头
//   node bin/qzone-login.js --gui       # 强制有头（桌面环境直接扫码）
import { qzoneLogin } from '../lib/qzone.js';

const flags = new Set(process.argv.slice(2));
const headless = flags.has('--headless') ? true : flags.has('--gui') ? false : undefined;

qzoneLogin({ headless }).catch((e) => {
  console.error('[qzone] 登录失败:', e.message);
  process.exit(1);
});

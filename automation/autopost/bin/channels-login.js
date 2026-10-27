#!/usr/bin/env node
// 微信视频号（视频号助手）扫码登录：二维码存 logs/qrcode/wechat.png
// 手机微信「扫一扫」打开 http://192.168.1.100:8123/wechat.png 并确认
//
// 用法:
//   node bin/channels-login.js             # 自动判断（无 DISPLAY 时 headless）
//   node bin/channels-login.js --headless
//   node bin/channels-login.js --gui
import { channelsWebLogin } from '../lib/wechat-channels.js';

const flags = new Set(process.argv.slice(2));
const headless = flags.has('--headless') ? true : flags.has('--gui') ? false : undefined;

channelsWebLogin({ headless }).catch((e) => {
  console.error('[channels] 登录失败:', e.message);
  process.exit(1);
});

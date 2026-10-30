// 扫码二维码邮件通知：调用 bin/mail-qr.py（python3 标准库 smtplib，无需额外依赖）
// 邮件失败只记日志，不影响登录主流程
import { spawn } from 'node:child_process';
import path from 'node:path';
import { ROOT, loadConfig, log } from './common.js';

const SCRIPT = path.join(ROOT, 'bin', 'mail-qr.py');

/**
 * 把当前二维码截图发到邮箱
 * @param {object} o
 * @param {string} o.platform 平台名（视频号 / QQ空间）
 * @param {string} o.image    二维码截图绝对路径
 * @param {string} [o.url]    局域网二维码地址
 * @param {string} [o.note]   附加说明
 */
export function mailQr({ platform, image, url = '', note = '' } = {}) {
  const mail = loadConfig().mail || {};
  if (mail.enabled === false) return;
  const args = [SCRIPT, '--platform', platform, '--image', image];
  if (url) args.push('--url', url);
  if (note) args.push('--note', note);
  if (mail.to) args.push('--to', mail.to);

  const child = spawn('python3', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let err = '';
  child.stderr.on('data', (d) => (err += String(d)));
  child.on('error', (e) => log(`[mail] ${platform} 二维码邮件发送失败: ${e.message}`));
  child.on('close', (code) => {
    if (code === 0) log(`[mail] ${platform} 二维码已发到邮箱`);
    else log(`[mail] ${platform} 二维码邮件发送失败: ${err.trim().slice(0, 200)}`);
  });
}

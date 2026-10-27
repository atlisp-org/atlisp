#!/usr/bin/env node
// QQ空间：发布一条说说（通过常驻守护进程，会话内发布，最稳）
// 守护进程未运行时会自动启动（首次需扫码）。
//
// 用法:
//   node bin/qzone-post.js "内容"
//   node bin/qzone-post.js "内容" --img a.jpg b.png
//   node bin/qzone-post.js queue/qzone/2026-10-27.txt   # 内容文件（首行文字，img: 行是图片）
//   node bin/qzone-post.js "内容" --dry-run             # 只填写不发布（调试）
import fs from 'node:fs';
import path from 'node:path';
import { abs, parseQzoneFile, loadConfig, log } from '../lib/common.js';
import { postViaDaemon } from '../lib/qzone-session.js';

const args = process.argv.slice(2);
const opts = { text: '', images: [], dryRun: false };
let i = 0;
let imgMode = false;
while (i < args.length) {
  const a = args[i];
  if (a === '--img') imgMode = true;
  else if (a === '--dry-run') opts.dryRun = true;
  else if (imgMode) opts.images.push(a);
  else if (!opts.text) opts.text = a;
  i++;
}

// 第一个参数是已存在的内容文件时，按文件格式解析
if (opts.text) {
  const candidates = [
    path.isAbsolute(opts.text) ? opts.text : path.resolve(process.cwd(), opts.text),
    abs(opts.text),
  ];
  const f = candidates.find((p) => fs.existsSync(p) && fs.statSync(p).isFile());
  if (f) {
    const parsed = parseQzoneFile(f);
    opts.text = parsed.text;
    opts.images = [...new Set([...opts.images, ...parsed.images])];
    log(`[qzone] 从文件读取内容: ${f}`);
  }
}

if (!opts.text) {
  console.error('用法: node bin/qzone-post.js "内容" [--img img1 img2 ...] [--dry-run]');
  console.error('     node bin/qzone-post.js 内容文件.txt');
  process.exit(1);
}

async function main() {
  const cfg = loadConfig().qzone || {};
  await postViaDaemon({ text: opts.text, images: opts.images, dryRun: opts.dryRun }, cfg);
  log(`[qzone] 发布流程结束`);
}

main().catch((e) => {
  console.error('[qzone] 发布失败:', e.message);
  process.exit(1);
});

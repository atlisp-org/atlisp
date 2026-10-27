#!/usr/bin/env node
// 单次发布（atlisp-worker 调度集成入口）：
//   取指定平台队列里第一个待发布文件 → 发布 → 成功移入 posted/，失败保留（下周期重试）
//
// 队列规则（与 bin/schedule.js 一致）：
//   - qzone:  queue/qzone/*.txt   首行=文字，img: 行=图片路径
//   - douyin: queue/douyin/*.json { "video": "路径", "title": "标题", "topics": [".."], "private": false }
//   - 跳过 . 开头的文件（示例/模板）
//
// 用法:
//   node bin/post-once.mjs qzone          # 走守护进程发布（未运行会自动拉起）
//   node bin/post-once.mjs qzone --dry-run
//   node bin/post-once.mjs douyin         # 自动选通道（有 appKey 走官方 API，否则网页自动化）
//
// 退出码: 0 = 成功或队列为空; 1 = 发布失败; 2 = 参数错误
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, abs, log, parseQzoneFile } from '../lib/common.js';
import { postViaDaemon } from '../lib/qzone-session.js';
import { publishVideo } from '../lib/douyin-api.js';
import { douyinWebPublish } from '../lib/douyin-web.js';
import { channelsWebPublish } from '../lib/wechat-channels.js';

const platform = process.argv[2] || '';
const dryRun = process.argv.includes('--dry-run');

/** 取队列里第一个待发布文件（按文件名排序，跳过 . 开头） */
function nextFile(dir) {
  const d = abs(dir);
  if (!fs.existsSync(d)) return null;
  const f = fs
    .readdirSync(d)
    .filter((n) => !n.startsWith('.') && fs.statSync(path.join(d, n)).isFile())
    .sort()[0];
  return f ? path.join(d, f) : null;
}

function movePosted(file, dir) {
  const posted = path.join(abs(dir), 'posted');
  fs.mkdirSync(posted, { recursive: true });
  fs.renameSync(file, path.join(posted, path.basename(file)));
}

async function main() {
  if (!['qzone', 'douyin', 'channels'].includes(platform)) {
    console.error('用法: node bin/post-once.mjs qzone|douyin|channels [--dry-run]');
    process.exit(2);
  }

  const cfg = loadConfig();
  const task = (cfg.schedule || []).find((t) => t.platform === platform);
  const dir = task?.queueDir || `queue/${platform}`;

  const file = nextFile(dir);
  if (!file) {
    log(`[post-once] ${platform}: 队列为空，跳过`);
    return;
  }
  log(`[post-once] ${platform}: 开始发布 ${path.basename(file)}`);

  if (platform === 'qzone') {
    const { text, images } = parseQzoneFile(file);
    if (!text) throw new Error('内容文件首行（文字）为空');
    await postViaDaemon({ text, images, dryRun }, cfg.qzone || {});
  } else if (platform === 'channels') {
    const content = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!content.video) throw new Error('JSON 缺少 video 字段');
    await channelsWebPublish({
      video: content.video,
      title: content.title || '',
      desc: content.desc || '',
      dryRun,
    });
  } else {
    const content = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!content.video) throw new Error('JSON 缺少 video 字段');
    const apiCfg = cfg.douyin?.api;
    const useApi =
      task?.mode === 'api' || (task?.mode !== 'web' && !!(apiCfg?.appKey && apiCfg?.appSecret));
    if (useApi) {
      await publishVideo({
        file: content.video,
        title: content.title || '',
        topics: content.topics || [],
        privateStatus: content.private ? 1 : 0,
      });
    } else {
      await douyinWebPublish({
        video: content.video,
        title: content.title || '',
        topics: content.topics || [],
        private: !!content.private,
        dryRun,
      });
    }
  }

  if (dryRun) {
    log(`[post-once] ${platform}: dry-run 完成，文件保留在队列`);
    return;
  }
  movePosted(file, dir);
  log(`[post-once] ${platform}: 发布成功，已移入 posted/`);
}

main().catch((e) => {
  console.error(`[post-once] ${platform} 发布失败:`, e.message);
  process.exit(1);
});

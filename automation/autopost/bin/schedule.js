#!/usr/bin/env node
// 定时调度器：按 config.json 里 schedule 数组的 cron 表达式发布内容
//
// 队列规则：
//   - 从 queueDir 里按文件名排序取第一个待发布文件（跳过 posted/ 子目录）
//   - QQ空间: *.txt（首行 = 文字，img: 行 = 图片路径）
//   - 抖音:   *.json（{ "video": "路径", "title": "标题", "topics": [".."], "private": false }）
//   - 发布成功后文件移入 queueDir/posted/；失败则保留，下个 cron 周期重试
//
// 用法:
//   node bin/schedule.js            # 前台运行（Ctrl+C 退出）
//   # 或用 systemd / nohup / tmux 常驻:
//   nohup node bin/schedule.js > /dev/null 2>&1 &
import fs from 'node:fs';
import path from 'node:path';
import cron from 'node-cron';
import { loadConfig, abs, log, parseQzoneFile } from '../lib/common.js';
import { postViaDaemon } from '../lib/qzone-session.js';
import { publishVideo } from '../lib/douyin-api.js';
import { douyinWebPublish } from '../lib/douyin-web.js';

const cfg = loadConfig();
const tasks = cfg.schedule || [];
if (!tasks.length) {
  console.error('config.json 里没有 schedule 任务，请参照 config.example.json 配置');
  process.exit(1);
}

/** 取队列里第一个待发布文件 */
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
  const dest = path.join(posted, path.basename(file));
  fs.renameSync(file, dest);
}

async function runTask(task) {
  const file = nextFile(task.queueDir);
  if (!file) {
    log(`[schedule] ${task.platform}: 队列为空，跳过`);
    return;
  }
  log(`[schedule] ${task.platform}: 开始发布 ${path.basename(file)}`);
  try {
    if (task.platform === 'qzone') {
      const { text, images } = parseQzoneFile(file);
      if (!text) throw new Error('内容文件首行（文字）为空');
      await postViaDaemon({ text, images }, cfg.qzone);
    } else if (task.platform === 'douyin') {
      const content = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!content.video) throw new Error('JSON 缺少 video 字段');
      const apiCfg = cfg.douyin?.api;
      const useApi = task.mode === 'api' || (task.mode !== 'web' && !!(apiCfg?.appKey && apiCfg?.appSecret));
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
        });
      }
    } else {
      throw new Error(`未知平台: ${task.platform}（支持 qzone / douyin）`);
    }
    movePosted(file, task.queueDir);
    log(`[schedule] ${task.platform}: 发布完成，文件已移入 posted/`);
  } catch (e) {
    log(`[schedule] ${task.platform}: 发布失败（保留文件，下周期重试）: ${e.message}`);
  }
}

let registered = 0;
for (const task of tasks) {
  if (!cron.validate(task.cron)) {
    log(`[schedule] 跳过无效 cron 表达式: ${task.cron}`);
    continue;
  }
  log(`[schedule] 已注册: ${task.platform} @ ${task.cron} → ${task.queueDir} (mode=${task.mode || 'auto'})`);
  cron.schedule(task.cron, () => {
    runTask(task).catch((e) => log(`[schedule] 任务异常: ${e.message}`));
  });
  registered++;
}
if (!registered) {
  console.error('没有可注册的定时任务');
  process.exit(1);
}
console.log('调度器已启动，按 Ctrl+C 退出。日志同时写入 logs/run.log');

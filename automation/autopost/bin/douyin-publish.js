#!/usr/bin/env node
// 抖音：发布一个视频
//
// 用法:
//   node bin/douyin-publish.js video.mp4 --title "标题" --topic 话题1 --topic 话题2
//   node bin/douyin-publish.js video.mp4 --api        # 强制走开放平台官方 API
//   node bin/douyin-publish.js video.mp4 --web        # 强制走创作者平台网页自动化
//   node bin/douyin-publish.js video.mp4 --private    # 仅自己可见
//   node bin/douyin-publish.js video.mp4 --dry-run    # 准备到发布前一步（仅 --web 有效）
//   node bin/douyin-publish.js video.mp4 --debug      # 打开页面停留30秒查DOM（仅 --web 有效）
//
// 默认 mode=auto：config 里配了 appKey 且存在有效 token 就走官方 API，否则走网页自动化。
import { loadConfig, log } from '../lib/common.js';
import { publishVideo } from '../lib/douyin-api.js';
import { douyinWebPublish } from '../lib/douyin-web.js';

const args = process.argv.slice(2);
const opts = { video: '', title: '', topics: [], private: false, mode: 'auto', dryRun: false, debug: false };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--title') opts.title = args[++i] || '';
  else if (a === '--topic') opts.topics.push(args[++i]);
  else if (a === '--private') opts.private = true;
  else if (a === '--api') opts.mode = 'api';
  else if (a === '--web') opts.mode = 'web';
  else if (a === '--dry-run') opts.dryRun = true;
  else if (a === '--debug') opts.debug = true;
  else if (!opts.video) opts.video = a;
}
if (!opts.video) {
  console.error('用法: node bin/douyin-publish.js video.mp4 --title "标题" [--topic 话题 ...] [--api|--web] [--private] [--dry-run] [--debug]');
  process.exit(1);
}

const cfg = loadConfig();
const apiCfg = cfg.douyin?.api;
const hasApi = !!(apiCfg?.appKey && apiCfg?.appSecret);

try {
  if (opts.mode === 'web' || (opts.mode === 'auto' && !hasApi)) {
    if (opts.mode === 'auto' && !hasApi) log('[douyin] 未配置官方 API（appKey），自动改用创作者平台网页自动化');
    const r = await douyinWebPublish({
      video: opts.video,
      title: opts.title,
      topics: opts.topics,
      private: opts.private,
      dryRun: opts.dryRun,
      debug: opts.debug,
    });
    log(`[douyin] 完成: ${JSON.stringify(r)}`);
  } else {
    if (opts.dryRun) log('[douyin] 官方 API 模式不支持 dry-run，直接发布');
    const r = await publishVideo({
      file: opts.video,
      title: opts.title,
      topics: opts.topics,
      privateStatus: opts.private ? 1 : 0,
    });
    log(`[douyin] 完成: aweme_id=${r.awemeId}`);
  }
} catch (e) {
  console.error('[douyin] 发布失败:', e.message);
  process.exit(1);
}

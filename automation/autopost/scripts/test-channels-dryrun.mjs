// dry-run 端到端：上传 + 转码等待 + 填标题/描述，不点「发表」
import { channelsWebPublish } from '../lib/wechat-channels.js';
const r = await channelsWebPublish({
  video: 'media/test-channels-dryrun.mp4',
  title: 'dry-run 测试标题',
  desc: 'dry-run 测试描述 #lisp #CAD',
  dryRun: true,
});
console.log('RESULT:', JSON.stringify(r));

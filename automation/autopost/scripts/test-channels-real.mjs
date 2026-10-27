// 真实发布测试：发 2 秒测试视频，验证后需从 post-card 列表删除
import { channelsWebPublish } from '../lib/wechat-channels.js';
const r = await channelsWebPublish({
  video: 'media/test-channels-dryrun.mp4',
  title: '测试视频-请忽略',
  desc: '自动化发布测试，稍后删除 #lisp #CAD',
  dryRun: false,
});
console.log('RESULT:', JSON.stringify(r));

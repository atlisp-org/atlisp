// 找 handleDeletePost 实现 + 删除 API 端点
import { launchBrowser, abs } from '../lib/common.js';
const { browser, context } = await launchBrowser({ profileDir: abs('state/profiles/channels'), headless: true });
const page = await context.newPage();
const base = 'https://res.wx.qq.com/t/wx_fed/finder/helper/finder-helper-web/res/static/js/';
for (const f of ['404.e44d862a.js']) {
  const t = await page.request.get(base + f).then((r) => r.text());
  console.log(`[${f}] length: ${t.length}`);
  // handleDeletePost 实现
  let idx = -1, n = 0;
  while ((idx = t.indexOf('handleDeletePost', idx + 1)) !== -1 && n < 5) {
    console.log(`\n===== handleDeletePost @${idx} =====`);
    console.log(t.slice(Math.max(0, idx - 150), idx + 800).replace(/\n/g, ' '));
    n++;
  }
  console.log(`\nhandleDeletePost total: ${n}`);
  // 可能的删除接口名
  for (const pat of ['post_delete', 'postDelete', 'deletePost', 'del_post', 'removePost']) {
    const c = t.split(pat).length - 1;
    if (c) {
      console.log(`\n---- "${pat}" x${c}, first ctx:`);
      console.log(t.slice(Math.max(0, t.indexOf(pat) - 250), t.indexOf(pat) + 350).replace(/\n/g, ' '));
    }
  }
}
await browser.close();

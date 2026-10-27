#!/usr/bin/env node
// 抖音开放平台：OAuth 授权（授权码 → access_token），token 存到 state/douyin-token.json
//
// 用法:
//   node bin/douyin-oauth.js            # 首次授权（浏览器打开授权页，扫码同意）
//   node bin/douyin-oauth.js --refresh  # 用 refresh_token 换新 token
//
// 前置：config.json 里填好 douyin.api.appKey / appSecret（抖音开放平台控制台 > 我的应用）
import http from 'node:http';
import { exec } from 'node:child_process';
import { loadConfig } from '../lib/common.js';
import { buildAuthUrl, codeForToken, refreshAccessToken, loadToken, saveToken } from '../lib/douyin-api.js';

const cfg = loadConfig().douyin?.api;
if (!cfg?.appKey || !cfg?.appSecret) {
  console.error('请先在 config.json 的 douyin.api 中填写 appKey / appSecret（抖音开放平台控制台 > 我的应用）');
  process.exit(1);
}

const redirectUri = cfg.redirectUri || 'http://localhost:8080/callback';
const tokenFile = cfg.tokenFile || 'state/douyin-token.json';
const scope = cfg.scope || 'user_info,video.create';

// ---- 刷新模式 ----
if (process.argv.includes('--refresh')) {
  const t = loadToken(tokenFile);
  if (!t?.refreshToken) {
    console.error('本地没有 refresh_token，请先运行 npm run douyin-oauth 完成授权');
    process.exit(1);
  }
  const nt = await refreshAccessToken({ appKey: cfg.appKey, appSecret: cfg.appSecret, refreshToken: t.refreshToken, file: tokenFile });
  console.log('token 已刷新:', nt.openId);
  process.exit(0);
}

// ---- 首次授权 ----
const url = new URL(redirectUri);
const port = parseInt(url.port || '80', 10);

const server = http.createServer((req, res) => {
  const u = new URL(req.url, redirectUri);
  if (u.pathname !== '/callback') {
    res.writeHead(404);
    res.end();
    return;
  }
  const code = u.searchParams.get('code');
  if (!code) {
    res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<h2>回调缺少 code 参数</h2>');
    return;
  }
  codeForToken({ appKey: cfg.appKey, appSecret: cfg.appSecret, code })
    .then((token) => {
      saveToken(tokenFile, token);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<h2>授权成功</h2><p>token 已保存，可以关闭此窗口。</p>');
      server.close();
      console.log(`授权完成，open_id: ${token.openId}`);
    })
    .catch((e) => {
      res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<h2>授权失败</h2><pre>${e.message}</pre>`);
      server.close();
      process.exit(1);
    });
});

server.on('error', (e) => {
  console.error(`回调端口 ${port} 启动失败: ${e.message}，请换一个 redirectUri`);
  process.exit(1);
});

server.listen(port, () => {
  const authUrl = buildAuthUrl({ appKey: cfg.appKey, redirectUri, scope });
  console.log('请在浏览器打开以下地址，用抖音账号登录并同意授权：\n');
  console.log(authUrl);
  console.log(`\n正在等待回调: ${redirectUri} （完成后自动关闭，Ctrl+C 取消）`);
  // 桌面环境下尝试自动打开浏览器（服务器上忽略失败，手动复制 URL 即可）
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  try {
    exec(`${opener} '${authUrl}'`);
  } catch {
    /* headless 环境，忽略 */
  }
});

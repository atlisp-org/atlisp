#!/usr/bin/env node
// QQ空间常驻守护进程：浏览器 24/7 保持打开，会话内随时可发说说
// 登录态失效/被风控踢出时，自动重新出二维码（手机扫 http://192.168.1.100:8123/qzone.png）
//
// 用法:
//   node bin/qzone-daemon.js          # 启动（端口默认 8124，可 --port 指定）
//
// API（本机回环）:
//   GET  http://127.0.0.1:8124/status  → 会话状态
//   POST http://127.0.0.1:8124/post    {"text":"...", "images":["a.png"], "dryRun":false}
//   POST http://127.0.0.1:8124/probe   → 探测输入框/发布按钮 DOM（调试选择器）
//   POST http://127.0.0.1:8124/relogin → 会话失效后触发重新扫码
import http from 'node:http';
import { loadConfig, log, sleep } from '../lib/common.js';
import { QzoneSession } from '../lib/qzone-session.js';

const args = process.argv.slice(2);
const portIdx = args.indexOf('--port');
const PORT = portIdx >= 0 ? Number(args[portIdx + 1]) : 8124;

const session = new QzoneSession(loadConfig().qzone || {});
let busy = false;

function json(res, code, obj) {
  const body = JSON.stringify(obj, null, 2);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1e6) reject(new Error('body too large')); });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/status') {
      return json(res, 200, { busy, ...session.status() });
    }
    if (req.method === 'POST' && req.url === '/post') {
      if (busy) return json(res, 429, { error: '上一个任务还在执行，请稍后' });
      const body = await readBody(req);
      if (!body.text) return json(res, 400, { error: '缺少 text 字段' });
      busy = true;
      try {
        const r = await session.post({ text: body.text, images: body.images || [], dryRun: !!body.dryRun });
        return json(res, 200, r);
      } finally {
        busy = false;
      }
    }
    if (req.method === 'POST' && req.url === '/probe') {
      if (busy) return json(res, 429, { error: '上一个任务还在执行，请稍后' });
      const body = await readBody(req).catch(() => ({}));
      busy = true;
      try {
        const r = await session.probeComposer(body);
        return json(res, 200, r);
      } finally {
        busy = false;
      }
    }
    if (req.method === 'POST' && req.url === '/relogin') {
      if (busy) return json(res, 429, { error: '上一个任务还在执行，请稍后' });
      busy = true;
      try {
        if (session.page) await session.page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
        await session.ensureLoggedIn();
        return json(res, 200, session.status());
      } finally {
        busy = false;
      }
    }
    json(res, 404, { error: 'not found' });
  } catch (e) {
    json(res, 500, { error: e.message });
  }
});

server.listen(PORT, '127.0.0.1', async () => {
  log(`[qzone-daemon] HTTP API 已启动: http://127.0.0.1:${PORT}/`);
  try {
    await session.start();
    log('[qzone-daemon] 会话就绪，可以发布');
  } catch (e) {
    // 扫码超时等：不退出，持续出二维码等待扫码（人不在时也能等）
    log(`[qzone-daemon] 尚未登录: ${e.message}；保持运行，持续刷新二维码等待扫码`);
    loginLoop();
  }
});

/** 未登录时持续重试：每次扫码等待 10 分钟，超时后 2 分钟再来一轮 */
async function loginLoop() {
  while (!session.status().loggedIn) {
    try {
      await session.ensureLoggedIn();
      log('[qzone-daemon] 登录成功，会话就绪');
      break;
    } catch (e) {
      log(`[qzone-daemon] 本轮扫码未成功: ${e.message}，2 分钟后再试`);
    }
    await sleep(120000);
  }
}

process.on('SIGTERM', async () => { log('[qzone-daemon] 收到 SIGTERM，退出'); await session.close(); process.exit(0); });
process.on('SIGINT', async () => { log('[qzone-daemon] 收到 SIGINT，退出'); await session.close(); process.exit(0); });

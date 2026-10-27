// 临时二维码图片服务：按文件名提供 logs/qrcode/ 下的图片
// 每次请求都读取文件最新内容（登录脚本会定期刷新文件，同一 URL 反复打开永远是最新码）
// 用法: node scripts/qr-server.mjs [port]
//   空间: http://<服务器IP>:<port>/qzone.png
//   抖音: http://<服务器IP>:<port>/douyin.png
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'logs', 'qrcode');
const port = Number(process.argv[2]) || 8123;

http
  .createServer((req, res) => {
    const name = path.basename(req.url.split('?')[0]);
    if (!/^[a-z0-9-]+\.png$/i.test(name)) {
      res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('仅支持 qzone.png / douyin.png');
      return;
    }
    const file = path.join(DIR, name);
    if (!fs.existsSync(file)) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(`${name} 尚未生成，请稍后刷新`);
      return;
    }
    res.writeHead(200, {
      'content-type': 'image/png',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
    });
    fs.createReadStream(file).pipe(res);
  })
  .listen(port, '0.0.0.0', () => {
    console.log(`QR 服务已启动: http://0.0.0.0:${port}/qzone.png | /douyin.png`);
  });

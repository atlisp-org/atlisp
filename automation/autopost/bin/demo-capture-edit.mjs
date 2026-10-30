#!/usr/bin/env node
// bin/demo-capture-edit.mjs — 实拍演示录制（at-edit 批量编辑）：CAD 里画图 → 一句命令批量多重偏移 → 抓屏 → 9:16 视频
//
// 流程（全自动、无人工交互）：
//   0. Linux 侧起临时 HTTP 服务（默认 8127），只用来收抓屏 zip
//   1. 确认当前图纸为空（非空直接失败，避免动到用户图纸）
//   2. 从共享目录加载 at-edit（w:/atlisp/packages/at-edit，纯 LISP 包）
//   3. 启动 PS1 抓屏（GDI+ CopyFromScreen，约 18s）
//   4. 分 3 批画 12 条波浪多段线（每批 4 条），制造"线条逐批出现"的画面
//   5. 调 (at-edit:ai-multi-offset 选择集 '(600 1200 1800) 1)，36 条新线一次出现
//   6. 缩放到全图 + 片尾局部特写
//   7. ffmpeg 合成 1080x1920 竖版片段（品牌底 + 抓屏嵌中央）
//   8. 删掉本次画的图元（图纸恢复原状）
//
// 失败一律 exit 1（调用方回退到纯 6 屏版式，不影响发布）。
//
// 用法:
//   node bin/demo-capture-edit.mjs [--sec 18] [--out media/demo-at-edit-YYYYMMDD.mp4] [--keep]
// 环境变量: DEMO_HOST（Linux 侧 IP，默认 192.168.1.100）、DEMO_PORT（默认 8127）、
//           DEMO_WORK_DIR（默认 /tmp/opencode/demo-frames-edit）、MCP_CAD_URL
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpCad } from '../lib/mcp-cad.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORK = process.env.DEMO_WORK_DIR || '/tmp/opencode/demo-frames-edit';
const HOST = process.env.DEMO_HOST || '192.168.1.100';
const PORT = Number(process.env.DEMO_PORT || '8127');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// at-edit 在 CAD 主机上的共享路径（本机 ~/atlisp/packages 映射为 w:/atlisp/packages）
const AT_EDIT_DIR = 'w:/atlisp/packages/at-edit';

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const SEC = Number(arg('sec', '18'));
const OUT = path.resolve(arg('out', path.join(
  ROOT, 'media', `demo-at-edit-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.mp4`)));
const KEEP = process.argv.includes('--keep');
const REUSE = process.argv.includes('--reuse'); // 只重新合成，不抓屏
// 只删自己画的图元（避免清掉别人同时在用这张图纸画的图）
const createdHandles = [];

function log(...a) { console.log('[demo-edit]', ...a); }
function fail(msg) { const e = new Error(msg); e.demoFail = true; throw e; }

// ---------- 0. 临时 HTTP 服务（收抓屏 zip + 下发抓屏脚本） ----------
let zipReceived = null;
let capScript = ''; // 完整抓屏 PS1（经 GET /script.ps1 下发，避免 LISP 字符串过长）
function startServer() {
  fs.mkdirSync(WORK, { recursive: true });
  const srv = http.createServer((req, res) => {
    const url = req.url.split('?')[0];
    if (req.method === 'GET' && url === '/script.ps1') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(capScript);
      return;
    }
    if (req.method === 'POST' && url.startsWith('/upload/')) {
      const name = path.basename(url.split('/').pop()).replace(/[^a-zA-Z0-9._-]/g, '_');
      const dest = path.join(WORK, name);
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        fs.writeFileSync(dest, Buffer.concat(chunks));
        zipReceived = dest;
        log(`  收到上传: ${name} (${Buffer.concat(chunks).length} bytes)`);
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('SAVED');
      });
      return;
    }
    res.writeHead(404); res.end('NOT FOUND');
  });
  return new Promise((resolve, reject) => {
    srv.once('error', reject);
    srv.listen(PORT, '0.0.0.0', () => {
      log(`HTTP 服务: http://${HOST}:${PORT}/ (POST /upload/*)`);
      resolve(srv);
    });
  });
}

async function ev(cad, code, label, timeoutMs = 60000) {
  try {
    const r = await cad.evalLisp(code, { timeoutMs });
    log(`  ${label} => ${String(r).slice(0, 300)}`);
    return String(r);
  } catch (e) {
    log(`  ${label} 失败: ${e.message.slice(0, 200)}`);
    return null;
  }
}

async function ps1(cad, script, label) {
  const b64 = Buffer.from(script, 'utf16le').toString('base64');
  if (b64.length > 8191) fail(`PS1 过长 (b64=${b64.length})`);
  const code = `(progn
  (vl-load-com)
  (setq sh (vlax-create-object "WScript.Shell"))
  (vlax-invoke sh 'Run "powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${b64}" 0 0)
  "PS1-SENT")`;
  const r = await ev(cad, code, label);
  if (r === null) fail(`${label} 发送失败`);
}

// 长脚本走 HTTP 下发：CAD 侧只跑短引导（下载 → 执行），绕开 LISP 字符串长度限制
async function ps1Remote(cad, script, label) {
  capScript = script;
  const boot = `$log = 'C:\\Users\\vitalgg\\@lisp\\tmp\\demo-cap.log'
"START $(Get-Date -Format o) $env:COMPUTERNAME" | Out-File -FilePath $log -Encoding utf8
try {
  Invoke-WebRequest -Uri 'http://${HOST}:${PORT}/script.ps1' -OutFile 'C:\\Users\\vitalgg\\@lisp\\tmp\\demo-cap.ps1' -UseBasicParsing -TimeoutSec 30
  "DOWNLOADED $((Get-Item 'C:\\Users\\vitalgg\\@lisp\\tmp\\demo-cap.ps1').Length)" | Out-File -FilePath $log -Append -Encoding utf8
  & 'C:\\Users\\vitalgg\\@lisp\\tmp\\demo-cap.ps1'
  "DONE" | Out-File -FilePath $log -Append -Encoding utf8
} catch {
  "ERR $($_.Exception.Message)" | Out-File -FilePath $log -Append -Encoding utf8
}
`;
  await ps1(cad, boot, label);
}

const stamp = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

// ---------- 1. 加载 at-edit ----------
async function loadAtEdit(cad) {
  const r = await ev(cad, `(progn
  (vl-load-com)
  (foreach f '("at-edit" "transform" "pline")
    (load (strcat "${AT_EDIT_DIR}/" f ".lsp")))
  (strcat "AT-EDIT=" (if at-edit:ai-multi-offset "OK" "NO")))`, 'LOAD-AT-EDIT', 120000);
  if (!r || !r.includes('AT-EDIT=OK')) fail(`at-edit 加载失败 (${r})`);
}

// ---------- 2. 造图：12 条波浪多段线（分 3 批） ----------
const WAVES = 6;
const WAVE_STEP = 5000;      // 行距（偏移 900/1800/2700 后每组 4 条，组间还留 2300 空隙）
const WAVE_X0 = 0;
const WAVE_X1 = 60000;       // 宽度
const WAVE_AMP = 350;        // 起伏（小一点：偏移后 4 条线保持平行、不互相穿插）
const WAVE_PTS = 25;         // 每条 25 个顶点（正弦，曲线顺滑）
const WAVE_LEN = 18000;      // 一个波长
const BATCH = 2;             // 每批 2 条

const wavePts = (i) => {
  const pts = [];
  for (let k = 0; k < WAVE_PTS; k += 1) {
    const x = WAVE_X0 + ((WAVE_X1 - WAVE_X0) * k) / (WAVE_PTS - 1);
    const y = i * WAVE_STEP + WAVE_AMP * Math.sin((2 * Math.PI * x) / WAVE_LEN);
    pts.push([Math.round(x), Math.round(y)]);
  }
  return pts;
};

async function drawBatch(cad, from, to) {
  const items = [];
  for (let i = from; i < to; i += 1) items.push(wavePts(i));
  const lisp = items.map((pts) => `(entmakex (list (cons 0 "LWPOLYLINE") (cons 100 "AcDbEntity")
    (cons 100 "AcDbPolyline") (cons 90 ${pts.length}) (cons 70 0)
    ${pts.map((p) => `(cons 10 (list ${p[0]}.0 ${p[1]}.0))`).join(' ')}))`).join('\n    ');
  const r = await ev(cad, `(progn
  (vl-load-com)
  (setq made (vl-remove nil (list ${lisp})))
  (setq hs (mapcar '(lambda (e) (cdr (assoc 5 (entget e)))) made))
  (strcat "DRAW=" (itoa (length made)) "|H=" (if hs (apply 'strcat (mapcar '(lambda (h) (strcat h ",")) hs)) "")))`, `DRAW ${from}-${to - 1}`, 60000);
  const m = r && r.match(/DRAW=(\d+)\|H=([0-9A-Fa-f,]*)/);
  if (!m) fail(`画第 ${from + 1}-${to} 条失败 (${r})`);
  m[2].split(',').filter(Boolean).forEach((h) => createdHandles.push(h));
}

// ---------- 3. 抓屏 PS1（只抓绘图区：按 AutoCAD 客户区原点 + SCREENSIZE 裁剪） ----------
function captureScript(zipName, seconds) {
  return `Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class WinApi {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr h, EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref POINT p);
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  public struct RECT { public int L, T, R, B; }
  public struct POINT { public int X, Y; }
  public static IntPtr FindView(IntPtr root) {
    IntPtr found = IntPtr.Zero;
    EnumChildWindows(root, (h, l) => {
      var sb = new StringBuilder(256);
      GetClassName(h, sb, 256);
      var cn = sb.ToString();
      if (cn.Contains("ACADDM_CHILD") || cn.Contains("FLIP_MODE_VIEW") || cn.Contains("AcadMdiChild")) {
        found = h; return false;
      }
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
"@
[WinApi]::SetProcessDPIAware() | Out-Null
$proc = Get-Process -Name acad -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
$hwnd = $proc.MainWindowHandle
# 优先：AutoCAD 绘图视口窗口（天然不含菜单栏/工具条/命令行/状态栏/任务栏）
$view = [WinApi]::FindView($hwnd)
if ($view -ne [IntPtr]::Zero) {
  $vr = New-Object WinApi+RECT
  [WinApi]::GetWindowRect($view, [ref]$vr) | Out-Null
  $x0 = $vr.L; $y0 = $vr.T; $w = $vr.R - $vr.L; $h = $vr.B - $vr.T
  $src = 'view'
} else {
  $cr = New-Object WinApi+RECT
  [WinApi]::GetClientRect($hwnd, [ref]$cr) | Out-Null
  $pt = New-Object WinApi+POINT
  [WinApi]::ClientToScreen($hwnd, [ref]$pt) | Out-Null
  $x0 = $pt.X; $y0 = $pt.Y; $w = $cr.R - $cr.L; $h = $cr.B - $cr.T
  $src = 'client'
}
$dir = 'C:\\Users\\vitalgg\\@lisp\\tmp\\demoframes'
$zip = 'C:\\Users\\vitalgg\\@lisp\\tmp\\${zipName}'
$done = 'C:\\Users\\vitalgg\\@lisp\\tmp\\demo-capture.txt'
Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item $zip -Force -ErrorAction SilentlyContinue
Remove-Item $done -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $dir | Out-Null
$jpg = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
$ep = [System.Drawing.Imaging.EncoderParameters]::new(1)
$ep.Param[0] = [System.Drawing.Imaging.EncoderParameter]::new([System.Drawing.Imaging.Encoder]::Quality, [long]80)
$n = 0
$sw = [System.Diagnostics.Stopwatch]::StartNew()
while ($sw.Elapsed.TotalSeconds -lt ${seconds}) {
  $bmp = [System.Drawing.Bitmap]::new($w, $h)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($x0, $y0, 0, 0, [System.Drawing.Size]::new($w, $h))
  $g.Dispose()
  $bmp.Save(($dir + '\\' + ('{0:D5}' -f $n) + '.jpg'), $jpg, $ep)
  $bmp.Dispose()
  $n = $n + 1
  Start-Sleep -Milliseconds 300
}
[System.IO.Compression.ZipFile]::CreateFromDirectory($dir, $zip)
try {
  Invoke-WebRequest -Uri 'http://${HOST}:${PORT}/upload/${zipName}' -Method POST -InFile $zip -TimeoutSec 120 | Out-Null
  [System.IO.File]::WriteAllText($done, 'OK ' + $n + ' frames ' + $w + 'x' + $h + ' @ ' + $x0 + ',' + $y0 + ' src=' + $src + ' ' + (Get-Item $zip).Length)
} catch {
  [System.IO.File]::WriteAllText($done, 'ERR ' + $_.Exception.Message)
}`;
}

// ---------- 4. 批量多重偏移 ----------
async function runMultiOffset(cad) {
  const t0 = Date.now();
  const r = await ev(cad, `(progn
  (vl-load-com)
  (setq ss (ssget "X" (list (cons 0 "LWPOLYLINE"))))
  (setq res (at-edit:ai-multi-offset ss '(900.0 1800.0 2700.0) 1))
  (setq hs (mapcar '(lambda (e) (cdr (assoc 5 (entget e)))) res))
  (strcat "OFFSET=" (itoa (if res (length res) 0))
          "|H=" (if hs (apply 'strcat (mapcar '(lambda (h) (strcat h ",")) hs)) "")
          "|ALL=" (itoa (sslength (ssget "X" (list (cons 0 "LWPOLYLINE")))))))`, 'MULTI-OFFSET', 120000);
  const m = r && r.match(/OFFSET=(\d+)\|H=([0-9A-Fa-f,]*)/);
  if (!m || Number(m[1]) < 1) fail(`批量偏移失败 (${r})`);
  (m[2] || '').split(',').filter(Boolean).forEach((h) => createdHandles.push(h));
  log(`  批量偏移耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s，新增 ${m[1]} 条`);
  return Number(m[1]);
}

async function cleanup(cad) {
  const hs = createdHandles.map((h) => `"${h}"`).join(' ');
  const r = await ev(cad, `(progn
  (vl-cmdf "_.CLEANSCREENOFF")
  (setq n 0)
  (foreach h (list ${hs})
    (setq e (if (= 'STR (type h)) (handent h) nil))
    (if (and e (entget e)) (progn (entdel e) (setq n (1+ n)))))
  (strcat "DELETED=" (itoa n)))`, 'CLEANUP', 30000);
  log(`  清理: ${r}（只删本次演示画的图元）`);
}

// ---------- 5. 等 zip ----------
async function waitZip(timeoutMs = 120000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (zipReceived && fs.existsSync(zipReceived)) return zipReceived;
    await sleep(1500);
  }
  return null;
}

// ---------- 6. 裁出绘图区 + 合成 9:16 ----------
// 抓的是整个客户区（无标题栏/任务栏），但底部命令行/状态栏是浮在绘图区上面的，
// 这里用第一帧的像素统计把顶部/底部的 UI 带自动切掉，只留纯绘图区。
function detectDrawArea(framePath) {
  // 视口窗口里还带着三样窗内 UI（不在 Windows 层，没法从外面裁）：
  //   顶部 文件标签条（Drawing17.dwg）、右侧 纵向滚动条、底部 布局标签条（模型/布局1）
  // 这三条是 AutoCAD 固定绘制位置，高度/宽度按本机实测裁掉；万一某次没有，也只是少几像素图面。
  const INSET_TOP = 24;
  const INSET_BOTTOM = 30;
  const INSET_RIGHT = 40;
  const py = `
import sys
import numpy as np
from PIL import Image
im = np.array(Image.open(sys.argv[1]).convert('L')).astype(float)
h, w = im.shape
print(0, 0, int(w), int(h))
`;
  const out = execFileSync('python3', ['-c', py, framePath]).toString().trim();
  const [, , w, h] = out.split(/\s+/).map(Number);
  return { x: 0, y: INSET_TOP, w: w - INSET_RIGHT, h: h - INSET_TOP - INSET_BOTTOM };
}

function compose(framesDir, out, frames) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const tmp = out + '.tmp.mp4';
  const bg = path.join(WORK, 'bg.png');
  execFileSync('python3', [path.join(ROOT, 'bin', 'make-demo-bg.py'), bg,
    '--brand', '@lisp · at-edit',
    '--title', '真实操作 · 一句命令批量偏移',
    '--sub', 'at-edit 包 · AI 全自动',
    '--foot', '@lisp · 免费 CAD 函数库']);
  const box = detectDrawArea(path.join(framesDir, frames[0]));
  log(`  绘图区裁切: ${box.w}x${box.h}+${box.x}+${box.y}`);
  const fc = [
    `[0:v]crop=${box.w}:${box.h}:${box.x}:${box.y},`
    + 'scale=1000:563:force_original_aspect_ratio=increase,crop=1000:563[clip]',
    '[1:v]null[bg]',
    '[bg][clip]overlay=40:820:shortest=1[v]',
  ];
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error',
    '-framerate', '8', '-i', path.join(framesDir, '%05d.jpg'),
    '-loop', '1', '-i', bg,
    '-filter_complex', fc.join(';'),
    '-map', '[v]', '-r', '25', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-crf', '20', tmp]);
  fs.renameSync(tmp, out);
  return box;
}

// ---------- main ----------
let srv = null;
const cad = new McpCad();
try {
  if (REUSE) {
    const framesDir = path.join(WORK, 'frames');
    const frames = fs.readdirSync(framesDir).filter((f) => f.endsWith('.jpg')).sort();
    if (!frames.length) fail(`复用模式但 ${framesDir} 没有帧`);
    log(`复用已有 ${frames.length} 帧重新合成`);
    compose(framesDir, OUT, frames);
    log(`完成: ${OUT}`);
    process.exit(0);
  }
  srv = await startServer();

  log(`连接 MCP → ${process.env.MCP_CAD_URL || '192.168.1.53:8110'}`);
  await cad.connect();
  await cad.waitReady(60000).catch(() => {});
  await cad.callTool('session_pin_instance', { key: 'fresh' }, { timeoutMs: 30000 }).catch(() => {});
  const hb = await cad.evalLisp('(if 1 1 nil)', { timeoutMs: 20000 });
  if (String(hb) !== '1') fail('CAD 心跳失败');
  await cad.callTool('bring_to_front', {}).catch(() => {});
  await sleep(1000);

  // 安全检查：只在空图纸上做演示
  const clean = await ev(cad, `(progn
  (setq all (ssget "X"))
  (strcat "COUNT=" (itoa (if all (sslength all) 0))))`, 'DRAWING-CHECK', 30000);
  if (clean !== 'COUNT=0') fail(`当前图纸非空 (${clean})，为免动到用户图纸跳过实拍`);

  // 全屏绘图区：窗口最大化 + 清爽屏幕（隐藏 ribbon/工具选项板），抓屏只取绘图区
  const prep = await ev(cad, `(progn
  (setvar "TILEMODE" 1)
  (setq app (vlax-get-acad-object))
  (vl-catch-all-apply 'vla-put-WindowState (list app 3))
  (vl-cmdf "_.CLEANSCREENON")
  (setvar "FILETABSTATE" 0)
  (setvar "NAVVCUBEDISPLAY" 0)
  (setvar "UCSICON" 0)
  (setq ss (getvar "SCREENSIZE"))
  (strcat "DRAW=" (rtos (car ss) 2 0) "x" (rtos (cadr ss) 2 0)
          "|CLEAN=" (itoa (getvar "CLEANSCREENSTATE"))))`, 'PREP', 30000);
  const dm = prep && prep.match(/DRAW=(\d+)x(\d+)/);
  if (!dm) fail(`绘图区尺寸读取失败 (${prep})`);
  const DRAW_W = Number(dm[1]);
  const DRAW_H = Number(dm[2]);
  log(`  绘图区 ${DRAW_W}x${DRAW_H}（clean=${prep.split('CLEAN=')[1]}），抓屏只取这块`);

  await loadAtEdit(cad);

  // 视图：全图窗口（内容 60000 宽 × ~31000 高，按绘图区 2.2 比例）
  const zoomWin = (cx, cy, h) => {
    const w = h * 2.2;
    return `(progn (vl-cmdf "_.ZOOM" "W" (list ${(cx - w / 2).toFixed(2)} ${(cy - h / 2).toFixed(2)} 0.0)`
      + ` (list ${(cx + w / 2).toFixed(2)} ${(cy + h / 2).toFixed(2)} 0.0)) "OK")`;
  };
  // 偏移方向把线往 +y 推，所以中心抬高一点
  const zcx = 30000, zcy = 15000, zhh = 34000;
  await ev(cad, zoomWin(zcx, zcy, zhh), 'ZOOM-INIT');

  const zipName = `frames-${stamp()}.zip`;
  log(`启动抓屏 PS1（${SEC}s）`);
  await ps1Remote(cad, captureScript(zipName, SEC), 'CAPTURE-START');

  await sleep(800);
  for (let b = 0; b < WAVES; b += BATCH) {
    log(`画第 ${b / BATCH + 1}/${WAVES / BATCH} 批（第 ${b + 1}-${b + BATCH} 条）`);
    await drawBatch(cad, b, b + BATCH);
    await sleep(1700);
  }

  log('批量多重偏移（一句命令出 36 条平行线）');
  await runMultiOffset(cad);

  await sleep(500);
  log('缩放到全图（看总体效果）');
  await ev(cad, zoomWin(zcx, zcy, zhh), 'ZOOM-WIDE');
  await sleep(3400);

  log('放大看细节（片尾定格）');
  await ev(cad, zoomWin(30000, 16000, 13000), 'ZOOM-DETAIL');
  await cad.callTool('bring_to_front', {}).catch(() => {});

  log('等抓屏结束 + 上传');
  const zip = await waitZip(120000);
  if (!zip) fail('抓屏 zip 未收到');

  log('解压帧');
  const framesDir = path.join(WORK, 'frames');
  fs.rmSync(framesDir, { recursive: true, force: true });
  fs.mkdirSync(framesDir, { recursive: true });
  execFileSync('unzip', ['-oq', zip, '-d', framesDir]);
  const frames = fs.readdirSync(framesDir).filter((f) => f.endsWith('.jpg')).sort();
  log(`  帧数: ${frames.length}`);
  if (frames.length < 10) fail(`帧太少 (${frames.length})`);

  // 黑屏守卫
  const mid = path.join(framesDir, frames[Math.floor(frames.length / 2)]);
  const mean = Number(execFileSync('identify', ['-format', '%[fx:mean]', mid]).toString().trim());
  log(`  画面亮度: ${mean.toFixed(3)}`);
  if (!(mean > 0.002)) fail(`抓屏疑似黑屏 (mean=${mean})`);

  log('合成 9:16 视频');
  compose(framesDir, OUT, frames);
  log(`完成: ${OUT} (${(fs.statSync(OUT).size / 1024 / 1024).toFixed(1)} MB)`);
} catch (e) {
  console.error(`[demo-edit] ${e.demoFail ? '失败' : '异常'}:`, e.message.slice(0, 300));
  process.exitCode = 1;
} finally {
  if (KEEP) {
    await ev(cad, '(progn (vl-cmdf "_.CLEANSCREENOFF") "OFF")', 'CLEANSCREEN-OFF', 20000).catch(() => {});
  } else {
    await cleanup(cad).catch(() => {});
  }
  try { cad.close(); } catch {}
  try { srv && srv.close(); } catch {}
}
process.exit(process.exitCode || 0);

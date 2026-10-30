#!/usr/bin/env node
// bin/demo-capture.mjs — 实拍演示录制：在 CAD 里真实插车位块 + AI 编号，同步抓屏 → 9:16 竖版视频
//
// 流程（全自动、无人工交互）：
//   0. Linux 侧起临时 HTTP 服务（默认 8126）：GET /che-wei.dwg 供下载，POST /upload/ 收 zip
//   1. 确保 at-arch 的车位.dwg 在 CAD 包目录（缺则从本机 HTTP 下载），并复制成 ASCII 名 che-wei.dwg
//   2. 在【当前图纸】里准备：写 at-arch 配置（旧版包缺 define-config）+ 确保块名「车位」存在
//   3. 启动 PS1 抓屏（GDI+ CopyFromScreen，约 14s）
//   4. 分 8 次插入车位块（2 列 × 4 行），制造"块逐个出现"的画面
//   5. 清空 NUMBER 属性 → 调用 (at-arch:ai-parking-number 1 nil) 真实编号 01..08
//   6. ZOOM E，等抓屏结束 → PS1 打包 zip POST 回来
//   7. ffmpeg 合成 1080x1920 竖版片段（品牌底 + 抓屏嵌中央）
//   8. 删掉本次插入的所有块（图纸恢复原状）
//
// 中文一律用 Unicode 码点构造（车 = chr 36710、位 = chr 20301），避免 LISP 源编码问题。
// 失败一律 exit 1（调用方回退到纯 6 屏版式，不影响发布）。
//
// 用法:
//   node bin/demo-capture.mjs [--pkg at-arch] [--sec 16] [--out media/demo-at-arch.mp4] [--keep]
// 环境变量: DEMO_HOST（Linux 侧 IP，默认 192.168.1.100）、DEMO_PORT（默认 8126）、
//           DEMO_WORK_DIR（默认 /tmp/opencode/demo-frames）、MCP_CAD_URL
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpCad } from '../lib/mcp-cad.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORK = process.env.DEMO_WORK_DIR || '/tmp/opencode/demo-frames';
const HOST = process.env.DEMO_HOST || '192.168.1.100';
const PORT = Number(process.env.DEMO_PORT || '8126');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// CAD 侧路径（Windows）+ 车位.dwg 的真实尺寸
const PKG_DIR_WIN = 'C:\\Users\\vitalgg\\@lisp\\packages\\at-arch';
const DWG_CN = '车位.dwg';          // PS1 用 Unicode 文件名（安全）
const DWG_ASCII = 'che-wei.dwg';    // LISP 用 ASCII 名（避开 LISP 源编码问题）
const DWG_SIZE = 201820;
const LOCAL_DWG = path.join(ROOT, '..', '..', 'packages', 'at-arch', '车位.dwg');

// 车 / 位 的 Unicode 码点
const CH_CHE = 36710;
const CH_WEI = 20301;

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const PKG = arg('pkg', 'at-arch');
const SEC = Number(arg('sec', '18'));
const OUT = path.resolve(arg('out', path.join(ROOT, 'media', `demo-${PKG}-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.mp4`)));
const KEEP = process.argv.includes('--keep');

function log(...a) { console.log('[demo]', ...a); }
function fail(msg) { const e = new Error(msg); e.demoFail = true; throw e; }

// ---------- 0. 临时 HTTP 服务 ----------
let zipReceived = null;
let capScript = ''; // 完整抓屏 PS1（经 GET /script.ps1 下发，避免 LISP 字符串过长）
function startServer() {
  fs.mkdirSync(WORK, { recursive: true });
  if (!fs.existsSync(LOCAL_DWG)) fail(`本机缺车位.dwg: ${LOCAL_DWG}`);
  const srv = http.createServer((req, res) => {
    const url = req.url.split('?')[0];
    if (req.method === 'GET' && url === '/script.ps1') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(capScript);
      return;
    }
    if (req.method === 'GET' && url === '/che-wei.dwg') {
      const st = fs.statSync(LOCAL_DWG);
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': st.size });
      fs.createReadStream(LOCAL_DWG).pipe(res);
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
      log(`HTTP 服务: http://${HOST}:${PORT}/ (GET /che-wei.dwg, POST /upload/*)`);
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

async function ps1(cad, script, label) {
  const b64 = Buffer.from(script, 'utf16le').toString('base64');
  if (b64.length > 8191) fail(`PS1 过长 (b64=${b64.length})`);
  const code = `(progn
  (vl-load-com)
  (setq sh (vlax-create-object "WScript.Shell"))
  (vlax-invoke sh 'Run "powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${b64}" 0 0)
  "PS1-SENT"
)`;
  const r = await ev(cad, code, label);
  if (r === null) fail(`${label} 发送失败`);
}

const stamp = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;
};

// ---------- 1. 车位.dwg 就位 ----------
async function ensureBlockFile(cad) {
  const ps = `$dir = '${PKG_DIR_WIN}'
$cn = $dir + '\\' + '${DWG_CN}'
$ascii = $dir + '\\${DWG_ASCII}'
$log = $dir + '\\.demo-copy.txt'
$L = [char]13 + [char]10
$r = ''
try {
  if (-not (Test-Path $cn)) {
    $c = New-Object System.Net.WebClient
    $c.DownloadFile('http://${HOST}:${PORT}/che-wei.dwg', $cn)
    $r = $r + 'DOWNLOADED ' + (Get-Item $cn).Length + $L
  } else {
    $r = $r + 'EXISTS ' + (Get-Item $cn).Length + $L
  }
  Copy-Item $cn $ascii -Force
  $r = $r + 'ASCII ' + (Get-Item $ascii).Length + $L
} catch {
  $r = $r + 'ERR ' + $_.Exception.Message + $L
}
[System.IO.File]::WriteAllText($log, $r)`;
  await ps1(cad, ps, 'COPY-BLOCK');
  const chkCode = `(progn
  (setq ff (findfile "C:/Users/vitalgg/@lisp/packages/at-arch/${DWG_ASCII}"))
  (strcat "SIZE=" (itoa (if ff (vl-file-size ff) -1))))`;
  for (let i = 0; i < 4; i++) {
    await sleep(2500);
    const chk = await ev(cad, chkCode, `CHECK-BLOCK${i + 1}`);
    if (chk && chk.includes(`SIZE=${DWG_SIZE}`)) return;
  }
  fail('车位.dwg 未就位');
}

// ---------- 2. 准备：配置 + 块定义 ----------
async function prep(cad) {
  // 旧版 at-arch 缺 @:define-config，配置项全为 nil；这里显式写入（中文用码点构造）
  const r = await ev(cad, `(progn
  (vl-load-com)
  (@::set-config '@arch:parking-blk (strcat (chr ${CH_CHE}) (chr ${CH_WEI}) "*"))
  (@::set-config '@arch:parking-layer "*")
  (@::set-config '@arch:parking-size "2200,3700,4600,6200")
  (@::set-config '@arch:parking-number-order "snake")
  (@::set-config '@arch:parking-number-att "*NUMBER*")
  (@::set-config '@arch:parking-row-tol 1200)
  (@::set-config '@arch:parking-min-row 5)
  (setq *demo-ents nil)
  (setvar "TILEMODE" 1)
  (setq app (vlax-get-acad-object))
  (vl-catch-all-apply 'vla-put-WindowState (list app 3))
  (vl-cmdf "_.CLEANSCREENON")
  (strcat "CFG-OK|tile=" (itoa (getvar "TILEMODE"))))`, 'PREP');
  if (!r || !r.startsWith('CFG-OK')) fail(`配置写入失败 (${r})`);

  // 确保块定义「车位」存在（不存在则用 ASCII 文件插一个再重命名）
  const b = await ev(cad, `(progn
  (vl-load-com)
  (setq doc (vla-get-ActiveDocument (vlax-get-acad-object)))
  (setq cname (strcat (chr ${CH_CHE}) (chr ${CH_WEI})))
  (if (tblsearch "BLOCK" cname)
      "BLK-EXISTS"
      (progn
        (setq ms (vla-get-ModelSpace doc))
        (setq fpath (findfile "C:/Users/vitalgg/@lisp/packages/at-arch/${DWG_ASCII}"))
        (if (null fpath) "BLK-NOFILE"
            (progn
              (setq ins0 (vla-insertblock ms (apply 'vlax-3d-point (list 0.0 0.0 0.0)) fpath 1.0 1.0 1.0 0.0))
              (setq old (vla-get-Name ins0))
              (setq blkobj (vla-Item (vla-get-Blocks doc) old))
              (setq rr (vl-catch-all-apply 'vla-put-Name (list blkobj cname)))
              (if (vl-catch-all-error-p rr)
                  (strcat "BLK-ERR:" (vl-catch-all-error-message rr))
                  (progn (entdel (vlax-vla-object->ename ins0)) "BLK-CREATED")))))))`, 'ENSURE-BLOCK');
  if (!b || !(b.startsWith('BLK-EXISTS') || b.startsWith('BLK-CREATED'))) fail(`块定义不可用 (${b})`);

  // 放大编号字高（原 ATTDEF 字高 350，缩到成片里只剩 ~14px 看不清；演示图纸设 900）
  const th = await ev(cad, `(progn
  (vl-load-com)
  (setq cname (strcat (chr ${CH_CHE}) (chr ${CH_WEI})))
  (setq blk (tblobjname "BLOCK" cname))
  (setq se (cdr (assoc -2 (entget blk))))
  (setq n 0)
  (while se
    (setq d (entget se))
    (if (= "ATTDEF" (cdr (assoc 0 d)))
        (progn
          (setq d2 (subst (cons 40 900.0) (assoc 40 d) d))
          (if (entmod d2) (setq n (1+ n)))))
    (setq se (entnext se)))
  (strcat "TEXT-H=" (itoa n)))`, 'BLOCK-TEXT');
  if (!th || !th.startsWith('TEXT-H=1')) fail(`编号字高设置失败 (${th})`);

  // 自检：识别 + 属性
  const c = await ev(cad, `(progn
  (vl-load-com)
  (setq ss (ssget "X" (list (cons 0 "INSERT"))))
  (if (null ss) "NO-INSERT"
      (progn
        (setq e (ssname ss 0))
        (setq ra (vl-catch-all-apply 'vlax-invoke (list (vlax-ename->vla-object e) 'GetAttributes)))
        (if (= 'safearray (type ra)) (setq al (vlax-safearray->list ra)) (setq al ra))
        (strcat "P=" (if (at-arch:parking-p e) "T" "N")
                "|ATTR=" (vl-prin1-to-string (at-arch:parking-number-att e))))))`, 'SELFTEST');
  if (c && c.startsWith('P=T')) return;   // 已有可识别的车位块（之前跑过）
  log('  当前图纸没有可识别车位块（正常，马上插入）');
}

// ---------- 3. 插入块 ----------
// 100 个车位：4 排 × 25 列，两排一组「相对布置」（中间 6000 宽车道），相邻两组「背靠背」。
// 相对的那一排整体转 180°（开口朝车道），再把它的属性文字转回 0°，编号始终正着看。
//   row0  y=0        rot 0    占据 y[-5300, 0]
//   ── 车道 6000 ──
//   row1  y=-16600   rot 180  占据 y[-16600, -11300]  ← 与 row0 相对
//   row2  y=-16600   rot 0    占据 y[-21900, -16600]  ← 与 row1 背靠背
//   ── 车道 6000 ──
//   row3  y=-33200   rot 180  占据 y[-33200, -27900]  ← 与 row2 相对
const BW = 2400, BH = 5300;          // 车位块包围盒（插入点在上边中点）
const COLS = 25;                     // 每排 25 个
const COL_STEP = 2500;               // 2400 宽 + 100 缝
const ROWS = [
  { y: 0, rot: 0 },
  { y: -16600, rot: 180 },
  { y: -16600, rot: 0 },
  { y: -33200, rot: 180 },
];
const GRID = [];
for (const r of ROWS) {
  for (let col = 0; col < COLS; col++) GRID.push({ x: col * COL_STEP, y: r.y, rot: r.rot });
}

// 一整排一次插完（25 个），画面上一排一排出现
async function insertRow(cad, row) {
  const rad = row.rot === 0 ? '0.0' : '3.14159265358979';
  return ev(cad, `(progn
  (vl-load-com)
  (setq ms (vla-get-ModelSpace (vla-get-ActiveDocument (vlax-get-acad-object))))
  (setq nm (strcat (chr ${CH_CHE}) (chr ${CH_WEI})))
  (setq i 0)
  (while (< i ${COLS})
    (setq ins (vla-insertblock ms
                (apply 'vlax-3d-point (list (* i ${COL_STEP}.0) ${row.y}.0 0.0))
                nm 1.0 1.0 1.0 ${rad}))
    (if (= ${row.rot === 0 ? 0 : 1} 1)
        (progn
          (setq ra (vl-catch-all-apply 'vlax-invoke (list ins 'GetAttributes)))
          (setq al (if (= 'safearray (type ra)) (vl-safearray->list ra) ra))
          (foreach at al (vla-put-Rotation at 0.0))))
    (setq *demo-ents (cons (vlax-vla-object->ename ins) *demo-ents))
    (setq i (1+ i)))
  (strcat "ROW-OK=" (itoa (length *demo-ents))))`, `INS row y=${row.y}`, 120000);
}

// ---------- 4. 抓屏 PS1 ----------
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
[System.IO.Compression.ZipFile]::CreateFromDirectory($dir, $zip)
try {
  Invoke-WebRequest -Uri 'http://${HOST}:${PORT}/upload/${zipName}' -Method POST -InFile $zip -TimeoutSec 120 | Out-Null
  [System.IO.File]::WriteAllText($done, 'OK ' + $n + ' frames ' + (Get-Item $zip).Length)
} catch {
  [System.IO.File]::WriteAllText($done, 'ERR ' + $_.Exception.Message)
}`;
}

// ---------- 5. 清属性 + 编号 ----------
async function clearAttrs(cad) {
  const r = await ev(cad, `(progn
  (vl-load-com)
  (foreach e *demo-ents
    (if (and e (entget e))
      (progn
        (setq ra (vl-catch-all-apply 'vlax-invoke (list (vlax-ename->vla-object e) 'GetAttributes)))
        (if (not (vl-catch-all-error-p ra))
            (progn
              (if (= 'safearray (type ra)) (setq al (vlax-safearray->list ra)) (setq al ra))
              (foreach a al (vla-put-TextString a "")))))))
  "CLEARED")`, 'CLEAR-ATTR');
  if (!r || !r.startsWith('CLEARED')) fail(`清属性失败 (${r})`);
}

async function runNumbering(cad) {
  let has = await ev(cad, '(if at-arch:ai-parking-number "HAS" "NO")', 'AT-ARCH?', 30000);
  if (has !== 'HAS') {
    log('at-arch 未加载，尝试 install_package');
    await cad.callTool('install_package', { packageName: 'at-arch' }, { timeoutMs: 120000 }).catch(() => {});
    await sleep(3000);
    has = await ev(cad, '(if at-arch:ai-parking-number "HAS" "NO")', 'AT-ARCH?', 30000);
  }
  if (has !== 'HAS') fail('at-arch 未加载，无法调用 ai-parking-number');

  const t0 = Date.now();
  const r = await ev(cad, `(progn
  (setq res (at-arch:ai-parking-number 1 nil))
  (strcat "NUMBERED=" (itoa (if res (length res) 0))))`, 'NUMBERING', 120000);
  log(`  编号耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  const m = r && r.match(/NUMBERED=(\d+)/);
  if (!m || Number(m[1]) < 1) fail(`编号失败 (${r})`);
  return Number(m[1]);
}

async function cleanup(cad) {
  const r = await ev(cad, `(progn
  (vl-cmdf "_.CLEANSCREENOFF")
  (setq n 0)
  (foreach e *demo-ents
    (if (and e (entget e)) (progn (entdel e) (setq n (1+ n)))))
  (setq *demo-ents nil)
  (strcat "DELETED=" (itoa n)))`, 'CLEANUP', 30000);
  log(`  清理: ${r}`);
}

// ---------- 6. 等 zip ----------
async function waitZip(timeoutMs = 120000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (zipReceived && fs.existsSync(zipReceived)) return zipReceived;
    await sleep(1500);
  }
  return null;
}

// ---------- 7. 合成 9:16 ----------
function compose(framesDir, out) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const tmp = out + '.tmp.mp4';   // 同目录临时文件（跨设备 rename 会 EXDEV）
  const bg = path.join(WORK, 'bg.png');
  execFileSync('python3', [path.join(ROOT, 'bin', 'make-demo-bg.py'), bg]);
  const fc = [
    `[0:v]crop=iw-40:ih-54:0:24,`
    + 'scale=1000:563:force_original_aspect_ratio=increase,crop=1000:563[clip]',
    `[1:v]null[bg]`,
    `[bg][clip]overlay=40:820:shortest=1[v]`,
  ];
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error',
    '-framerate', '8', '-i', path.join(framesDir, '%05d.jpg'),
    '-loop', '1', '-i', bg,
    '-filter_complex', fc.join(';'),
    '-map', '[v]', '-r', '25', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-crf', '20', tmp]);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.renameSync(tmp, out);
  return out;
}

// ---------- main ----------
let srv = null;
const cad = new McpCad();
try {
  srv = await startServer();

  log(`连接 MCP → ${process.env.MCP_CAD_URL || '192.168.1.53:8110'}`);
  await cad.connect();
  await cad.waitReady(60000).catch(() => {});
  await cad.callTool('session_pin_instance', { key: 'fresh' }, { timeoutMs: 30000 }).catch(() => {});
  const hb = await cad.evalLisp('(if 1 1 nil)', { timeoutMs: 20000 });
  if (String(hb) !== '1') fail('CAD 心跳失败');
  await cad.callTool('bring_to_front', {}).catch(() => {});
  await sleep(1000);
  await ev(cad, '(strcat "DOC=" (vla-get-Name (vla-get-ActiveDocument (vlax-get-acad-object))))', 'DOC');

  log('确保车位.dwg 就位');
  await ensureBlockFile(cad);

  log('准备（配置 + 块定义）');
  // 安全检查：只在空图纸上做演示，避免动到用户的真实图纸（失败则回退 6 屏）
  const clean = await ev(cad, `(progn
  (setq all (ssget "X"))
  (strcat "COUNT=" (itoa (if all (sslength all) 0))))`, 'DRAWING-CHECK', 30000);
  if (clean !== 'COUNT=0') fail(`当前图纸非空 (${clean})，为免动到用户图纸跳过实拍`);
  await prep(cad);

  const zipName = `frames-${stamp()}.zip`;
  // 先把视图定到车位区域（按网格包围盒算中心与高度，块 2400x5300，转 180° 的排向上长）
  const minX = Math.min(...GRID.map((g) => g.x)) - BW / 2;
  const maxX = Math.max(...GRID.map((g) => g.x)) + BW / 2;
  const minY = Math.min(...GRID.map((g) => (g.rot ? g.y : g.y - BH)));
  const maxY = Math.max(...GRID.map((g) => (g.rot ? g.y + BH : g.y)));
  const zcx = (minX + maxX) / 2, zcy = (minY + maxY) / 2;
  const zhh = Math.round((maxY - minY) * 1.08);
  // 注意：ZOOM C 在高度 >4 万时会把 CAD 挂住（实测），统一用 ZOOM W（窗口按绘图区 2.2 比例）
  const zoomWin = (cx, cy, h) => {
    const w = h * 2.2;
    return `(progn (vl-cmdf "_.ZOOM" "W" (list ${(cx - w / 2).toFixed(2)} ${(cy - h / 2).toFixed(2)} 0.0)`
      + ` (list ${(cx + w / 2).toFixed(2)} ${(cy + h / 2).toFixed(2)} 0.0)) "OK")`;
  };
  await ev(cad, zoomWin(zcx, zcy, zhh), 'ZOOM-INIT');
  log(`启动抓屏 PS1（${SEC}s）`);
  await ps1Remote(cad, captureScript(zipName, SEC), 'CAPTURE-START');

  // 抓屏已在跑：开始画面动作
  await sleep(800);
  for (let r = 0; r < ROWS.length; r++) {
    log(`插入第 ${r + 1}/${ROWS.length} 排（${COLS} 个车位，rot ${ROWS[r].rot}）`);
    const res = await insertRow(cad, ROWS[r]);
    if (r === 0 && (!res || !res.startsWith('ROW-OK='))) fail(`首排插入失败 (${res})`);
    if (!res || !res.startsWith('ROW-OK=')) fail(`第 ${r + 1} 排插入失败 (${res})`);
    await sleep(1800);
  }

  log('清空编号属性（对比更明显）');
  await clearAttrs(cad);

  log('执行 AI 编号');
  const n = await runNumbering(cad);
  log(`  已编号 ${n} 个车位`);

  log('缩放到全图');
  await ev(cad, zoomWin(zcx, zcy, zhh), 'ZOOM-WIDE');
  await cad.callTool('bring_to_front', {}).catch(() => {});
  await sleep(1000);

  // 片尾停在局部特写：第一组「相对布置」（row0 + row1 跨车道面对面），
  // 编号 43px 抓屏 → 成片 ~22px，正反向都看得清。抓屏自然结束在这里。
  log('局部放大到第一组相对车位（片尾定格）');
  await ev(cad, zoomWin(10000, -8300, 18000), 'ZOOM-DETAIL');

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

  // 黑屏守卫：Windows 锁屏/屏保时 CopyFromScreen 抓到全黑
  const mid = path.join(framesDir, frames[Math.floor(frames.length / 2)]);
  const mean = Number(execFileSync('identify', ['-format', '%[fx:mean]', mid]).toString().trim());
  log(`  画面亮度: ${mean.toFixed(3)}`);
  if (!(mean > 0.05)) fail(`抓屏疑似黑屏 (mean=${mean})`);

  log('合成 9:16 视频');
  compose(framesDir, OUT);
  log(`完成: ${OUT} (${(fs.statSync(OUT).size / 1024 / 1024).toFixed(1)} MB)`);
} catch (e) {
  console.error(`[demo] ${e.demoFail ? '失败' : '异常'}:`, e.message.slice(0, 300));
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

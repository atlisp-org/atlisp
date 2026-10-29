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
//   node bin/demo-capture.mjs [--pkg at-arch] [--sec 12] [--out media/demo-at-arch.mp4] [--keep]
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
const SEC = Number(arg('sec', '12'));
const OUT = path.resolve(arg('out', path.join(ROOT, 'media', `demo-${PKG}-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.mp4`)));
const KEEP = process.argv.includes('--keep');

function log(...a) { console.log('[demo]', ...a); }
function fail(msg) { console.error('[demo] 失败:', msg); process.exit(1); }

// ---------- 0. 临时 HTTP 服务 ----------
let zipReceived = null;
function startServer() {
  fs.mkdirSync(WORK, { recursive: true });
  if (!fs.existsSync(LOCAL_DWG)) fail(`本机缺车位.dwg: ${LOCAL_DWG}`);
  const srv = http.createServer((req, res) => {
    const url = req.url.split('?')[0];
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
  (@::set-config '@arch:parking-min-row 2)
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
const GRID = [];
for (let col = 0; col < 5; col++) GRID.push([col * 3000, 0]);   // 一排 5 个车位：编号在成片里可辨认

async function insertOne(cad, x, y) {
  return ev(cad, `(progn
  (vl-load-com)
  (setq ms (vla-get-ModelSpace (vla-get-ActiveDocument (vlax-get-acad-object))))
  (setq ins (vla-insertblock ms (apply 'vlax-3d-point (list ${x}.0 ${y}.0 0.0))
                             (strcat (chr ${CH_CHE}) (chr ${CH_WEI})) 1.0 1.0 1.0 0.0))
  (setq *demo-ents (cons (vlax-vla-object->ename ins) *demo-ents))
  "INS-OK")`, `INS ${x},${y}`, 60000);
}

// ---------- 4. 抓屏 PS1 ----------
function captureScript(zipName, seconds) {
  return `Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.IO.Compression.FileSystem
$dir = 'C:\\Users\\vitalgg\\@lisp\\tmp\\demoframes'
$zip = 'C:\\Users\\vitalgg\\@lisp\\tmp\\${zipName}'
$done = 'C:\\Users\\vitalgg\\@lisp\\tmp\\demo-capture.txt'
Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item $zip -Force -ErrorAction SilentlyContinue
Remove-Item $done -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $dir | Out-Null
$b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$w = $b.Width
$h = $b.Height
$jpg = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
$ep = [System.Drawing.Imaging.EncoderParameters]::new(1)
$ep.Param[0] = [System.Drawing.Imaging.EncoderParameter]::new([System.Drawing.Imaging.Encoder]::Quality, [long]72)
$n = 0
$sw = [System.Diagnostics.Stopwatch]::StartNew()
while ($sw.Elapsed.TotalSeconds -lt ${seconds}) {
  $bmp = [System.Drawing.Bitmap]::new($w, $h)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen(0, 0, 0, 0, [System.Drawing.Size]::new($w, $h))
  $g.Dispose()
  $bmp.Save(($dir + '\\' + ('{0:D5}' -f $n) + '.jpg'), $jpg, $ep)
  $bmp.Dispose()
  $n = $n + 1
  Start-Sleep -Milliseconds 300
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
    `[0:v]scale=1000:563:force_original_aspect_ratio=increase,crop=1000:563[clip]`,
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
  // 先把视图定到车位区域（块 2400x5300：x 每加 1 个 +3000，首块 x∈[-1200,1200]、y∈[-5300,0]）
  const minX = -1200, maxX = (GRID.length - 1) * 3000 + 1200;
  const zcx = (minX + maxX) / 2, zcy = -2650, zhh = Math.round(5300 * 1.19);
  await ev(cad, `(progn (command "_.ZOOM" "C" (list ${zcx}.0 ${zcy}.0 0.0) ${zhh}) "OK")`, 'ZOOM-INIT');
  log(`启动抓屏 PS1（${SEC}s）`);
  await ps1(cad, captureScript(zipName, SEC), 'CAPTURE-START');

  // 抓屏已在跑：开始画面动作
  await sleep(1200);
  log(`插入 ${GRID.length} 个车位块`);
  for (let i = 0; i < GRID.length; i++) {
    const r = await insertOne(cad, GRID[i][0], GRID[i][1]);
    if (i === 0 && (!r || r !== 'INS-OK')) fail(`首块插入失败 (${r})`);
    await sleep(1400);
  }

  log('清空编号属性（对比更明显）');
  await clearAttrs(cad);

  log('执行 AI 编号');
  const n = await runNumbering(cad);
  log(`  已编号 ${n} 个车位`);

  log('缩放到全图');
  await ev(cad, '(progn (command "_.ZOOM" "E") (command "_.REGEN") "OK")', 'ZOOM-E');
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

  // 黑屏守卫：Windows 锁屏/屏保时 CopyFromScreen 抓到全黑
  const mid = path.join(framesDir, frames[Math.floor(frames.length / 2)]);
  const mean = Number(execFileSync('identify', ['-format', '%[fx:mean]', mid]).toString().trim());
  log(`  画面亮度: ${mean.toFixed(3)}`);
  if (!(mean > 0.05)) fail(`抓屏疑似黑屏 (mean=${mean})`);

  log('合成 9:16 视频');
  compose(framesDir, OUT);
  log(`完成: ${OUT} (${(fs.statSync(OUT).size / 1024 / 1024).toFixed(1)} MB)`);
} catch (e) {
  console.error('[demo] 异常:', e.message.slice(0, 300));
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

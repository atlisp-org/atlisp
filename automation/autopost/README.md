# autopost — QQ空间 + 抖音 自动化内容发布

把「内容队列 + 定时调度 + 自动发布」串起来的推广发布组件，已并入 **atlisp-worker**
（`automation/` 目录，根仓库跟踪）：

- **常驻进程**：`autopost.service`（systemd）拉起二维码服务（8123）+ QQ空间守护进程（8124）
- **定时调度**：`automation/schedule.json` 里的 `autopost-qzone`（10:00）/
  `autopost-channels`（14:00）/ `autopost-douyin`（16:00）任务，
  经 `work-service.sh` 调 `bin/post-once.mjs` 执行
- **开关**：`/etc/atlisp/atlisp-worker.env` 里 `AUTOPOST_MODE=off|publish`（默认 publish；
  队列为空时任务自动空转，有内容文件才真正发）
- 本目录的 `bin/schedule.js`（自带 cron 调度器）保留作独立运行用，worker 在跑时不要再启动它

- **QQ空间**：Playwright 网页自动化（扫码登录一次，之后自动发文字/图片）
- **抖音**：双通道
  - **通道 A（官方）**：抖音开放平台 API（OAuth 授权 → 上传视频 → 创建视频，含自动刷新 token、分片上传）——需要**企业主体**
  - **通道 B（兜底）**：抖音创作者平台（creator.douyin.com）网页自动化——个人账号可用
- **微信视频号**：视频号助手（channels.weixin.qq.com）网页自动化——个人账号可用，微信 App 扫码
  - 官方 API 同样需要企业主体，个人走网页通道
  - 登录态存持久化 profile（`state/profiles/channels`，同 qzone 模式）；
    微信网页会话可能中途失效（实测约 1 小时后被踢回 login.html），发布失败提示
    「登录态已失效」时重新 `node bin/channels-login.js` 扫码即可
  - ⚠️ 微信系风控比抖音严，频率每天 1 条封顶，封号风险自担

> ⚠️ **风险声明**：QQ空间/创作者平台的网页自动化**违反平台用户协议**，存在验证码、限流、封号风险，请自行承担。
> 控制频率（一天 1~3 条）、用真实网络环境、避免高频机械操作。发布的内容要合规（推广文案不要硬导流，抖音话题审核很严）。

---

## 目录结构

```
autopost/
├── run.sh                # systemd 入口：拉起二维码服务 + QQ空间守护进程
├── bin/                  # 命令行入口
│   ├── qzone-daemon.js   # QQ空间常驻守护进程（浏览器 24/7 保活，会话内发布）
│   ├── qzone-login.js    # QQ空间扫码登录（一次性，会话不跨重启时仅作备用）
│   ├── qzone-post.js     # QQ空间发一条（走守护进程）
│   ├── post-once.mjs     # 单发入口（atlisp-worker 调度调用：取队列第一个文件发布）
│   ├── gen-content.py    # 内容生成（AI 文案 → Pillow 渲染竖版视频 → 写入队列）
│   ├── gen-bgm.py        # BGM 合成（欢快风格，media/bgm.wav 共享复用）
│   ├── demo-capture.mjs  # 实拍演示录制（CAD 真实操作 + 抓屏 → 9:16 片段）
│   ├── make-demo-bg.py   # 实拍片段品牌底图（Pillow）
│   ├── douyin-oauth.js   # 抖音开放平台 OAuth 授权
│   ├── douyin-web-login.js # 创作者平台扫码登录（兜底通道）
│   ├── douyin-publish.js # 抖音发一个视频（自动选通道 A/B）
│   ├── channels-login.js # 视频号扫码登录（微信 App 扫 8123/wechat.png）
│   └── schedule.js       # 定时调度器（node-cron，独立运行用）
├── lib/                  # 核心模块
│   ├── common.js         # 配置/日志/浏览器/登录态/内容解析
│   ├── qzone-session.js  # QQ空间会话管理器（守护进程核心：登录/发布/探测）
│   ├── qzone.js          # QQ空间一次性脚本（旧通道，保留）
│   ├── douyin-api.js     # 抖音开放平台官方 API
│   ├── douyin-web.js     # 创作者平台网页自动化
│   └── wechat-channels.js# 视频号助手网页自动化（登录+发布）
├── scripts/              # 调试脚本（二维码 HTTP 服务、DOM 探测等）
├── queue/                # 内容队列（发布成功后移入 posted/）
│   ├── qzone/*.txt       # 首行=文字，img: 行=图片路径
│   ├── douyin/*.json     # { video, title, topics, private }
│   └── channels/*.json   # { video, title(≤16字短标题), fullTitle, desc, private }（微信视频号）
├── media/                # 生成的竖版视频 & 画面帧（已 gitignore）
├── state/                # 登录态 & token（已 gitignore，勿外传）
│   └── profiles/qzone/   # 空间浏览器持久化 profile（等同账号凭证，勿外传）
└── logs/                 # run.log + 调试截图 screenshots/ + 二维码 qrcode/
```

## 推广内容自动生成（atlisp-worker 任务 `autopost-content`）

每天 08:30 由 worker 自动执行（`work-service.sh` 的 `autopost-content` 分支）：

```
pick_autopost_pkg()          轮换挑一个应用包（logs/autopost-topics.log 记已用，
                             与微信文章题材独立轮换，近 60 条不重复）
        │
call_opencode                AI 读 packages/<包>/ 素材，写出文案 JSON：
                             { qzone: 说说的文字, title: 抖音标题, topics: 话题[],
                               command: 真实入口命令（优先 ai- 无交互入口）,
                               slides: 5 项[钩子/痛点/效果/收益1/收益2] }
        │
demo-capture.mjs（仅 at-arch）实拍演示（失败自动跳过，不影响发布）：
                             ① PS1 把 车位.dwg 复制成 ASCII 名 che-wei.dwg
                             ② 当前图纸打 at-arch 配置 + 确保块名「车位」存在
                             ③ GDI+ 抓屏 18s，边抓边插 100 个车位块（4 排 × 25 列，
                                两排一组跨 6000 宽车道「相对布置」，相邻两组背靠背；
                                相对的那排整体转 180°，属性文字再转回 0° 保持正向）
                             ④ 编号字高调到 900（原 350 缩进成片只有 ~14px，看不清）
                             ⑤ (at-arch:ai-parking-number 1 nil) 真实编号（4 排蛇形：
                                1-25 左到右 / 26-50 右到左 / 51-75 左到右 / 76-100 右到左）
                             ⑥ 全景停留 → 局部特写（第一组相对车位，编号 43px 抓屏 ≈ 22px 成片）
                                → 片尾定格在特写
                             ⑦ 帧 zip 回传 Linux → ffmpeg 合成 9:16 片段 → media/demo-*.mp4
                             ⑧ 成功后把 demo 字段注入文案 JSON（走 8 屏版式）
        │
gen-content.py               确定性渲染：
                             ① Pillow 画 1080×1920 竖版画面（品牌深蓝底）
                             ② ffmpeg xfade 合成短视频 → media/
                                · 无 demo：6 屏（钩子/痛点/命令/效果/收益/CTA）~16.7s
                                · 有 demo：8 屏（钩子/痛点/命令/实拍/效果/收益1/收益2/CTA）~24s
                             ③ 写队列 queue/qzone/<日期>-<包>.txt（含首屏配图）
                                queue/douyin/<日期>-<包>.json
        │
autopost-qzone (10:00) /     到点照常发布队列里的内容
autopost-channels (14:00) /
autopost-douyin (16:00)
```

- 当日同一包重复生成会自动跳过（文件已存在）
- 手动跑：`python3 bin/gen-content.py --pkg <包名> --copy <文案.json> [--force] [--root <测试目录>]`
- 手动录实拍：`node bin/demo-capture.mjs --pkg at-arch [--sec 18] [--keep]`（--keep 保留 CAD 里的块，便于读回验证）
- 依赖：`python3 + Pillow`（画面渲染）、`ffmpeg`（合成，无需 drawtext）、`unzip`/`identify`（ImageMagick）
- 实拍是**尽力而为**：CAD 不可用 / 图纸非空 / 屏幕锁屏（抓出来全黑，亮度守卫拦截）→ 自动回退 6 屏，发布不受影响

### 实拍演示的 LISP 注意事项（踩过的坑）

MCP 的 `eval_lisp_with_result` 用 `(progn (setq f (open 结果文件 "w")) (setq r (vl-catch-all-apply ...)) (princ r f))`
包装用户代码 —— **`f` 和 `r` 是保留变量**。用户代码里 `(setq f ...)` 会覆盖文件句柄，
表现为「eval 返回空字符串」（结果文件没写成）。此前排查很久的「FSO 读文件返回空」也是同一个原因。

其他约束：
- 中文一律用 Unicode 码点构造：`(chr 36710)`=车、`(chr 20301)`=位（ACAD 2018+ 内部 UCS-2；
  用 GBK 字节 `(chr 179)...` 构造是错的，findfile 找不到）
- 从文件插块时块名 = 文件名（ASCII 名 → 块名 `che-wei`），要 `(vla-put-Name blkobj 车位)` 才符合
  `@arch:parking-blk` 的识别规则；属性 tag 用 `vla-get-TagString`（不是 `vla-get-Tag`）
- 单次 eval 的代码（含 base64）别超约 5000 字符，超了报「输入的字符串太长」；PS1 请拆短
- `command` 不能 `vl-catch-all-apply`，要用 `vl-cmdf`
- **ZOOM C 在高度 >4 万时会把 CAD 挂住**（`cad.stalled`，之后 `send_esc` 才恢复）；
  需要精确定位一律用 `ZOOM W`（窗口两点，按绘图区 2.2 比例算），别用 `ZOOM C`
- 块插成 180° 后，属性的 `vla-get-Rotation` 会跟着变成 3.14（绝对角度，不是相对），
  文字会倒过来；插完对每个属性 `(vla-put-Rotation at 0.0)` 就正回来了


## 安装

```bash
cd autopost
npm install
npx playwright install chromium     # 下载浏览器（约 170MB）
cp config.example.json config.json  # 按需修改
```

### 无图形环境（服务器）扫码登录

无需 Xvfb。登录流程在 Linux 无 `DISPLAY` 时自动 headless：打开登录页 →
把二维码截图存到 `logs/qrcode/`（qzone.png / douyin.png）→ 轮询等待扫码
（QR 约 2 分钟过期，脚本每 75 秒**重载登录页换新码**，最长等 10 分钟）→
登录成功保存登录态（空间用持久化 profile `state/profiles/qzone/`）。

```bash
# 方式一（推荐）：手机直接打开二维码图片服务
node scripts/qr-server.mjs 8123     # 服务 logs/qrcode/qzone.png，同一局域网手机可访问
# 手机浏览器打开 http://<服务器IP>:8123/qzone.png → 保存 → QQ 扫一扫「打开图片」

# 方式二：拷文件
scp user@server:/home/vitalgg/atlisp/autopost/logs/qrcode/qzone.png .
# 在手机上打开图片，用 QQ / 抖音「扫一扫」扫它
```

之后所有发布/调度命令（qzone-post、douyin-publish --web、schedule）都用
headless 跑，不需要显示器（自动判断：Linux 无 `DISPLAY` 时 headless）。
想强制指定：登录命令加 `--headless` / `--gui`；发布命令在 `config.json`
对应平台下加 `"headless": true` 或 `"headless": false`。

（备选方案：装 Xvfb 让浏览器跑在虚拟显示上，`xvfb-run -a node bin/schedule.js`。）

## 使用

### QQ空间（推荐：常驻守护进程）

> **为什么需要守护进程**：账号被平台风控后，登录态无法跨浏览器重启保留
> （冷启动的新会话会被立刻踢出）。守护进程让浏览器 24/7 保持打开，
> 发布在存活会话内完成，是最稳的方案。会话失效时守护进程会自动重新出二维码。

```bash
# 1. 守护进程由 systemd 服务管理（开机自启，崩溃自动拉起）：
sudo systemctl start|stop|status autopost
journalctl -u autopost -f                     # 看日志

# 手动前台调试（服务停掉后再跑）:
node bin/qzone-daemon.js

# 手机扫码（同一局域网）：浏览器打开 http://<服务器IP>:8123/qzone.png
#   （8123 是二维码图片服务，随服务启动；每次打开都是最新码）
#   → 长按二维码保存图片 → QQ「扫一扫」→「打开图片」
# 扫码前可先看状态: curl http://127.0.0.1:8124/status

# 2. 手动发一条（守护进程未运行时会自动拉起）
node bin/qzone-post.js "今天的内容"
node bin/qzone-post.js "内容" --img a.jpg b.png
node bin/qzone-post.js "内容" --dry-run   # 只填写不点发布（调试）

# 调试：探测输入框/发布按钮的 DOM 结构
curl -X POST http://127.0.0.1:8124/probe
```

**调度**（`npm run schedule`）里 qzone 任务同样走守护进程；若会话失效，
调度任务会阻塞等待扫码（守护进程持续出二维码），扫完即恢复。

自动化流程：往 `queue/qzone/` 丢 `.txt` 文件（命名如 `2026-10-27.txt`），
定时任务到点自动取第一个文件发布，成功后移入 `posted/`，失败保留下周期重试。

```
# queue/qzone/2026-10-27.txt
这是一条推广说说，介绍我们的产品……
img: /home/vitalgg/pics/a.jpg
img: /home/vitalgg/pics/b.jpg
```

### 抖音 · 通道 B（创作者平台网页版，个人账号可用）

```bash
npm run douyin-web-login                                # 1. 扫码登录
node bin/douyin-publish.js demo.mp4 --title "标题" --topic AutoLISP --topic CAD
node bin/douyin-publish.js demo.mp4 --private           # 仅自己可见（先试水）
node bin/douyin-publish.js demo.mp4 --dry-run           # 准备到发布前一步
```

### 抖音 · 通道 A（开放平台官方 API，需企业主体）

**申请流程**（[开发者平台](https://developer.open-douyin.com/)）：

1. 注册开发者账号，完成**企业主体认证**（个人开发者无法开通发布能力；资料：营业执照等）
2. 创建「网站应用」（移动/网站应用）
3. 应用详情 > 能力管理 > **能力实验室** > 申请「**代替用户发布内容到抖音**」（对应 scope `video.create`）
4. 应用通过审核后，把 **Client Key (appKey)** / **Client Secret (appSecret)** 填入 `config.json`
5. 在应用里配置**回调地址**（与 `redirectUri` 一致，本机开发用 `http://localhost:8080/callback`）

**授权与发布**：

```bash
npm run douyin-oauth                # 打开授权页，用要发布的抖音账号扫码同意
node bin/douyin-publish.js demo.mp4 --title "标题" --topic AutoLISP   # 自动走官方 API
node bin/douyin-oauth --refresh     # token 过期时手动刷新（一般不用，程序会自动刷新）
```

**官方 API 限制**（来自官方文档）：

| 项目 | 限制 |
|---|---|
| 标题 | ≤ 1000 字（含 #话题、@用户） |
| 视频时长 | ≤ 15 分钟 |
| 文件大小 | 直接上传 ≤ 300MB（>300MB 自动走分片上传，总大小 ≤ 4GB） |
| 频率 | 一个用户在一个应用下**每天最多 75 个作品** |
| 状态 | 发布后进入平台审核，审核期间仅自己可见 |

### 定时发布

`config.json` 里的 `schedule` 数组（cron 表达式，服务器时区）：

```json
"schedule": [
  { "platform": "qzone",  "cron": "0 9 * * *",  "queueDir": "queue/qzone" },
  { "platform": "douyin", "cron": "10 20 * * *", "queueDir": "queue/douyin", "mode": "auto" }
]
```

- `mode`: `auto`（有官方 API 权限就走 API，否则网页版）/ `api` / `web`
- 运行：`npm run schedule`（前台）或 `nohup node bin/schedule.js >/dev/null 2>&1 &`（常驻）
- 也可以用系统 crontab 替代调度器，每次取队列第一个文件发布：

```cron
0 9 * * * cd ~/atlisp/autopost && xvfb-run -a node bin/schedule-once-qzone.sh
```

日志统一在 `logs/run.log`，每次发布都有截图存 `logs/screenshots/` 可事后核对。

**队列规则补充**：`queue/` 下以 `.` 开头的文件（如 `.sample.txt`）是示例/模板，调度器会自动跳过，不会误发。

## 环境自检

```bash
node scripts/smoke.mjs   # 不登录：验证浏览器可启动、两个平台页面可达、抖音 API 可达
node scripts/probe.mjs   # 探测登录页 DOM（排查登录流程时用）
```

> 2026-10-27 已在本机验证：QQ空间 / 创作者平台页面可正常打开，抖音开放平台 OAuth 接口
> 调用格式正确（假 code 返回 `error_code: 10007 code已失效`）。实际发布需要用真实账号扫码。

## 常见问题

**Q：报「找不到输入框 / 发布按钮」？**
空间/抖音网页会改版。发布按钮查找有两层：固定选择器（`lib/qzone-session.js`
的 `SEND_SELECTORS`）+ 动态兜底（输入框容器内文字恰为「发布」的最深层可见元素）。
仍失败时用 `curl -X POST http://127.0.0.1:8124/probe` 拿到真实 DOM 结构，
更新选择器。失败现场自动截图到 `logs/screenshots/`。

**Q：登录态多久过期？**
守护进程运行期间会话一直有效（浏览器常驻）。普通情况数周到数月；
**账号被风控后，会话无法跨浏览器重启保留**——守护进程检测到被踢出会登录页时
会自动重新出二维码，扫一次即恢复，不影响已排队的文件。

**Q：抖音网页版点「发布」后没反应？**
程序点完发布后会自动验证：优先看页面跳转/「发布成功」提示；页面崩溃或未跳转时，
另起一个浏览器查「内容管理 → 作品」列表，标题出现在列表里即确认发布成功
（日志会写「作品列表已确认」）。仍显示「请人工核对」时看
`logs/screenshots/douyin-post-*.png` 和创作者中心作品列表。常见原因：视频还在转码
（程序最长等 10 分钟）、标题含敏感词被拦截、账号被限流。

**Q：风控了怎么办？**
出现验证码/滑块时，人工在弹出的浏览器窗口里解决一次即可（程序用的是真实浏览器上下文，
处理完登录态仍有效）。长期策略：降频、真机 IP、内容差异化。

**Q：个人开发者想用抖音官方 API？**
官方明确：发布内容能力要求企业主体（另有 600 元/年的保证金等要求）。
个人账号请走通道 B（创作者平台网页版），或注册个体户/公司后再开通。

## 安全注意

- `state/` 里是账号登录态和 token，**等同于账号凭证**，不要提交 git、不要发给别人（已在 .gitignore）
- 本项目只操作**自己的账号**，不要用于批量矩阵号刷量

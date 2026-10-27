#!/bin/bash
# autopost 常驻进程入口（由 autopost.service 拉起）：
#   1. 二维码图片服务（端口 8123，手机扫码用）
#   2. QQ空间守护进程（端口 8124，浏览器 24/7 常驻，会话内发布）
#
# 会话失效时守护进程会自动重新出二维码：
#   手机打开 http://<服务器IP>:8123/qzone.png → 保存 → QQ 扫一扫
#
# 抖音不需要常驻：每次发布临时起浏览器（登录态存 state/douyin-web.json，跨重启有效）。
BASE=/home/vitalgg/atlisp/automation/autopost
LOG_DIR="$BASE/logs"
mkdir -p "$LOG_DIR"

node "$BASE/scripts/qr-server.mjs" 8123 >> "$LOG_DIR/qr-server.log" 2>&1 &
QR_PID=$!
node "$BASE/bin/qzone-daemon.js" --port 8124 >> "$LOG_DIR/daemon.log" 2>&1 &
DAEMON_PID=$!

trap 'kill $QR_PID $DAEMON_PID 2>/dev/null; exit 0' TERM INT

# 以守护进程为准：它退出（理论上不会，扫码会无限重试）则整体退出，由 systemd 重启
wait $DAEMON_PID

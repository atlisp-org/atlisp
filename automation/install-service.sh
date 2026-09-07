#!/bin/bash
# /home/vitalgg/atlisp/automation/install-service.sh
# 安装自动化员工服务

set -e

SERVICE_NAME="atlisp-worker"
SERVICE_FILE="/home/vitalgg/atlisp/automation/atlisp-worker.service"
SYSTEMD_DIR="/etc/systemd/system"

echo "安装 @lisp 自动化员工服务..."

# 检查是否root
if [ "$EUID" -ne 0 ]; then
    echo "请使用 sudo 运行此脚本"
    exit 1
fi

# 复制服务文件
cp "$SERVICE_FILE" "$SYSTEMD_DIR/$SERVICE_NAME.service"

# 设置权限
chmod 644 "$SYSTEMD_DIR/$SERVICE_NAME.service"
chmod +x /home/vitalgg/atlisp/automation/work-service.sh

# 重新加载systemd
systemctl daemon-reload

# 启用服务（开机自启）
systemctl enable "$SERVICE_NAME"

# 启动服务
systemctl start "$SERVICE_NAME"

# 检查状态
sleep 2
systemctl status "$SERVICE_NAME" --no-pager

echo ""
echo "服务安装完成！"
echo ""
echo "常用命令:"
echo "  启动: sudo systemctl start $SERVICE_NAME"
echo "  停止: sudo systemctl stop $SERVICE_NAME"
echo "  重启: sudo systemctl restart $SERVICE_NAME"
echo "  状态: systemctl status $SERVICE_NAME"
echo "  日志: journalctl -u $SERVICE_NAME -f"

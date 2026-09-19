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

# 准备环境变量文件（含 VLLM_API_KEY，0600 权限，密钥不写入仓库）
ENV_FILE="/etc/atlisp/atlisp-worker.env"
mkdir -p /etc/atlisp
if [ ! -f "$ENV_FILE" ]; then
    # 尝试从已安装的旧 unit 迁移密钥
    OLD_KEY=$(systemctl show "$SERVICE_NAME" -p Environment 2>/dev/null | grep -oE 'VLLM_API_KEY=[^ ]+' | head -1)
    if [ -n "$OLD_KEY" ]; then
        echo "$OLD_KEY" > "$ENV_FILE"
        echo "已从旧配置迁移 VLLM_API_KEY 到 $ENV_FILE"
    else
        NEW_KEY=$(openssl rand -hex 24 2>/dev/null || tr -dc 'a-f0-9' < /dev/urandom | head -c 48)
        printf 'VLLM_API_KEY=%s\n' "$NEW_KEY" > "$ENV_FILE"
        echo "警告: 已生成新的 VLLM_API_KEY 并写入 $ENV_FILE"
        echo "      请确认其值与 vllm 服务端的 --api-key 一致，否则 AI 任务将无法认证"
    fi
    chmod 600 "$ENV_FILE"
    chown root:root "$ENV_FILE"
else
    echo "环境变量文件已存在: $ENV_FILE"
fi

# 复制服务文件
cp "$SERVICE_FILE" "$SYSTEMD_DIR/$SERVICE_NAME.service"

# 设置权限
chmod 644 "$SYSTEMD_DIR/$SERVICE_NAME.service"
chmod +x /home/vitalgg/atlisp/automation/work-service.sh

# 重新加载systemd
systemctl daemon-reload

# 清除历史失败计数（避免 start-limit-hit 阻止启动）
systemctl reset-failed "$SERVICE_NAME" 2>/dev/null || true

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

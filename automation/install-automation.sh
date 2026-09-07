#!/bin/bash

# @lisp CAD应用云管理系统 - 一键安装自动化维护工具
# 用法: ./install-automation.sh

set -e

TARGET_DIR="${HOME}/atlisp"

echo "@lisp CAD应用云管理系统 - 自动化维护工具安装"
echo "================================================"

# 检查是否在正确目录
if [ ! -f "$TARGET_DIR/Makefile" ]; then
    echo "错误: 请在 $TARGET_DIR 目录下运行此脚本"
    exit 1
fi

cd "$TARGET_DIR"

# 1. 设置脚本权限
echo "1. 设置脚本权限..."
chmod +x "$TARGET_DIR/sync-all.sh" "$TARGET_DIR/push-pkg.sh" "$TARGET_DIR/automation/setup-cron.sh" "$TARGET_DIR/handle-detached.sh"

# 2. 安装Git钩子
echo "2. 安装Git钩子..."
if [ -d ".git" ]; then
    chmod +x .git/hooks/pre-commit .git/hooks/post-checkout 2>/dev/null || true
    echo "Git钩子已安装"
else
    echo "警告: 不是git仓库，跳过Git钩子安装"
fi

# 3. 安装atlisp-lint依赖
echo "3. 安装atlisp-lint依赖..."
if [ -d "atlisp-lint" ]; then
    cd atlisp-lint
    if [ ! -d "node_modules" ]; then
        npm install
    else
        echo "atlisp-lint依赖已安装"
    fi
    cd "$TARGET_DIR"
else
    echo "警告: atlisp-lint目录不存在，跳过"
fi

# 4. 创建日志目录
echo "4. 创建日志目录..."
mkdir -p logs

# 5. 安装定时任务（可选）
echo "5. 定时任务安装..."
read -p "是否安装定时任务？(y/N): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    "$TARGET_DIR/automation/setup-cron.sh" --install
else
    echo "跳过定时任务安装"
fi

# 6. 测试Makefile
echo "6. 测试Makefile..."
make help > /dev/null 2>&1 && echo "Makefile正常" || echo "Makefile有问题"

# 7. 显示安装结果
echo ""
echo "================================================"
echo "安装完成！"
echo ""
echo "可用命令:"
echo "  make help          - 查看所有可用命令"
echo "  make sync          - 同步所有子模块"
echo "  make lint          - 运行代码检查"
echo "  make status        - 查看项目状态"
echo "  make all           - 运行所有检查"
echo ""
echo "定时任务:"
echo "  ./automation/setup-cron.sh --status  - 查看定时任务状态"
echo "  ./automation/setup-cron.sh --list    - 列出定时任务"
echo ""
echo "Git钩子:"
echo "  pre-commit: 提交前自动检查代码"
echo "  post-checkout: 切换分支后提示同步"
echo ""
echo "文档:"
echo "  AUTOMATION.md - 自动化维护详细指南"
echo "================================================"
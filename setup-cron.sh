#!/bin/bash

# @lisp CAD应用云管理系统 - cron定时任务配置脚本
# 用法: ./setup-cron.sh [选项]
# 选项:
#   --install    安装定时任务
#   --remove     移除定时任务
#   --list       列出当前定时任务
#   --status     显示定时任务状态

set -e

TARGET_DIR="${HOME}/atlisp"
LOG_DIR="${TARGET_DIR}/logs"
SYNC_SCRIPT="${TARGET_DIR}/sync-all.sh"
LINT_SCRIPT="${TARGET_DIR}/make lint"

# 创建日志目录
mkdir -p "$LOG_DIR"

# 显示帮助
show_help() {
    echo "@lisp CAD应用云管理系统 - cron定时任务配置"
    echo ""
    echo "用法: $0 [选项]"
    echo "选项:"
    echo "  --install    安装定时任务"
    echo "  --remove     移除定时任务"
    echo "  --list       列出当前定时任务"
    echo "  --status     显示定时任务状态"
    echo ""
    echo "定时任务说明:"
    echo "  1. 每天凌晨2点同步子模块"
    echo "  2. 每周一凌晨3点运行代码检查"
    echo "  3. 每月1号凌晨4点生成文档"
}

# 安装定时任务
install_cron() {
    echo "安装定时任务..."
    
    # 备份现有crontab
    crontab -l > "${LOG_DIR}/crontab.backup" 2>/dev/null || true
    
    # 移除现有的@lisp相关任务
    crontab -l 2>/dev/null | grep -v "atlisp" | grep -v "sync-all.sh" | grep -v "make lint" | grep -v "generate_manifest" > "${LOG_DIR}/crontab.new" || true
    
    # 添加新的定时任务
    cat >> "${LOG_DIR}/crontab.new" << EOF
# @lisp CAD应用云管理系统 - 自动化维护任务

# 每天凌晨2点同步子模块
0 2 * * * cd ${TARGET_DIR} && ./sync-all.sh >> ${LOG_DIR}/sync.log 2>&1

# 每周一凌晨3点运行代码检查
0 3 * * 1 cd ${TARGET_DIR} && make lint >> ${LOG_DIR}/lint.log 2>&1

# 每月1号凌晨4点生成文档
0 4 1 * * cd ${TARGET_DIR} && make docs >> ${LOG_DIR}/docs.log 2>&1
EOF
    
    # 安装新的crontab
    crontab "${LOG_DIR}/crontab.new"
    
    echo "定时任务安装完成"
    echo "查看: crontab -l"
}

# 移除定时任务
remove_cron() {
    echo "移除定时任务..."
    
    # 备份现有crontab
    crontab -l > "${LOG_DIR}/crontab.backup" 2>/dev/null || true
    
    # 移除所有@lisp相关任务
    crontab -l 2>/dev/null | grep -v "atlisp" | grep -v "sync-all.sh" | grep -v "make lint" | grep -v "generate_manifest" | crontab -
    
    echo "定时任务移除完成"
}

# 列出当前定时任务
list_cron() {
    echo "当前定时任务:"
    crontab -l 2>/dev/null || echo "没有定时任务"
}

# 显示定时任务状态
status_cron() {
    echo "定时任务状态:"
    echo ""
    echo "已安装的@lisp相关任务:"
    crontab -l 2>/dev/null | grep -A1 -B1 "atlisp\|sync-all\|make lint\|generate_manifest" || echo "没有相关任务"
    echo ""
    echo "日志文件:"
    ls -la "$LOG_DIR"/*.log 2>/dev/null || echo "没有日志文件"
}

# 解析参数
case "${1:-}" in
    --install)
        install_cron
        ;;
    --remove)
        remove_cron
        ;;
    --list)
        list_cron
        ;;
    --status)
        status_cron
        ;;
    *)
        show_help
        ;;
esac
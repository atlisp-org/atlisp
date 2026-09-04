#!/bin/bash

# @lisp CAD应用云管理系统 - fcron定时任务配置脚本
# 用法: ./setup-fcron.sh [选项]
# 选项:
#   --install    安装定时任务
#   --remove     移除定时任务
#   --list       列出当前定时任务
#   --status     显示定时任务状态

set -e

TARGET_DIR="${HOME}/atlisp"
LOG_DIR="${TARGET_DIR}/logs"
SYNC_SCRIPT="${TARGET_DIR}/sync-all.sh"

# 创建日志目录
mkdir -p "$LOG_DIR"

# 显示帮助
show_help() {
    echo "@lisp CAD应用云管理系统 - fcron定时任务配置"
    echo ""
    echo "用法: $0 [选项]"
    echo "选项:"
    echo "  --install    安装定时任务"
    echo "  --remove     移除定时任务"
    echo "  --list       列出当前定时任务"
    echo "  --status     显示定时任务状态"
    echo ""
    echo "Fcron特性:"
    echo "  - 系统关机错过的任务会在开机后自动补执行"
    echo "  - 支持任务频率控制"
    echo "  - 支持依赖等待"
}

# 安装定时任务
install_fcron() {
    echo "安装fcron定时任务..."
    
    # 备份现有配置
    fcrontab -l > "${LOG_DIR}/fcrontab.backup" 2>/dev/null || true
    
    # 创建临时文件
    TEMP_FILE=$(mktemp)
    
    # 保留现有任务（排除旧的atlisp任务）
    fcrontab -l 2>/dev/null | grep -v "atlisp\|sync-all.sh\|make lint\|generate_manifest" > "$TEMP_FILE" || true
    
    # 添加新的定时任务
    cat >> "$TEMP_FILE" << 'EOF'
# @lisp CAD应用云管理系统 - 自动化维护任务

# 每天凌晨2点同步子模块和独立项目
0 2 * * * cd /home/vitalgg/atlisp && ./sync-all.sh >> logs/sync.log 2>&1

# 每周一凌晨3点运行代码检查（包括独立项目）
0 3 * * 1 cd /home/vitalgg/atlisp && make lint lint-projects >> logs/lint.log 2>&1

# 每周五凌晨4点生成开发建议报告
0 4 * * 5 cd /home/vitalgg/atlisp && ./generate-suggestions.sh >> logs/suggestions.log 2>&1

# 每月1号凌晨5点生成文档
0 5 1 * * cd /home/vitalgg/atlisp && make docs >> logs/docs.log 2>&1
EOF
    
    # 安装新的fcron配置
    fcrontab "$TEMP_FILE"
    rm -f "$TEMP_FILE"
    
    echo "fcron定时任务安装完成"
    echo "查看: fcrontab -l"
}

# 移除定时任务
remove_fcron() {
    echo "移除fcron定时任务..."
    
    # 备份现有配置
    fcrontab -l > "${LOG_DIR}/fcrontab.backup" 2>/dev/null || true
    
    # 移除所有@lisp相关任务
    fcrontab -l 2>/dev/null | grep -v "atlisp\|sync-all.sh\|make lint\|generate_manifest" | fcrontab -
    
    echo "fcron定时任务移除完成"
}

# 列出当前定时任务
list_fcron() {
    echo "当前fcron定时任务:"
    fcrontab -l 2>/dev/null || echo "没有定时任务"
}

# 显示定时任务状态
status_fcron() {
    echo "Fcron定时任务状态:"
    echo ""
    echo "已安装的任务:"
    fcrontab -l 2>/dev/null || echo "没有任务"
    echo ""
    echo "Fcron服务状态:"
    systemctl status fcron 2>/dev/null || ps aux | grep fcron | grep -v grep || echo "fcron未运行"
    echo ""
    echo "日志文件:"
    ls -la "$LOG_DIR"/*.log 2>/dev/null || echo "没有日志文件"
}

# 解析参数
case "${1:-}" in
    --install)
        install_fcron
        ;;
    --remove)
        remove_fcron
        ;;
    --list)
        list_fcron
        ;;
    --status)
        status_fcron
        ;;
    *)
        show_help
        ;;
esac
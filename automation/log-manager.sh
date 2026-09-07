#!/bin/bash
# /home/vitalgg/atlisp/automation/log-manager.sh
# 日志管理脚本 - 轮转、清理、压缩

set -e

WORK_DIR="/home/vitalgg/atlisp"
LOG_DIR="$WORK_DIR/logs"
TASKS_DIR="$WORK_DIR/tasks"

# 配置
MAX_LOG_SIZE=$((10 * 1024 * 1024))  # 10MB
MAX_LOG_FILES=5                      # 保留5个轮转文件
MAX_TASK_FILES=50                    # 保留50个任务文件
MAX_OPENCOD_LOG_SIZE=$((5 * 1024 * 1024))  # 5MB

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# 清除 ANSI 颜色码
strip_ansi() {
    sed 's/\x1b\[[0-9;]*m//g' "$1" > "$1.tmp" && mv "$1.tmp" "$1"
}

# 日志轮转
rotate_log() {
    local logfile=$1
    local max_size=${2:-$MAX_LOG_SIZE}
    
    if [ ! -f "$logfile" ]; then
        return 0
    fi
    
    local size=$(stat -f%z "$logfile" 2>/dev/null || stat -c%s "$logfile" 2>/dev/null || echo 0)
    
    if [ "$size" -gt "$max_size" ]; then
        log_info "轮转日志: $logfile ($(( size / 1024 ))KB)"
        
        # 移动旧文件
        for i in $(seq $((MAX_LOG_FILES - 1)) -1 1); do
            local prev=$((i - 1))
            if [ -f "$logfile.$prev.gz" ]; then
                mv "$logfile.$prev.gz" "$logfile.$i.gz"
            fi
        done
        
        # 压缩当前文件
        if command -v gzip &> /dev/null; then
            gzip -c "$logfile" > "$logfile.0.gz"
        else
            cp "$logfile" "$logfile.0"
        fi
        
        # 清空当前文件
        > "$logfile"
        
        log_info "日志已轮转: $logfile.0.gz"
    fi
}

# 清理旧的日志轮转文件
cleanup_old_logs() {
    local logfile=$1
    
    for i in $(seq $MAX_LOG_FILES 10); do
        if [ -f "$logfile.$i.gz" ] || [ -f "$logfile.$i" ]; then
            rm -f "$logfile.$i.gz" "$logfile.$i"
            log_info "删除旧日志: $logfile.$i"
        fi
    done
}

# 清理 opencode 日志（保留最新的几个）
cleanup_opencode_logs() {
    local count=$(ls -1 "$LOG_DIR"/opencode-*.log 2>/dev/null | wc -l || echo 0)
    
    if [ "$count" -gt 10 ]; then
        ls -t "$LOG_DIR"/opencode-*.log | tail -n +11 | xargs rm -f
        log_info "清理 opencode 日志: 保留最新10个"
    fi
}

# 清理旧任务文件
cleanup_old_tasks() {
    local done_count=$(ls -1 "$TASKS_DIR/done/"*.task 2>/dev/null | wc -l || echo 0)
    
    if [ "$done_count" -gt "$MAX_TASK_FILES" ]; then
        ls -t "$TASKS_DIR/done/"*.task | tail -n +$((MAX_TASK_FILES + 1)) | xargs rm -f
        log_info "清理旧任务: 保留最新 $MAX_TASK_FILES 个"
    fi
    
    # 清理超大的任务文件（>100KB）
    find "$TASKS_DIR/done/" -name "*.task" -size +100k -exec rm -f {} \; 2>/dev/null || true
}

# 清理 tasks 目录中的临时文件
cleanup_task_temp() {
    # 清理超过1天的任务文件
    find "$TASKS_DIR/" -name "*.task" -mtime +1 -exec rm -f {} \; 2>/dev/null || true
}

# 主函数
main() {
    case "${1:-cleanup}" in
        rotate)
            log_info "开始日志轮转..."
            rotate_log "$LOG_DIR/sync.log"
            rotate_log "$LOG_DIR/lint.log"
            rotate_log "$LOG_DIR/optimize.log"
            rotate_log "$LOG_DIR/suggestions.log"
            rotate_log "$LOG_DIR/docs.log"
            rotate_log "$LOG_DIR/full-check.log"
            rotate_log "$LOG_DIR/clean.log"
            rotate_log "$LOG_DIR/lint-check.log"
            rotate_log "$LOG_DIR/worker.log"
            ;;
        cleanup)
            log_info "开始日志清理..."
            cleanup_old_logs "$LOG_DIR/sync.log"
            cleanup_old_logs "$LOG_DIR/lint.log"
            cleanup_old_logs "$LOG_DIR/optimize.log"
            cleanup_old_logs "$LOG_DIR/suggestions.log"
            cleanup_old_logs "$LOG_DIR/docs.log"
            cleanup_old_logs "$LOG_DIR/full-check.log"
            cleanup_old_logs "$LOG_DIR/clean.log"
            cleanup_old_logs "$LOG_DIR/lint-check.log"
            cleanup_old_logs "$LOG_DIR/worker.log"
            cleanup_opencode_logs
            cleanup_old_tasks
            cleanup_task_temp
            ;;
        strip-ansi)
            log_info "清理 ANSI 颜色码..."
            for f in "$LOG_DIR"/*.log; do
                if [ -f "$f" ]; then
                    strip_ansi "$f"
                fi
            done
            ;;
        status)
            log_info "日志状态:"
            echo "  日志文件:"
            ls -lh "$LOG_DIR"/*.log 2>/dev/null | awk '{print "    " $9 ": " $5}'
            echo "  轮转文件:"
            ls -lh "$LOG_DIR"/*.gz 2>/dev/null | awk '{print "    " $9 ": " $5}' || echo "    无"
            echo "  任务文件:"
            echo "    待处理: $(ls -1 "$TASKS_DIR"/*.task 2>/dev/null | wc -l || echo 0)"
            echo "    已完成: $(ls -1 "$TASKS_DIR/done/"*.task 2>/dev/null | wc -l || echo 0)"
            ;;
        *)
            echo "用法: $0 {rotate|cleanup|strip-ansi|status}"
            exit 1
            ;;
    esac
}

main "$@"

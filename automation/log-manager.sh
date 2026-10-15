#!/bin/bash
# /home/vitalgg/atlisp/automation/log-manager.sh
# 日志管理脚本 - 轮转、清理、压缩

set -e

WORK_DIR="/home/vitalgg/atlisp"
LOG_DIR="$WORK_DIR/logs"
TASKS_DIR="$WORK_DIR/tasks"

# 配置
MAX_LOG_SIZE=$((10 * 1024 * 1024))           # 10MB
MAX_LOG_FILES=5                              # 保留5个轮转文件
MAX_TASK_FILES=100                           # 保留100个任务文件（与 worker 主循环的保留量一致，
                                             # 避免裁剪 self-review 的 24h 统计窗口）
MAX_OPENCODE_LOGS=10                         # 保留最新10个 opencode-*.log
TEMP_KEEP_DAYS=1                             # 遗留临时文件保留天数

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
    
    local size
    size=$(stat -c%s "$logfile" 2>/dev/null || stat -f%z "$logfile" 2>/dev/null || echo 0)
    
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
        : > "$logfile"
        
        log_info "日志已轮转: $logfile.0.gz"
    fi
}

# 清理旧的日志轮转文件
cleanup_old_logs() {
    local logfile=$1
    local target

    for i in $(seq $MAX_LOG_FILES 10); do
        for target in "$logfile.$i.gz" "$logfile.$i"; do
            if [ -f "$target" ]; then
                rm -f "$target"
                log_info "删除旧轮转日志: $(basename "$target")"
            fi
        done
    done
}

# 列出所有日志基名（含仅剩轮转副本的日志，如 sync.log.6.gz 而 sync.log 已不存在）
list_log_basenames() {
    local f base
    for f in "$LOG_DIR"/*.log "$LOG_DIR"/*.log.* "$LOG_DIR"/*.gz; do
        [ -e "$f" ] || continue
        base=${f%.gz}
        base=$(printf '%s' "$base" | sed -E 's/\.[0-9]+$//')
        printf '%s\n' "$base"
    done | sort -u
}

# 清理 opencode 日志（保留最新的几个）
cleanup_opencode_logs() {
    local count
    count=$(ls -1 "$LOG_DIR"/opencode-*.log 2>/dev/null | wc -l || echo 0)
    
    if [ "$count" -gt "$MAX_OPENCODE_LOGS" ]; then
        ls -t "$LOG_DIR"/opencode-*.log | tail -n +$((MAX_OPENCODE_LOGS + 1)) | xargs -r rm -f
        log_info "清理 opencode 日志: 保留最新 $MAX_OPENCODE_LOGS 个"
    fi
}

# 清理旧任务文件
cleanup_old_tasks() {
    local done_count
    done_count=$(ls -1 "$TASKS_DIR/done/"*.task 2>/dev/null | wc -l || echo 0)
    
    if [ "$done_count" -gt "$MAX_TASK_FILES" ]; then
        ls -t "$TASKS_DIR/done/"*.task | tail -n +$((MAX_TASK_FILES + 1)) | xargs -r rm -f
        log_info "清理旧任务: 保留最新 $MAX_TASK_FILES 个"
    fi
    
    # 清理超大的任务文件（>100KB）
    find "$TASKS_DIR/done/" -name "*.task" -size +100k -exec rm -f {} \; 2>/dev/null || true
}

# 清理 tasks 目录中的孤儿临时文件。
# 注意：绝不能删除 *.task / *.task.running —— 那是待执行与挂起任务，
# 误删会静默丢任务（历史教训见 reports/self-review-*）。
cleanup_task_temp() {
    find "$TASKS_DIR/" -maxdepth 1 \
        \( -name '*.tmp' -o -name '*.tmp.*' -o -name '*.task.tmp*' \) \
        -mtime "+$TEMP_KEEP_DAYS" -exec rm -f {} \; 2>/dev/null || true
}

# 清理 call_opencode 等留下的遗留临时文件（进程异常退出时未自清理）
cleanup_leftover_temp() {
    find "$LOG_DIR" -maxdepth 1 \
        \( -name 'prompt-*' -o -name 'opencode-out-*' \) \
        -mtime "+$TEMP_KEEP_DAYS" -exec rm -f {} \; 2>/dev/null || true
    # 失败的文章草稿仅作排查用，保留 30 天
    find "$LOG_DIR" -maxdepth 1 -name 'article-failed-*.md' \
        -mtime +30 -exec rm -f {} \; 2>/dev/null || true
}

# 主函数
main() {
    case "${1:-cleanup}" in
        rotate)
            log_info "开始日志轮转..."
            # 轮转 logs/ 下所有日志（不再维护易漏项的硬编码清单）
            for f in "$LOG_DIR"/*.log; do
                [ -f "$f" ] || continue
                rotate_log "$f"
            done
            ;;
        cleanup)
            log_info "开始日志清理..."
            # 遍历所有日志基名（而非仅现存 *.log），确保孤儿轮转副本也被清理
            while IFS= read -r base; do
                cleanup_old_logs "$base"
            done < <(list_log_basenames)
            cleanup_opencode_logs
            cleanup_old_tasks
            cleanup_task_temp
            cleanup_leftover_temp
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
            local f sz
            echo "  日志文件:"
            for f in "$LOG_DIR"/*.log; do
                [ -f "$f" ] || continue
                sz=$(du -h "$f" 2>/dev/null | cut -f1)
                printf '    %s (%s)\n' "$(basename "$f")" "${sz:-?}"
            done
            echo "  轮转文件:"
            local found_gz=0
            for f in "$LOG_DIR"/*.gz "$LOG_DIR"/*.log.1; do
                [ -f "$f" ] || continue
                sz=$(du -h "$f" 2>/dev/null | cut -f1)
                printf '    %s (%s)\n' "$(basename "$f")" "${sz:-?}"
                found_gz=1
            done
            [ "$found_gz" -eq 1 ] || echo "    无"
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

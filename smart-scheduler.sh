#!/bin/bash

# @lisp 智能工作流调度器
# 用法: ./smart-scheduler.sh [命令] [选项]

set -e

TARGET_DIR="${HOME}/atlisp"
LOG_DIR="${TARGET_DIR}/logs"
QUEUE_FILE="${LOG_DIR}/task_queue.txt"
STATUS_FILE="${LOG_DIR}/task_status.txt"
ALERT_FILE="${LOG_DIR}/alerts.log"

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# 初始化
init() {
    mkdir -p "$LOG_DIR"
    touch "$QUEUE_FILE" "$STATUS_FILE" "$ALERT_FILE"
}

# 显示帮助
show_help() {
    echo -e "${BLUE}@lisp 智能工作流调度器${NC}"
    echo ""
    echo "用法: $0 [命令] [选项]"
    echo ""
    echo "命令:"
    echo "  add <任务名> <优先级> [依赖]   添加任务到队列"
    echo "  run                            执行任务队列"
    echo "  status                         查看任务状态"
    echo "  monitor                        实时监控面板"
    echo "  clear                          清空任务队列"
    echo "  retry <任务名>                 重试失败的任务"
    echo ""
    echo "优先级:"
    echo "  1 - 关键任务 (critical)"
    echo "  2 - 高优先级 (high)"
    echo "  3 - 中等优先级 (medium)"
    echo "  4 - 低优先级 (low)"
    echo "  5 - 后台任务 (background)"
    echo ""
    echo "示例:"
    echo "  $0 add sync 1                 添加同步任务（关键）"
    echo "  $0 add lint 2 sync            添加lint任务（高，依赖sync）"
    echo "  $0 add test 3 lint            添加测试任务（中，依赖lint）"
    echo "  $0 run                        执行所有任务"
}

# 添加任务到队列
add_task() {
    local task_name=$1
    local priority=$2
    local dependencies=${3:-""}
    
    if [ -z "$task_name" ] || [ -z "$priority" ]; then
        echo -e "${RED}错误: 任务名和优先级不能为空${NC}"
        return 1
    fi
    
    # 检查任务是否已存在
    if grep -q ":${task_name}:" "$QUEUE_FILE"; then
        echo -e "${YELLOW}警告: 任务 ${task_name} 已存在于队列中${NC}"
        return 0
    fi
    
    # 添加任务
    echo "${priority}:${task_name}:${dependencies}" >> "$QUEUE_FILE"
    
    # 按优先级排序
    sort -t: -k1 -n "$QUEUE_FILE" -o "$QUEUE_FILE"
    
    echo -e "${GREEN}任务 ${task_name} 已添加到队列 (优先级: ${priority})${NC}"
}

# 检查依赖
check_dependencies() {
    local deps=$1
    
    if [ -z "$deps" ]; then
        return 0
    fi
    
    IFS=',' read -ra DEPS <<< "$deps"
    for dep in "${DEPS[@]}"; do
        if ! grep -q "completed:${dep}:" "$STATUS_FILE"; then
            echo -e "${YELLOW}依赖未满足: ${dep}${NC}"
            return 1
        fi
    done
    
    return 0
}

# 执行任务
execute_task() {
    local task_name=$1
    
    echo -e "${BLUE}执行任务: ${task_name}${NC}"
    
    # 记录开始时间
    local start_time=$(date +%s)
    
    # 执行任务
    local result=0
    case $task_name in
        "sync")
            cd "$TARGET_DIR" && ./sync-all.sh
            ;;
        "lint")
            cd "$TARGET_DIR" && make lint
            ;;
        "test")
            cd "$TARGET_DIR" && make test
            ;;
        "docs")
            cd "$TARGET_DIR" && make docs
            ;;
        "suggestions")
            cd "$TARGET_DIR" && ./generate-suggestions.sh
            ;;
        "clean")
            cd "$TARGET_DIR" && make clean
            ;;
        *)
            echo -e "${RED}未知任务: ${task_name}${NC}"
            return 1
            ;;
    esac
    
    result=$?
    
    # 记录结束时间
    local end_time=$(date +%s)
    local duration=$((end_time - start_time))
    
    # 更新状态
    if [ $result -eq 0 ]; then
        echo "completed:${task_name}:${duration}:$(date)" >> "$STATUS_FILE"
        echo -e "${GREEN}任务 ${task_name} 完成 (耗时: ${duration}s)${NC}"
    else
        echo "failed:${task_name}:${duration}:$(date)" >> "$STATUS_FILE"
        echo -e "${RED}任务 ${task_name} 失败 (耗时: ${duration}s)${NC}"
    fi
    
    return $result
}

# 执行任务队列
run_queue() {
    echo -e "${BLUE}开始执行任务队列...${NC}"
    
    if [ ! -s "$QUEUE_FILE" ]; then
        echo -e "${YELLOW}任务队列为空${NC}"
        return 0
    fi
    
    while IFS=: read -r priority task_name dependencies; do
        echo ""
        echo -e "${BLUE}--- 处理任务: ${task_name} (优先级: ${priority}) ---${NC}"
        
        # 检查依赖
        if ! check_dependencies "$dependencies"; then
            echo -e "${YELLOW}跳过任务 ${task_name} (依赖未满足)${NC}"
            continue
        fi
        
        # 执行任务
        execute_task "$task_name"
        
        # 如果任务失败，记录并继续
        if [ $? -ne 0 ]; then
            echo "$(date): 任务 ${task_name} 失败" >> "$ALERT_FILE"
        fi
        
        # 从队列中移除已完成的任务
        sed -i "/:${task_name}:/d" "$QUEUE_FILE"
        
    done < "$QUEUE_FILE"
    
    echo ""
    echo -e "${GREEN}任务队列执行完成${NC}"
}

# 查看任务状态
show_status() {
    echo -e "${BLUE}=== 任务状态 ===${NC}"
    echo ""
    
    echo -e "${YELLOW}任务队列:${NC}"
    if [ -s "$QUEUE_FILE" ]; then
        while IFS=: read -r priority task_name dependencies; do
            echo "  ${task_name} (优先级: ${priority}, 依赖: ${dependencies:-无})"
        done < "$QUEUE_FILE"
    else
        echo "  队列为空"
    fi
    
    echo ""
    echo -e "${YELLOW}任务历史:${NC}"
    if [ -s "$STATUS_FILE" ]; then
        tail -10 "$STATUS_FILE" | while IFS=: read -r status task_name duration timestamp; do
            if [ "$status" = "completed" ]; then
                echo -e "  ${GREEN}✓${NC} ${task_name} (${duration}s) - ${timestamp}"
            else
                echo -e "  ${RED}✗${NC} ${task_name} (${duration}s) - ${timestamp}"
            fi
        done
    else
        echo "  暂无历史记录"
    fi
    
    echo ""
    echo -e "${YELLOW}统计:${NC}"
    local total=$(wc -l < "$STATUS_FILE" 2>/dev/null || echo 0)
    local completed=$(grep -c "completed" "$STATUS_FILE" 2>/dev/null || echo 0)
    local failed=$(grep -c "failed" "$STATUS_FILE" 2>/dev/null || echo 0)
    
    echo "  总任务: ${total}"
    echo "  完成: ${completed}"
    echo "  失败: ${failed}"
    if [ $total -gt 0 ]; then
        local success_rate=$((completed * 100 / total))
        echo "  成功率: ${success_rate}%"
    fi
}

# 实时监控面板
monitor() {
    echo -e "${BLUE}=== 实时监控面板 ===${NC}"
    echo ""
    echo "按 Ctrl+C 退出"
    echo ""
    
    while true; do
        clear
        echo -e "${BLUE}=== @lisp 智能工作流监控 ===${NC}"
        echo ""
        echo "时间: $(date)"
        echo ""
        
        # 系统状态
        echo -e "${YELLOW}系统状态:${NC}"
        echo "  磁盘使用: $(df -h / | awk 'NR==2{print $5}')"
        echo "  内存使用: $(free -h | awk 'NR==2{print $3"/"$2}')"
        echo "  负载: $(uptime | awk -F'load average:' '{print $2}')"
        echo ""
        
        # 任务队列
        echo -e "${YELLOW}任务队列:${NC}"
        if [ -s "$QUEUE_FILE" ]; then
            while IFS=: read -r priority task_name dependencies; do
                echo "  [${priority}] ${task_name}"
            done < "$QUEUE_FILE"
        else
            echo "  队列为空"
        fi
        echo ""
        
        # 最近任务
        echo -e "${YELLOW}最近任务:${NC}"
        if [ -s "$STATUS_FILE" ]; then
            tail -5 "$STATUS_FILE" | while IFS=: read -r status task_name duration timestamp; do
                if [ "$status" = "completed" ]; then
                    echo -e "  ${GREEN}✓${NC} ${task_name} (${duration}s)"
                else
                    echo -e "  ${RED}✗${NC} ${task_name} (${duration}s)"
                fi
            done
        fi
        
        sleep 5
    done
}

# 清空任务队列
clear_queue() {
    > "$QUEUE_FILE"
    echo -e "${GREEN}任务队列已清空${NC}"
}

# 重试失败的任务
retry_task() {
    local task_name=$1
    
    if [ -z "$task_name" ]; then
        echo -e "${RED}错误: 请指定任务名${NC}"
        return 1
    fi
    
    # 检查任务是否失败
    if grep -q "failed:${task_name}:" "$STATUS_FILE"; then
        echo -e "${BLUE}重试任务: ${task_name}${NC}"
        execute_task "$task_name"
    else
        echo -e "${YELLOW}任务 ${task_name} 没有失败记录${NC}"
    fi
}

# 主函数
main() {
    init
    
    case "${1:-}" in
        "add")
            add_task "$2" "$3" "$4"
            ;;
        "run")
            run_queue
            ;;
        "status")
            show_status
            ;;
        "monitor")
            monitor
            ;;
        "clear")
            clear_queue
            ;;
        "retry")
            retry_task "$2"
            ;;
        *)
            show_help
            ;;
    esac
}

main "$@"

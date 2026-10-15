#!/bin/bash
# /home/vitalgg/atlisp/automation/plan-manager.sh
# 计划管理工具

PLANS_DIR="/home/vitalgg/atlisp/plans"
PENDING_DIR="$PLANS_DIR/pending"
APPROVED_DIR="$PLANS_DIR/approved"
REJECTED_DIR="$PLANS_DIR/rejected"
ARCHIVE_DIR="$PLANS_DIR/archive"

# 初始化目录
init() {
    mkdir -p "$PENDING_DIR" "$APPROVED_DIR" "$REJECTED_DIR" "$ARCHIVE_DIR"
}

# 显示帮助
show_help() {
    echo "计划管理工具"
    echo ""
    echo "用法: $0 [命令]"
    echo ""
    echo "命令:"
    echo "  list              列出待审批计划"
    echo "  list-all          列出所有计划"
    echo "  show <plan-id>    查看计划详情"
    echo "  approve <plan-id> 批准计划"
    echo "  reject <plan-id>  拒绝计划"
    echo "  expire [days]     归档超过 N 天（默认 7）未审批的计划"
    echo "  archive           归档已处理计划"
    echo "  status            查看计划统计"
}

# 列出待审批计划
list_pending() {
    echo "=== 待审批计划 ==="
    echo ""
    
    local count=0
    for plan_file in "$PENDING_DIR"/*.plan; do
        [ -f "$plan_file" ] || continue
        
        local plan_id plan_name plan_priority plan_created
        plan_id=$(basename "$plan_file" .plan)
        plan_name=$(jq -r '.name' "$plan_file")
        plan_priority=$(jq -r '.priority' "$plan_file")
        plan_created=$(jq -r '.created' "$plan_file")
        
        echo "[$plan_id] $plan_name"
        echo "  优先级: $plan_priority"
        echo "  创建时间: $plan_created"
        echo ""
        
        count=$((count + 1))
    done
    
    if [ $count -eq 0 ]; then
        echo "没有待审批计划"
    else
        echo "共 $count 个待审批计划"
    fi
}

# 列出所有计划
list_all() {
    echo "=== 所有计划 ==="
    echo ""
    
    echo "待审批:"
    ls -1 "$PENDING_DIR"/*.plan 2>/dev/null | wc -l
    
    echo "已批准:"
    ls -1 "$APPROVED_DIR"/*.plan 2>/dev/null | wc -l
    
    echo "已拒绝:"
    ls -1 "$REJECTED_DIR"/*.plan 2>/dev/null | wc -l
}

# 查看计划详情
show_plan() {
    local plan_id=$1
    
    local plan_file
    plan_file=$(find "$PLANS_DIR" -name "$plan_id.plan" 2>/dev/null | head -1)
    
    if [ -z "$plan_file" ]; then
        echo "计划不存在: $plan_id"
        return 1
    fi
    
    echo "=== 计划详情 ==="
    echo ""
    jq '.' "$plan_file"
}

# 批准计划
approve_plan() {
    local plan_id=$1
    local comments=${2:-""}
    
    local plan_file="$PENDING_DIR/$plan_id.plan"
    
    if [ ! -f "$plan_file" ]; then
        echo "计划不存在: $plan_id"
        return 1
    fi
    
    # 注意: 用 --arg 传值，不能把 $comments 拼进 jq 程序（含引号会破坏或注入）
    jq --arg ts "$(date -Iseconds)" --arg c "$comments" \
        '.status = "approved" | .approved_at = $ts | .approved_comments = $c' \
        "$plan_file" > "$plan_file.tmp" && mv "$plan_file.tmp" "$plan_file"
    
    # 移动到已批准目录
    mv "$plan_file" "$APPROVED_DIR/"
    
    echo "已批准计划: $plan_id"
}

# 拒绝计划
reject_plan() {
    local plan_id=$1
    local reason=${2:-""}
    
    local plan_file="$PENDING_DIR/$plan_id.plan"
    
    if [ ! -f "$plan_file" ]; then
        echo "计划不存在: $plan_id"
        return 1
    fi
    
    # 更新状态
    jq --arg ts "$(date -Iseconds)" --arg r "$reason" \
        '.status = "rejected" | .rejected_at = $ts | .rejection_reason = $r' \
        "$plan_file" > "$plan_file.tmp" && mv "$plan_file.tmp" "$plan_file"
    
    # 移动到已拒绝目录
    mv "$plan_file" "$REJECTED_DIR/"
    
    echo "已拒绝计划: $plan_id"
}

# 查看统计
status() {
    echo "=== 计划统计 ==="
    echo ""
    echo "待审批: $(ls -1 "$PENDING_DIR"/*.plan 2>/dev/null | wc -l || echo 0)"
    echo "已批准: $(ls -1 "$APPROVED_DIR"/*.plan 2>/dev/null | wc -l || echo 0)"
    echo "已拒绝: $(ls -1 "$REJECTED_DIR"/*.plan 2>/dev/null | wc -l || echo 0)"
}

# 归档超过 N 天未审批的计划
expire_plans() {
    local days=${1:-7}
    local count=0 f
    while IFS= read -r f; do
        [ -f "$f" ] || continue
        if mv -f "$f" "$ARCHIVE_DIR/" 2>/dev/null; then
            echo "已归档过期计划: $(basename "$f")"
            count=$((count + 1))
        fi
    done < <(find "$PENDING_DIR" -maxdepth 1 -name '*.plan' -mtime "+$days" 2>/dev/null)
    echo "共归档 $count 个超过 $days 天未审批的计划"
}

# 主函数
init

case "${1:-}" in
    list)
        list_pending
        ;;
    list-all)
        list_all
        ;;
    show)
        show_plan "$2"
        ;;
    approve)
        approve_plan "$2" "$3"
        ;;
    reject)
        reject_plan "$2" "$3"
        ;;
    expire)
        expire_plans "$2"
        ;;
    status)
        status
        ;;
    *)
        show_help
        ;;
esac

#!/bin/bash
# /home/vitalgg/atlisp/automation/self-review.sh
# 汇总 atlisp-worker 自身近期工作指标，供 06:00 自我迭代分析使用。
# 用法: self-review.sh [输出文件]

set +e

WORK_DIR="${WORK_DIR:-/home/vitalgg/atlisp}"
LOG_DIR="$WORK_DIR/logs"
OUT="${1:-$LOG_DIR/self-review-input.md}"

SCHED="$LOG_DIR/schedule.json"
[ -s "$SCHED" ] || SCHED="$WORK_DIR/automation/schedule.json"

mkdir -p "$(dirname "$OUT")"

{
    echo "# atlisp-worker 自我工作分析输入"
    echo
    echo "- 生成时间: $(date -Iseconds)"
    echo

    echo "## 运行状态 (status.json)"
    if [ -f "$WORK_DIR/status.json" ]; then
        jq -r '"uptime=\(.uptime) active_ai=\(.active_ai) pending=\(.tasks.pending) running=\(.tasks.running) completed=\(.tasks.completed)"' \
            "$WORK_DIR/status.json" 2>/dev/null || echo "(解析失败)"
    else
        echo "(无)"
    fi
    echo

    echo "## 近 24 小时任务执行统计"
    # 滚动 24 小时窗口。运行中的 06:00/06:30 任务（self-review / introspection）
    # 尚未落盘，其最近记录来自前一日同一时刻，表内显式标注 (T-1) 以免趋势被整体读错一天。
    tmp=$(mktemp)
    recent_types=$(find "$WORK_DIR/tasks/done" -maxdepth 1 -name '*.task' -mmin -720 -print0 2>/dev/null \
        | xargs -0 -r jq -r '.type // empty' 2>/dev/null | sort -u | tr '\n' ' ')
    find "$WORK_DIR/tasks/done" -maxdepth 1 -name '*.task' -mmin -1440 -print0 2>/dev/null \
        | xargs -0 -r jq -r '[.type, .status, (.duration // 0), (.retry_count // 0), (.exit_code // 0)] | @tsv' \
            2>/dev/null > "$tmp"
    if [ -s "$tmp" ]; then
        echo "总计: $(wc -l < "$tmp") 个任务"
        echo "(窗口: 滚动 24 小时；标注 (T-1) 者最近一次记录距今 >12h，即本次运行尚在进行)"
        echo
        echo "| 类型 | 次数 | 完成 | 失败 | 平均耗时(s) | 最大耗时(s) | 重试合计 |"
        echo "|---|---|---|---|---|---|---|"
        awk -F'\t' -v recent=" $recent_types " '
            {c[$1]++; if($2=="completed")ok[$1]++; else fa[$1]++;
             d[$1]+=$3; if($3>m[$1])m[$1]=$3; r[$1]+=$4}
            END{for(t in c) { mark = (index(recent, " " t " ") > 0) ? "" : " (T-1)";
                 printf "| %s%s | %d | %d | %d | %d | %d | %d |\n",
                 t, mark, c[t], ok[t]+0, fa[t]+0, (d[t]/c[t]), m[t]+0, r[t]+0}}' "$tmp" | sort
        echo
        echo "### 失败/超时明细（exit=124 表示超时）"
        # 截断必须显式标注（教训 [2026-10-20]）：head -30 之外若还有失败，消费端须知情
        fail_total=$(awk -F'\t' '$2!="completed"' "$tmp" | wc -l)
        awk -F'\t' '$2!="completed"{printf "- %s exit=%s retries=%s\n", $1, $5, $4}' "$tmp" | head -30
        [ "$fail_total" -gt 30 ] && echo "(截断: 仅显示前 30 条/共 $fail_total 条, 全量明细见 tasks/done/*.task)"
    else
        echo "(近 24 小时无已完成任务)"
    fi
    rm -f "$tmp"
    echo

    echo "## 当前调度 (schedule)"
    echo "来源: $SCHED"
    echo
    echo "| 时间 | 日期 | 类型 | 名称 | 优先级 | 状态 |"
    echo "|---|---|---|---|---|---|"
    jq -r '.tasks[] | "| \(.time) | \(.days // "*") | \(.type) | \(.name) | p\(.priority // 5) | \(if (has("enabled") and (.enabled|not)) then "off" else "on" end) |"' \
        "$SCHED" 2>/dev/null || echo "(解析失败)"
    echo

    echo "## 近期错误 (worker.log)"
    # 截断必须显式标注（教训 [2026-10-20]）：tail -20 之外的错误总数须知情
    err_total=$(grep -ac '\[ERROR\]' "$LOG_DIR/worker.log" 2>/dev/null)
    err_total=${err_total:-0}
    grep -a '\[ERROR\]' "$LOG_DIR/worker.log" 2>/dev/null | tail -20
    [ "$err_total" -gt 20 ] && echo "(截断: 仅显示最近 20 条/共 $err_total 条, 全量日志见 $LOG_DIR/worker.log)"
    echo

    echo "## lint 汇总 (lint-check.log)"
    # 截断必须显式标注（教训 [2026-10-20]）：tail -3 之外的记录总数须知情
    lint_total=$(grep -acE '个错误|个警告' "$LOG_DIR/lint-check.log" 2>/dev/null)
    lint_total=${lint_total:-0}
    grep -aE '个错误|个警告' "$LOG_DIR/lint-check.log" 2>/dev/null | tail -3
    [ "$lint_total" -gt 3 ] && echo "(截断: 仅显示最近 3 条/共 $lint_total 条, 全量日志见 $LOG_DIR/lint-check.log)"
    echo

    echo "## 计划与报告"
    echo "- pending plans: $(ls -1 "$WORK_DIR/plans/pending"/*.plan 2>/dev/null | wc -l)"
    echo "- approved plans: $(ls -1 "$WORK_DIR/plans/approved"/*.plan 2>/dev/null | wc -l)"
    echo "- 最近 reports:"
    ls -t "$WORK_DIR/reports" 2>/dev/null | head -8 | sed 's/^/  - /'
    echo

    echo "## 日志体积"
    # sort 输出可能因 head 提前关闭管道而产生 SIGPIPE 噪声，静默其 stderr
    du -sh "$LOG_DIR"/*.log 2>/dev/null | sort -rh 2>/dev/null | head -8
} > "$OUT" 2>&1

echo "$OUT"

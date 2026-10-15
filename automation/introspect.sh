#!/bin/bash
# /home/vitalgg/atlisp/automation/introspect.sh
# 汇总 atlisp-worker 自身的决策与反思输入，供 ai-introspect 自省任务使用。
# 与 self-review.sh（量化指标）互补：本脚本聚焦"决策过程"——
# 调度调整是否有效、失败是否重蹈覆辙、既有自省教训是否被落实。
# 用法: introspect.sh [输出文件]

set +e

WORK_DIR="${WORK_DIR:-/home/vitalgg/atlisp}"
LOG_DIR="$WORK_DIR/logs"
OUT="${1:-$LOG_DIR/introspect-input.md}"
INTRO_DIR="$WORK_DIR/reports/introspection"
LESSONS="$INTRO_DIR/lessons.md"

SCHED="$LOG_DIR/schedule.json"
[ -s "$SCHED" ] || SCHED="$WORK_DIR/automation/schedule.json"

today=$(date +%F)
yest=$(date -d yesterday +%F 2>/dev/null || echo "")

mkdir -p "$(dirname "$OUT")"

{
    echo "# atlisp-worker 自省输入"
    echo
    echo "- 生成时间: $(date -Iseconds)"
    echo

    echo "## 最近自我迭代报告 (self-review)"
    latest_review=$(ls -t "$WORK_DIR/reports"/self-review-*.md 2>/dev/null | head -1)
    if [ -n "$latest_review" ] && [ -f "$latest_review" ]; then
        echo "文件: $latest_review ($(date -r "$latest_review" '+%Y-%m-%d %H:%M'))"
        echo
        head -c 6000 "$latest_review"
    else
        echo "(无)"
    fi
    echo
    echo

    echo "## 最近自省报告 (introspection)"
    latest_intro=$(ls -t "$INTRO_DIR"/introspection-*.md 2>/dev/null | head -1)
    if [ -n "$latest_intro" ] && [ -f "$latest_intro" ]; then
        echo "文件: $latest_intro ($(date -r "$latest_intro" '+%Y-%m-%d %H:%M'))"
        echo
        head -c 4000 "$latest_intro"
    else
        echo "(无——这是首次自省，无历史教训可对照)"
    fi
    echo
    echo

    echo "## 既有教训记忆 (lessons.md)"
    if [ -s "$LESSONS" ]; then
        echo "条目数: $(grep -c '^- \[' "$LESSONS" 2>/dev/null)"
        echo
        head -c 6000 "$LESSONS"
    else
        echo "(空——尚无沉淀的教训)"
    fi
    echo
    echo

    echo "## 调度变更历史 (logs/schedule-history/)"
    hist=$(ls -t "$LOG_DIR/schedule-history"/schedule-*.json 2>/dev/null | head -5)
    if [ -n "$hist" ]; then
        echo "$hist" | while read -r h; do
            echo "- $(date -r "$h" '+%Y-%m-%d %H:%M')  $(basename "$h")  (任务数: $(jq '.tasks | length' "$h" 2>/dev/null))"
        done
        echo
        echo "当前生效调度 vs 最近一次历史备份（任务差异）:"
        newest_hist=$(echo "$hist" | head -1)
        diff <(jq -r '.tasks[] | "\(.id) \(.time) \(.type) \(.days // "*") \(.enabled // true)"' "$newest_hist" 2>/dev/null | sort) \
             <(jq -r '.tasks[] | "\(.id) \(.time) \(.type) \(.days // "*") \(.enabled // true)"' "$SCHED" 2>/dev/null | sort) \
             2>/dev/null | head -20 || true
    else
        echo "(无——尚未发生自我迭代调度调整)"
    fi
    echo
    echo

    echo "## 被拒绝的候选调度 (logs/schedule-rejected-*.json)"
    rejected=$(ls -t "$LOG_DIR"/schedule-rejected-*.json 2>/dev/null | head -2)
    if [ -n "$rejected" ]; then
        echo "$rejected" | while read -r r; do
            echo "- $(date -r "$r" '+%Y-%m-%d %H:%M')  $(basename "$r")"
            head -c 1500 "$r"
            echo
        done
    else
        echo "(无——所有候选调度均通过校验)"
    fi
    echo
    echo

    echo "## 近 24 小时错误 (worker.log)"
    err_count=$(grep -a '\[ERROR\]' "$LOG_DIR/worker.log" 2>/dev/null | awk -v t="$today" -v y="$yest" 'index($0,t)>0 || index($0,y)>0' | wc -l)
    echo "错误条数: $err_count"
    grep -a '\[ERROR\]' "$LOG_DIR/worker.log" 2>/dev/null \
        | awk -v t="$today" -v y="$yest" 'index($0,t)>0 || index($0,y)>0' | tail -15
    echo
    echo

    echo "## 近 24 小时失败任务 (tasks/done)"
    tmp=$(mktemp)
    find "$WORK_DIR/tasks/done" -maxdepth 1 -name '*.task' -mmin -1440 -print0 2>/dev/null \
        | xargs -0 -r jq -r 'select(.status != "completed") | [.type, .exit_code // 0, .retry_count // 0] | @tsv' \
        2>/dev/null > "$tmp"
    if [ -s "$tmp" ]; then
        echo "失败任务数: $(wc -l < "$tmp")"
        awk -F'\t' '{c[$1]++} END{for(t in c) printf "- %s: %d 次\n", t, c[t]}' "$tmp" | sort
    else
        echo "(无)"
    fi
    rm -f "$tmp"
    echo
} > "$OUT" 2>&1

echo "$OUT"

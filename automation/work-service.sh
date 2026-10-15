#!/bin/bash
# /home/vitalgg/atlisp/automation/work-service.sh
# Automated employee main service script - auto-listen and execute tasks

# Note: No set -e to avoid background task crashes killing the whole service

# ---- Configuration ----
WORK_DIR="/home/vitalgg/atlisp"
export WORK_DIR   # 子脚本（self-review.sh / introspect.sh 等）继承同一工作目录
LOG_DIR="$WORK_DIR/logs"
STATUS_FILE="$WORK_DIR/status.json"
PLANS_DIR="$WORK_DIR/plans"
PENDING_DIR="$PLANS_DIR/pending"
APPROVED_DIR="$PLANS_DIR/approved"
REJECTED_DIR="$PLANS_DIR/rejected"
ARCHIVE_DIR="$PLANS_DIR/archive"
PID_FILE="/tmp/atlisp-worker.pid"
LOCK_FILE="/tmp/atlisp-worker.lock"
WATCH_PID_FILE="/tmp/atlisp-worker-watch.pid"

# vllm service configuration
VLLM_REQUIRED="${VLLM_REQUIRED:-true}"
VLLM_CHECK_SCRIPT="$WORK_DIR/automation/check-vllm.sh"
VLLM_WAIT_TIMEOUT="${VLLM_WAIT_TIMEOUT:-60}"

# Concurrency limits
MAX_CONCURRENT="${MAX_CONCURRENT:-3}"
MAX_WORK_CONCURRENT="${MAX_WORK_CONCURRENT:-2}"

# Timeouts and retries
STALE_TASK_TIMEOUT="${STALE_TASK_TIMEOUT:-86400}"
AI_TASK_TIMEOUT="${AI_TASK_TIMEOUT:-1800}"
# 重型 AI 任务（全项目分析/长文写作）使用更长超时，避免 exit 124
AI_LONG_TASK_TIMEOUT="${AI_LONG_TASK_TIMEOUT:-3600}"
MAX_RETRY="${MAX_RETRY:-2}"
WEBHOOK_URL="${WEBHOOK_URL:-}"

# Dedup / throttle
AI_FIX_ALL_COOLDOWN="${AI_FIX_ALL_COOLDOWN:-1800}"
WATCH_THROTTLE="${WATCH_THROTTLE:-300}"

# 全量 lint 巡检间隔（秒）。全量 lint 开销大且长期零信息增量（144 次/天、
# 0 错误 + 只有警告漂移），默认降至 1 小时一次（见 reports/self-review-*）。
QUALITY_CHECK_INTERVAL="${QUALITY_CHECK_INTERVAL:-3600}"

# Log rotation
LOG_ROTATE_SIZE="${LOG_ROTATE_SIZE:-10485760}"

# Plan expiry (days)
PLAN_MAX_AGE_DAYS="${PLAN_MAX_AGE_DAYS:-7}"

# ---- PID tracking ----
AI_PIDS=()
WORK_PIDS=()
WATCH_PID=""
QUALITY_PID=""
LAST_WATCH_TASK_TS=0

reap_pids() {
    local -n _pids=$1
    local pid new_pids=()
    for pid in "${_pids[@]}"; do
        if kill -0 "$pid" 2>/dev/null; then
            new_pids+=("$pid")
        fi
    done
    _pids=("${new_pids[@]}")
}
reap_ai()  { reap_pids AI_PIDS; }
reap_work() { reap_pids WORK_PIDS; }

# ---- Logging ----
log_info()  { echo "[INFO]  $(date '+%Y-%m-%d %H:%M:%S') $1" >> "$LOG_DIR/worker.log"; }
log_warn()  { echo "[WARN]  $(date '+%Y-%m-%d %H:%M:%S') $1" >> "$LOG_DIR/worker.log"; }
log_error() { echo "[ERROR] $(date '+%Y-%m-%d %H:%M:%S') $1" | tee -a "$LOG_DIR/worker.log" >&2; }

rotate_log() {
    local f size
    for f in "$LOG_DIR"/*.log; do
        [ -f "$f" ] || continue
        size=$(stat -c %s "$f" 2>/dev/null || echo 0)
        [ "$size" -gt "$LOG_ROTATE_SIZE" ] || continue
        # 保留一个历史备份（覆盖旧备份），并截断当前文件避免无限增长
        mv -f "$f" "${f}.1" 2>/dev/null || continue
        : > "$f"
        log_info "Log rotated: $(basename "$f") (${size} bytes)"
    done
}

# ---- Webhook notification (safe JSON via jq) ----
send_notification() {
    local title=$1
    local message=$2
    local level=${3:-info}
    [ -z "$WEBHOOK_URL" ] && return 0
    local payload
    payload=$(jq -n \
        --arg t "$title" \
        --arg m "$message" \
        --arg l "$level" \
        --arg h "$(hostname)" \
        --arg ts "$(date -Iseconds)" \
        '{title:$t, message:$m, level:$l, timestamp:$ts, hostname:$h, service:"atlisp-worker"}')
    curl -s --max-time 10 -X POST "$WEBHOOK_URL" \
        -H "Content-Type: application/json" \
        -d "$payload" \
        > /dev/null 2>&1 9>&- &
}

# ---- opencode CLI 兼容性 ----
# opencode 会自动升级（配置 autoupdate=true），CLI 参数偶有变更：
# v2.0 起 `opencode run` 不再接受 `--pure`，带上它会在 10 秒内以 exit 1 失败，
# 使全部 AI 任务静默失效。这里集中声明参数并在启动时预检。
OPENCODE_FLAGS=(--auto)

check_opencode_cli() {
    if ! command -v opencode > /dev/null 2>&1; then
        log_error "opencode 未安装或不在 PATH，AI 任务不可用"
        return 1
    fi

    local help flag
    help=$(opencode run --help 2>&1 || true)
    for flag in "${OPENCODE_FLAGS[@]}"; do
        if ! grep -q -- "$flag" <<< "$help"; then
            log_error "opencode run 不支持参数 $flag（CLI 版本变更？），AI 任务将全部失败"
            send_notification "opencode CLI 参数不兼容" \
                "opencode run 不再支持 $flag，AI 任务会全部失败，请更新 automation/work-service.sh 的 OPENCODE_FLAGS" \
                "error"
            return 1
        fi
    done
    log_info "opencode CLI 预检通过: $(opencode --version 2>/dev/null || echo unknown)"
    return 0
}

# ---- vllm service check ----
check_vllm_service() {
    if [ "$VLLM_REQUIRED" != "true" ]; then
        log_info "vllm check disabled"
        return 0
    fi
    if [ ! -x "$VLLM_CHECK_SCRIPT" ]; then
        log_error "vllm check script missing: $VLLM_CHECK_SCRIPT"
        return 1
    fi
    if ! "$VLLM_CHECK_SCRIPT" check > /dev/null 2>&1; then
        log_warn "vllm not ready, waiting..."
        if ! "$VLLM_CHECK_SCRIPT" wait "$VLLM_WAIT_TIMEOUT" 5; then
            log_error "vllm startup timed out"
            return 1
        fi
    fi
    log_info "vllm service ready"
    return 0
}

# ---- Init ----
init() {
    mkdir -p "$LOG_DIR" "$WORK_DIR/tasks/done" "$WORK_DIR/events" \
             "$PENDING_DIR" "$APPROVED_DIR" "$REJECTED_DIR" "$ARCHIVE_DIR"

    # 初始化生效调度（首次从默认复制，便于查看与自我迭代）
    if [ -n "$SCHEDULE_ACTIVE" ] && [ ! -s "$SCHEDULE_ACTIVE" ] && [ -s "$SCHEDULE_DEFAULT" ]; then
        cp -f "$SCHEDULE_DEFAULT" "$SCHEDULE_ACTIVE" 2>/dev/null || true
    fi
    [ -n "$SCHEDULE_HISTORY_DIR" ] && mkdir -p "$SCHEDULE_HISTORY_DIR"

    exec 9>"$LOCK_FILE"
    if ! flock -n 9; then
        echo "[ERROR] $(date '+%Y-%m-%d %H:%M:%S') Another worker instance is running, exiting." >> "$LOG_DIR/worker.log"
        exit 1
    fi

    echo $$ > "$PID_FILE"
    rm -f "$LOG_DIR"/oc-*.pid
    log_info "Service started (PID: $$)"

    if [ -f "$WATCH_PID_FILE" ]; then
        local old_watch
        old_watch=$(cat "$WATCH_PID_FILE" 2>/dev/null)
        if [ -n "$old_watch" ] && kill -0 "$old_watch" 2>/dev/null; then
            pkill -TERM -P "$old_watch" 2>/dev/null || true
            kill -TERM "$old_watch" 2>/dev/null || true
        fi
        rm -f "$WATCH_PID_FILE"
    fi

    local stale
    for stale in "$WORK_DIR/tasks"/*.task.running; do
        [ -f "$stale" ] || continue
        mv "$stale" "${stale%.running}"
        log_info "Recovered stuck task: $(basename "$stale")"
    done

    check_vllm_service
    check_opencode_cli
}

# ---- Cleanup ----
cleanup() {
    log_info "Service stopping"
    local f oc
    for f in "$LOG_DIR"/oc-*.pid; do
        [ -e "$f" ] || continue
        oc=$(cat "$f" 2>/dev/null)
        if [ -n "$oc" ]; then
            kill -TERM -- "-$oc" 2>/dev/null || true
        fi
    done
    sleep 2
    for f in "$LOG_DIR"/oc-*.pid; do
        [ -e "$f" ] || continue
        oc=$(cat "$f" 2>/dev/null)
        if [ -n "$oc" ]; then
            kill -KILL -- "-$oc" 2>/dev/null || true
        fi
    done
    rm -f "$LOG_DIR"/oc-*.pid
    if [ -n "$WATCH_PID" ] && kill -0 "$WATCH_PID" 2>/dev/null; then
        pkill -TERM -P "$WATCH_PID" 2>/dev/null || true
        kill -TERM "$WATCH_PID" 2>/dev/null || true
    fi
    rm -f "$WATCH_PID_FILE"
    if [ -n "$QUALITY_PID" ] && kill -0 "$QUALITY_PID" 2>/dev/null; then
        pkill -TERM -P "$QUALITY_PID" 2>/dev/null || true
        kill -TERM "$QUALITY_PID" 2>/dev/null || true
    fi
    local pid
    for pid in "${AI_PIDS[@]}" "${WORK_PIDS[@]}"; do
        pkill -TERM -P "$pid" 2>/dev/null || true
        kill -TERM "$pid" 2>/dev/null || true
    done
    rm -f "$PID_FILE"
    exit 0
}

trap cleanup SIGTERM SIGINT

# ---- Task helpers ----

generate_task_id() { date +%s%N; }

has_pending_task() {
    local task_type=$1
    local f
    for f in "$WORK_DIR/tasks"/*.task "$WORK_DIR/tasks"/*.task.running; do
        [ -f "$f" ] || continue
        # 用 grep 按行锚定读取 type（create_task 写出的是逐字段一行的 JSON），
        # 避免每个文件启动一个 jq 进程；行锚定可防止匹配到 name/data 里的同名子串
        grep -qE "^[[:space:]]*\"type\"[[:space:]]*:[[:space:]]*\"$task_type\"" "$f" 2>/dev/null && return 0
    done
    return 1
}

has_recent_done_task() {
    local task_type=$1
    local max_age=${2:-$AI_FIX_ALL_COOLDOWN}
    local mins=$(( max_age / 60 + 1 ))
    local f
    # 先用 find 按时间窗过滤（廉价），再逐文件 grep type；
    # 避免对上百个 done 任务逐个启动 jq（原实现一次调用上百进程）
    while IFS= read -r f; do
        [ -f "$f" ] || continue
        grep -qE "^[[:space:]]*\"type\"[[:space:]]*:[[:space:]]*\"$task_type\"" "$f" 2>/dev/null && return 0
    done < <(find "$WORK_DIR/tasks/done" -maxdepth 1 -name '*.task' -mmin "-$mins" 2>/dev/null)
    return 1
}

create_task() {
    local name=$1
    local type=$2
    local priority=${3:-5}
    local data=${4:-""}

    local task_id
    task_id=$(generate_task_id)
    local task_file="$WORK_DIR/tasks/$task_id.task"

    local escaped_name escaped_data
    escaped_name=$(printf '%s' "$name" | tr '\n' ' ' | sed 's/\\/\\\\/g; s/"/\\"/g; s/\t/\\t/g')
    escaped_data=$(printf '%s' "$data" | sed 's/\\/\\\\/g; s/"/\\"/g; s/\t/\\t/g' | tr '\n' ' ')

    local task_tmp="${task_file}.tmp.$$"
    cat > "$task_tmp" <<EOF
{
    "id": "$task_id",
    "name": "$escaped_name",
    "type": "$type",
    "priority": $priority,
    "data": "$escaped_data",
    "status": "pending",
    "created": "$(date -Iseconds)"
}
EOF
    mv "$task_tmp" "$task_file"

    log_info "Created task: $name ($task_id)"
}

update_status() {
    local task_pending task_running task_done task_total
    task_pending=$(ls "$WORK_DIR/tasks"/*.task 2>/dev/null | wc -l)
    task_running=$(ls "$WORK_DIR/tasks"/*.task.running 2>/dev/null | wc -l)
    task_done=$(ls "$WORK_DIR/tasks/done"/*.task 2>/dev/null | wc -l)
    task_total=$((task_pending + task_running + task_done))

    local active_ai=${#AI_PIDS[@]}

    cat > "$STATUS_FILE" <<EOF
{
    "timestamp": "$(date -Iseconds)",
    "pid": $$,
    "status": "running",
    "uptime": "$(ps -p $$ -o etime= 2>/dev/null || echo '0:00')",
    "active_ai": $active_ai,
    "tasks": {
        "pending": $task_pending,
        "running": $task_running,
        "completed": $task_done,
        "total": $task_total
    }
}
EOF
}

# ---- Call opencode AI ----
call_opencode() {
    local prompt=$1
    local task_id=$2
    local task_timeout=${3:-$AI_TASK_TIMEOUT}

    if [ "$VLLM_REQUIRED" = "true" ]; then
        if ! "$VLLM_CHECK_SCRIPT" check > /dev/null 2>&1; then
            log_error "vllm unavailable, skipping AI task"
            return 1
        fi
    fi

    local prompt_bytes
    prompt_bytes=$(printf '%s' "$prompt" | wc -c)
    if [ "$prompt_bytes" -gt 100000 ]; then
        local prompt_file
        prompt_file=$(mktemp "$LOG_DIR/prompt-XXXXXX")
        printf '%s' "$prompt" > "$prompt_file"
        log_warn "Prompt too long (${prompt_bytes} bytes), saved to $prompt_file"
        prompt="Your task description is long. First read $prompt_file in full, then follow the instructions in the file."
    fi

    log_info "Calling opencode: ${prompt:0:200}"

    local out_file start_ts rc opencode_pid
    out_file=$(mktemp "$LOG_DIR/opencode-out-XXXXXX")
    start_ts=$(date +%s)

    setsid timeout "$task_timeout" opencode run "$prompt" "${OPENCODE_FLAGS[@]}" > "$out_file" 2>&1 9>&- &
    opencode_pid=$!
    echo "$opencode_pid" > "$LOG_DIR/oc-$opencode_pid.pid"

    while kill -0 "$opencode_pid" 2>/dev/null; do
        local elapsed=$(( $(date +%s) - start_ts ))
        if [ "$elapsed" -ge "$task_timeout" ]; then
            log_error "AI task timed out (${elapsed}s), killing process group $opencode_pid"
            kill -TERM -- "-$opencode_pid" 2>/dev/null || true
            sleep 3
            kill -KILL -- "-$opencode_pid" 2>/dev/null || true
            rc=124
            break
        fi
        sleep 5
    done

    if [ "${rc:-0}" -ne 124 ]; then
        wait "$opencode_pid" 2>/dev/null
        rc=$?
    fi

    local result
    result=$(cat "$out_file" 2>/dev/null)
    rm -f "$out_file"

    if [ "$rc" -eq 124 ]; then
        log_error "AI task killed (timeout)"
    elif [ "$rc" -eq 143 ]; then
        log_info "AI task stopped (service shutdown)"
    elif [ "$rc" -ne 0 ]; then
        log_error "opencode exited abnormally (exit code $rc)"
        # CLI 参数被拒绝时立刻点名原因，避免"快速失败"被误读为正常回落
        if grep -qi 'Unrecognized flag' <<< "$result"; then
            log_error "opencode 拒绝 CLI 参数（疑似 opencode 升级），请核对 OPENCODE_FLAGS"
        fi
    else
        log_info "opencode completed"
    fi

    if [ -n "$task_id" ]; then
        echo "$result" > "$LOG_DIR/opencode-$task_id.log"
    fi

    rm -f "$LOG_DIR/oc-$opencode_pid.pid"
    return "${rc:-0}"
}

# ---- Execute a single task ----
execute_task() {
    local task_file=$1
    local task_type task_name task_data task_id start_time
    task_type=$(jq -r '.type' "$task_file")
    task_name=$(jq -r '.name' "$task_file")
    task_data=$(jq -r '.data // empty' "$task_file")
    task_id=$(jq -r '.id' "$task_file")
    start_time=$(date +%s)

    if ! mv "$task_file" "${task_file}.running" 2>/dev/null; then
        log_info "Task already claimed, skipping: $task_name"
        return 0
    fi
    local work_file="${task_file}.running"

    log_info "Executing: $task_name"

    local exit_code=0
    local plan_result plan_rc

    case $task_type in
        "sync")
            cd "$WORK_DIR" && "$WORK_DIR/sync-all.sh" >> "$LOG_DIR/sync.log" 2>&1 || exit_code=$?
            ;;
        "lint")
            cd "$WORK_DIR" && make lint >> "$LOG_DIR/lint.log" 2>&1 || exit_code=$?
            ;;
        "optimize")
            if [ -n "$task_data" ]; then
                cd "$WORK_DIR" && "$WORK_DIR/automation/optimize-code.sh" "$task_data" >> "$LOG_DIR/optimize.log" 2>&1 || exit_code=$?
            else
                cd "$WORK_DIR" && "$WORK_DIR/automation/optimize-code.sh" >> "$LOG_DIR/optimize.log" 2>&1 || exit_code=$?
            fi
            ;;
        "generate")
            cd "$WORK_DIR" && "$WORK_DIR/generate-suggestions.sh" >> "$LOG_DIR/suggestions.log" 2>&1 || exit_code=$?
            ;;
        "docs")
            cd "$WORK_DIR" && make docs >> "$LOG_DIR/docs.log" 2>&1 || exit_code=$?
            ;;
        "full-check")
            cd "$WORK_DIR" && make full-check >> "$LOG_DIR/full-check.log" 2>&1 || exit_code=$?
            ;;
        "clean")
            ( cd "$WORK_DIR" && make clean ) >> "$LOG_DIR/clean.log" 2>&1 || exit_code=$?
            # 日志清理接线：opencode-*.log 等运行时日志无界增长（无清理预案则只能靠人工）
            bash "$WORK_DIR/automation/log-manager.sh" cleanup >> "$LOG_DIR/clean.log" 2>&1 || true
            ;;
        "ai-fix")
            if [ -f "$task_data" ]; then
                call_opencode "请读取文件 $task_data 中的错误信息，修复其中所有问题" "$task_id" || exit_code=$?
            else
                call_opencode "请修复以下问题：$task_data" "$task_id" || exit_code=$?
            fi
            ;;
        "ai-review")
            call_opencode "请审查 $task_data 的代码质量，包括：代码规范、性能、可维护性" "$task_id" || exit_code=$?
            ;;
        "ai-optimize")
            call_opencode "请优化 $task_data 的性能，包括：算法优化、内存优化、执行效率" "$task_id" || exit_code=$?
            ;;
        "ai-suggest")
            local suggest_file dev_report dev_date
            suggest_file="$WORK_DIR/reports/ai-suggestions-$(date +%Y%m%d).md"
            mkdir -p "$WORK_DIR/reports"
            if [ -s "$suggest_file" ]; then
                # 去重：当天报告已生成则跳过，避免重复生成与重复邮件
                log_info "AI 建议报告已存在，跳过: $suggest_file"
            else
                # 互证：始终引用最新一份实测报告，避免跨日日期错配
                dev_report=$(ls -t "$WORK_DIR/reports"/dev-suggestions-*.md 2>/dev/null | head -1)
                if [ -n "$dev_report" ] && [ -f "$dev_report" ]; then
                    dev_date=$(date -r "$dev_report" '+%Y-%m-%d %H:%M')
                else
                    dev_report="（暂无实测报告）"
                    dev_date=""
                fi
                # shellcheck disable=SC1111  # 以下中文引号“”属提示词正文，非误写
                call_opencode "请分析 $task_data 的现状（README/AGENTS.md/代码结构与已有能力），提出【改进型建议】，重点是【新功能与能力扩展】方向：
1. 可新增的功能模块（面向 CAD 用户、@lisp 函数库/应用包、AI 与自动化能力等增量方向）
2. 现有能力的增强点（使用体验、性能、覆盖面、兼容性）
3. 与现有架构契合的扩展路径与落地步骤
【相互印证（必做）】先阅读最新实测报告 $dev_report（生成于 $dev_date；若为“（暂无实测报告）”则忽略此项），
以其量化结论（lint 问题数、测试覆盖、技术债、未提交变更）为依据；每条建议须引用该报告的对应指标或条目编号，
不得与其矛盾；若实测报告指出的错误级问题影响某建议，请在该建议中标注依赖关系。
要求：建议必须具体、可落地，结合项目现状说明理由；每条包含 —— 名称、价值/收益、实现要点、工作量（S/M/L）、优先级（高/中/低）。以 Markdown 清单输出，按优先级排序，避免泛泛而谈与纯代码风格类意见。
最后必须：把完整报告写入文件 $suggest_file（Markdown，含标题与生成时间），并在回答末尾给出该文件路径。" "$task_id" "$AI_LONG_TASK_TIMEOUT" || exit_code=$?
                if [ ! -s "$suggest_file" ]; then
                    log_warn "AI 未写出报告文件，回退保存去 ANSI 的会话输出"
                    sed 's/\x1b\[[0-9;]*m//g' "$LOG_DIR/opencode-$task_id.log" > "$suggest_file" 2>/dev/null || true
                fi
                if [ -s "$suggest_file" ]; then
                    log_info "AI 建议报告: $suggest_file"
                    # 邮件通知（本任务的职责；dev-suggestions 不再发邮件）
                    if [ -f "${HOME}/.atlisp-email-config" ]; then
                        if (
                            source "${HOME}/.atlisp-email-config"
                            export EMAIL_PASSWORD
                            python3 "$WORK_DIR/notify-email.py" --report "$suggest_file" --title "@lisp AI 改进建议"
                        ) >> "$LOG_DIR/suggestions.log" 2>&1; then
                            log_info "AI 建议报告邮件已发送"
                        else
                            log_warn "AI 建议报告邮件发送失败（见 logs/suggestions.log）"
                        fi
                    else
                        log_warn "未配置 ~/.atlisp-email-config，跳过邮件通知"
                    fi
                else
                    log_error "AI 建议报告生成失败（无输出）"
                fi
            fi
            ;;
        "ai-plan")
            plan_result=""
            local dup_plan
            dup_plan=""
            for _f in "$PLANS_DIR/pending"/*.plan; do
                [ -f "$_f" ] || continue
                if [ "$(jq -r '.name' "$_f" 2>/dev/null)" = "AI计划: $task_data" ]; then
                    dup_plan="$_f"
                    break
                fi
            done
            if [ -n "$dup_plan" ]; then
                log_info "已存在同名待审批计划，跳过生成: $(basename "$dup_plan")"
            else
                call_opencode "请为 $task_data 制定详细的开发计划，包括：目标、步骤、时间估算，以JSON格式输出" "$task_id" "$AI_LONG_TASK_TIMEOUT"
                plan_rc=$?
                plan_result=$(cat "$LOG_DIR/opencode-$task_id.log" 2>/dev/null)
                if [ "$plan_rc" -ne 0 ] || [ -z "$plan_result" ]; then
                    log_error "AI plan generation failed (exit code $plan_rc)"
                    exit_code=$plan_rc
                else
                    local plan_id plan_file
                    plan_id=$(date +%s%N)
                    plan_file="$PLANS_DIR/pending/$plan_id.plan"
                    cat > "$plan_file" <<EOFPLAN
{
    "id": "$plan_id",
    "name": "AI计划: $task_data",
    "content": $(echo "$plan_result" | jq -Rs .),
    "status": "pending",
    "priority": "medium",
    "created": "$(date -Iseconds)",
    "task_id": "$task_id"
}
EOFPLAN
                    log_info "Plan saved, awaiting approval: $plan_file"
                fi
            fi
            ;;
        "ai-refactor")
            call_opencode "请重构 $task_data 的代码，提升代码质量和可维护性" "$task_id" || exit_code=$?
            ;;
        "ai-document")
            call_opencode "请为 $task_data 生成详细的API文档和使用说明" "$task_id" || exit_code=$?
            ;;
        "ai-test")
            call_opencode "请为 $task_data 生成完整的单元测试用例" "$task_id" || exit_code=$?
            ;;
        "ai-daily")
            local done_tasks
            done_tasks=$(ls -1 "$WORK_DIR/tasks/done/" 2>/dev/null | wc -l)
            call_opencode "请根据今天的任务执行情况(${done_tasks}个任务完成)，生成日报总结" "$task_id" || exit_code=$?
            ;;
        "ai-weekly")
            call_opencode "请根据本周的任务执行情况，生成周报总结，包括：完成情况、问题分析、下周计划" "$task_id" || exit_code=$?
            ;;
        "ai-learn")
            call_opencode "请分析最近的代码变更和任务执行记录，总结经验教训，更新知识库" "$task_id" || exit_code=$?
            ;;
        "ai-article")
            local art_pkg art_file
            art_pkg="$task_data"
            art_file="$WORK_DIR/docs/@lisp-article-$(date +%Y%m%d)-${art_pkg}.md"
            mkdir -p "$WORK_DIR/docs"
            call_opencode "你是面向 CAD 用户的 @lisp 推广作者。请以应用包【$art_pkg】为题材，写一篇推广/介绍文章。
【素材】先阅读 ~/atlisp/packages/$art_pkg/ 下的文件（README.md、pkg.lsp、*.lsp、*.org 等），弄清它解决什么问题、提供哪些命令/功能、如何使用；示例必须来自真实内容。
【角度】二选一（自行判断更合适者）：
 (a) 面向 CAD 用户：使用介绍 —— 场景痛点 → 该包如何解决 → 具体命令与操作示例；
 (b) 面向开发者：AutoLISP 开发介绍 —— 实现思路、关键函数、可复用技巧。
【加分】若能自然结合 AI 能力（规范问答、代码生成、@lisp AI 助手等），请融入正文。
【要求】中文，正文 1000~1500 字；结构清晰（标题 / 导语 / 小标题 / 示例代码 / 小结）；函数名与命令必须来自该包真实内容，禁止编造；避免夸大宣传与空话。
最后必须：把文章写入文件 $art_file（Markdown，含标题、生成时间与所涉包名），并在回答末尾给出该文件路径。" "$task_id" "$AI_LONG_TASK_TIMEOUT" || exit_code=$?
            if [ -s "$art_file" ]; then
                echo "$(date +%F) $art_pkg $art_file" >> "$ARTICLE_TOPIC_LOG"
                log_info "AI 文章: $art_file"
            else
                # 不把噪声写进 docs/：失败输出另存 logs/
                sed 's/\x1b\[[0-9;]*m//g' "$LOG_DIR/opencode-$task_id.log" > "$LOG_DIR/article-failed-$task_id.md" 2>/dev/null || true
                log_error "AI 文章生成失败（无输出），原始会话见 logs/article-failed-$task_id.md"
            fi
            ;;
        "ai-self-review")
            local review_date review_report metrics_file
            review_date=$(date +%Y%m%d)
            review_report="$WORK_DIR/reports/self-review-$review_date.md"
            metrics_file="$LOG_DIR/self-review-input-$review_date.md"
            mkdir -p "$WORK_DIR/reports"
            "$WORK_DIR/automation/self-review.sh" "$metrics_file" > /dev/null 2>&1 || true
            local lessons_file="$WORK_DIR/reports/introspection/lessons.md"
            call_opencode "你是 @lisp 自动化员工（atlisp-worker）的自我迭代分析器。请分析自身近期的工作内容，并改进自己的工作安排。
【输入】工作指标: $metrics_file ；当前调度: $(schedule_file) ；历史自省教训: $lessons_file（若不存在则忽略）
【分析维度】任务成功率、失败/超时/重试原因、空转与重复任务、调度冲突、资源占用、报告与邮件的实际价值。
【改进维度】基于证据调整调度（schedule.json）：错开冲突时段、降低无效任务频率、为易超时任务合理排期、启用/停用价值低的任务等。调整前须先对照历史自省教训，避免重复已知的坑。
【输出1（必须）】把分析报告写入 $review_report（Markdown，包含：现状指标、发现的问题、改进项、预期收益）。
【输出2（可选）】若确有必要调整调度，将【完整且合法的】新 schedule.json 写入 $WORK_DIR/logs/schedule.proposed.json：
  - 保持 schema：version / grace_seconds / tasks[]；每项含 id,name,type,time,priority,days,enabled（可选 data/dynamic）
  - time 为 HH:MM；priority 为 1-5 整数；days 为 * / 1-7 / dom:DD；type 必须为现有任务类型
  - 必须保留 id=self-review 与 id=introspection 且均 enabled=true；不得清空任务
  - 仅做有依据的最小改动；若无调整必要，请不要生成该文件
最后在回答末尾给出报告路径。" "$task_id" "$AI_LONG_TASK_TIMEOUT" || exit_code=$?
            if [ -s "$review_report" ]; then
                log_info "自我迭代报告: $review_report"
            else
                sed 's/\x1b\[[0-9;]*m//g' "$LOG_DIR/opencode-$task_id.log" > "$review_report" 2>/dev/null || true
                log_warn "AI 未写出自我迭代报告，已回退保存会话输出"
            fi
            apply_proposed_schedule
            ;;
        "ai-introspect")
            local introspect_date introspect_report introspect_input introspect_lessons
            introspect_date=$(date +%Y%m%d)
            introspect_report="$WORK_DIR/reports/introspection/introspection-$introspect_date.md"
            introspect_input="$LOG_DIR/introspect-input-$introspect_date.md"
            introspect_lessons="$WORK_DIR/reports/introspection/lessons.md"
            mkdir -p "$WORK_DIR/reports/introspection"
            "$WORK_DIR/automation/introspect.sh" "$introspect_input" > /dev/null 2>&1 || true
            call_opencode "你是 @lisp 自动化员工（atlisp-worker）的自省模块。请反思自身近期的决策与行为，并沉淀可复用的教训。
【输入】自省输入: $introspect_input ；既有教训记忆: $introspect_lessons（若不存在则视为首次自省）。
【反思维度】
 1. 调度调整：近 7 天自我迭代做的调度改动是否有效？是否有候选调度被拒绝？原因是什么？
 2. 失败模式：重复出现的失败/超时/重试类型，是否重蹈了已知覆辙；
 3. 判断偏差：是否过度调整（无充分证据就改调度）或调整不足（问题反复出现却没行动）；
 4. 价值评估：哪些任务/报告/邮件真正有价值，哪些在空转，哪些教训尚未落实。
【输出1（必须）】把自省报告写入 $introspect_report（Markdown，包含：近期决策回顾、提取的教训、对今后行为的改进措施）。
【输出2（必须）】更新教训记忆 $introspect_lessons：
  - 先读取该文件既有内容，按行格式 - [YYYY-MM-DD] 教训（一条一行）；
  - 新增与既有条目语义不同的教训，追加在文件末尾；
  - 保持总条目数不超过 60 条，超出时删除最旧的条目；
  - 若今日确无新教训，则不要修改该文件。
最后在回答末尾给出报告与教训文件的路径。" "$task_id" "$AI_LONG_TASK_TIMEOUT" || exit_code=$?
            if [ -s "$introspect_report" ]; then
                log_info "自省报告: $introspect_report"
            else
                sed 's/\x1b\[[0-9;]*m//g' "$LOG_DIR/opencode-$task_id.log" > "$introspect_report" 2>/dev/null || true
                log_warn "AI 未写出自省报告，已回退保存会话输出"
            fi
            ;;
        "ai-monitor")
            call_opencode "请分析系统运行状态、任务执行情况，生成监控报告和优化建议" "$task_id" || exit_code=$?
            ;;
        "ai-security")
            call_opencode "请对 $task_data 进行安全检查，包括：代码安全、依赖安全、配置安全" "$task_id" || exit_code=$?
            ;;
        "ai-deploy")
            call_opencode "请检查部署就绪状态，包括：代码质量、测试覆盖、文档完整" "$task_id" || exit_code=$?
            ;;
        "ai-compare")
            call_opencode "请对比分析 $task_data 的不同版本，总结改进点" "$task_id" || exit_code=$?
            ;;
        "ai-explain")
            call_opencode "请详细解释 $task_data 的代码逻辑和实现原理" "$task_id" || exit_code=$?
            ;;
        "ai-refactor-batch")
            call_opencode "请批量重构 $task_data 目录下的所有lsp文件，统一代码风格" "$task_id" || exit_code=$?
            ;;
        "ai-generate-pkg")
            call_opencode "请根据需求 $task_data 创建新的CAD应用包，包括：目录结构、pkg.lsp、README" "$task_id" || exit_code=$?
            ;;
        "ai-fix-all")
            call_opencode "请读取 $LOG_DIR/lint-check.log 中的lint检查结果，修复所有错误级别的问题（警告可忽略），修复后运行 make lint 验证" "$task_id" || exit_code=$?
            ;;
        "ai-execute-plan")
            if [ -f "$task_data" ]; then
                local plan_content
                plan_content=$(cat "$task_data")
                call_opencode "请执行以下计划内容：$plan_content" "$task_id" || exit_code=$?
            else
                call_opencode "请执行以下计划：$task_data" "$task_id" || exit_code=$?
            fi
            ;;
        *)
            log_error "Unknown task type: $task_type"
            exit_code=1
            ;;
    esac

    local end_time duration status
    end_time=$(date +%s)
    duration=$((end_time - start_time))

    status="completed"
    [ $exit_code -ne 0 ] && status="failed"

    local retry_count
    retry_count=$(jq -r '.retry_count // 0' "$work_file" 2>/dev/null)
    [[ "$retry_count" =~ ^[0-9]+$ ]] || retry_count=0
    if [ "$status" = "failed" ] && [ "$retry_count" -lt "$MAX_RETRY" ]; then
        retry_count=$((retry_count + 1))
        if jq ".retry_count = $retry_count | .status = \"pending\" | .last_error = \"exit code $exit_code\"" \
            "$work_file" > "$work_file.tmp" 2>/dev/null; then
            mv "$work_file.tmp" "$work_file"
        else
            rm -f "$work_file.tmp"
            log_warn "Failed to update retry metadata, requeueing task as-is: $task_name"
        fi
        mv "$work_file" "$WORK_DIR/tasks/$task_id.task"
        log_error "Task failed, retrying ($retry_count/$MAX_RETRY): $task_name"
        return 1
    fi

    local completed_time
    completed_time=$(date -Iseconds)
    if jq ".status = \"$status\" | .duration = $duration | .exit_code = $exit_code | .completed = \"$completed_time\" | .retry_count = $retry_count" \
        "$work_file" > "$work_file.tmp" 2>/dev/null; then
        mv "$work_file.tmp" "$work_file"
    else
        rm -f "$work_file.tmp"
        log_warn "Failed to update task metadata, archiving without status: $task_name"
    fi

    mv "$work_file" "$WORK_DIR/tasks/done/$task_id.task"

    log_info "Done: $task_name (${duration}s, $status, retries=$retry_count)"

    if [ "$status" = "failed" ]; then
        send_notification "Task failed: $task_name" "Failed after $retry_count retries, exit code: $exit_code" "error"
        # AI 任务失败即时邮件告警（每日最多 1 封，去重）：
        # 2026-10-15 故障教训 —— vllm/opencode 后端失效时全部 AI 任务秒级失败，
        # 但自审/自省（原每日告警入口）依赖同一后端，故障期间最长 33.5h 无人告警。
        # 改用 notify-email.py（纯 SMTP，不依赖 vllm）在失败时直接告警。
        local task_type alert_key alert_body
        task_type=$(jq -r '.type // empty' "$work_file" 2>/dev/null)
        case "$task_type" in
            ai-*)
                if [ -n "${EMAIL_PASSWORD:-}" ]; then
                    alert_key="$LOG_DIR/.ai-fail-alert-$(date +%Y%m%d)"
                    if [ ! -f "$alert_key" ]; then
                        touch "$alert_key" 2>/dev/null
                        alert_body="$LOG_DIR/ai-fail-alert-$(date +%Y%m%d).md"
                        {
                            echo "# AI 任务失败告警 (atlisp-worker)"
                            echo
                            echo "- 任务: $task_name (type=$task_type)"
                            echo "- 重试 $retry_count 次后失败, exit code: $exit_code"
                            echo "- 机器: $(hostname) | 时间: $(date -Iseconds)"
                            echo
                            echo "AI 后端 (vllm/opencode) 疑似不可用：全部 AI 任务会立即失败。请检查 vllm 服务与 opencode CLI 版本。"
                            echo "详情: $LOG_DIR/worker.log"
                        } > "$alert_body" 2>/dev/null
                        python3 "$WORK_DIR/notify-email.py" --report "$alert_body" --title "atlisp-worker 告警: AI 任务 [$task_name] 失败" \
                            >/dev/null 2>&1 || log_warn "AI 失败告警邮件发送失败"
                    fi
                else
                    log_warn "EMAIL_PASSWORD 未设置，AI 任务失败告警邮件未发送 (task=$task_name)"
                fi
                ;;
        esac
    fi
}

# ---- Watch for file changes ----
on_file_change() {
    local file=$1

    case "$file" in
        "$WORK_DIR/lib/"*|"$WORK_DIR/packages/"*|"$WORK_DIR/kernel/"*) ;;
        *) return 0 ;;
    esac

    local now
    now=$(date +%s)
    if [ $((now - LAST_WATCH_TASK_TS)) -lt "$WATCH_THROTTLE" ]; then
        return 0
    fi

    if has_pending_task "lint"; then
        return 0
    fi

    LAST_WATCH_TASK_TS=$now
    log_info "File change detected: $file"
    create_task "Code check: $(basename "$file")" "lint" 2 "$file"
}

watch_files() {
    if [ -f "$WATCH_PID_FILE" ]; then
        local old_watch
        old_watch=$(cat "$WATCH_PID_FILE" 2>/dev/null)
        if [ -n "$old_watch" ] && kill -0 "$old_watch" 2>/dev/null; then
            pkill -TERM -P "$old_watch" 2>/dev/null || true
            kill -TERM "$old_watch" 2>/dev/null || true
        fi
        rm -f "$WATCH_PID_FILE"
    fi

    if command -v inotifywait > /dev/null 2>&1; then
        (
            inotifywait -m -r -e modify,create,delete \
                --format '%w%f' \
                "$WORK_DIR/lib" "$WORK_DIR/packages" "$WORK_DIR/kernel" 2>/dev/null |
            while IFS= read -r file; do
                case "$file" in
                    *.lsp) on_file_change "$file" ;;
                esac
            done
        ) 9>&- &
        log_info "File watcher started (inotify, PID: $!)"
    else
        log_warn "inotifywait not found, falling back to polling watcher"
        (
            marker="$LOG_DIR/watch-marker"
            touch "$marker"
            while true; do
                while IFS= read -r file; do
                    on_file_change "$file"
                done < <(find "$WORK_DIR/lib" "$WORK_DIR/packages" "$WORK_DIR/kernel" \
                    \( -name '*.lsp' \) -type f -newer "$marker" \
                    2>/dev/null)
                touch "$marker"
                sleep 30
            done
        ) 9>&- &
        log_info "File watcher started (polling, PID: $!)"
    fi
    WATCH_PID=$!
    echo "$WATCH_PID" > "$WATCH_PID_FILE"
}

# ---- Check scheduled tasks ----
check_schedule() {
    local hour minute day day_of_month
    hour=$(date +%H)
    minute=$(date +%-M)
    day=$(date +%u)
    day_of_month=$(date +%d)

    if [ "$hour" = "22" ] && [ "$minute" = "0" ]; then
        create_task "Daily sync" "sync" 1
    fi
    if [ "$hour" = "22" ] && [ "$minute" = "30" ]; then
        create_task "Daily lint check" "lint" 2
    fi
    if [ "$hour" = "23" ] && [ "$minute" = "0" ]; then
        create_task "Generate suggestions" "generate" 3
    fi
    if [ "$hour" = "23" ] && [ "$minute" = "30" ]; then
        create_task "Code cleanup" "clean" 4
    fi
    if [ "$hour" = "0" ] && [ "$minute" = "0" ]; then
        create_task "Generate docs" "docs" 3
    fi
    if [ "$day" = "6" ] && [ "$hour" = "1" ] && [ "$minute" = "0" ]; then
        create_task "Weekly full check" "full-check" 1
    fi
    if [ "$day_of_month" = "01" ] && [ "$hour" = "2" ] && [ "$minute" = "0" ]; then
        create_task "Monthly maintenance" "full-check" 1
    fi
}

# Check whether a plan already has a task
has_plan_task() {
    local plan_id=$1
    local f
    for f in "$WORK_DIR/tasks"/*.task "$WORK_DIR/tasks"/*.task.running; do
        [ -f "$f" ] || continue
        local data
        data=$(jq -r '.data // empty' "$f" 2>/dev/null)
        if [ -n "$data" ] && echo "$data" | grep -q "plan-${plan_id}-content.txt"; then
            return 0
        fi
    done
    return 1
}

# Process approved plans
process_approved_plans() {
    mkdir -p "$APPROVED_DIR" "$ARCHIVE_DIR"

    local plan_count=0
    for plan_file in "$APPROVED_DIR"/*.plan; do
        [ -f "$plan_file" ] || continue

        local plan_id
        plan_id=$(basename "$plan_file" .plan)

        if has_plan_task "$plan_id"; then
            log_info "Skipping plan $plan_id: task already exists"
            continue
        fi

        local plan_name plan_content plan_priority
        plan_name=$(jq -r '.name' "$plan_file")
        plan_content=$(jq -r '.content' "$plan_file")
        plan_priority=$(jq -r '.priority // "medium"' "$plan_file")

        if ! mv "$plan_file" "$ARCHIVE_DIR/" 2>/dev/null; then
            log_error "Cannot move plan file: $plan_file"
            continue
        fi

        local task_priority=3
        case "$plan_priority" in
            "critical") task_priority=1 ;;
            "high") task_priority=2 ;;
            "medium") task_priority=3 ;;
            "low") task_priority=4 ;;
            "background") task_priority=5 ;;
        esac

        local tasks_json
        tasks_json=$(echo "$plan_content" | jq -r '.tasks[]? | "\(.name)|\(.type)|\(.data // "")"' 2>/dev/null || echo "")

        if [ -n "$tasks_json" ]; then
            while IFS='|' read -r t_name t_type t_data; do
                [ -z "$t_name" ] && continue
                create_task "$t_name" "$t_type" "$task_priority" "$t_data"
                log_info "Created task from plan: $t_name (type: $t_type)"
            done <<< "$tasks_json"
        else
            local t_name="Execute plan: $plan_name"
            local t_type="ai-execute-plan"
            local plan_data_file="$LOG_DIR/plan-$plan_id-content.txt"
            echo "$plan_content" > "$plan_data_file"
            create_task "$t_name" "$t_type" "$task_priority" "$plan_data_file"
            log_info "Created AI task from plan: $t_name"
        fi

        plan_count=$((plan_count + 1))
        log_info "Processed plan: $plan_id ($plan_name)"
    done

    [ $plan_count -gt 0 ] && log_info "Processed $plan_count approved plans"
}

# 归档长期未审批的计划，避免 pending 无限积压
expire_old_plans() {
    mkdir -p "$PENDING_DIR" "$ARCHIVE_DIR"
    local f count=0
    while IFS= read -r f; do
        [ -f "$f" ] || continue
        if mv -f "$f" "$ARCHIVE_DIR/" 2>/dev/null; then
            count=$((count + 1))
        fi
    done < <(find "$PENDING_DIR" -maxdepth 1 -name '*.plan' -mtime "+$PLAN_MAX_AGE_DAYS" 2>/dev/null)
    [ "$count" -gt 0 ] && log_info "Expired $count stale pending plans (older than ${PLAN_MAX_AGE_DAYS}d)"
    return 0
}

# ---- 文章题材选取（每日 05:00 文章任务）----
ARTICLE_TOPIC_LOG="$WORK_DIR/logs/article-topics.log"

pick_article_pkg() {
    local all used cand
    all=$(find "$WORK_DIR/packages" -mindepth 1 -maxdepth 1 -type d ! -name '.*' \
          -exec basename {} \; 2>/dev/null | sort)
    [ -z "$all" ] && return 0
    # 近 60 条已用题材优先排除（候选不足时回退全量）
    used=$(tail -60 "$ARTICLE_TOPIC_LOG" 2>/dev/null | awk '{print $2}' | sort -u)
    cand="$all"
    if [ -n "$used" ]; then
        cand=$(comm -23 <(echo "$all") <(echo "$used"))
        [ -z "$cand" ] && cand="$all"
    fi
    echo "$cand" | shuf -n 1
}

# ---- Daily AI tasks ----
daily_ai_tasks() {
    local hour minute day
    hour=$(date +%H)
    minute=$(date +%-M)
    day=$(date +%u)

    if [ "$hour" = "03" ] && [ "$minute" = "0" ]; then
        create_task "AI suggestions" "ai-suggest" 3 "整个项目"
    fi
    if [ "$hour" = "22" ] && [ "$minute" = "45" ]; then
        create_task "AI code review" "ai-review" 2 "lib/src"
    fi
    if [ "$hour" = "23" ] && [ "$minute" = "15" ]; then
        create_task "AI plan tomorrow" "ai-plan" 3 "明日开发任务"
    fi
    if [ "$hour" = "0" ] && [ "$minute" = "15" ]; then
        create_task "AI daily report" "ai-daily" 2
    fi
    if [ "$day" = "6" ] && [ "$hour" = "1" ] && [ "$minute" = "15" ]; then
        create_task "AI weekly report" "ai-weekly" 2
    fi
    if [ "$(date +%d)" = "01" ] && [ "$hour" = "2" ] && [ "$minute" = "15" ]; then
        create_task "AI monthly summary" "ai-learn" 3
    fi
    if [ "$hour" = "05" ] && [ "$minute" = "0" ]; then
        local art_pkg
        art_pkg=$(pick_article_pkg)
        if [ -n "$art_pkg" ]; then
            create_task "AI article: $art_pkg" "ai-article" 2 "$art_pkg"
        else
            log_warn "未找到可用应用包，跳过文章任务"
        fi
    fi
}

# ---- Check Git ----
check_git() {
    cd "$WORK_DIR" || return 0

    git fetch origin 2>/dev/null

    local upstream
    upstream=$(git rev-parse --abbrev-ref '@{u}' 2>/dev/null || echo "origin/main")

    local remote_hash
    remote_hash=$(git rev-parse "$upstream" 2>/dev/null)
    [ -n "$remote_hash" ] || return 0

    local behind
    behind=$(git rev-list --count "HEAD..$upstream" 2>/dev/null)
    [[ "$behind" =~ ^[0-9]+$ ]] || behind=0

    if [ "$behind" -gt 0 ] && ! has_pending_task "sync"; then
        log_info "Remote is ahead by $behind commits, creating sync task"
        create_task "Pull updates" "sync" 1
    fi
}

# ---- Check code quality ----
check_code_quality() {
    local lint_out="$LOG_DIR/lint-check.log"
    local lint_tmp="${lint_out}.tmp.$$"

    # 注意：atlisp-lint 在 stdout 为管道时会因 Node 异步写+提前退出而丢失尾部
    # （含汇总行），导致解析恒为 0 错误。必须重定向到文件后再解析。
    ( cd "$WORK_DIR" && make lint ) > "$lint_tmp" 2>&1 || true

    local error_count warning_count
    error_count=$(grep -aoE '[0-9]+ 个错误' "$lint_tmp" | awk '{s+=$1} END {print s+0}')
    warning_count=$(grep -aoE '[0-9]+ 个警告' "$lint_tmp" | awk '{s+=$1} END {print s+0}')
    [[ "$error_count" =~ ^[0-9]+$ ]] || error_count=0
    [[ "$warning_count" =~ ^[0-9]+$ ]] || warning_count=0

    mv -f "$lint_tmp" "$lint_out" 2>/dev/null || rm -f "$lint_tmp"

    log_info "Code check: $error_count errors, $warning_count warnings"

    if [ "$error_count" -gt 0 ] && ! has_pending_task "ai-fix-all" && ! has_recent_done_task "ai-fix-all" "$AI_FIX_ALL_COOLDOWN"; then
        create_task "AI fix all errors" "ai-fix-all" 1
    fi
}

# ---- Task list sorted by priority ----
list_sorted_tasks() {
    local f p
    for f in "$WORK_DIR/tasks"/*.task; do
        [ -f "$f" ] || continue
        p=$(jq -r '.priority // 5' "$f" 2>/dev/null)
        [[ "$p" =~ ^[0-9]+$ ]] || p=5
        printf '%s %s\n' "$p" "$f"
    done | sort -n -s | cut -d' ' -f2-
}

# ---- Main loop ----
main_loop() {
    local last_schedule_check=""
    local last_git_check=""
    local last_quality_check=""
    local last_approved_check=""
    local loop_count=0

    while true; do
        local current_time
        current_time=$(date +%H:%M)
        local now
        now=$(date +%s)

        if [ "$current_time" != "$last_schedule_check" ]; then
            run_schedule
            last_schedule_check="$current_time"
        fi

        if [ -z "$last_git_check" ] || [ $((now - last_git_check)) -ge 300 ]; then
            check_git
            last_git_check=$now
        fi

        if [ -z "$last_quality_check" ] || [ $((now - last_quality_check)) -ge "$QUALITY_CHECK_INTERVAL" ]; then
            # 异步执行，避免全量 lint 阻塞主循环导致定时任务被跳过
            if [ -z "$QUALITY_PID" ] || ! kill -0 "$QUALITY_PID" 2>/dev/null; then
                ( check_code_quality ) 9>&- &
                QUALITY_PID=$!
            fi
            last_quality_check=$now
        fi

        if [ -z "$last_approved_check" ] || [ $((now - last_approved_check)) -ge 300 ]; then
            process_approved_plans
            expire_old_plans
            last_approved_check=$now
        fi

        reap_ai
        reap_work

        while IFS= read -r task_file; do
            [ -n "$task_file" ] || continue
            [ -f "$task_file" ] || continue
            local task_type
            task_type=$(jq -r '.type' "$task_file")
            case "$task_type" in
                ai-*)
                    if [ "${#AI_PIDS[@]}" -lt "$MAX_CONCURRENT" ]; then
                        local task_name
                        task_name=$(jq -r '.name' "$task_file" 2>/dev/null)
                        ( execute_task "$task_file" ) 9>&- &
                        AI_PIDS+=($!)
                        log_info "AI task submitted (${#AI_PIDS[@]}/$MAX_CONCURRENT): $task_name"
                    else
                        break
                    fi
                    ;;
                *)
                    if [ "${#WORK_PIDS[@]}" -lt "$MAX_WORK_CONCURRENT" ]; then
                        ( execute_task "$task_file" ) 9>&- &
                        WORK_PIDS+=($!)
                        log_info "Work task submitted (${#WORK_PIDS[@]}/$MAX_WORK_CONCURRENT): $(jq -r '.name' "$task_file" 2>/dev/null)"
                    else
                        break
                    fi
                    ;;
            esac
        done < <(list_sorted_tasks)

        local running_file
        for running_file in "$WORK_DIR/tasks"/*.task.running; do
            [ -f "$running_file" ] || continue
            local mtime
            mtime=$(stat -c %Y "$running_file" 2>/dev/null || echo 0)
            if [ $(( now - mtime )) -gt "$STALE_TASK_TIMEOUT" ]; then
                mv "$running_file" "${running_file%.running}"
                log_error "Recovering stuck task: $(basename "$running_file")"
            fi
        done

        local done_count
        done_count=$(ls "$WORK_DIR/tasks/done"/*.task 2>/dev/null | wc -l)
        if [ "$done_count" -gt 100 ]; then
            ls -t "$WORK_DIR/tasks/done"/*.task | tail -n +101 | xargs rm -f
        fi

        update_status

        if [ $((loop_count % 100)) -eq 0 ]; then
            rotate_log
        fi
        loop_count=$((loop_count + 1))

        sleep 10 9>&- &
        wait $!
    done
}

# ---- Start ----
# 数据驱动调度（run_schedule / apply_proposed_schedule）
if [ -f "$WORK_DIR/automation/schedule.sh" ]; then
    source "$WORK_DIR/automation/schedule.sh"
else
    log_warn "schedule.sh 缺失，回退内置调度"
fi

# 兜底：schedule.sh 未提供 run_schedule 时使用内置调度，避免主循环每分钟报错
if ! declare -F run_schedule > /dev/null; then
    run_schedule() { check_schedule; daily_ai_tasks; }
fi
if ! declare -F apply_proposed_schedule > /dev/null; then
    apply_proposed_schedule() { return 0; }
fi

init
watch_files
main_loop

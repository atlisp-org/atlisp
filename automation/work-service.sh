#!/bin/bash
# /home/vitalgg/atlisp/automation/work-service.sh
# Automated employee main service script - auto-listen and execute tasks

# Note: No set -e to avoid background task crashes killing the whole service

# ---- Configuration ----
WORK_DIR="/home/vitalgg/atlisp"
LOG_DIR="$WORK_DIR/logs"
STATUS_FILE="$WORK_DIR/status.json"
PLANS_DIR="$WORK_DIR/plans"
APPROVED_DIR="$PLANS_DIR/approved"
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
MAX_RETRY="${MAX_RETRY:-2}"
WEBHOOK_URL="${WEBHOOK_URL:-}"

# Dedup / throttle
AI_FIX_ALL_COOLDOWN="${AI_FIX_ALL_COOLDOWN:-1800}"
WATCH_THROTTLE="${WATCH_THROTTLE:-300}"

# ---- PID tracking ----
AI_PIDS=()
WORK_PIDS=()
WATCH_PID=""
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
    local log_file="$LOG_DIR/worker.log"
    if [ -f "$log_file" ]; then
        local size
        size=$(stat -c %s "$log_file" 2>/dev/null || echo 0)
        if [ "$size" -gt 10485760 ]; then
            mv "$log_file" "${log_file}.1"
            log_info "Log rotated"
        fi
    fi
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
             "$PLANS_DIR/pending" "$APPROVED_DIR" "$PLANS_DIR/rejected"

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
        [ "$(jq -r '.type' "$f" 2>/dev/null)" = "$task_type" ] && return 0
    done
    return 1
}

has_recent_done_task() {
    local task_type=$1
    local max_age=${2:-$AI_FIX_ALL_COOLDOWN}
    local now f mtime
    now=$(date +%s)
    for f in "$WORK_DIR/tasks/done"/*.task; do
        [ -f "$f" ] || continue
        [ "$(jq -r '.type' "$f" 2>/dev/null)" = "$task_type" ] || continue
        mtime=$(stat -c %Y "$f" 2>/dev/null || echo 0)
        [ $((now - mtime)) -lt "$max_age" ] && return 0
    done
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

    setsid timeout "$AI_TASK_TIMEOUT" opencode run "$prompt" --auto --pure > "$out_file" 2>&1 9>&- &
    opencode_pid=$!
    echo "$opencode_pid" > "$LOG_DIR/oc-$opencode_pid.pid"

    while kill -0 "$opencode_pid" 2>/dev/null; do
        local elapsed=$(( $(date +%s) - start_ts ))
        if [ "$elapsed" -ge "$AI_TASK_TIMEOUT" ]; then
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
            cd "$WORK_DIR" && make clean >> "$LOG_DIR/clean.log" 2>&1 || exit_code=$?
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
            call_opencode "请分析 $task_data 的代码，生成改进建议和优化方案" "$task_id" || exit_code=$?
            ;;
        "ai-plan")
            plan_result=""
            call_opencode "请为 $task_data 制定详细的开发计划，包括：目标、步骤、时间估算，以JSON格式输出" "$task_id"
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
                    *.lsp|*.md) on_file_change "$file" ;;
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
                    \( -name '*.lsp' -o -name '*.md' \) -type f -newer "$marker" \
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

# ---- Daily AI tasks ----
daily_ai_tasks() {
    local hour minute day
    hour=$(date +%H)
    minute=$(date +%-M)
    day=$(date +%u)

    if [ "$hour" = "22" ] && [ "$minute" = "15" ]; then
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
    cd "$WORK_DIR" || return 0

    local lint_result
    lint_result=$(make lint 2>&1) || true

    local error_count warning_count
    error_count=$(echo "$lint_result" | grep -oE '[0-9]+ 个错误|[0-9]+ error\(s\)' | grep -oE '^[0-9]+' | awk '{s+=$1} END {print s+0}')
    warning_count=$(echo "$lint_result" | grep -oE '[0-9]+ 个警告|[0-9]+ warning\(s\)' | grep -oE '^[0-9]+' | awk '{s+=$1} END {print s+0}')

    log_info "Code check: $error_count errors, $warning_count warnings"

    if [ "$error_count" -gt 0 ] && ! has_pending_task "ai-fix-all" && ! has_recent_done_task "ai-fix-all" "$AI_FIX_ALL_COOLDOWN"; then
        create_task "AI fix all errors" "ai-fix-all" 1
    fi

    echo "$lint_result" > "$LOG_DIR/lint-check.log"
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
            check_schedule
            daily_ai_tasks
            last_schedule_check="$current_time"
        fi

        if [ -z "$last_git_check" ] || [ $((now - last_git_check)) -ge 300 ]; then
            check_git
            last_git_check=$now
        fi

        if [ -z "$last_quality_check" ] || [ $((now - last_quality_check)) -ge 600 ]; then
            check_code_quality
            last_quality_check=$now
        fi

        if [ -z "$last_approved_check" ] || [ $((now - last_approved_check)) -ge 300 ]; then
            process_approved_plans
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
init
watch_files
main_loop

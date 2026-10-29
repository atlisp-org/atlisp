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

# 邮件凭证：setup-email.sh 写入 ~/.atlisp-email-config，但 systemd unit 只加载
# /etc/atlisp/atlisp-worker.env（不含该项）。在此 source 使 AI 失败告警邮件可真正发出
# （2026-10-22 自审发现告警链路从未触发，见 reports/self-review-20261022.md）
EMAIL_CONFIG_FILE="${HOME:-/home/vitalgg}/.atlisp-email-config"
[ -f "$EMAIL_CONFIG_FILE" ] && . "$EMAIL_CONFIG_FILE"

# Dedup / throttle
AI_FIX_ALL_COOLDOWN="${AI_FIX_ALL_COOLDOWN:-1800}"
WATCH_THROTTLE="${WATCH_THROTTLE:-300}"

# 全量 lint 巡检间隔（秒）。全量 lint 开销大且长期零信息增量（144 次/天、
# 0 错误 + 只有警告漂移），默认降至 1 小时一次（见 reports/self-review-*）。
QUALITY_CHECK_INTERVAL="${QUALITY_CHECK_INTERVAL:-3600}"

# 文章生成后发布到公众号：off | dry-run | draft | publish
# draft = 只建草稿（默认，人工预览后发表）；publish = 直接 freepublish/submit
WECHAT_ARTICLE_MODE="${WECHAT_ARTICLE_MODE:-draft}"
# 社交推广自动发布（automation/autopost，QQ空间/抖音）：off | publish
# 队列为空时任务自动空转（不发布）；有内容文件才真正发。失败保留文件下周期重试。
# 注意：网页自动化频率要克制（每天 1~2 条），账号被风控时先停（置 off）
AUTOPOST_MODE="${AUTOPOST_MODE:-publish}"
# 发布动作经跳板机执行（其出口 IP 在公众号白名单内）；置空则本机直连微信接口
WECHAT_RELAY_HOST="${WECHAT_RELAY_HOST:-atlisp.cn}"

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
# 可选：固定自动化用的模型/agent（不设则用 opencode.json 的默认值，v2: provider/model#variant）
OPENCODE_MODEL="${OPENCODE_MODEL:-}"
OPENCODE_AGENT="${OPENCODE_AGENT:-}"

# 夜间廉价模型：在窗口 [NIGHT_START, NIGHT_END) 内启动的 AI 任务
# 改用 NIGHT_MODEL（默认 deepseek/deepseek-flash，成本约为本地模型的 1/10），
# 窗口外（白天 08:30-18:05）用 OPENCODE_MODEL/opencode 默认。
# 置空 NIGHT_MODEL 即关闭；均可经 /etc/atlisp/atlisp-worker.env 覆盖。
NIGHT_MODEL="${NIGHT_MODEL:-deepseek/deepseek-flash}"
NIGHT_START="${NIGHT_START:-18:05}"
NIGHT_END="${NIGHT_END:-08:30}"

# 能力位（由 check_opencode_cli 探测，老版本缺参数时自动降级为兼容模式）：
#   JSON   `run --format json`：逐行结构化事件，可拿到纯文本回复/错误类型/用量/会话 ID
#   SESSION `run --session <id>`：预分配会话 ID，超时按 ID 精确取消，不再 list+标题撞库
#   FILE   `run --file <path>`：超长提示词作为附件直接进上下文，省掉一次 read 工具往返
OC_CAP_JSON=0
OC_CAP_SESSION=0
OC_CAP_FILE=0

# 当前时刻是否落在窗口 [NIGHT_START, NIGHT_END)（HH:MM，支持跨零点，
# 如 18:05→08:30 表示 18:05:00 ~ 次日 08:29:59；start 含、end 不含）
in_night_window() {
    local now_m start_m end_m
    [[ "$NIGHT_START" =~ ^([01][0-9]|2[0-3]):[0-5][0-9]$ ]] || return 1
    [[ "$NIGHT_END"   =~ ^([01][0-9]|2[0-3]):[0-5][0-9]$ ]] || return 1
    now_m=$((10#$(date +%H) * 60 + 10#$(date +%M)))
    start_m=$((10#${NIGHT_START%%:*} * 60 + 10#${NIGHT_START##*:}))
    end_m=$((10#${NIGHT_END%%:*} * 60 + 10#${NIGHT_END##*:}))
    if [ "$start_m" -lt "$end_m" ]; then
        [ "$now_m" -ge "$start_m" ] && [ "$now_m" -lt "$end_m" ]
    else
        [ "$now_m" -ge "$start_m" ] || [ "$now_m" -lt "$end_m" ]
    fi
}

check_opencode_cli() {
    if ! command -v opencode > /dev/null 2>&1; then
        log_error "opencode 未安装或不在 PATH，AI 任务不可用"
        return 1
    fi

    local help flag
    help=$(opencode run --help 2>&1 || true)
    local required=(--title)
    # NIGHT_MODEL 启用时同样需要 --model 支持（夜间任务会传 --model）
    { [ -n "$OPENCODE_MODEL" ] || [ -n "$NIGHT_MODEL" ]; } && required+=(--model)
    [ -n "$OPENCODE_AGENT" ] && required+=(--agent)
    for flag in "${OPENCODE_FLAGS[@]}" "${required[@]}"; do
        if ! grep -q -- "$flag" <<< "$help"; then
            log_error "opencode run 不支持参数 $flag（CLI 版本变更？），AI 任务将全部失败"
            send_notification "opencode CLI 参数不兼容" \
                "opencode run 不再支持 $flag，AI 任务会全部失败，请更新 automation/work-service.sh 的 OPENCODE_FLAGS" \
                "error"
            return 1
        fi
    done

    # 可选能力：有则启用，无则降级并留痕（不阻塞 AI 任务）
    OC_CAP_JSON=0; OC_CAP_SESSION=0; OC_CAP_FILE=0
    grep -q -- '--format' <<< "$help"  && OC_CAP_JSON=1
    grep -q -- '--session' <<< "$help" && OC_CAP_SESSION=1
    grep -q -- '--file' <<< "$help"    && OC_CAP_FILE=1
    [ "$OC_CAP_JSON" = 1 ]    || log_warn "opencode run 无 --format json，退回纯文本解析（错误定位与用量统计能力受限）"
    [ "$OC_CAP_SESSION" = 1 ] || log_warn "opencode run 无 --session，超时清理退回按标题查找会话"
    [ "$OC_CAP_FILE" = 1 ]    || log_warn "opencode run 无 --file，超长提示词退回\"先读取文件\"提示"

    local ver
    ver=$(opencode --version 2>/dev/null || echo unknown)
    # 实际输出形如 "opencode v2.0.29"
    if ! grep -qE '(^|[^0-9])2\.[0-9]+' <<< "$ver"; then
        log_warn "opencode 版本 $ver 不在 2.x，运行于兼容模式"
    fi

    if ! opencode session delete --help > /dev/null 2>&1; then
        log_warn "opencode session delete 不可用，超时后无法清理服务端会话"
    fi
    if ! opencode session list -n 1 --format json > /dev/null 2>&1; then
        log_warn "opencode 后台服务不可达（session list 失败）；持续存在时 AI 任务会失败"
    fi
    log_info "opencode CLI 预检通过: $ver${OPENCODE_MODEL:+ (model=$OPENCODE_MODEL)}${OPENCODE_AGENT:+ (agent=$OPENCODE_AGENT)} (night=${NIGHT_MODEL:-off} ${NIGHT_START}-${NIGHT_END}) (json=${OC_CAP_JSON} session=${OC_CAP_SESSION} file=${OC_CAP_FILE})"
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
    # 上次异常退出（SIGKILL/断电）遗留的会话：CLI 已死但服务端可能仍在生成，按 ID 清掉
    cleanup_stale_opencode_sessions
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
    # CLI 已杀，但服务端会话可能还在跑：按预分配 ID 删除，避免停服后继续写文件
    cleanup_stale_opencode_sessions
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
# opencode v2 是客户端/服务端架构：超时或停服时 kill 掉的只是 CLI 客户端，会话仍在
# 后台服务里继续生成（历史上表现为"杀了还在 16 分钟后写日报"）。v2.0.29 起
# `opencode run` 提供三项对自动化很关键的参数：
#   --session <id>  预分配会话 ID（不存在则创建）→ 超时/停服按 ID 精确取消，
#                   不再 `session list -n 100` + 标题匹配（同秒启动会撞名误删别人的会话）
#   --format json   逐行事件（text/tool_use/step_finish/error）→ 取纯文本、结构化错误、
#                   token/费用，避免 ANSI 与 TUI 噪声污染会话转储和 ai-plan 的 JSON
#   --file <path>   附件直接进上下文 → 超长提示词不必再让模型先 read 一遍
# 刻意不用 --standalone：每个任务单起私有服务会重复占内存，也与共享服务的会话数据割裂。
delete_opencode_session() {
    local sid=$1 del_out
    [ -n "$sid" ] || return 0
    command -v opencode > /dev/null 2>&1 || return 0
    if del_out=$(timeout 15 opencode session delete "$sid" 2>&1); then
        log_info "已删除会话 $sid"
    elif grep -qi 'not found' <<< "$del_out"; then
        log_info "会话 $sid 不存在（未及创建），无需清理"
    else
        log_warn "会话删除失败: $sid: $(printf '%s' "$del_out" | tail -1)"
    fi
}

cleanup_opencode_session() {
    local title=$1 sid=$2
    command -v opencode > /dev/null 2>&1 || return 0
    if [ -z "$sid" ]; then
        # 兼容模式（老版本无 --session）：退回按标题在会话列表里查找
        sid=$(opencode session list -n 100 --format json 2>/dev/null \
            | jq -r --arg t "$title" '.[] | select(.title == $t) | .id' 2>/dev/null | head -1)
    fi
    if [ -z "$sid" ]; then
        log_warn "未找到超时会话（title=$title），可能有残留"
        return 0
    fi
    delete_opencode_session "$sid"
}

# 清理异常中断（SIGKILL/断电）留下的会话记录：init 启动时与 cleanup 停服时调用
cleanup_stale_opencode_sessions() {
    local f
    for f in "$LOG_DIR"/oc-*.sid; do
        [ -e "$f" ] || continue
        delete_opencode_session "$(cat "$f" 2>/dev/null)"
        rm -f "$f"
    done
}

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

    local prompt_file="" prompt_bytes
    local -a oc_file_args=()
    prompt_bytes=$(printf '%s' "$prompt" | wc -c)
    if [ "$prompt_bytes" -gt 100000 ]; then
        prompt_file=$(mktemp "$LOG_DIR/prompt-XXXXXX")
        printf '%s' "$prompt" > "$prompt_file"
        log_warn "Prompt too long (${prompt_bytes} bytes), saved to $prompt_file"
        if [ "$OC_CAP_FILE" = "1" ]; then
            # 附件直达上下文，省掉"先 read 文件"的一次工具往返
            oc_file_args=(--file "$prompt_file")
            prompt="你的完整任务说明在同一条消息的附件中（$prompt_file）。请先通读附件，再严格按其中的要求执行。"
        else
            prompt="Your task description is long. First read $prompt_file in full, then follow the instructions in the file."
        fi
    fi

    # 模型选择：夜间窗口且配置了 NIGHT_MODEL → 廉价模型；否则 OPENCODE_MODEL / opencode 默认
    local model="${OPENCODE_MODEL:-}"
    if [ -n "$NIGHT_MODEL" ] && in_night_window; then
        model="$NIGHT_MODEL"
    fi

    log_info "Calling opencode (model=${model:-default}): ${prompt:0:200}"

    local out_file err_file start_ts rc opencode_pid oc_title oc_sid
    out_file=$(mktemp "$LOG_DIR/opencode-out-XXXXXX")
    err_file=$(mktemp "$LOG_DIR/opencode-err-XXXXXX")
    start_ts=$(date +%s)
    # 标题带上任务号与启动时间：人工在 session list 里可辨认
    oc_title="worker-${task_id:-manual}-$(date +%s)"
    # 预分配会话 ID：超时/停服时无需扫描会话列表即可精确取消
    oc_sid=""
    [ "$OC_CAP_SESSION" = "1" ] && oc_sid="ses_worker_${task_id:-manual}_$(date +%s%N)"

    local -a oc_args=("${OPENCODE_FLAGS[@]}" --title "$oc_title")
    [ "$OC_CAP_JSON" = "1" ] && oc_args+=(--format json)
    [ -n "$oc_sid" ] && oc_args+=(--session "$oc_sid")
    [ -n "$model" ] && oc_args+=(--model "$model")
    [ -n "$OPENCODE_AGENT" ] && oc_args+=(--agent "$OPENCODE_AGENT")

    # stdout（JSON 事件流）与 stderr（客户端日志）必须分开：混流会破坏逐行 JSON 解析。
    # 超时交给 timeout 自己：默认模式下它会为目标命令新建进程组，超时先 TERM 整组，
    # --kill-after 再兜底 KILL，rc=124；不必在 shell 里轮询（省掉每次最多 5s 空等）。
    setsid timeout --kill-after=10 "$task_timeout" opencode run "$prompt" "${oc_args[@]}" \
        ${oc_file_args[@]+"${oc_file_args[@]}"} \
        > "$out_file" 2> "$err_file" 9>&- &
    opencode_pid=$!
    echo "$opencode_pid" > "$LOG_DIR/oc-$opencode_pid.pid"
    [ -n "$oc_sid" ] && echo "$oc_sid" > "$LOG_DIR/oc-$opencode_pid.sid"

    wait "$opencode_pid" 2>/dev/null
    rc=$?

    # 124=超时、143=收到 SIGTERM（停服）：CLI 已死，但服务端会话可能还在跑
    if [ "${rc:-0}" -eq 124 ] || [ "${rc:-0}" -eq 143 ]; then
        cleanup_opencode_session "$oc_title" "$oc_sid"
    fi

    local result="" err_events="" usage="" steps=0 tok_in=0 tok_out=0 cost=0 tools=""
    if [ "$OC_CAP_JSON" = "1" ]; then
        # 逐行流式解析（不 slurp，避免大段工具输出占内存）；fromjson? 容忍被超时截断的末行
        result=$(jq -R -r 'fromjson? | select(.type == "text") | .part.text' "$out_file" 2>/dev/null)
        [ -z "$oc_sid" ] && oc_sid=$(jq -R -r 'fromjson? | .sessionID // empty' "$out_file" 2>/dev/null | head -1)
        err_events=$(jq -R -r 'fromjson? | select(.type == "error") | "\(.error.type // "error"): \(.error.message // "")"' \
            "$out_file" 2>/dev/null | head -3)
        usage=$(jq -R -r 'fromjson? | select(.type == "step_finish") | [(.part.tokens.input // 0), (.part.tokens.output // 0), (.part.cost // 0)] | @tsv' \
            "$out_file" 2>/dev/null \
            | awk 'NF >= 3 { n++; i += $1; o += $2; c += $3 } END { printf "%d %d %d %.6f", n+0, i+0, o+0, c+0 }')
        read -r steps tok_in tok_out cost <<< "$usage"
        tools=$(jq -R -r 'fromjson? | select(.type == "tool_use") | .part.tool // empty' "$out_file" 2>/dev/null \
            | sort | uniq -c | awk '{ printf "%s%s×%d", (n++ ? " " : ""), $2, $1 }')
        # step_finish 只覆盖"工具调用步"，纯文本收尾步不上报；成功时以
        # `session export` 的会话汇总为准（含标题生成等全部调用），拿到再覆盖
        if [ -n "$oc_sid" ] && [ "${rc:-0}" -eq 0 ]; then
            local export_json export_usage export_steps
            export_json=$(timeout 15 opencode session export "$oc_sid" 2>/dev/null)
            if [ -n "$export_json" ]; then
                export_usage=$(jq -r '[(.info.tokens.input // 0), (.info.tokens.output // 0), (.info.cost // 0)] | @tsv' \
                    <<< "$export_json" 2>/dev/null)
                export_steps=$(jq -r '[.messages[]? | select(.type == "assistant")] | length' \
                    <<< "$export_json" 2>/dev/null)
                if [ -n "$export_usage" ]; then
                    read -r tok_in tok_out cost <<< "$export_usage"
                    [ "${export_steps:-0}" -gt 0 ] && steps=$export_steps
                fi
            fi
        fi
    else
        # 兼容模式：纯文本 + 去 ANSI
        result=$(sed 's/\x1b\[[0-9;]*m//g' "$out_file" 2>/dev/null)
    fi

    # 失败时把 stderr 尾部并入会话记录（JSON 模式下 stdout 已不含客户端日志）
    if [ "${rc:-0}" -ne 0 ] && [ -s "$err_file" ]; then
        result+=$'\n--- stderr ---\n'"$(sed 's/\x1b\[[0-9;]*m//g' "$err_file" | tail -40)"
    fi

    local duration=$(( $(date +%s) - start_ts ))
    rm -f "$out_file" "$err_file"
    [ -n "$prompt_file" ] && rm -f "$prompt_file"

    if [ "$rc" -eq 124 ]; then
        log_error "AI task killed (timeout, ${duration}s, session=${oc_sid:-?})"
    elif [ "$rc" -eq 143 ]; then
        log_info "AI task stopped (service shutdown, session=${oc_sid:-?})"
    elif [ "$rc" -ne 0 ]; then
        log_error "opencode exited abnormally (exit code $rc, ${duration}s)"
        if [ -n "$err_events" ]; then
            log_error "opencode 错误事件: $(printf '%s' "$err_events" | tr '\n' ';')"
        fi
        # 兼容模式/无结构化错误时，仍按文本特征给出可操作提示
        if grep -qi 'Unrecognized flag' <<< "$result"; then
            log_error "opencode 拒绝 CLI 参数（疑似 opencode 升级），请核对 OPENCODE_FLAGS"
        fi
        if grep -qiE 'ProviderModelNotFound|model[^ ]* not found|模型.*不存在|provider\.no-route' <<< "$result$err_events"; then
            log_error "opencode 模型不可用，请检查 OPENCODE_MODEL 与 opencode.json 的 provider 配置"
        elif grep -qiE 'fetch failed|ECONNREFUSED|connect ECONN|provider\.auth' <<< "$result$err_events"; then
            log_error "opencode 后台服务或模型后端连接/鉴权失败（检查 opencode serve 与 vllm）"
        fi
    else
        log_info "opencode completed (${duration}s${tools:+, tools: $tools}${oc_sid:+, session=$oc_sid})"
        if [ -n "$err_events" ]; then
            log_warn "opencode 会话内含错误事件: $(printf '%s' "$err_events" | tr '\n' ';')"
        fi
    fi

    # 用量落盘：按任务统计 token/费用与耗时，供自审/自省做量化分析
    if [ "$OC_CAP_JSON" = "1" ] && [ "${steps:-0}" -gt 0 ]; then
        log_info "opencode 用量: steps=$steps tokens_in=$tok_in tokens_out=$tok_out cost=$cost"
        if [ -n "$task_id" ]; then
            jq -cn --arg ts "$(date -Iseconds)" --arg task "$task_id" \
                --argjson rc "${rc:-0}" --argjson dur "$duration" \
                --argjson steps "$steps" --argjson tin "$tok_in" \
                --argjson tout "$tok_out" --arg cost "$cost" --arg session "$oc_sid" \
                --arg model "${model:-}" \
                '{time:$ts, task:$task, rc:$rc, duration:$dur, steps:$steps,
                  tokens_in:$tin, tokens_out:$tout, cost:($cost|tonumber),
                  session:$session, model:$model}' \
                >> "$LOG_DIR/opencode-usage.jsonl" 2>/dev/null || true
        fi
    fi

    if [ -n "$task_id" ]; then
        echo "$result" > "$LOG_DIR/opencode-$task_id.log"
    fi

    rm -f "$LOG_DIR/oc-$opencode_pid.pid" "$LOG_DIR/oc-$opencode_pid.sid"
    return "${rc:-0}"
}

# ---- 报告有效性判定 / 回退 ----
# 任务重试场景下，正式报告路径可能残留上一次尝试的回退内容；仅凭 [ -s ] 判非空
# 会把残留误判为"AI 已写出"，掩盖失败（2026-10-23 self-review/introspection 各
# 3 次超时、正式报告被会话转储污染即此缺陷）。有效性 = 非空 且 mtime 不早于本次任务开始。
report_fresh() {
    local file=$1 task_start=$2
    [ -s "$file" ] || return 1
    local mtime
    mtime=$(stat -c %Y "$file" 2>/dev/null || echo 0)
    [ "$mtime" -ge "$task_start" ]
}

# 回退保存去 ANSI 的会话输出：只写 <report>.attempt-fallback.bak，永不覆盖正式
# 报告路径（残留转储会被次日报告链当作真报告消费，且污染重试的成功判定）
save_fallback_session() {
    local task_id=$1 report=$2
    sed 's/\x1b\[[0-9;]*m//g' "$LOG_DIR/opencode-$task_id.log" \
        > "${report}.attempt-fallback.bak" 2>/dev/null || true
    log_warn "AI 未写出报告，会话输出已存 ${report}.attempt-fallback.bak"
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
            if [ -n "$task_data" ] && [ -f "$task_data" ]; then
                # 文件级检查（文件监听触发，task_data=变更文件）：只 lint 该文件。
                # 此前每次文件变更都触发整库 make lint：单次输出 ~3.9M 写入 lint.log
                # （10M 上限 24h 内轮转 2 次），且 10-16 三次 linter 崩溃（exit=2，
                # 与并发写入竞态相关）引发 5 次无效重试（10-17 自审）。
                cd "$WORK_DIR" && "$WORK_DIR/atlisp-lint/bin/atlisp-lint" "$task_data" >> "$LOG_DIR/lint.log" 2>&1 || exit_code=$?
            else
                cd "$WORK_DIR" && make lint >> "$LOG_DIR/lint.log" 2>&1 || exit_code=$?
            fi
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
                if ! report_fresh "$suggest_file" "$start_time"; then
                    save_fallback_session "$task_id" "$suggest_file"
                fi
                if report_fresh "$suggest_file" "$start_time"; then
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
            art_file="$WORK_DIR/docs/@lisp-article/@lisp-article-$(date +%Y%m%d)-${art_pkg}.md"
            mkdir -p "$WORK_DIR/docs/@lisp-article"
            call_opencode "你是面向 CAD 用户的 @lisp 推广作者。请以应用包【$art_pkg】为题材，写一篇推广/介绍文章。
【素材】先阅读 ~/atlisp/packages/$art_pkg/ 下的文件（README.md、pkg.lsp、*.lsp、*.org 等），弄清它解决什么问题、提供哪些命令/功能、如何使用；示例必须来自真实内容。
【角度】二选一（自行判断更合适者）：
 (a) 面向 CAD 用户：使用介绍 —— 场景痛点 → 该包如何解决 → 具体命令与操作示例；
 (b) 面向开发者：AutoLISP 开发介绍 —— 实现思路、关键函数、可复用技巧。
【加分】若能自然结合 AI 能力（规范问答、代码生成、@lisp AI 助手等），请融入正文。
【公众号排版】文章会直接转成公众号图文，必须严格按下列骨架输出（「标题备选」与「正文」两块缺一不可）：
# 文章标题（文件标题，可随意）
**一句话卖点**：20~60 字（必填，直接作为公众号摘要，不得超过 120 字）
---
## 标题备选
1. **正式标题（20 字内，有信息量）**
2. **备选标题**
## 正文
### 导语
2~3 句、60~120 字，写清场景痛点与本文价值（摘要缺失时会取这段）。
### 一、小节标题
正文段落、命令示例与代码。
### 二、小节标题
……
### 小结
一句话收束，给出适用场景或下一步。
> 生成时间：$(date +%F) ｜ 所涉包：$art_pkg
【要求】中文，正文 1000~1500 字；结构清晰（标题 / 导语 / 小标题 / 示例代码 / 小结）；函数名与命令必须来自该包真实内容，禁止编造；避免夸大宣传与空话。
最后必须：把文章写入文件 $art_file（Markdown，含标题、生成时间与所涉包名），并在回答末尾给出该文件路径。" "$task_id" "$AI_LONG_TASK_TIMEOUT" || exit_code=$?
            if [ -s "$art_file" ]; then
                echo "$(date +%F) $art_pkg $art_file" >> "$ARTICLE_TOPIC_LOG"
                log_info "AI 文章: $art_file"
                publish_article_to_wechat "$art_file" "$art_pkg"
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
  - 必须保留全部 id 以 autopost- 开头的任务（社交推广自动发布，核心业务任务，勿删勿禁用；可调整其 time/days）
  - 仅做有依据的最小改动；若无调整必要，请不要生成该文件
【边界】时间预算约 45 分钟，优先完成【输出1】报告写盘。本任务只做分析与调度建议：禁止修改任何代码/脚本/配置文件（work-service.sh、automation/*.sh、agent、lib、packages、kernel 等一律不改）；发现的代码问题写入报告作为建议，交由对应任务处理。
最后在回答末尾给出报告路径。" "$task_id" "$AI_LONG_TASK_TIMEOUT" || exit_code=$?
            if report_fresh "$review_report" "$start_time"; then
                log_info "自我迭代报告: $review_report"
            else
                save_fallback_session "$task_id" "$review_report"
                log_error "AI 未写出自我迭代报告（本次尝试无产出，日志: logs/opencode-$task_id.log）"
            fi
            # 仅应用本次任务新产生的候选调度：残留的历史候选（服务中断等）不代表当日判断
            if [ -f "$WORK_DIR/logs/schedule.proposed.json" ] && \
               [ "$(stat -c %Y "$WORK_DIR/logs/schedule.proposed.json" 2>/dev/null || echo 0)" -ge "$start_time" ]; then
                apply_proposed_schedule
            else
                log_info "无本次任务产生的调度调整建议"
            fi
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
【边界】时间预算约 40 分钟，优先完成【输出1】报告与【输出2】lessons.md 写盘；除这两处外不得修改任何其他文件（代码/脚本/配置一律不改），发现的问题写入报告作为建议。
最后在回答末尾给出报告与教训文件的路径。" "$task_id" "$AI_LONG_TASK_TIMEOUT" || exit_code=$?
            if report_fresh "$introspect_report" "$start_time"; then
                log_info "自省报告: $introspect_report"
            else
                save_fallback_session "$task_id" "$introspect_report"
                log_error "AI 未写出自省报告（本次尝试无产出，日志: logs/opencode-$task_id.log）"
            fi
            ;;
        "ai-agent-optimize")
            local opt_date opt_report opt_input opt_applied
            opt_date=$(date +%Y%m%d)
            opt_report="$WORK_DIR/reports/agent-optimize/agent-optimize-$opt_date.md"
            opt_input="$LOG_DIR/agent-optimize-input-$opt_date.md"
            opt_applied="$WORK_DIR/reports/agent-optimize/applied.md"
            mkdir -p "$WORK_DIR/reports/agent-optimize"
            python3 "$WORK_DIR/automation/agent-memory-analysis.py" "$opt_input" > /dev/null 2>&1 || true
            call_opencode "你是 @lisp 自动化员工（atlisp-worker）的 agent 项目优化模块。职责：分析 ~/.atlisp/memory/ 里的真实用户会话，找出 agent 项目 /home/vitalgg/atlisp/agent 中的反复出现问题，做最小且可验证的优化。
【输入】
- 会话分析输入: $opt_input（总览统计 + 最近 48 小时会话详情 + 全量会话索引，超长内容已显式标注截断）。
- 已应用优化: $opt_applied（若文件不存在则视为首次运行）。
- memory 原文: ~/.atlisp/memory/（每个文件一轮消息, memory.<sessionId>.json）；输入细节不足时按需读取原文交叉核对。
【分析要求】
1. 只针对「反复出现」的问题：同类问题（误判 / 回答错误 / 编造图纸属性 / 工具缺失 / 用户重复提问或抱怨）在 2 个及以上会话出现，或单会话有严重问题的充分证据。
2. 先对照 $opt_applied：已有优化条目的问题跳过（除非 memory 显示该修复无效——在报告中说明重新处理的原因）。
3. 根因必须定位到 agent 项目的具体代码（文件 + 函数）；若根因不在 agent（CAD 端数据 / 模型能力 / 用户问题），只记录到报告，不改代码。
【实施要求】（仅当存在可优化项时执行）
4. 动手前检查 /home/vitalgg/atlisp/agent 的 git status --porcelain：若有未提交改动（可能是昨夜未完成），先运行 npx vitest run，通过则作为昨夜工作的收尾提交（报告中注明）再继续；不通过则 git restore . 并在报告说明。
5. 最小改动：只改 /home/vitalgg/atlisp/agent/src/（含 src/test/ 测试），遵循仓库规范（新行为加测试、匹配既有代码风格），覆盖率棘轮不得跌破。不要改 lib、packages、kernel 或根仓库。
6. 验证（全部必须，在 /home/vitalgg/atlisp/agent 内执行）：npx vitest run（全量通过）、npx eslint src/、npx prettier --check src/。
7. 任一验证失败：git restore . 回滚，并在报告明确「改动已回滚，原因是…」。不要把失败的改动带入第二天。
8. 验证通过后：git add + git commit（conventional commit 格式、中文描述、引用 memory 证据），然后 git push origin main。
【输出1（必须）】把分析报告写入 $opt_report（Markdown，包含：总览、发现的问题（带会话证据）、本次应用项（改动点 + commit hash）、未应用项（原因）、回滚项（原因）、后续观察建议）。
【输出2（必须）】若实际应用了优化，更新 $opt_applied：
  - 行格式: - [YYYY-MM-DD] 问题摘要 → 改动点 (agent@短hash)，一行一条；
  - 保持总条目数不超过 60 条，超出时删除最旧条目；
  - 若今日未应用任何优化，不要修改该文件。
【时间预算】约 50 分钟；若临近预算，优先保证 vitest/eslint/prettier 验证通过并完成 commit 或回滚，报告可精简但不可缺。
最后在回答末尾给出报告路径与 commit hash（如有）。" "$task_id" "$AI_LONG_TASK_TIMEOUT" || exit_code=$?
            if report_fresh "$opt_report" "$start_time"; then
                log_info "Agent 优化报告: $opt_report"
            else
                save_fallback_session "$task_id" "$opt_report"
                log_error "AI 未写出 agent 优化报告（本次尝试无产出，日志: logs/opencode-$task_id.log）"
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
        "autopost")
            # 社交推广发布（task_data = qzone|douyin），实现见 automation/autopost/
            if [ "$AUTOPOST_MODE" = "off" ]; then
                log_info "autopost($task_data): AUTOPOST_MODE=off，跳过"
            elif [ "$AUTOPOST_MODE" = "dry-run" ]; then
                timeout 1800 node "$WORK_DIR/automation/autopost/bin/post-once.mjs" "$task_data" --dry-run \
                    >> "$LOG_DIR/autopost.log" 2>&1 || exit_code=$?
            else
                timeout 1800 node "$WORK_DIR/automation/autopost/bin/post-once.mjs" "$task_data" \
                    >> "$LOG_DIR/autopost.log" 2>&1 || exit_code=$?
            fi
            ;;
        "autopost-content")
            # 自动生成推广内容：轮换挑包 → opencode 写文案 → gen-content.py 渲染视频+入队。
            # 生成的内容进 autopost 队列，由 autopost-qzone/autopost-douyin 任务到点发布。
            if [ "$AUTOPOST_MODE" = "off" ]; then
                log_info "autopost-content: AUTOPOST_MODE=off，跳过"
            else
                local ap_pkg ap_copy
                ap_pkg=$(pick_autopost_pkg)
                if [ -z "$ap_pkg" ]; then
                    log_warn "autopost-content: 未找到可用应用包，跳过"
                else
                    ap_copy="$LOG_DIR/autopost-copy-$(date +%Y%m%d-%H%M%S).json"
                    call_opencode "你是面向 CAD 用户的 @lisp 推广文案作者。请为应用包【$ap_pkg】生成一套社交媒体推广内容。
【素材】先阅读 ~/atlisp/packages/$ap_pkg/ 下的文件（README.md、pkg.lsp、*.lsp、*.org 等），弄清它解决什么问题、提供哪些命令/功能；示例必须来自真实内容，禁止编造。
【输出】把结果写入文件 $ap_copy（UTF-8，纯 JSON，不要 markdown 代码围栏），结构（英文键、中文值）：
{
  \"qzone\": \"QQ空间说说正文：80~180字，口语化，包含 1 个真实使用场景 + 1 个实际命令，结尾一句收益；可带 1~2 个 #话题# 标签；不要硬广口吻、不要外链和二维码\",
  \"title\": \"抖音标题：15~30字，有钩子（痛点/反差/数字），不夸大\",
  \"topics\": [\"话题1\", \"话题2\", \"话题3\"],
  \"command\": \"该包真实入口命令（如 (at-arch:ai-parking-number 1 nil)），必须逐字取自包源码，≤40 字符\",
  \"slides\": [\"第1屏 钩子\", \"第2屏 痛点\", \"第4屏 效果\", \"第5屏 收益1\", \"第5屏 收益2\"]
}
- topics：3~5 个，选平台真实存在的垂类话题（如 AutoCAD、CAD插件、AutoLISP、工程效率 等），不要生造
- command：必须是该包 pkg.lsp/主 .lsp 里真实存在的入口命令（用户实际输入的那条），禁止编造；
  **优先选无交互的 ai- 入口**（形如 (ns:ai-xxx 参数…)）——实拍演示会在 CAD 里真实执行这条命令，
  交互命令（弹窗/等鼠标）会导致录制卡住；没有 ai- 入口时才用普通命令
- slides：恰好 5 项，竖版短视频屏文案（第3屏命令屏由 command 字段自动生成，无需写）：
  第1屏钩子 ≤14 字；第2屏痛点（具体场景）≤16 字；第4屏跑完命令后的效果 ≤16 字；第5屏两条短收益各 ≤12 字
【要求】中文；命令名/函数名必须来自该包真实内容；不要提及抖音/公众号/微信等其他平台；不要虚假承诺。
完成后确认文件已写入，并在回答末尾输出该文件路径。" "$task_id" "$AI_LONG_TASK_TIMEOUT" || exit_code=$?
                    if [ -s "$ap_copy" ]; then
                        # 实拍演示（目前只有 at-arch 有录屏脚本）：成功则把 demo 字段注入 copy.json，
                        # 走 8 屏实拍版式；失败/超时/画面异常则保持 6 屏，不影响发布。
                        if [ "$ap_pkg" = "at-arch" ]; then
                            local ap_demo
                            ap_demo="$AUTOPOST_DIR/media/demo-$ap_pkg-$(date +%Y%m%d).mp4"
                            if timeout 900 node "$AUTOPOST_DIR/bin/demo-capture.mjs" --pkg "$ap_pkg" \
                                    --out "$ap_demo" >> "$LOG_DIR/autopost.log" 2>&1 && [ -s "$ap_demo" ]; then
                                if jq --arg d "media/$(basename "$ap_demo")" '.demo = $d' "$ap_copy" > "$ap_copy.tmp" \
                                        && mv "$ap_copy.tmp" "$ap_copy"; then
                                    log_info "autopost-content: 实拍演示已生成（8 屏版式）$ap_demo"
                                fi
                            else
                                rm -f "$ap_demo"
                                log_warn "autopost-content: 实拍演示失败，回退 6 屏版式"
                            fi
                        fi
                        python3 "$AUTOPOST_DIR/bin/gen-content.py" --pkg "$ap_pkg" --copy "$ap_copy" \
                            >> "$LOG_DIR/autopost.log" 2>&1 || exit_code=$?
                        echo "$(date +%F) $ap_pkg" >> "$AUTOPOST_TOPIC_LOG"
                    else
                        log_warn "autopost-content: AI 未写出文案文件（$ap_copy），跳过；题材 $ap_pkg 不计入已用"
                    fi
                fi
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
    if [ "$status" = "failed" ] && [ "$exit_code" -eq 124 ]; then
        # 即败型：同 prompt、同超时上限的重试大概率以同样方式再次超时
        # （2026-10-23 self-review/introspection 各 3×3600s 全超时，连烧 3.5h 并
        # 互相抢占 vllm）。直接归档失败并告警，根因留给次日自审/自省分析。
        log_error "AI 任务超时（${duration}s 达上限），按即败型跳过重试: $task_name"
    elif [ "$status" = "failed" ] && [ "$retry_count" -lt "$MAX_RETRY" ]; then
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
        # $work_file 已在上方被 mv 到 done/，须从归档路径读 type
        # （2026-10-22 自审：原代码读不存在的文件 → type 恒空 → ai-* 分支从未触发）
        task_type=$(jq -r '.type // empty' "$WORK_DIR/tasks/done/$task_id.task" 2>/dev/null)
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
WECHAT_PUBLISH_LOG="$LOG_DIR/wechat-publish.log"

# 文章生成后转公众号草稿/发布。失败不影响文章任务本身（文章已落盘）。
publish_article_to_wechat() {
    local md=$1 pkg=$2
    local mode="$WECHAT_ARTICLE_MODE"
    [ "$mode" = "off" ] && return 0

    local mode_args=()
    case "$mode" in
        dry-run) mode_args=(--dry-run) ;;
        draft)   ;;
        publish) mode_args=(--publish) ;;
        *) log_warn "未知 WECHAT_ARTICLE_MODE=$mode，按 off 处理"; return 0 ;;
    esac

    local relay_args=()
    [ -n "${WECHAT_RELAY_HOST:-}" ] && relay_args=(--remote "$WECHAT_RELAY_HOST")

    # 经跳板机时凭据在跳板机的 server/.env 里，本机不需要
    if [ "$mode" != "dry-run" ] && [ -z "${WECHAT_RELAY_HOST:-}" ] &&
       { [ -z "${WECHAT_APPID:-}${WX_MP_APPID:-}" ] || [ -z "${WECHAT_APPSECRET:-}${WX_MP_SECRET:-}" ]; }; then
        log_warn "公众号发布跳过：未配置 WECHAT_APPID/WECHAT_APPSECRET（文章已保留）"
        echo "$(date +%F) $pkg skip:no-credentials" >> "$WECHAT_PUBLISH_LOG"
        return 0
    fi

    # 构建产物放 logs/（不污染 docs 仓库）
    local build_dir="$LOG_DIR/wechat/$(date +%Y%m%d)-$pkg"
    mkdir -p "$build_dir"

    local out media_id
    if out=$(bash "$WORK_DIR/automation/wechat/publish.sh" "$md" \
                 --build-dir "$build_dir" \
                 ${relay_args[@]+"${relay_args[@]}"} \
                 ${mode_args[@]+"${mode_args[@]}"} 2>&1); then
        if [ "$mode" = "dry-run" ]; then
            log_info "公众号发布预检通过（dry-run，未联网，产物 $build_dir）"
            echo "$(date +%F) $pkg dry-run ok $build_dir" >> "$WECHAT_PUBLISH_LOG"
            return 0
        fi
        media_id=$(printf '%s\n' "$out" | grep -o 'media_id = [A-Za-z0-9_-]*' | tail -1 | awk '{print $3}')
        if [ "$mode" = "publish" ]; then
            log_info "公众号已发布: ${media_id:-unknown}（mode=publish, 产物 $build_dir）"
        else
            log_info "公众号草稿已创建: ${media_id:-unknown}（mode=$mode, 产物 $build_dir）"
        fi
        echo "$(date +%F) $pkg $mode ${media_id:-ok} $build_dir" >> "$WECHAT_PUBLISH_LOG"
    else
        log_error "公众号草稿创建失败（文章已保留）: $(printf '%s' "$out" | tail -3 | tr '\n' ' ')"
        echo "$(date +%F) $pkg $mode failed $build_dir" >> "$WECHAT_PUBLISH_LOG"
    fi
    return 0
}

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

# ---- 社交推广内容生成（autopost） ----
AUTOPOST_DIR="$WORK_DIR/automation/autopost"
AUTOPOST_TOPIC_LOG="$WORK_DIR/logs/autopost-topics.log"

pick_autopost_pkg() {
    local all used cand
    all=$(find "$WORK_DIR/packages" -mindepth 1 -maxdepth 1 -type d ! -name '.*' \
          -exec basename {} \; 2>/dev/null | sort)
    [ -z "$all" ] && return 0
    # 与微信文章题材独立轮换：近 60 条已用优先排除（候选不足时回退全量）
    used=$(tail -60 "$AUTOPOST_TOPIC_LOG" 2>/dev/null | awk '{print $2}' | sort -u)
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

    # 巡检长期 0 错误、警告仅漂移：无变化时不刷日志（worker.log 曾累计 5602 条
    # 同值巡检行，纯噪声）；出现错误或计数变化仍立即记录，闭环复检能力不受影响
    local qs_file="$LOG_DIR/.quality-last-summary" qs_now qs_last
    qs_now="$error_count/$warning_count"
    qs_last=$(cat "$qs_file" 2>/dev/null || echo "")
    if [ "$error_count" -gt 0 ] || [ "$qs_now" != "$qs_last" ]; then
        log_info "Code check: $error_count errors, $warning_count warnings"
        printf '%s' "$qs_now" > "$qs_file"
    fi

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

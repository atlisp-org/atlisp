#!/bin/bash
# /home/vitalgg/atlisp/automation/schedule.sh
# 数据驱动调度：从 logs/schedule.json（无则用 automation/schedule.json）读取任务定义。
# 由 work-service.sh source。提供按天去重、宽限补跑、候选调度校验后应用等能力，
# 使 worker 能够通过自我迭代报告改进自身的工作安排而无需修改脚本代码。

SCHEDULE_DEFAULT="$WORK_DIR/automation/schedule.json"
SCHEDULE_ACTIVE="$WORK_DIR/logs/schedule.json"
SCHEDULE_STATE="$WORK_DIR/logs/schedule-state.json"
SCHEDULE_HISTORY_DIR="$WORK_DIR/logs/schedule-history"

# 返回当前生效的调度文件
schedule_file() {
    if [ -s "$SCHEDULE_ACTIVE" ] && jq empty "$SCHEDULE_ACTIVE" 2>/dev/null; then
        echo "$SCHEDULE_ACTIVE"
    else
        echo "$SCHEDULE_DEFAULT"
    fi
}

# 读取某任务今日是否已运行（返回日期字符串）
schedule_state_get() {
    local id=$1
    [ -f "$SCHEDULE_STATE" ] || return 1
    jq -r --arg id "$id" '.[$id] // empty' "$SCHEDULE_STATE" 2>/dev/null
}

# 记录某任务今日已运行
schedule_mark_run() {
    local id=$1 day=$2 tmp
    tmp="${SCHEDULE_STATE}.tmp.$$"
    if [ -f "$SCHEDULE_STATE" ] && jq empty "$SCHEDULE_STATE" 2>/dev/null; then
        jq --arg id "$id" --arg d "$day" '.[$id] = $d' "$SCHEDULE_STATE" > "$tmp" 2>/dev/null || echo "{}" > "$tmp"
    else
        jq -n --arg id "$id" --arg d "$day" '{($id): $d}' > "$tmp" 2>/dev/null || echo "{}" > "$tmp"
    fi
    mv -f "$tmp" "$SCHEDULE_STATE" 2>/dev/null || rm -f "$tmp"
}

# 日期匹配：days 为 * / 1-7（逗号分隔，1=周一）/ dom:DD（逗号分隔）
schedule_day_match() {
    local days=$1 dow=$2 dom=$3 d
    [ "$days" = "*" ] && return 0
    if [[ "$days" == dom:* ]]; then
        local IFS=','
        for d in ${days#dom:}; do
            [ "$((10#$d))" = "$((10#$dom))" ] && return 0
        done
        return 1
    fi
    local IFS=','
    for d in $days; do
        [ "$d" = "$dow" ] && return 0
    done
    return 1
}

# 主调度：每分钟调用，负责到点建任务、按天去重、宽限期内补跑
run_schedule() {
    local sched
    sched=$(schedule_file)
    if [ ! -s "$sched" ] || ! jq empty "$sched" 2>/dev/null; then
        log_warn "schedule.json 不可用，回退内置调度"
        check_schedule
        daily_ai_tasks
        return 0
    fi

    local now_epoch dow dom today grace rows
    now_epoch=$(date +%s)
    dow=$(date +%u)
    dom=$(date +%d)
    today=$(date +%F)

    grace=$(jq -r '.grace_seconds // 3600' "$sched" 2>/dev/null)
    [[ "$grace" =~ ^[0-9]+$ ]] || grace=3600

    # 单次 jq 解析整份调度。原实现对每个任务逐个字段调用 jq（16 任务 × 8 次
    # ≈ 128 个进程/分钟），此处压到 1 次。
    # 字段分隔用 US(\x1f) 而非制表符：tab 属于 IFS 空白字符，连续空字段会被
    # read 合并，导致 data/dynamic 为空时整行错位；US 不是空白字符，空字段保留。
    # 末尾附 EOT 哨兵用于检测被截断的行；data 内的换行在 jq 内转义为 \n。
    rows=$(jq -r '
        .tasks[]? |
        [ (.id // ""), (.name // .id // ""), (.type // ""), (.time // ""),
          ((.priority // 5) | tostring), (.days // "*"),
          (.data // ""), (.dynamic // ""),
          (if has("enabled") then (.enabled | tostring) else "true" end),
          "EOT" ]
        | map(tostring | gsub("\n"; "\\n") | gsub("\u001f"; ""))
        | join("\u001f")' "$sched" 2>/dev/null)
    [ -n "$rows" ] || return 0

    local id name type prio time days data dynamic enabled eot sched_epoch
    while IFS=$'\x1f' read -r id name type time prio days data dynamic enabled eot; do
        [ "$eot" = "EOT" ] || { log_warn "调度项字段数异常，跳过"; continue; }
        data=${data//\\n/ }   # 还原为单行（与 create_task 对 data 的处理一致）
        [ "$enabled" = "true" ] || continue
        schedule_day_match "$days" "$dow" "$dom" || continue
        [[ "$time" =~ ^[0-9]{2}:[0-9]{2}$ ]] || continue
        sched_epoch=$(date -d "today $time" +%s 2>/dev/null) || continue
        [ "$now_epoch" -ge "$sched_epoch" ] || continue
        [ $((now_epoch - sched_epoch)) -le "$grace" ] || continue
        [ -n "$id" ] || continue
        [ "$(schedule_state_get "$id")" = "$today" ] && continue

        [[ "$prio" =~ ^[0-9]+$ ]] || prio=5
        [ -n "$name" ] || name=$id

        if [ "$dynamic" = "article_pkg" ]; then
            data=$(pick_article_pkg)
            if [ -z "$data" ]; then
                log_warn "未找到可用应用包，跳过: $name"
                schedule_mark_run "$id" "$today"
                continue
            fi
        fi

        create_task "$name" "$type" "$prio" "$data"
        schedule_mark_run "$id" "$today"
    done <<< "$rows"
}

# 应用 AI 生成的候选调度：校验通过后备份并替换，否则拒绝
apply_proposed_schedule() {
    local prop="$WORK_DIR/logs/schedule.proposed.json"
    local cur="$SCHEDULE_ACTIVE"
    local validator="$WORK_DIR/automation/validate-schedule.py"

    [ -f "$prop" ] || { log_info "无调度调整建议"; return 0; }

    if [ "${SELF_ITERATE_APPLY:-true}" != "true" ]; then
        log_info "SELF_ITERATE_APPLY=false，保留候选调度供人工审阅: $prop"
        return 0
    fi

    if python3 "$validator" "$prop" > /dev/null 2>&1; then
        mkdir -p "$SCHEDULE_HISTORY_DIR"
        if [ -f "$cur" ]; then
            cp -f "$cur" "$SCHEDULE_HISTORY_DIR/schedule-$(date +%Y%m%d-%H%M%S).json" 2>/dev/null
        elif [ -f "$SCHEDULE_DEFAULT" ]; then
            cp -f "$SCHEDULE_DEFAULT" "$SCHEDULE_HISTORY_DIR/schedule-$(date +%Y%m%d-%H%M%S).json" 2>/dev/null
        fi
        mv -f "$prop" "$cur"
        log_info "调度已自我迭代更新（历史备份于 logs/schedule-history/）"
    else
        mv -f "$prop" "$WORK_DIR/logs/schedule-rejected-$(date +%s).json" 2>/dev/null
        log_warn "候选调度未通过校验，已拒绝（见 logs/schedule-rejected-*.json）"
    fi
}

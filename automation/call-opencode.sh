#!/bin/bash
# /home/vitalgg/atlisp/automation/call-opencode.sh
# 通过 opencode CLI（v2）调用一次 AI
# 用法: call-opencode.sh "<prompt>" [timeout_seconds]
#
# v2 起非交互入口是 `opencode run`，v1 的 `-p/--yes` 已移除；
# 无人值守时必须带 --auto，否则工具权限确认会挂住。

PROMPT=${1:?用法: call-opencode.sh "<prompt>" [timeout_seconds]}
TIMEOUT=${2:-300}

# 夜间窗口（默认 18:05 → 次日 08:30，HH:MM 支持跨零点，start 含 end 不含）
# 使用廉价模型降成本；变量与 work-service.sh 同名，可经 /etc/atlisp/atlisp-worker.env 覆盖，
# 置空 NIGHT_MODEL 即关闭。
NIGHT_MODEL="${NIGHT_MODEL:-deepseek/deepseek-flash}"
NIGHT_START="${NIGHT_START:-18:05}"
NIGHT_END="${NIGHT_END:-08:30}"

args=(--auto)
if [ -n "$NIGHT_MODEL" ]; then
    if [[ "$NIGHT_START" =~ ^([01][0-9]|2[0-3]):[0-5][0-9]$ ]] && [[ "$NIGHT_END" =~ ^([01][0-9]|2[0-3]):[0-5][0-9]$ ]]; then
        now_m=$((10#$(date +%H) * 60 + 10#$(date +%M)))
        start_m=$((10#${NIGHT_START%%:*} * 60 + 10#${NIGHT_START##*:}))
        end_m=$((10#${NIGHT_END%%:*} * 60 + 10#${NIGHT_END##*:}))
        if [ "$start_m" -lt "$end_m" ]; then
            [ "$now_m" -ge "$start_m" ] && [ "$now_m" -lt "$end_m" ] && args+=(--model "$NIGHT_MODEL")
        else
            { [ "$now_m" -ge "$start_m" ] || [ "$now_m" -lt "$end_m" ]; } && args+=(--model "$NIGHT_MODEL")
        fi
    fi
fi

exec timeout "$TIMEOUT" opencode run "${args[@]}" "$PROMPT"

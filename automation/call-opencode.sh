#!/bin/bash
# /home/vitalgg/atlisp/automation/call-opencode.sh
# 通过 opencode CLI 调用 AI
# 用法: call-opencode.sh "<prompt>" [timeout_seconds]

PROMPT=$1
TIMEOUT=${2:-60}

# 方式1: 使用 opencode CLI（用 timeout 兜底，避免调用方被卡死）
exec timeout "$TIMEOUT" opencode -p "$PROMPT" --yes 2>&1

# 方式2: 使用 opencode 非交互模式
# echo "$PROMPT" | opencode --non-interactive

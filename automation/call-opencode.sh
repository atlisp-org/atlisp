#!/bin/bash
# /home/vitalgg/atlisp/automation/call-opencode.sh
# 通过 opencode CLI 调用 AI

PROMPT=$1
TIMEOUT=${2:-60}

# 方式1: 使用 opencode CLI
opencode -p "$PROMPT" --yes 2>&1

# 方式2: 使用 opencode 非交互模式
# echo "$PROMPT" | opencode --non-interactive

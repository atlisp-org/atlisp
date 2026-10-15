#!/bin/bash
# /home/vitalgg/atlisp/automation/optimize-code.sh
# Optimize code performance — analyze and suggest improvements
# 用法: optimize-code.sh [目录]（默认 lib/）

WORK_DIR="/home/vitalgg/atlisp"
TARGET="${1:-$WORK_DIR/lib}"
LINE_LIMIT="${LINE_LIMIT:-500}"

echo "Analyzing code in: $TARGET"

# 统计 .lsp 文件规模，报告需要拆分的大文件（避免逐文件 fork wc）
find "$TARGET" -name "*.lsp" -type f -printf '%s\t%p\n' 2>/dev/null \
    | sort -rn \
    | while IFS=$'\t' read -r size file; do
        lines=$(wc -l < "$file" 2>/dev/null || echo 0)
        lines=${lines//[[:space:]]/}
        [[ "$lines" =~ ^[0-9]+$ ]] || lines=0
        [ "$lines" -gt "$LINE_LIMIT" ] && \
            echo "WARNING: $file has $lines lines ($size bytes) — consider splitting"
      done

echo "Optimization analysis complete."

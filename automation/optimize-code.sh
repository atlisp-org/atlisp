#!/bin/bash
# /home/vitalgg/atlisp/automation/optimize-code.sh
# Optimize code performance — analyze and suggest improvements

WORK_DIR="/home/vitalgg/atlisp"
TARGET="${1:-$WORK_DIR/lib}"

echo "Analyzing code in: $TARGET"

# Find LSP files and report large/complex functions
find "$TARGET" -name "*.lsp" 2>/dev/null | while read -r f; do
    lines=$(wc -l < "$f" 2>/dev/null || echo 0)
    if [ "$lines" -gt 500 ]; then
        echo "WARNING: $f has $lines lines — consider splitting"
    fi
done

echo "Optimization analysis complete."

#!/bin/bash

# @lisp CAD应用云管理系统 - 开发建议生成器
# 调用 automation/project-analyzer.py 进行数据驱动分析，生成 Markdown 报告

set +e  # 容错模式：单个任务失败不中断

TARGET_DIR="${HOME}/atlisp"
REPORT_DIR="${TARGET_DIR}/reports"
REPORT_FILE="${REPORT_DIR}/dev-suggestions-$(date +%Y%m%d).md"
HISTORY_FILE="${REPORT_DIR}/dev-suggestions-history.md"
ANALYZER="${TARGET_DIR}/automation/project-analyzer.py"

mkdir -p "$REPORT_DIR"

if [ ! -f "$ANALYZER" ]; then
    echo "[ERROR] 分析器不存在: $ANALYZER" >&2
    exit 1
fi

if ! command -v python3 > /dev/null 2>&1; then
    echo "[ERROR] 未找到 python3，无法生成报告" >&2
    exit 1
fi

cd "$TARGET_DIR" || exit 1

# 分析并生成报告（失败时保留上一版报告）
TMP_FILE="${REPORT_FILE}.tmp.$$"
if python3 "$ANALYZER" --root "$TARGET_DIR" --output "$TMP_FILE"; then
    mv "$TMP_FILE" "$REPORT_FILE"
    echo "报告已生成: $REPORT_FILE"
else
    rm -f "$TMP_FILE"
    echo "[ERROR] 报告生成失败，保留原报告" >&2
    exit 1
fi

# 生成历史记录
echo "# 开发建议历史" > "$HISTORY_FILE"
echo "" >> "$HISTORY_FILE"
find "$REPORT_DIR" -maxdepth 1 -name 'dev-suggestions-*.md' ! -name '*history*' \
    2>/dev/null | sort -r | head -10 | while read -r file; do
    name=$(basename "$file")
    date=${name#dev-suggestions-}
    date=${date%.md}
    echo "- [$date]($name)" >> "$HISTORY_FILE"
done

# 附：AI 建议对照（与 ai-suggestions 相互印证）
# 注意：本报告不发送邮件；邮件通知由 ai-suggestions 任务负责（notify-email.py --report ...）
AI_REPORT=$(ls -t "$REPORT_DIR"/ai-suggestions-*.md 2>/dev/null | head -1)
if [ -n "$AI_REPORT" ] && [ -f "$AI_REPORT" ]; then
    {
        echo ""
        echo "## 八、AI 建议对照（ai-suggestions）"
        echo ""
        echo "最新 AI 改进建议: \`$(basename "$AI_REPORT")\`（$(date -r "$AI_REPORT" '+%Y-%m-%d %H:%M')）"
        echo ""
        echo "> 两份报告互为印证：本报告用实测数据回答「哪里有 / 有多少问题」，"
        echo "> AI 报告回答「可新增 / 扩展什么能力」。评审时对照阅读；"
        echo "> 若 AI 建议涉及本报告的错误级问题或高频规则，优先修复。"
        echo ""
        echo "AI 报告章节概览："
        grep -E '^#{1,3} ' "$AI_REPORT" 2>/dev/null | head -15 | sed 's/^/  - /'
    } >> "$REPORT_FILE"
    echo "已附加 AI 建议对照: $(basename "$AI_REPORT")"
fi

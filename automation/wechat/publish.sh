#!/usr/bin/env bash
# 一条命令把文章 Markdown 发成公众号草稿。
#
#   ./publish.sh ../../atlisp-dwg-kb/docs/推广文章.md --dry-run   # 只校验，不联网
#   ./publish.sh ../../atlisp-dwg-kb/docs/推广文章.md            # 建草稿
#   ./publish.sh ../../atlisp-dwg-kb/docs/推广文章.md --publish   # 建草稿并发布
#
# 产物（与文章同目录）：<stem>.html、<stem>-wechat.html、assets/cover.png、
# assets/cover-thumb.jpg。上传所需环境变量与限制见 README.md。
set -euo pipefail

SRC="${1:-}"
if [[ -z "$SRC" ]]; then
    echo "用法: $0 <文章.md> [--dry-run|--publish] [--author X] [--source-url URL]" >&2
    exit 2
fi
shift || true

HERE="$(cd "$(dirname "$0")" && pwd)"
PY="${PYTHON:-python3}"

if [[ ! -f "$SRC" ]]; then
    echo "找不到文章: $SRC" >&2
    exit 2
fi

DIR="$(cd "$(dirname "$SRC")" && pwd)"
MD="$DIR/$(basename "${SRC%.*}").md"
STEM="${MD%.md}"

echo "== 1/4 独立网页版"
"$PY" "$HERE/build-promo-html.py" "$MD"

echo "== 2/4 公众号正文（全内联样式）"
"$PY" "$HERE/build-promo-wechat.py" "$MD"

echo "== 3/4 封面（1080x460 + ≤64KB 缩略图）"
"$PY" "$HERE/build-promo-cover.py" "$MD"

echo "== 4/4 上传草稿"
"$PY" "$HERE/publish_wechat.py" \
    --html "${STEM}-wechat.html" \
    --cover "$DIR/assets/cover-thumb.jpg" \
    "$@"

#!/usr/bin/env bash
# 一条命令把文章 Markdown 发成公众号草稿。
#
#   ./publish.sh ../../atlisp-dwg-kb/docs/推广文章.md --dry-run   # 只校验，不联网
#   ./publish.sh ../../atlisp-dwg-kb/docs/推广文章.md            # 建草稿
#   ./publish.sh ../../atlisp-dwg-kb/docs/推广文章.md --publish   # 建草稿并发布
#
# 产物（默认与文章同目录，可用 --build-dir 改到构建目录）：<stem>.html、
# <stem>-wechat.html、assets/cover.png、assets/cover-thumb.jpg。
# 上传所需环境变量与限制见 README.md。
#
# --remote HOST：把发布动作放到跳板机（如 atlisp.cn）执行 —— 只有跳板机的出口 IP
# 在公众号白名单里时用这个。构建仍在本机做，只上传 HTML/封面/上传脚本，凭据留在
# 跳板机的 ~/www/@lisp/server/.env（WX_MP_APPID / WX_MP_SECRET），不经网络传输。
set -euo pipefail

SRC="${1:-}"
if [[ -z "$SRC" ]]; then
    echo "用法: $0 <文章.md> [--dry-run|--publish] [--build-dir DIR] [--remote HOST] [--author X] [--source-url URL]" >&2
    exit 2
fi
shift || true

# 透传给 publish_wechat.py 的参数；--build-dir / --remote 由本脚本消费
BUILD_DIR=""
REMOTE_HOST=""
PASSTHRU=()
while [[ $# -gt 0 ]]; do
    case "$1" in
        --build-dir)
            BUILD_DIR="${2:-}"
            if [[ -z "$BUILD_DIR" ]]; then
                echo "--build-dir 需要一个目录参数" >&2
                exit 2
            fi
            shift 2
            ;;
        --remote)
            REMOTE_HOST="${2:-}"
            if [[ -z "$REMOTE_HOST" ]]; then
                echo "--remote 需要跳板机主机名（如 atlisp.cn）" >&2
                exit 2
            fi
            shift 2
            ;;
        *)
            PASSTHRU+=("$1")
            shift
            ;;
    esac
done

HERE="$(cd "$(dirname "$0")" && pwd)"
PY="${PYTHON:-python3}"

if [[ ! -f "$SRC" ]]; then
    echo "找不到文章: $SRC" >&2
    exit 2
fi

DIR="$(cd "$(dirname "$SRC")" && pwd)"
MD="$DIR/$(basename "${SRC%.*}").md"
STEM="${MD%.md}"
NAME="$(basename "$STEM")"
OUT="${BUILD_DIR:-$DIR}"
mkdir -p "$OUT"

echo "== 1/4 独立网页版"
"$PY" "$HERE/build-promo-html.py" "$MD" -o "$OUT/$NAME.html"

echo "== 2/4 公众号正文（全内联样式）"
"$PY" "$HERE/build-promo-wechat.py" "$MD" -o "$OUT/$NAME-wechat.html"

echo "== 3/4 封面（1080x460 + ≤64KB 缩略图）"
"$PY" "$HERE/build-promo-cover.py" "$MD" --outdir "$OUT/assets"

echo "== 4/4 上传草稿"
if [[ -n "$REMOTE_HOST" ]]; then
    echo "   （经跳板机 $REMOTE_HOST；凭据取自跳板机 ~/www/@lisp/server/.env）"
    REMOTE_DIR="/tmp/atlisp-wx-$(date +%Y%m%d%H%M%S)-$$"
    SSH=(ssh -o BatchMode=yes -o ConnectTimeout=15 "$REMOTE_HOST")
    SCP=(scp -q -o BatchMode=yes -o ConnectTimeout=15)

    # 顺手清掉上次中断留下的临时目录（>1 天）
    "${SSH[@]}" "find /tmp -maxdepth 1 -name 'atlisp-wx-*' -mtime +1 -exec rm -rf {} + 2>/dev/null || true; mkdir -p '$REMOTE_DIR'"

    "${SCP[@]}" "$HERE/publish_wechat.py" \
        "$OUT/$NAME-wechat.html" "$OUT/assets/cover-thumb.jpg" \
        "$REMOTE_HOST:$REMOTE_DIR/"

    rc=0
    "${SSH[@]}" "cd '$REMOTE_DIR' && \
        export WECHAT_APPID=\"\$(sed -n 's/^WX_MP_APPID=//p' ~/www/@lisp/server/.env | head -1)\" && \
        export WECHAT_APPSECRET=\"\$(sed -n 's/^WX_MP_SECRET=//p' ~/www/@lisp/server/.env | head -1)\" && \
        python3 publish_wechat.py --html '$NAME-wechat.html' --cover cover-thumb.jpg ${PASSTHRU[*]+"${PASSTHRU[*]}"}; \
        rc=\$?; cd /; rm -rf '$REMOTE_DIR'; exit \$rc" || rc=$?
    exit "$rc"
fi

"$PY" "$HERE/publish_wechat.py" \
    --html "$OUT/$NAME-wechat.html" \
    --cover "$OUT/assets/cover-thumb.jpg" \
    ${PASSTHRU[@]+"${PASSTHRU[@]}"}

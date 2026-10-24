#!/usr/bin/env python3
"""Create a WeChat Official Account (公众号) draft from the promo article.

The article HTML comes from `build-promo-wechat.py` (inline styles only —
WeChat strips <style>/class CSS). This script only talks to the API:

    access_token -> upload cover as permanent thumb -> draft/add

It stops at the DRAFT. Publishing (群发/发布) is a separate decision:
either pass --publish explicitly, or open 公众号后台 → 内容管理 → 草稿箱 and
hit 发表 yourself.

Requirements
------------
* 已认证 订阅号/服务号（个人主体号没有草稿/发布接口权限）
* `WECHAT_APPID` + `WECHAT_APPSECRET` in the environment
  (后台 → 设置与开发 → 基本配置 → 公众号开发信息)
* the machine's public IP added to 后台 → 基本配置 → IP 白名单

Usage
-----
    export WECHAT_APPID=wx...
    export WECHAT_APPSECRET=...

    python publish_wechat.py --html article-wechat.html --cover assets/cover-thumb.jpg --dry-run
    python publish_wechat.py --html ... --cover ...     # 创建草稿
    python publish_wechat.py --html ... --cover ... --publish

No third-party dependencies (urllib only).
"""
from __future__ import annotations

import argparse
import json
import mimetypes
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

# WECHAT_API_BASE lets the flow be exercised against a local stub (tests/dev)
API = os.environ.get("WECHAT_API_BASE", "https://api.weixin.qq.com/cgi-bin").rstrip("/")
BODY_LIMIT = 20000          # 微信后台：正文 HTML 少于 2 万字符
THUMB_LIMIT = 64 * 1024     # 永久素材 thumb 上限 64KB

HINTS = {
    40001: "AppSecret 不对（或已重置），去后台重新取一次",
    40013: "AppID 不对（wx 开头 18 位）",
    40125: "AppSecret 无效",
    40164: "调用 IP 不在白名单：后台 → 基本配置 → IP 白名单，加上本机公网出口 IP",
    48001: "接口未授权：账号未认证（或该主体没有草稿/发布权限）",
    45009: "调用频率超限，等一会儿再试",
    40007: "thumb_media_id 无效（封面素材上传失败？）",
    53503: "该账号不支持此接口",
}


class WeChatError(RuntimeError):
    pass


def _request(url: str, data: bytes | None = None, content_type: str | None = None) -> dict:
    req = urllib.request.Request(url, data=data)
    if content_type:
        req.add_header("Content-Type", content_type)
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            raw = resp.read()
    except urllib.error.HTTPError as e:  # noqa: PERF203 - 简单脚本，统一报错即可
        raise WeChatError(f"HTTP {e.code}: {e.reason}") from e

    try:
        payload = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise WeChatError(f"非 JSON 响应：{raw[:200]!r}") from None

    errcode = payload.get("errcode", 0)
    if errcode:
        msg = payload.get("errmsg", "")
        hint = HINTS.get(errcode, "")
        raise WeChatError(
            f"微信接口报错 errcode={errcode} errmsg={msg}" + (f"\n  → {hint}" if hint else "")
        )
    return payload


def access_token(appid: str, secret: str) -> str:
    q = urllib.parse.urlencode(
        {"grant_type": "client_credential", "appid": appid, "secret": secret}
    )
    token = _request(f"{API}/token?{q}").get("access_token")
    if not token:
        raise WeChatError("拿不到 access_token（响应里没有该字段）")
    return token


def upload_thumb(token: str, cover: Path) -> str:
    boundary = f"----dwgkb{os.urandom(8).hex()}"
    mime = mimetypes.guess_type(cover.name)[0] or "application/octet-stream"
    head = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="media"; filename="{cover.name}"\r\n'
        f"Content-Type: {mime}\r\n\r\n"
    ).encode()
    body = head + cover.read_bytes() + f"\r\n--{boundary}--\r\n".encode()
    payload = _request(
        f"{API}/material/add_material?access_token={token}&type=thumb",
        data=body,
        content_type=f"multipart/form-data; boundary={boundary}",
    )
    media_id = payload.get("media_id")
    if not media_id:
        raise WeChatError("封面素材上传成功但没有 media_id")
    return media_id


def add_draft(token: str, article: dict) -> str:
    body = json.dumps({"articles": [article]}, ensure_ascii=False).encode("utf-8")
    payload = _request(f"{API}/draft/add?access_token={token}", data=body,
                       content_type="application/json; charset=utf-8")
    media_id = payload.get("media_id")
    if not media_id:
        raise WeChatError("draft/add 没有返回 media_id")
    return media_id


def submit_publish(token: str, media_id: str) -> dict:
    body = json.dumps({"media_id": media_id}, ensure_ascii=False).encode("utf-8")
    return _request(f"{API}/freepublish/submit?access_token={token}", data=body,
                    content_type="application/json; charset=utf-8")


def extract(html_path: Path) -> tuple[str, str, str]:
    html = html_path.read_text(encoding="utf-8")
    title_m = re.search(r"<title>(.*?)</title>", html, re.S)
    digest_m = re.search(r'<meta name="description" content="(.*?)"', html, re.S)
    frag_m = re.search(r"<!-- WECHAT:BEGIN -->(.*?)<!-- WECHAT:END -->", html, re.S)
    if not frag_m:
        raise SystemExit(f"{html_path} 里找不到 WECHAT:BEGIN/END 片段标记，先跑 make promo-wechat")
    content = frag_m.group(1).strip()
    title = (title_m.group(1).strip() if title_m else "").strip()
    summary = (digest_m.group(1).strip() if digest_m else "").strip()
    return title, summary, content


def main() -> int:
    ap = argparse.ArgumentParser(description="创建公众号草稿（不自动群发）")
    ap.add_argument("--html", type=Path, required=True, help="build-promo-wechat.py 产出的 HTML")
    ap.add_argument("--cover", type=Path, required=True, help="封面缩略图（≤64KB，jpg/png）")
    ap.add_argument("--author", default="atlisp")
    ap.add_argument("--source-url", default="https://atlisp.cn/dwg-kb.html",
                    help="阅读原文链接（已认证号才可点）")
    ap.add_argument("--dry-run", action="store_true", help="只做本地校验，不调用接口")
    ap.add_argument("--publish", action="store_true", help="创建草稿后立即提交发布")
    args = ap.parse_args()

    if not args.html.exists():
        raise SystemExit(f"找不到 {args.html}，先跑 build-promo-wechat.py")
    title, summary, content = extract(args.html)

    # --- 本地校验：这两条是硬限制，先在本地拦住 -------------------------------
    if len(content) >= BODY_LIMIT:
        raise SystemExit(
            f"正文 {len(content):,} 字符 ≥ {BODY_LIMIT:,} 的上限，微信会拒收；"
            "精简样式或删减小节后重新 build-promo-wechat.py"
        )
    if not args.cover.exists():
        raise SystemExit(f"找不到封面 {args.cover}，先跑 build-promo-cover.py")
    cover_size = args.cover.stat().st_size
    if cover_size > THUMB_LIMIT:
        raise SystemExit(
            f"封面 {cover_size:,} 字节 > 64KB，微信 thumb 素材会被拒；"
            "用 build-promo-cover.py 生成压缩版"
        )

    print(f"标题   : {title}")
    print(f"摘要   : {summary}  ({len(summary)} 字)")
    print(f"正文   : {len(content):,} 字符（上限 {BODY_LIMIT:,}）")
    print(f"封面   : {args.cover.name} ({cover_size:,} 字节 ≤ 64KB)")

    if args.dry_run:
        print("\n--dry-run：未联网。检查通过，去掉 --dry-run 即创建草稿。")
        return 0

    appid = os.environ.get("WECHAT_APPID", "").strip()
    secret = os.environ.get("WECHAT_APPSECRET", "").strip()
    if not appid or not secret:
        raise SystemExit(
            "缺少凭据：export WECHAT_APPID=wx... WECHAT_APPSECRET=...\n"
            "（后台 → 设置与开发 → 基本配置 → 公众号开发信息）"
        )

    print("\n1/3 获取 access_token ...")
    token = access_token(appid, secret)

    print("2/3 上传封面（永久素材 thumb）...")
    thumb_id = upload_thumb(token, args.cover)

    print("3/3 创建草稿 ...")
    draft_id = add_draft(token, {
        "title": title,
        "author": args.author,
        "digest": summary,
        "content": content,
        "content_source_url": args.source_url,
        "thumb_media_id": thumb_id,
        "need_open_comment": 0,
        "only_fans_can_comment": 0,
    })
    print(f"    草稿 media_id = {draft_id}")
    print("    → 后台「内容管理 → 草稿箱」可预览/群发")

    if args.publish:
        print("\n4/4 提交发布（freepublish/submit）...")
        print(f"    {submit_publish(token, draft_id)}")
    else:
        print("\n未发布（默认只建草稿）。确认无误后可加 --publish，或在后台手动点发表。")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except WeChatError as e:
        print(f"\n失败：{e}", file=sys.stderr)
        sys.exit(1)

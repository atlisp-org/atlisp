"""Render an article Markdown file -> WeChat Official Account compatible HTML.

Usage:  python build-promo-wechat.py ../../atlisp-dwg-kb/docs/推广文章.md
        python build-promo-wechat.py article.md -o /tmp/article-wechat.html

Why a separate file instead of reusing the web page? The WeChat editor strips
`<style>` blocks and class/id-based CSS, and ignores flex/grid. So every rule
has to be an inline `style="..."` on the tag itself, and layout must degrade to
plain block/table flow.

Output: `docs/推广文章-wechat.html`
  - a normal page for previewing in a browser (chrome styling lives outside the
    fragment markers), plus
  - the fragment between `<!-- WECHAT:BEGIN -->` / `<!-- WECHAT:END -->`, which
    is what `scripts/publish_wechat.py` uploads as the draft body.
"""
from __future__ import annotations

import argparse
import html
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from promo_common import digest, prepare  # noqa: E402

try:
    import markdown
except ImportError:  # pragma: no cover - docs tooling only
    raise SystemExit("需要 markdown：pip install markdown") from None

# --- WeChat-safe inline styles (no flex/grid/position, no external CSS) -------
S = {
    # Base typography on the wrapper: children inherit size/line-height/colour,
    # which keeps the per-tag inline styles short (WeChat caps the body at
    # 20,000 characters of HTML).
    "section": (
        "font-size:16px;line-height:1.8;color:#333;"
        "font-family:-apple-system,BlinkMacSystemFont,'PingFang SC',"
        "'Microsoft YaHei',sans-serif;"
    ),
    "lede": (
        "margin:0 0 22px;padding:12px 14px;background:#fff7f8;"
        "border-left:4px solid #e94560;color:#444;font-size:15px;"
    ),
    "h2": (
        "margin:32px 0 12px;padding-left:10px;border-left:4px solid #e94560;"
        "font-size:18px;font-weight:bold;color:#1a1a2e;line-height:1.5;"
    ),
    "h3": "margin:22px 0 8px;font-weight:bold;color:#1a1a2e;",
    "p": "margin:14px 0;",
    "strong": "color:#10131f;",
    "ul": "margin:12px 0;padding-left:22px;",
    "ol": "margin:12px 0;padding-left:22px;",
    "li": "margin:6px 0;",
    "code": (
        "background:#f2f4f8;color:#b4235a;padding:1px 5px;"
        "font-size:14px;font-family:Consolas,Menlo,monospace;"
    ),
    "pre": (
        "background:#1b1b31;color:#e7e9f5;padding:14px 16px;border-radius:8px;"
        "font-size:12.5px;line-height:1.7;white-space:pre-wrap;margin:16px 0;"
    ),
    "code_in_pre": "background:none;color:#e7e9f5;padding:0;font-size:12.5px;",
    "blockquote": (
        "margin:16px 0;padding:10px 14px;background:#fff7f8;"
        "border-left:4px solid #ff7a45;color:#444;font-size:15px;"
    ),
    "table": "width:100%;border-collapse:collapse;margin:18px 0;font-size:13.5px;line-height:1.6;",
    "th": (
        "background:#1a1a2e;color:#fff;padding:8px 10px;"
        "border:1px solid #1a1a2e;text-align:left;"
    ),
    "td": "padding:8px 10px;border:1px solid #e6e8f0;vertical-align:top;",
    "hr": "border:none;border-top:1px solid #e6e8f0;margin:26px 0;",
    "a": "color:#2f6fd0;",
}

PREVIEW_CSS = """
body { margin:0; background:#ededf0; font-family:-apple-system,BlinkMacSystemFont,
       "PingFang SC","Microsoft YaHei",sans-serif; }
.shell { max-width:677px; margin:24px auto; background:#fff; padding:28px 22px 40px; }
.note { max-width:677px; margin:16px auto 0; color:#8a8f9c; font-size:12px;
        line-height:1.7; font-family:monospace; }
"""


def _style(html: str, tag: str, css: str) -> str:
    """Add `style` to every <tag> that does not have one yet."""
    return re.sub(
        # (?=[\s/>]) keeps <p> from matching <pre>/<path>, <th> from <thead>
        rf"<{tag}(?=[\s/>])(?![^>]*\bstyle=)([^>]*)>",
        rf'<{tag} style="{css}"\1>',
        html,
    )


def inline_styles(html: str) -> str:
    for tag in ("h2", "h3", "p", "ul", "ol", "li", "strong", "a", "blockquote", "hr"):
        html = _style(html, tag, S[tag])
    html = _style(html, "code", S["code"])
    # code inside a <pre> must not keep the inline-code look
    html = re.sub(r"(<pre[^>]*>)\s*<code[^>]*>", r'\1<code style="' + S["code_in_pre"] + r'">', html)
    html = _style(html, "pre", S["pre"])
    html = _style(html, "table", S["table"])
    html = _style(html, "th", S["th"])
    html = _style(html, "td", S["td"])
    return html


def build(src: Path) -> tuple[str, str, str]:
    """Return (title, digest, fragment_html) for the given article."""
    title, lede, text = prepare(src)

    md = markdown.Markdown(extensions=["tables", "fenced_code", "sane_lists"])
    body = md.convert(text)
    # class attributes are dead weight in WeChat (no CSS applies) and eat into
    # the 20,000-character body limit.
    body = re.sub(r'\s+class="[^"]*"', "", body)

    if lede:
        lede_html = markdown.Markdown().convert(lede).strip()
        lede_html = lede_html.replace("<p>", f'<p style="{S["lede"]}">', 1)
        body = lede_html + "\n" + body

    fragment = f'<section style="{S["section"]}">\n{inline_styles(body).strip()}\n</section>'
    return title, digest(lede), fragment


def main() -> None:
    ap = argparse.ArgumentParser(description="文章 Markdown -> 公众号正文（全内联样式）")
    ap.add_argument("src", type=Path, help="文章 Markdown")
    ap.add_argument("-o", "--out", type=Path, help="输出 HTML（默认 <源文件名>-wechat.html）")
    args = ap.parse_args()

    out = args.out or args.src.with_name(args.src.stem + "-wechat.html")
    title, text_digest, fragment = build(args.src)

    page = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{html.escape(title)}</title>
<meta name="description" content="{html.escape(text_digest, quote=True)}">
<style>{PREVIEW_CSS}</style>
</head>
<body>
<div class="note">预览页：下方内容即公众号正文片段（全内联样式，无 &lt;style&gt;/class 依赖）。
上传草稿：python scripts/publish_wechat.py --html docs/推广文章-wechat.html</div>
<div class="shell">
<!-- WECHAT:BEGIN -->
{fragment}
<!-- WECHAT:END -->
</div>
</body>
</html>
"""

    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(page, encoding="utf-8")
    frag_chars = len(re.sub(r"<[^>]+>", "", fragment))
    print(f"wrote {out} ({out.stat().st_size:,} bytes)")
    print(f"  body text: {frag_chars:,} 字 / fragment: {len(fragment):,} 字符")
    if len(fragment) >= 20000:
        print(
            "  ! 微信正文上限 2 万字符，当前超出 "
            f"{len(fragment) - 20000} 字符：请精简内联样式或删减小节",
            file=sys.stderr,
        )


if __name__ == "__main__":
    main()

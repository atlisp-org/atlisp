"""Render an article Markdown file -> a standalone, self-contained HTML page.

Usage:  python build-promo-html.py ../../atlisp-dwg-kb/docs/推广文章.md
        python build-promo-html.py article.md -o /tmp/article.html

The Markdown file stays the single source of truth; this script only adds a
document shell + print-friendly CSS. The @lisp brand icon is inlined as a data
URI, so the output is a single self-contained file.
"""
from __future__ import annotations

import argparse
import base64
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from promo_common import prepare  # noqa: E402

try:
    import markdown
except ImportError:  # pragma: no cover - docs tooling only
    raise SystemExit("需要 markdown：pip install markdown") from None

HERE = Path(__file__).resolve().parent
DEFAULT_ICON = HERE / "assets" / "icon.png"
ICON_FALLBACK = "https://atlisp.cn/assets/images/brand/icon.png"

CSS = """
:root {
    --ink: #1d2333;
    --ink-soft: #5a6076;
    --accent: #e94560;
    --accent-2: #ff7a45;
    --navy: #1a1a2e;
    --navy-2: #0f3460;
    --line: #e6e8f0;
    --bg: #f6f7fb;
    --code-bg: #1b1b31;
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
    margin: 0;
    background: var(--bg);
    color: var(--ink);
    font: 17px/1.85 -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans SC",
          "PingFang SC", "Microsoft YaHei", Roboto, sans-serif;
}
.page {
    max-width: 900px;
    margin: 0 auto;
    padding: 0 22px 72px;
}
/* ---- 顶部品牌条 ---- */
.brand {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 22px 0 14px;
    text-decoration: none;
    border-bottom: none;
    color: var(--navy);
}
.brand img { width: 30px; height: 30px; object-fit: contain; }
.brand b { font-size: 16px; letter-spacing: .5px; }
.brand span { font-size: 12px; color: var(--ink-soft); }
.brand:hover b { color: var(--accent); }

/* ---- 标题 ---- */
h1 {
    font-size: 32px;
    line-height: 1.3;
    letter-spacing: -.2px;
    margin: 18px 0 10px;
}
.lede {
    margin: 14px 0 26px;
    padding: 14px 18px;
    background: #fff;
    border-left: 4px solid var(--accent);
    border-radius: 0 10px 10px 0;
    box-shadow: 0 1px 3px rgba(20, 24, 46, .06);
    color: #3c4258;
    font-size: 16px;
    line-height: 1.85;
}
h1::after {
    content: "";
    display: block;
    width: 68px;
    height: 4px;
    margin-top: 14px;
    border-radius: 2px;
    background: linear-gradient(90deg, var(--accent), var(--accent-2));
}
h2 {
    font-size: 23px;
    margin: 46px 0 14px;
    padding-left: 12px;
    border-left: 4px solid var(--accent);
    line-height: 1.4;
}
h3 { font-size: 18px; margin: 28px 0 10px; }
p { margin: 12px 0; }
strong { color: #10131f; }
hr { border: 0; border-top: 1px solid var(--line); margin: 34px 0; }
a { color: #2f6fd0; text-decoration: none; border-bottom: 1px solid rgba(47,111,208,.3); }
a:hover { border-bottom-color: #2f6fd0; }

/* ---- 引用块（导语 / 提示） ---- */
blockquote {
    margin: 18px 0;
    padding: 14px 18px;
    background: #fff;
    border-left: 4px solid var(--accent-2);
    border-radius: 0 10px 10px 0;
    box-shadow: 0 1px 3px rgba(20, 24, 46, .06);
    color: #3c4258;
    font-size: 15.5px;
    line-height: 1.8;
}
blockquote p { margin: 6px 0; }

/* ---- 表格 ---- */
table {
    width: 100%;
    border-collapse: separate;
    border-spacing: 0;
    margin: 20px 0;
    background: #fff;
    border: 1px solid var(--line);
    border-radius: 10px;
    overflow: hidden;
    font-size: 15px;
    box-shadow: 0 1px 3px rgba(20, 24, 46, .05);
}
thead th {
    background: var(--navy);
    color: #fff;
    text-align: left;
    font-weight: 600;
    padding: 11px 14px;
}
tbody td { padding: 10px 14px; border-top: 1px solid var(--line); vertical-align: top; }
th:first-child, td:first-child { width: 34%; }
@media (min-width: 720px) {
    table th:first-child, table td:first-child { white-space: nowrap; }
}
tbody tr:nth-child(even) { background: #fafbfe; }

/* ---- 代码 ---- */
pre {
    background: var(--code-bg);
    color: #e7e9f5;
    padding: 16px 18px;
    border-radius: 10px;
    overflow-x: auto;
    font-size: 13.5px;
    line-height: 1.7;
    margin: 16px 0;
    box-shadow: 0 4px 16px rgba(20, 24, 46, .18);
}
pre code { background: none; color: inherit; padding: 0; font-size: inherit; }
code {
    background: #eef1f8;
    color: #b4235a;
    padding: 1px 6px;
    border-radius: 4px;
    font-family: "JetBrains Mono", Menlo, Consolas, "Courier New", monospace;
    font-size: .9em;
}

/* ---- 目录 ---- */
.toc {
    margin: 26px 0 34px;
    padding: 16px 20px;
    background: #fff;
    border: 1px solid var(--line);
    border-radius: 12px;
    box-shadow: 0 1px 3px rgba(20, 24, 46, .05);
}
.toc .toc-title { font-size: 13px; letter-spacing: 1px; color: var(--ink-soft); margin-bottom: 8px; }
.toc ul { margin: 0; padding-left: 18px; }
.toc li { margin: 4px 0; font-size: 15px; }
.toc a { border-bottom: none; }
.toc a:hover { color: var(--accent); }

/* ---- 页脚 ---- */
.footer {
    margin-top: 56px;
    padding-top: 18px;
    border-top: 1px solid var(--line);
    color: var(--ink-soft);
    font-size: 13.5px;
    display: flex;
    flex-wrap: wrap;
    gap: 8px 18px;
    justify-content: space-between;
}

/* ---- 打印 / PDF ---- */
@media print {
    body { background: #fff; font-size: 12pt; }
    .page { max-width: none; padding: 0; }
    .toc { break-inside: avoid; }
    h2 { break-after: avoid; }
    pre, table, blockquote { break-inside: avoid; }
    pre { box-shadow: none; }
}
@media (max-width: 640px) {
    body { font-size: 16px; }
    h1 { font-size: 26px; }
    h2 { font-size: 20px; }
    table { font-size: 13.5px; }
}
"""

TEMPLATE = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>近 3000 张 CAD 图纸，怎么变成"能提问"的档案库？ — atlisp-dwg-kb</title>
<meta name="description" content="atlisp-dwg-kb：把历史 DWG 图纸变成可检索、可追溯的知识图谱。开源、可私有部署，AI 结论以图纸硬数据为准。">
<meta name="author" content="atlisp">
<style>{css}</style>
</head>
<body>
<div class="page">
    <a class="brand" href="https://atlisp.cn" target="_blank" rel="noopener noreferrer">
        <img src="{icon}" alt="@lisp">
        <b>atlisp-dwg-kb</b><span>CAD 图纸知识库</span>
    </a>
{body}
    <div class="footer">
        <span>atlisp-dwg-kb · MIT License · v0.2.3</span>
        <span>
            <a href="https://github.com/atlisp/dwg-knowledge-base">GitHub</a> ·
            <a href="https://pypi.org/project/atlisp-dwg-kb/">PyPI</a> ·
            <a href="https://atlisp.cn">atlisp.cn</a>
        </span>
    </div>
</div>
</body>
</html>
"""


def main() -> None:
    ap = argparse.ArgumentParser(description="文章 Markdown -> 独立 HTML 页面")
    ap.add_argument("src", type=Path, help="文章 Markdown")
    ap.add_argument("-o", "--out", type=Path, help="输出 HTML（默认与源文件同名 .html）")
    ap.add_argument("--icon", type=Path, default=DEFAULT_ICON, help="品牌图标（内联为 data URI）")
    args = ap.parse_args()

    out = args.out or args.src.with_suffix(".html")
    title, lede, text = prepare(args.src)

    md_body = f"# {title}\n\n{text}"

    md = markdown.Markdown(
        extensions=["tables", "fenced_code", "toc", "sane_lists"],
        extension_configs={"toc": {"toc_depth": "2-2"}},
    )
    body = md.convert(md_body)

    # Lede: rendered as its own paragraph right under the headline.
    if lede:
        lede_html = markdown.Markdown().convert(lede).strip()
        lede_html = lede_html.replace("<p>", '<p class="lede">', 1)
        body = body.replace("</h1>", "</h1>\n" + lede_html, 1)
    toc = md.toc.replace('class="toc"', 'class="toc" aria-label="目录"')
    toc = toc.replace(
        '<div class="toc" aria-label="目录">',
        '<div class="toc" aria-label="目录"><div class="toc-title">目 录</div>',
        1,
    )

    # Insert the TOC right after the intro (i.e. before the first horizontal rule).
    if "<hr" in body:
        head, rest = body.split("<hr", 1)
        body = head + toc + "<hr" + rest
    else:
        body = toc + body

    # Self-contained: inline the brand icon so the single .html file works offline.
    if args.icon.exists():
        b64 = base64.b64encode(args.icon.read_bytes()).decode("ascii")
        icon = f"data:image/png;base64,{b64}"
    else:
        icon = ICON_FALLBACK

    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(TEMPLATE.format(css=CSS, body=body, icon=icon), encoding="utf-8")
    print(f"wrote {out} ({out.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()

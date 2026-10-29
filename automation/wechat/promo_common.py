"""Shared helpers for the promo-article renderers (web page + WeChat).

The article Markdown carries a little editor scaffolding (reader profile,
headline candidates, one-line pitch, social snippet, screenshot checklist) that
must not leak into the published output — this module strips it and returns a
clean (title, lede, markdown) triple.

Conventions expected in the source Markdown (all optional except a title):

    # <任意文件标题>                       <- dropped, not the article title

    > 目标读者：...                        <- editor block, dropped
    **一句话卖点**：...                    <- becomes the lede paragraph
    ---

    ## 标题备选
    1. **真正的文章标题**                  <- becomes <h1>/公众号标题
    2. ...

    ## 正文
    ### 导语
    正文段落...

    ### 一、小节
    ...

    ## 转发用短文案                        <- editor tail, cut off
"""
from __future__ import annotations

import re
from pathlib import Path

# 中文软换行在浏览器里会变成一个空格，句中断开很难看；CJK 之间直接拼接。
_CJK = r"\u4e00-\u9fff\u3000-\u303f\uff00-\uffef"


def prepare(src: Path | str) -> tuple[str, str, str]:
    """Return (title, lede, markdown) ready for rendering."""
    src = Path(src)
    text = src.read_text(encoding="utf-8")

    # Editor-only tail (social snippet + screenshot checklist) stays in the .md.
    text = text.split("## 转发用短文案")[0]

    # Primary headline usually lives in the 标题备选 list; otherwise use the H1.
    title_match = re.search(r"^1\.\s+\*\*(.+?)\*\*$", text, flags=re.M)
    if title_match:
        title = title_match.group(1).strip()
    else:
        h1 = re.search(r"^#\s+(.+)$", text, flags=re.M)
        title = h1.group(1).strip() if h1 else src.stem

    # Drop the editor's file heading (never the article title).
    text = re.sub(r"\A#\s+.*\n+", "", text, count=1)

    # Editor meta blockquote -> drop; keep 一句话卖点 as the lede.
    text = re.sub(r">\s*目标读者：.*?(?=\*\*一句话卖点\*\*)", "", text, flags=re.S)
    lede_match = re.search(r"\*\*一句话卖点\*\*：(.*?)\n+-{3,}\n", text, flags=re.S)
    lede = " ".join(lede_match.group(1).split()) if lede_match else ""
    text = text[lede_match.end():] if lede_match else text

    # Drop the title-candidates block and the 正文 wrapper heading.
    text = re.sub(r"## 标题备选\n.*?(?=## 正文\n)", "", text, flags=re.S)
    text = text.replace("## 正文\n", "", 1)
    text = re.sub(r"\A\s*(?:-{3,}[ \t]*\n+)+", "", text)

    # 没有「一句话卖点」时，用导语首段当摘要（并从正文移除，避免重复展示）。
    if not lede:
        guide = re.search(r"#{2,3}\s*导语\s*\n+(.+?)(?=\n\s*#{2,3}\s|\Z)", text, flags=re.S)
        if guide:
            lede = _plain(guide.group(1))
            text = (text[: guide.start()] + text[guide.end():]).lstrip()
    if not lede:
        para = re.match(r"\s*(.+?)(?=\n\s*\n|\Z)", text, flags=re.S)
        if para:
            lede = _plain(para.group(1))
            text = text[para.end():].lstrip()

    # 导语 becomes the lede paragraph (no heading of its own).
    text = re.sub(r"\A\s*### 导语\n+", "", text)
    # Sections are written as ### under the editor wrapper; promote them to ##.
    text = re.sub(r"^### ", "## ", text, flags=re.M)

    text = re.sub(rf"(?<=[{_CJK}])\n(?=[{_CJK}])", "", text)
    return title, lede, text.strip() + "\n"


def _plain(md: str) -> str:
    """Markdown 片段 → 适合做摘要的纯文本（单行）。"""
    s = re.sub(r"```.*?```", " ", md, flags=re.S)
    s = re.sub(r"!\[[^\]]*\]\([^)]*\)", " ", s)
    s = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", s)
    s = re.sub(r"<[^>]+>", " ", s)
    s = re.sub(r"[`*_>#|]", "", s)
    s = re.sub(r"^\s*[-+]\s+", "", s, flags=re.M)
    return re.sub(r"\s+", " ", s).strip()


def digest(lede: str, limit: int = 110) -> str:
    """WeChat 摘要: plain text, ≤120 chars (the API limit)."""
    plain = re.sub(r"[`*_>#]", "", lede)
    plain = re.sub(r"——\s+", "——", plain)
    plain = re.sub(r"\s{2,}", " ", plain).strip()
    return plain if len(plain) <= limit else plain[: limit - 1] + "…"

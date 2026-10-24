"""Generate a WeChat-style cover image for an article.

Usage:  python build-promo-cover.py ../../atlisp-dwg-kb/docs/推广文章.md
        python build-promo-cover.py article.md --outdir /tmp/assets

Outputs (default: <article dir>/assets/):
  cover.png        1080x460  — 公众号封面 / 文章头图
  cover-thumb.jpg   900x383  — 上传用的永久素材（微信 thumb 上限 64KB）

Needs Pillow and a CJK font (Noto Sans SC / Microsoft YaHei / SimSun are
auto-probed).
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from promo_common import prepare  # noqa: E402

try:
    from PIL import Image, ImageDraw, ImageFilter, ImageFont
except ImportError:  # pragma: no cover
    raise SystemExit("需要 Pillow：pip install Pillow") from None

HERE = Path(__file__).resolve().parent
DEFAULT_ICON = HERE / "assets" / "icon.png"

W, H = 1080, 460
FONT_CANDIDATES = [
    Path.home() / ".local/share/fonts/NotoSansSC-Bold.otf",
    Path.home() / ".local/share/fonts/NotoSansSC-Regular.otf",
    Path.home() / ".local/share/fonts/msyh.ttc",
    Path.home() / ".local/share/fonts/msyh.ttf",
    Path("/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"),
    Path("/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc"),
]


def font(size: int) -> ImageFont.FreeTypeFont:
    for path in FONT_CANDIDATES:
        if path.exists():
            try:
                return ImageFont.truetype(str(path), size)
            except OSError:
                continue
    raise SystemExit("找不到中文字体（Noto Sans SC / 微软雅黑 / 文泉驿）")


def wrap(draw: ImageDraw.ImageDraw, text: str, f: ImageFont.FreeTypeFont, max_w: int) -> list[str]:
    """Greedy wrap that prefers breaking after Chinese punctuation."""
    lines: list[str] = []
    cur = ""
    for ch in text:
        if draw.textlength(cur + ch, font=f) <= max_w:
            cur += ch
            continue
        cut = max(cur.rfind(p) for p in "，。、；：？！,;:") + 1 if any(
            p in cur for p in "，。、；：？！,;:") else len(cur)
        lines.append(cur[:cut])
        cur = cur[cut:] + ch
    if cur:
        lines.append(cur)
    return lines


def gradient() -> Image.Image:
    top, bottom = (26, 26, 46), (15, 52, 96)   # #1a1a2e -> #0f3460
    base = Image.new("RGB", (1, H))
    for y in range(H):
        t = y / (H - 1)
        base.putpixel((0, y), tuple(round(a + (b - a) * t) for a, b in zip(top, bottom, strict=True)))
    return base.resize((W, H))


def main() -> None:
    ap = argparse.ArgumentParser(description="生成公众号封面（1080x460 + 64KB 内缩略图）")
    ap.add_argument("src", type=Path, help="文章 Markdown（用于取标题）")
    ap.add_argument("--outdir", type=Path, help="输出目录（默认 <文章目录>/assets）")
    ap.add_argument("--icon", type=Path, default=DEFAULT_ICON, help="品牌图标")
    ap.add_argument("--brand", default="atlisp-dwg-kb", help="封面左上品牌名")
    ap.add_argument("--sub", default="CAD 图纸知识库", help="品牌名下方小字")
    args = ap.parse_args()

    outdir = args.outdir or (args.src.parent / "assets")
    outdir.mkdir(parents=True, exist_ok=True)
    cover, thumb = outdir / "cover.png", outdir / "cover-thumb.jpg"
    icon_path = args.icon

    title, _, _ = prepare(args.src)

    img = gradient().convert("RGBA")

    # warm glow bottom-right + thin accent bar on the left
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse((W - 460, H - 300, W + 120, H + 200), fill=(255, 122, 69, 190))
    glow = glow.filter(ImageFilter.GaussianBlur(90))
    img = Image.alpha_composite(img, glow)

    d = ImageDraw.Draw(img)
    d.rectangle((0, 0, 10, H), fill=(233, 69, 96, 255))

    # brand row
    if icon_path.exists():
        icon = Image.open(icon_path).convert("RGBA").resize((56, 56), Image.LANCZOS)
        img.alpha_composite(icon, (56, 48))
    d.text((126, 58), args.brand, font=font(30), fill=(255, 255, 255, 255))
    d.text((126, 92), args.sub, font=font(20), fill=(168, 180, 210, 255))

    # headline
    f_big = font(58)
    lines = wrap(d, title, f_big, W - 160)
    y = 170
    for line in lines[:2]:
        d.text((56, y), line, font=f_big, fill=(255, 255, 255, 255))
        y += 76

    # footer strip
    d.text((56, H - 62), "开源 · MIT · pip install atlisp-dwg-kb",
           font=font(22), fill=(190, 198, 226, 255))

    img.convert("RGB").save(cover, optimize=True)

    # WeChat thumb: ≤64KB, 900x383 (2.35:1)
    thumb_path = thumb
    thumb_img = img.convert("RGB").resize((900, 383), Image.LANCZOS)
    for quality in (90, 85, 80, 75, 70, 65, 60):
        thumb_img.save(thumb_path, quality=quality, optimize=True, progressive=True)
        if thumb_path.stat().st_size <= 64 * 1024:
            break

    print(f"wrote {cover} ({cover.stat().st_size:,} bytes)")
    print(f"wrote {thumb} ({thumb.stat().st_size:,} bytes)")
    if thumb.stat().st_size > 64 * 1024:
        print("  ! 缩略图仍超过 64KB，微信 thumb 素材会被拒；请降低尺寸", file=sys.stderr)


if __name__ == "__main__":
    main()

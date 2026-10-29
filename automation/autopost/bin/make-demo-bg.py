#!/usr/bin/env python3
# bin/make-demo-bg.py — 实拍演示片的 1080x1920 品牌底图（中间留抓屏区域 + 描边）
# 用法: python3 bin/make-demo-bg.py <输出png>
import sys

from PIL import Image, ImageDraw, ImageFont

FONT = "/home/vitalgg/.local/share/fonts/NotoSansSC-Regular.otf"
W, H = 1080, 1920
BG_TOP = (29, 53, 87)      # 与 gen-content.py 的 slides 同色系
BG_BOT = (16, 33, 58)
RED = (230, 57, 70)
DIM = (150, 170, 200)
WHITE = (255, 255, 255)
CLIP = (40, 820, 1040, 1383)   # 抓屏视频的落位（1000x563，16:9）


def main(out):
    img = Image.new("RGB", (W, H))
    d = ImageDraw.Draw(img)
    for y in range(H):
        t = y / H
        d.line([(0, y), (W, y)],
               fill=tuple(int(BG_TOP[i] + (BG_BOT[i] - BG_TOP[i]) * t) for i in range(3)))

    f_brand = ImageFont.truetype(FONT, 44)
    d.text((80, 110), "@lisp · at-arch", font=f_brand, fill=RED)

    f_t = ImageFont.truetype(FONT, 54)
    title = "真实操作 · 车位自动编号"
    d.text((W / 2 - d.textlength(title, font=f_t) / 2, 620), title, font=f_t, fill=WHITE)

    f_s = ImageFont.truetype(FONT, 36)
    sub = "at-arch 包 · AI 全自动"
    d.text((W / 2 - d.textlength(sub, font=f_s) / 2, 700), sub, font=f_s, fill=DIM)

    d.rectangle(list(CLIP), outline=(46, 90, 138), width=3)

    f_f = ImageFont.truetype(FONT, 40)
    foot = "@lisp · 免费 CAD 函数库"
    d.text((W / 2 - d.textlength(foot, font=f_f) / 2, 1680), foot, font=f_f, fill=DIM)

    img.save(out)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "demo-bg.png")

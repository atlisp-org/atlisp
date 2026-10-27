#!/usr/bin/env python3
# /home/vitalgg/atlisp/automation/autopost/bin/gen-content.py
# 把 AI 生成的推广文案（copy.json）渲染成可发布的内容（worker autopost-content 任务调用）：
#   1. Pillow 渲染 4 屏 9:16 竖版画面（品牌深蓝底 + 白字，无 drawtext 依赖）
#   2. ffmpeg xfade 合成 ~10 秒竖版短视频
#   3. 写入队列：
#      queue/qzone/<YYYYMMDD>-<pkg>.txt    首行=说说文字，img: 行=第一屏图片
#      queue/douyin/<YYYYMMDD>-<pkg>.json  { video, title, topics, private }
#
# copy.json 结构（opencode 产出）：
#   { "qzone": "...", "title": "...", "topics": ["..."], "slides": ["屏1", ..., "屏4"] }
#
# 用法:
#   python3 bin/gen-content.py --pkg <包名> --copy <copy.json>
# 退出码: 0 = 成功（或当日已生成过）; 1 = 失败
import argparse
import json
import re
import subprocess
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FONT = "/home/vitalgg/.local/share/fonts/NotoSansSC-Regular.otf"
W, H = 1080, 1920
BG_TOP = (29, 53, 87)    # 品牌深蓝（同 video/scenes.json）
BG_BOT = (16, 33, 58)
RED = (230, 57, 70)
WHITE = (255, 255, 255)
DIM = (150, 170, 200)
SLIDE_SEC = 3.0
FADE = 0.5


def render_slide(text, pkg, idx, total, out):
    """渲染一屏画面到 PNG（1080x1920 竖版）"""
    from PIL import Image, ImageDraw, ImageFont

    img = Image.new("RGB", (W, H))
    draw = ImageDraw.Draw(img)
    # 上深下浅的纵向渐变背景
    for y in range(H):
        t = y / H
        c = tuple(int(BG_TOP[i] + (BG_BOT[i] - BG_TOP[i]) * t) for i in range(3))
        draw.line([(0, y), (W, y)], fill=c)

    f_head = ImageFont.truetype(FONT, 44)
    f_main = ImageFont.truetype(FONT, 84)
    f_foot = ImageFont.truetype(FONT, 36)

    # 顶部：品牌 + 包名
    head = f"@lisp · {pkg}"
    draw.text((80, 110), head, font=f_head, fill=RED)

    # 中部主文案：超 16 字自动折行（最多 5 行）；超宽自动缩字号
    lines = [text[i:i + 16] for i in range(0, len(text), 16)][:5] or [""]
    max_w = W - 160  # 左右各留 80
    f_size = 84
    probe = ImageFont.truetype(FONT, f_size)
    longest = max((draw.textlength(ln, font=probe) for ln in lines), default=0)
    if longest > max_w:
        f_size = max(40, int(f_size * max_w / longest))
    f_main = ImageFont.truetype(FONT, f_size)
    lh = int(f_size * 1.5)
    y0 = H // 2 - (len(lines) - 1) * lh // 2
    for i, ln in enumerate(lines):
        wtxt = draw.textlength(ln, font=f_main)
        draw.text((W / 2 - wtxt / 2, y0 + i * lh), ln, font=f_main, fill=WHITE)

    # 底部：站点 + 页码
    ft = "atlisp.cn"
    draw.text((W / 2 - draw.textlength(ft, font=f_foot) / 2, H - 170), ft, font=f_foot, fill=DIM)
    dot = f"{idx + 1}/{total}"
    draw.text((W - 80 - draw.textlength(dot, font=f_foot), H - 170), dot, font=f_foot, fill=DIM)

    img.save(out)


def build_video(pngs, out):
    """ffmpeg 合成：每屏 SLIDE_SEC 秒，相邻屏 FADE 秒交叉淡化"""
    n = len(pngs)
    cmd = ["ffmpeg", "-y", "-loglevel", "error"]
    for p in pngs:
        cmd += ["-framerate", "25", "-loop", "1", "-t", str(SLIDE_SEC), "-i", str(p)]
    if n == 1:
        cmd += ["-map", "0:v"]
    else:
        fc, prev = [], "[0:v]"
        for k in range(1, n):
            label = f"[v{k}]" if k < n - 1 else "[vout]"
            offset = k * (SLIDE_SEC - FADE)
            fc.append(f"{prev}[{k}:v]xfade=transition=fade:duration={FADE}:offset={offset:.2f}{label}")
            prev = label
        total = n * SLIDE_SEC - (n - 1) * FADE
        cmd += ["-filter_complex", ";".join(fc), "-map", "[vout]", "-t", f"{total:.2f}"]
    cmd += ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", "25", str(out)]
    subprocess.run(cmd, check=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pkg", required=True, help="应用包名（用于文件命名与画面展示）")
    ap.add_argument("--copy", required=True, help="copy.json 路径")
    args = ap.parse_args()

    pkg = re.sub(r"[^A-Za-z0-9_-]", "", args.pkg) or "pkg"
    raw = Path(args.copy).read_text(encoding="utf-8").strip()
    # 容错：AI 可能在 JSON 外裹了 markdown 围栏/说明文字，取首尾花括号之间的内容
    i, j = raw.find("{"), raw.rfind("}")
    if 0 <= i < j:
        raw = raw[i:j + 1]
    copy = json.loads(raw)
    qzone_text = (copy.get("qzone") or "").strip()
    title = (copy.get("title") or "").strip()
    topics = [str(t).strip().lstrip("#") for t in (copy.get("topics") or []) if str(t).strip()]
    slides = [str(s).strip() for s in (copy.get("slides") or []) if str(s).strip()]

    if not qzone_text or not title or not slides:
        print(f"[gen-content] copy.json 缺字段: qzone={bool(qzone_text)} title={bool(title)} slides={len(slides)}", file=sys.stderr)
        sys.exit(1)
    slides = slides[:6]  # 上限 6 屏

    d = date.today().strftime("%Y%m%d")
    media = ROOT / "media"
    media.mkdir(exist_ok=True)
    video = media / f"{d}-{pkg}.mp4"
    qzone_file = ROOT / "queue" / "qzone" / f"{d}-{pkg}.txt"
    douyin_file = ROOT / "queue" / "douyin" / f"{d}-{pkg}.json"

    if video.exists() and qzone_file.exists() and douyin_file.exists():
        print(f"[gen-content] {d}-{pkg} 今日已生成过，跳过")
        return

    # 1) 渲染画面（第一屏同时作为 QQ空间配图）
    pngs = []
    for i, s in enumerate(slides):
        p = media / f"{d}-{pkg}-s{i + 1}.png"
        render_slide(s, pkg, i, len(slides), p)
        pngs.append(p)

    # 2) 合成视频
    build_video(pngs, video)
    size_mb = video.stat().st_size / 1024 / 1024
    print(f"[gen-content] 视频: {video} ({size_mb:.1f} MB, {len(slides)} 屏)")

    # 3) 写 QQ空间队列（首行文字 + 第一屏配图）
    qzone_file.write_text(
        qzone_text + "\n" + f"img: media/{d}-{pkg}-s1.png\n", encoding="utf-8"
    )
    print(f"[gen-content] QQ空间队列: {qzone_file}")

    # 4) 写抖音队列
    douyin_file.write_text(
        json.dumps(
            {"video": f"media/{d}-{pkg}.mp4", "title": title, "topics": topics[:5], "private": False},
            ensure_ascii=False, indent=2,
        ) + "\n",
        encoding="utf-8",
    )
    print(f"[gen-content] 抖音队列: {douyin_file} (title={title!r}, topics={topics})")


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as e:
        print(f"[gen-content] 子进程失败: {e.cmd[:3]}... rc={e.returncode}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"[gen-content] 失败: {e}", file=sys.stderr)
        sys.exit(1)

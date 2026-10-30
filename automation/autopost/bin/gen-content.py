#!/usr/bin/env python3
# /home/vitalgg/atlisp/automation/autopost/bin/gen-content.py
# 把 AI 生成的推广文案（copy.json）渲染成可发布的内容（worker autopost-content 任务调用）：
#   1. Pillow 渲染 6 屏 9:16 竖版画面（6 屏结构：钩子/痛点/命令屏/效果/收益/CTA）
#   2. ffmpeg 合成 ~17 秒竖版短视频（Ken Burns 微缩放 + xfade 交叉淡化 + BGM）
#   3. 写入队列：
#      queue/qzone/<YYYYMMDD>-<pkg>.txt    首行=说说文字，img: 行=第一屏图片
#      queue/douyin/<YYYYMMDD>-<pkg>.json  { video, title, topics, private }
#      queue/channels/<YYYYMMDD>-<pkg>.json { video, title, desc, private }
#
# copy.json 结构（opencode 产出）：
#   {
#     "qzone": "...", "title": "...", "topics": ["..."],
#     "command": "(pkg:command)",                        # 命令屏：该包真实入口命令
#     "slides": ["钩子", "痛点", "效果", "收益1", "收益2"], # 5 项，CTA 用固定模板
#     "demo": "media/demo-at-arch-20261029.mp4"          # 可选：实拍演示片段（9:16）
#   }
#   屏序（无 demo）：1 钩子 / 2 痛点 / 3 命令屏 / 4 效果 / 5 收益 / 6 CTA
#   屏序（有 demo）：1 钩子 / 2 痛点 / 3 命令屏 / 4 实拍 / 5 效果 / 6 收益1 / 7 收益2 / 8 CTA
#   缺 command 或 slides 不足 5 → 回退旧的纯文字屏版式（向后兼容，最多 6 屏）。
#
# 用法:
#   python3 bin/gen-content.py --pkg <包名> --copy <copy.json> [--force] [--root <目录>]
#   --force  当日已生成过也重新生成（重跑/修版式用）
#   --root   覆盖项目根目录（media/queue 输出位置；测试时指向临时目录，避免混入真队列）
# 退出码: 0 = 成功（或当日已生成过）; 1 = 失败
import argparse
import json
import re
import subprocess
import sys
from datetime import date
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
FONT = "/home/vitalgg/.local/share/fonts/NotoSansSC-Regular.otf"
FONT_MONO = "/usr/share/fonts/X11/TTF/luximr.ttf"
W, H = 1080, 1920
BG_TOP = (29, 53, 87)    # 品牌深蓝（同 video/scenes.json）
BG_BOT = (16, 33, 58)
RED = (230, 57, 70)
WHITE = (255, 255, 255)
DIM = (150, 170, 200)
GREEN = (46, 160, 67)
# CAD 命令行面板配色（AutoCAD 深色模式风格）
CAD_BG = (27, 27, 27)
CAD_BD = (68, 68, 68)
CAD_PROMPT = (168, 168, 168)   # "Command:" 提示符
CAD_LABEL = (128, 128, 128)    # 面板标签
SLIDE_SEC = 3.2
FADE = 0.5


def gradient(draw):
    """上深下浅的纵向渐变背景"""
    for y in range(H):
        t = y / H
        c = tuple(int(BG_TOP[i] + (BG_BOT[i] - BG_TOP[i]) * t) for i in range(3))
        draw.line([(0, y), (W, y)], fill=c)


def wrap_text(draw, text, font, max_w, max_lines=99):
    """按像素宽度折行（CJK 逐字），返回最多 max_lines 行"""
    lines, cur = [], ""
    for ch in text:
        if draw.textlength(cur + ch, font=font) <= max_w:
            cur += ch
        elif cur:
            lines.append(cur)
            cur = ch
    if cur:
        lines.append(cur)
    return lines[:max_lines]


def center_lines(draw, lines, font, lh, cy, fill=WHITE):
    """居中绘制多行文本，块垂直中心在 cy；返回块底 y"""
    y0 = cy - (len(lines) - 1) * lh / 2
    for i, ln in enumerate(lines):
        wtxt = draw.textlength(ln, font=font)
        draw.text((W / 2 - wtxt / 2, y0 + i * lh), ln, font=font, fill=fill)
    return y0 + len(lines) * lh


def draw_check(draw, cx, cy, r):
    """绿色圆底 + 白色对勾"""
    draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=GREEN)
    lw = max(4, int(r * 0.24))
    draw.line([(cx - r * 0.45, cy + r * 0.02), (cx - r * 0.10, cy + r * 0.40),
               (cx + r * 0.50, cy - r * 0.34)], fill=WHITE, width=lw, joint="curve")


def header_footer(draw, pkg, idx, total):
    """顶部品牌 + 底部站点/页码（各屏共用）"""
    f_head = ImageFont.truetype(FONT, 44)
    f_foot = ImageFont.truetype(FONT, 36)
    draw.text((80, 110), f"@lisp · {pkg}", font=f_head, fill=RED)
    ft = "atlisp.cn"
    draw.text((W / 2 - draw.textlength(ft, font=f_foot) / 2, H - 170), ft, font=f_foot, fill=DIM)
    dot = f"{idx + 1}/{total}"
    draw.text((W - 80 - draw.textlength(dot, font=f_foot), H - 170), dot, font=f_foot, fill=DIM)


# ---------- 6 屏版式 ----------

def render_hook(draw, pkg, idx, total, text):
    """屏1 钩子：眉题 + 大标题 + 红色下划线"""
    f_k = ImageFont.truetype(FONT, 42)
    kicker = "CAD 用户值得看"
    draw.text((W / 2 - draw.textlength(kicker, font=f_k) / 2, 620), kicker, font=f_k, fill=DIM)
    f_m = ImageFont.truetype(FONT, 92)
    lines = wrap_text(draw, text, f_m, W - 200, 3)
    bottom = center_lines(draw, lines, f_m, int(92 * 1.45), 900)
    draw.rounded_rectangle([W / 2 - 90, bottom + 55, W / 2 + 90, bottom + 70], radius=7, fill=RED)


def render_pain(draw, pkg, idx, total, text):
    """屏2 痛点：红色感叹号徽章 + 文案"""
    cx, cy, r = W / 2, 580, 66
    draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=RED)
    f_mark = ImageFont.truetype(FONT, 104)
    mark = "!"
    draw.text((cx - draw.textlength(mark, font=f_mark) / 2, cy - 78), mark, font=f_mark, fill=WHITE)
    f_m = ImageFont.truetype(FONT, 76)
    lines = wrap_text(draw, text, f_m, W - 240, 3)
    center_lines(draw, lines, f_m, int(76 * 1.5), 900)


def render_command(draw, pkg, idx, total, command):
    """屏3 命令屏：CAD 命令行样式（Command: 提示符 + 白字命令 + 光标块）"""
    f_lab = ImageFont.truetype(FONT, 42)
    lab = "怎么用"
    draw.text((W / 2 - draw.textlength(lab, font=f_lab) / 2, 500), lab, font=f_lab, fill=DIM)
    # 卡片：CAD 深色命令行面板
    x0, x1, y0, y1 = 90, 990, 620, 1160
    draw.rounded_rectangle([x0, y0, x1, y1], radius=10, fill=CAD_BG, outline=CAD_BD, width=3)
    # 顶部标签：Command Line（右对齐，仿 CAD 命令行窗口）
    f_name = ImageFont.truetype(FONT_MONO, 30)
    name = "Command Line"
    draw.text((x1 - 44 - draw.textlength(name, font=f_name), y0 + 30), name, font=f_name, fill=CAD_LABEL)
    draw.line([(x0 + 22, y0 + 84), (x1 - 22, y0 + 84)], fill=CAD_BD, width=2)
    # 命令：提示符 + 命令文本，超 2 行逐级缩字号
    prompt = "Command: "
    full = prompt + command
    code_w = x1 - x0 - 100
    size = 46
    for s in (46, 40, 34, 28):
        f = ImageFont.truetype(FONT_MONO, s)
        if len(wrap_text(draw, full, f, code_w, 2)) <= 2:
            size = s
            break
    f_code = ImageFont.truetype(FONT_MONO, size)
    lines = wrap_text(draw, full, f_code, code_w, 2)
    lh = int(size * 1.7)
    cy = (y0 + 84 + y1) / 2
    # 逐字着色：前 len(prompt) 个字符为灰色提示符，其余白色
    pos = 0
    last_x = 0
    for i, ln in enumerate(lines):
        y = cy - (len(lines) - 1) * lh / 2 + i * lh - size
        x = x0 + 50
        for ch in ln:
            color = CAD_PROMPT if pos < len(prompt) else WHITE
            draw.text((x, y), ch, font=f_code, fill=color)
            x += draw.textlength(ch, font=f_code)
            pos += 1
        last_x = x
    # 光标块（命令末尾）
    cursor_h = int(size * 1.25)
    y_last = cy - (len(lines) - 1) * lh / 2 + (len(lines) - 1) * lh - size
    draw.rectangle([last_x + 6, y_last + 2, last_x + 6 + int(size * 0.55), y_last + 2 + cursor_h], fill=WHITE)
    # 卡片下说明
    f_cap = ImageFont.truetype(FONT, 40)
    cap = "在 CAD 命令行输入后回车"
    draw.text((W / 2 - draw.textlength(cap, font=f_cap) / 2, y1 + 60), cap, font=f_cap, fill=DIM)


def render_effect(draw, pkg, idx, total, text):
    """屏4 效果：绿色对勾徽章 + 文案"""
    draw_check(draw, W / 2, 580, 66)
    f_m = ImageFont.truetype(FONT, 76)
    lines = wrap_text(draw, text, f_m, W - 240, 3)
    center_lines(draw, lines, f_m, int(76 * 1.5), 900)


def render_benefit(draw, pkg, idx, total, b1, b2):
    """屏5 收益：两条对勾要点"""
    f_m = ImageFont.truetype(FONT, 62)
    max_w = W - 270 - 80
    for y, txt in [(740, b1), (1030, b2)]:
        if not txt:
            continue
        draw_check(draw, 190, y, 42)
        lines = wrap_text(draw, txt, f_m, max_w, 2)
        lh = int(62 * 1.5)
        y0 = y - (len(lines) - 1) * lh / 2
        for i, ln in enumerate(lines):
            draw.text((270, y0 + i * lh - 20), ln, font=f_m, fill=WHITE)


def render_benefit_single(draw, pkg, idx, total, text):
    """实拍版式屏6/7：单条收益（大对勾 + 一行大字）"""
    draw_check(draw, W / 2, 700, 62)
    f_m = ImageFont.truetype(FONT, 68)
    lines = wrap_text(draw, text, f_m, W - 240, 3)
    center_lines(draw, lines, f_m, int(68 * 1.5), 940)


def render_cta(draw, pkg, idx, total, arg=None):
    """屏6 CTA：固定模板（品牌 + 站点 + 免费）"""
    f_big = ImageFont.truetype(FONT, 150)
    logo = "@lisp"
    draw.text((W / 2 - draw.textlength(logo, font=f_big) / 2, 560), logo, font=f_big, fill=WHITE)
    f_sub = ImageFont.truetype(FONT, 56)
    sub = "CAD 函数库"
    draw.text((W / 2 - draw.textlength(sub, font=f_sub) / 2, 790), sub, font=f_sub, fill=DIM)
    # 红色药丸按钮
    pw, ph = 500, 128
    draw.rounded_rectangle([W / 2 - pw / 2, 940, W / 2 + pw / 2, 940 + ph], radius=ph // 2, fill=RED)
    f_url = ImageFont.truetype(FONT_MONO, 64)
    url = "atlisp.cn"
    draw.text((W / 2 - draw.textlength(url, font=f_url) / 2, 972), url, font=f_url, fill=WHITE)
    f_tag = ImageFont.truetype(FONT, 44)
    tag = "免费使用 · 持续更新"
    draw.text((W / 2 - draw.textlength(tag, font=f_tag) / 2, 1160), tag, font=f_tag, fill=DIM)


def render_plain(draw, pkg, idx, total, text):
    """旧版式：渐变底 + 居中一行大白字（缺 command 字段时回退）"""
    f_head = ImageFont.truetype(FONT, 44)
    f_foot = ImageFont.truetype(FONT, 36)
    f_main = ImageFont.truetype(FONT, 84)
    head = f"@lisp · {pkg}"
    draw.text((80, 110), head, font=f_head, fill=RED)
    lines = [text[i:i + 16] for i in range(0, len(text), 16)][:5] or [""]
    max_w = W - 160
    probe = ImageFont.truetype(FONT, 84)
    longest = max((draw.textlength(ln, font=probe) for ln in lines), default=0)
    if longest > max_w:
        f_main = ImageFont.truetype(FONT, max(40, int(84 * max_w / longest)))
    lh = int(84 * 1.5)
    y0 = H // 2 - (len(lines) - 1) * lh // 2
    for i, ln in enumerate(lines):
        wtxt = draw.textlength(ln, font=f_main)
        draw.text((W / 2 - wtxt / 2, y0 + i * lh), ln, font=f_main, fill=WHITE)
    ft = "atlisp.cn"
    draw.text((W / 2 - draw.textlength(ft, font=f_foot) / 2, H - 170), ft, font=f_foot, fill=DIM)
    dot = f"{idx + 1}/{total}"
    draw.text((W - 80 - draw.textlength(dot, font=f_foot), H - 170), dot, font=f_foot, fill=DIM)


SLIDE_LABEL_RE = re.compile(
    r"^\s*(?:第\s*[0-9一二三四五六七八九十]+\s*(?:屏|页)\s*[·:：、.\-—]?\s*)?"
    r"(?:钩子|痛点|效果|收益\s*[12一二]?|卖点|命令|标题|CTA|行动)\s*[:：\-—]\s*"
)


def clean_slide(s):
    """剥掉 AI 抄模板时带的屏标签前缀。

    AI 经常把 JSON 模板里的占位符原样带进来（“第1屏 钩子：真实文案”/“痛点：…”），
    这些标签会直接画到短视频画面上，所以统一去掉；顺便去掉行首的列表符号。
    """
    out = s.strip().strip('"“”').strip()
    for _ in range(3):
        new = SLIDE_LABEL_RE.sub("", out).strip()
        new = re.sub(r"^[\-*·•\d]+[.、)）]?\s*", "", new).strip()
        if new == out:
            break
        out = new
    return out.rstrip("：: -—").strip()


def probe_duration(path):
    """ffprobe 取视频时长（秒）"""
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=nw=1:nk=1", str(path)],
        capture_output=True, text=True, check=True,
    )
    return float(r.stdout.strip())


def render_slide(pkg, idx, total, fn, arg, out_dir):
    """渲染一个静态屏（渐变底 + 版式 + 页眉页脚），返回 png 路径"""
    img = Image.new("RGB", (W, H))
    draw = ImageDraw.Draw(img)
    gradient(draw)
    fn(draw, pkg, idx, total, arg)
    header_footer(draw, pkg, idx, total)
    p = out_dir / f"slide-{idx + 1}.png"
    img.save(p)
    return p


def render_frames(pkg, command, slides, out_dir, demo=None):
    """按版式渲染全部分段；缺 command 或 slides<5 时回退旧版式。

    demo: 实拍演示视频路径（9:16 mp4）。给了就走 8 屏版式，否则 6 屏。
    返回 (segments, layout 描述)；segments 元素为 ("png", path) / ("video", path)。
    """
    use_demo = False
    if demo:
        try:
            use_demo = Path(demo).exists() and probe_duration(demo) > 0.5
        except Exception as e:
            print(f"[gen-content] demo 探测失败，降级 6 屏: {e}", file=sys.stderr)
            use_demo = False

    if command and len(slides) >= 5:
        hook, pain, effect, b1, b2 = slides[0], slides[1], slides[2], slides[3], slides[4]
        if use_demo:
            total = 8
            segs = [
                ("png", render_slide(pkg, 0, total, render_hook, hook, out_dir)),
                ("png", render_slide(pkg, 1, total, render_pain, pain, out_dir)),
                ("png", render_slide(pkg, 2, total, render_command, command, out_dir)),
                ("video", Path(demo)),
                ("png", render_slide(pkg, 4, total, render_effect, effect, out_dir)),
                ("png", render_slide(pkg, 5, total, render_benefit_single, b1, out_dir)),
                ("png", render_slide(pkg, 6, total, render_benefit_single, b2, out_dir)),
                ("png", render_slide(pkg, 7, total, render_cta, None, out_dir)),
            ]
            return segs, "8屏实拍版式"

        total_new = 6
        pngs = [
            render_slide(pkg, 0, total_new, render_hook, hook, out_dir),
            render_slide(pkg, 1, total_new, render_pain, pain, out_dir),
            render_slide(pkg, 2, total_new, render_command, command, out_dir),
            render_slide(pkg, 3, total_new, render_effect, effect, out_dir),
            # 屏5 收益（两条）
            render_slide(pkg, 4, total_new, lambda d, p, i, t, a: render_benefit(d, p, i, t, b1, b2), None, out_dir),
            render_slide(pkg, 5, total_new, render_cta, None, out_dir),
        ]
        return [("png", p) for p in pngs], "6屏"

    # 回退旧版式（最多 6 屏纯文字）
    ss = slides[:6]
    total = len(ss)
    pngs = []
    for i, s in enumerate(ss):
        img = Image.new("RGB", (W, H))
        draw = ImageDraw.Draw(img)
        gradient(draw)
        render_plain(draw, pkg, i, total, s)
        p = out_dir / f"slide-{i + 1}.png"
        img.save(p)
        pngs.append(p)
    return [("png", p) for p in pngs], f"旧版式{total}屏"


def build_video(segments, out, bgm=None):
    """ffmpeg 合成：图片段 SLIDE_SEC 秒（Ken Burns 微缩放），视频段用原时长，
    相邻段 FADE 秒交叉淡化，可选混入 BGM。"""
    durs = []
    for kind, p in segments:
        durs.append(SLIDE_SEC if kind == "png" else probe_duration(p))
    n = len(segments)
    total = sum(durs) - (n - 1) * FADE

    cmd = ["ffmpeg", "-y", "-loglevel", "error"]
    for (kind, p), dur in zip(segments, durs):
        if kind == "png":
            cmd += ["-framerate", "25", "-loop", "1", "-t", str(dur), "-i", str(p)]
        else:
            cmd += ["-i", str(p)]
    if bgm:
        # BGM 只有 ~19s，成片可能更长（8 屏实拍版 ~24s）：循环播放，再由 atrim 截到总时长
        cmd += ["-stream_loop", "-1", "-i", str(bgm)]

    fc = []
    for k, ((kind, _p), dur) in enumerate(zip(segments, durs)):
        if kind == "png":
            # 静帧加轻微放大（1.00 → ~1.06），让画面有呼吸感
            fc.append(
                f"[{k}:v]zoompan=z='1+0.00075*on':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'"
                f":d=1:s={W}x{H}:fps=25[v{k}]"
            )
        else:
            # 实拍片段：统一成 1080x1920 / 25fps，不足的用底色补齐
            fc.append(
                f"[{k}:v]scale={W}:{H}:force_original_aspect_ratio=decrease,"
                f"pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:color=0x101017,"
                f"fps=25,setsar=1[v{k}]"
            )
    if n > 1:
        prev = "[v0]"
        acc = durs[0]
        for k in range(1, n):
            label = f"[v{k}]" if k < n - 1 else "[vout]"
            offset = acc - FADE
            fc.append(f"{prev}[v{k}]xfade=transition=fade:duration={FADE}:offset={offset:.2f}{label}")
            prev = label
            acc += durs[k] - FADE
    if bgm:
        fc.append(
            f"[{n}:a]atrim=0:{total:.2f},asetpts=PTS-STARTPTS,"
            f"afade=t=in:d=0.4,afade=t=out:st={total - 1.6:.2f}:d=1.6[aout]"
        )

    cmd += ["-filter_complex", ";".join(fc)]
    cmd += ["-map", "[v0]" if n == 1 else "[vout]"]
    if bgm:
        cmd += ["-map", "[aout]", "-c:a", "aac", "-b:a", "160k"]
    cmd += ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", "25", "-t", f"{total:.2f}", str(out)]
    subprocess.run(cmd, check=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pkg", required=True, help="应用包名（用于文件命名与画面展示）")
    ap.add_argument("--copy", required=True, help="copy.json 路径")
    ap.add_argument("--force", action="store_true", help="当日已生成过也重新生成")
    ap.add_argument("--no-demo", action="store_true", help="忽略 copy.json 的 demo 字段（强制 6 屏）")
    ap.add_argument("--root", default=None, help="项目根目录（默认本脚本所在 autopost 目录）")
    args = ap.parse_args()

    root = Path(args.root).expanduser().resolve() if args.root else ROOT
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
    command = (copy.get("command") or "").strip()
    slides = [clean_slide(str(s)) for s in (copy.get("slides") or []) if str(s).strip()]
    slides = [s for s in slides if s]

    if not qzone_text or not title or not slides:
        print(f"[gen-content] copy.json 缺字段: qzone={bool(qzone_text)} title={bool(title)} slides={len(slides)}", file=sys.stderr)
        sys.exit(1)

    d = date.today().strftime("%Y%m%d")
    media = root / "media"
    media.mkdir(parents=True, exist_ok=True)
    video = media / f"{d}-{pkg}.mp4"
    qzone_file = root / "queue" / "qzone" / f"{d}-{pkg}.txt"
    douyin_file = root / "queue" / "douyin" / f"{d}-{pkg}.json"
    channels_file = root / "queue" / "channels" / f"{d}-{pkg}.json"

    if not args.force and video.exists() and qzone_file.exists() and douyin_file.exists() and channels_file.exists():
        print(f"[gen-content] {d}-{pkg} 今日已生成过，跳过（--force 可重跑）")
        return

    # 1) 渲染画面（有 demo 走 8 屏实拍版式；demo 缺失/不可用自动降级 6 屏）
    demo = None if args.no_demo else (copy.get("demo") or "").strip()
    if demo:
        demo_path = Path(demo)
        if not demo_path.is_absolute():
            demo_path = (root / demo_path)
        if demo_path.exists():
            demo = demo_path
        else:
            print(f"[gen-content] demo 文件不存在，降级 6 屏: {demo}", file=sys.stderr)
            demo = None
    segments, layout = render_frames(pkg, command, slides, media, demo=demo)
    first_png = segments[0][1].name

    # 2) BGM（共享资产，始终取正式目录；缺则先合成，供每天复用）
    bgm = ROOT / "media" / "bgm.wav"
    if not bgm.exists():
        subprocess.run([sys.executable, str(ROOT / "bin" / "gen-bgm.py")], check=True, cwd=str(ROOT))
    if not bgm.exists():
        bgm = None

    # 3) 合成视频
    build_video(segments, video, bgm)
    size_mb = video.stat().st_size / 1024 / 1024
    print(f"[gen-content] 视频: {video} ({size_mb:.1f} MB, {layout}, {len(segments)} 段)")

    # 4) 写 QQ空间队列（首行文字 + 第一屏配图）
    qzone_file.parent.mkdir(parents=True, exist_ok=True)
    qzone_file.write_text(
        qzone_text + "\n" + f"img: media/{first_png}\n", encoding="utf-8"
    )
    print(f"[gen-content] QQ空间队列: {qzone_file}")

    # 5) 写抖音队列
    douyin_file.parent.mkdir(parents=True, exist_ok=True)
    douyin_file.write_text(
        json.dumps(
            {"video": f"media/{d}-{pkg}.mp4", "title": title, "topics": topics[:5], "private": False},
            ensure_ascii=False, indent=2,
        ) + "\n",
        encoding="utf-8",
    )
    print(f"[gen-content] 抖音队列: {douyin_file} (title={title!r}, topics={topics})")

    # 6) 写视频号队列（desc 复用说说的文字，自带话题标签）
    channels_file.parent.mkdir(parents=True, exist_ok=True)
    channels_file.write_text(
        json.dumps(
            {"video": f"media/{d}-{pkg}.mp4", "title": title, "desc": qzone_text, "private": False},
            ensure_ascii=False, indent=2,
        ) + "\n",
        encoding="utf-8",
    )
    print(f"[gen-content] 视频号队列: {channels_file}")


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as e:
        print(f"[gen-content] 子进程失败: {e.cmd[:3]}... rc={e.returncode}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"[gen-content] 失败: {e}", file=sys.stderr)
        sys.exit(1)

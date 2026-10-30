#!/usr/bin/env python3
"""把扫码登录二维码发到邮箱（视频号 / QQ空间 扫码登录时由 lib/mail.js 调用）。

注意：二维码约 2 分钟过期、每 75 秒换新码；邮件解决的是「人不在机器前」——
需要在电脑/平板/另一部手机上打开邮件，再用手机微信扫。手机看自己邮箱里的码扫不了。

凭证: 环境变量 EMAIL_PASSWORD 优先，否则读 ~/.atlisp-email-config（KEY=VALUE 格式）
用法:
  python3 bin/mail-qr.py --platform 视频号 --image logs/qrcode/wechat.png \
      [--url http://192.168.1.100:8123/wechat.png] [--note "..."] [--to a@b.com]
退出码: 0 发送成功 / 1 失败
"""
import argparse
import mimetypes
import os
import re
import smtplib
import sys
from datetime import datetime
from email.mime.image import MIMEImage
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path

SMTP_SERVER = os.environ.get("ATLISP_SMTP_SERVER", "smtp.qq.com")
SMTP_PORT = int(os.environ.get("ATLISP_SMTP_PORT", "465"))
SENDER_EMAIL = os.environ.get("ATLISP_MAIL_FROM", "vitalgg@foxmail.com")
DEFAULT_TO = os.environ.get("ATLISP_MAIL_TO", "vitalgg@foxmail.com")
CRED_FILE = Path.home() / ".atlisp-email-config"


def load_password():
    """环境变量优先，其次读 ~/.atlisp-email-config"""
    pw = os.environ.get("EMAIL_PASSWORD", "").strip()
    if pw:
        return pw
    if not CRED_FILE.exists():
        return ""
    for line in CRED_FILE.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        m = re.match(r"(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$", line)
        if not m:
            continue
        key, val = m.group(1), m.group(2).strip().strip('"').strip("'")
        if key == "EMAIL_PASSWORD":
            return val
    return ""


def build_message(image_path, platform, url, note, to_addr):
    ctype = mimetypes.guess_type(str(image_path))[0] or "image/png"
    png = Path(image_path).read_bytes()
    if len(png) < 500:
        raise ValueError(f"二维码图片太小，可能没截到: {image_path}")

    msg = MIMEMultipart("related")
    msg["Subject"] = f"[@lisp] {platform}扫码登录 · {datetime.now():%m-%d %H:%M}"
    msg["From"] = SENDER_EMAIL
    msg["To"] = to_addr

    stamp = datetime.now().strftime("%H:%M:%S")
    url_line = (
        f'<p>同一局域网也可以直接打开：<a href="{url}">{url}</a></p>' if url else ""
    )
    note_line = f'<p style="color:#c0392b">{note}</p>' if note else ""
    html = f"""<!doctype html><html><body style="font-family:sans-serif;color:#222">
<h2 style="margin:0 0 8px">{platform}扫码登录</h2>
<p>生成时间 {stamp}，二维码约 <b>2 分钟过期</b>，登录进程会每 75 秒自动换新码。</p>
<p><img src="cid:qr@atlisp" alt="二维码" style="width:320px;height:320px"></p>
<p>用微信「扫一扫」扫上面的二维码，在手机上确认登录。</p>
{url_line}
{note_line}
<p style="color:#888;font-size:12px">手机看自己邮箱里的码扫不了（同一块屏幕扫不到自己），
请在电脑/平板/另一部手机上打开本邮件。</p>
</body></html>"""
    msg.attach(MIMEText(html, "html", "utf-8"))

    img = MIMEImage(png, _subtype=ctype.split("/")[-1])
    img.add_header("Content-ID", "<qr@atlisp>")
    img.add_header("Content-Disposition", "inline", filename=f"qr-{platform}.png")
    msg.attach(img)
    return msg


def main():
    ap = argparse.ArgumentParser(description="把扫码登录二维码发到邮箱")
    ap.add_argument("--platform", required=True, help="平台名，如 视频号 / QQ空间")
    ap.add_argument("--image", required=True, help="二维码截图路径")
    ap.add_argument("--url", default="", help="局域网二维码地址（可选）")
    ap.add_argument("--note", default="", help="附加说明（可选）")
    ap.add_argument("--to", default=DEFAULT_TO, help=f"收件人（默认 {DEFAULT_TO}）")
    args = ap.parse_args()

    image = Path(args.image)
    if not image.exists():
        print(f"二维码文件不存在: {image}", file=sys.stderr)
        return 1

    password = load_password()
    if not password:
        print("未找到 EMAIL_PASSWORD（环境变量或 ~/.atlisp-email-config）", file=sys.stderr)
        return 1

    try:
        msg = build_message(image, args.platform, args.url, args.note, args.to)
        with smtplib.SMTP_SSL(SMTP_SERVER, SMTP_PORT, timeout=30) as server:
            server.login(SENDER_EMAIL, password)
            server.sendmail(SENDER_EMAIL, [args.to], msg.as_string())
    except Exception as e:  # noqa: BLE001 邮件失败不影响登录主流程，交给调用方记日志
        print(f"发送失败: {e}", file=sys.stderr)
        return 1
    print(f"已发送到 {args.to}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

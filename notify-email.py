#!/usr/bin/env python3
"""
@lisp CAD应用云管理系统 - 邮件通知脚本
使用163邮箱SMTP服务发送开发建议报告
"""

import argparse
import smtplib
import os
import sys
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from datetime import datetime
from pathlib import Path

# 配置
SMTP_SERVER = "smtp.qq.com"
SMTP_PORT = 465
SENDER_EMAIL = "vitalgg@foxmail.com"
# 需要设置授权码，不是登录密码
# QQ邮箱 -> 设置 -> 账户 -> POP3/SMTP服务 -> 开启 -> 生成授权码
SENDER_PASSWORD = os.environ.get("EMAIL_PASSWORD", "")  # 从环境变量读取
RECEIVER_EMAIL = "vitalgg@foxmail.com"

REPORT_DIR = Path.home() / "atlisp" / "reports"


def load_report(report_path=None):
    """加载报告：显式路径优先，否则取当天/最新的 dev-suggestions。"""
    if report_path:
        p = Path(report_path)
        if p.exists():
            return p.read_text(encoding='utf-8')
        return None
    today = datetime.now().strftime("%Y%m%d")
    report_file = REPORT_DIR / f"dev-suggestions-{today}.md"
    if not report_file.exists():
        # 查找最近的报告
        reports = sorted(REPORT_DIR.glob("dev-suggestions-*.md"), reverse=True)
        if reports:
            report_file = reports[0]
        else:
            return None
    with open(report_file, 'r', encoding='utf-8') as f:
        return f.read()


def create_email_body(report_content, title="@lisp 开发建议报告"):
    """创建邮件正文（HTML格式）"""
    # 将Markdown转换为简单的HTML
    html_content = report_content.replace('\n', '<br>')
    html_content = html_content.replace('# ', '<h1>').replace('<h1>', '<h1>', 1)

    html = f"""
    <html>
    <head>
        <style>
            body {{ font-family: Arial, sans-serif; line-height: 1.6; color: #333; }}
            h1 {{ color: #2c3e50; border-bottom: 2px solid #3498db; padding-bottom: 10px; }}
            h2 {{ color: #34495e; }}
            h3 {{ color: #7f8c8d; }}
            .priority-high {{ color: #e74c3c; font-weight: bold; }}
            .priority-medium {{ color: #f39c12; }}
            .action-item {{ background: #f8f9fa; padding: 10px; margin: 5px 0; border-left: 4px solid #3498db; }}
            code {{ background: #ecf0f1; padding: 2px 6px; border-radius: 3px; }}
            .footer {{ margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; color: #7f8c8d; font-size: 12px; }}
        </style>
    </head>
    <body>
        <h1>{title}</h1>
        {html_content}
        <div class="footer">
            <p>此邮件由自动生成脚本发送</p>
            <p>报告位置: ~/atlisp/reports/</p>
            <p>查看命令: make suggestions-latest</p>
        </div>
    </body>
    </html>
    """
    return html


def send_email(subject, html_content):
    """发送邮件"""
    if not SENDER_PASSWORD:
        print("错误: 未设置邮箱密码")
        print("请设置环境变量: export EMAIL_PASSWORD='你的163授权码'")
        print("或修改脚本中的 SENDER_PASSWORD")
        return False
    
    msg = MIMEMultipart('alternative')
    msg['Subject'] = subject
    msg['From'] = SENDER_EMAIL
    msg['To'] = RECEIVER_EMAIL
    
    # 添加HTML内容
    html_part = MIMEText(html_content, 'html', 'utf-8')
    msg.attach(html_part)
    
    try:
        # 使用SSL连接
        with smtplib.SMTP_SSL(SMTP_SERVER, SMTP_PORT) as server:
            server.login(SENDER_EMAIL, SENDER_PASSWORD)
            server.sendmail(SENDER_EMAIL, RECEIVER_EMAIL, msg.as_string())
        print(f"邮件已发送到 {RECEIVER_EMAIL}")
        return True
    except Exception as e:
        print(f"发送失败: {e}")
        return False


def main():
    """主函数"""
    ap = argparse.ArgumentParser(description="发送报告邮件")
    ap.add_argument("--report", help="报告文件路径（默认：当天/最新的 dev-suggestions-*.md）")
    ap.add_argument("--title", default="@lisp 开发建议报告", help="邮件标题（同时作为主题前缀）")
    args = ap.parse_args()

    print("正在生成邮件...")

    # 加载报告
    report = load_report(args.report)
    if not report:
        print(f"未找到报告: {args.report or 'dev-suggestions-*.md'}")
        return 1

    # 创建邮件内容
    html_content = create_email_body(report, args.title)

    # 发送邮件
    today = datetime.now().strftime("%Y-%m-%d")
    subject = f"{args.title} - {today}"

    if send_email(subject, html_content):
        print("通知完成")
        return 0
    else:
        print("通知失败，请检查邮箱配置")
        return 1


if __name__ == "__main__":
    sys.exit(main())
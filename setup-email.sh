#!/bin/bash

# @lisp CAD应用云管理系统 - 邮箱配置脚本

CONFIG_FILE="${HOME}/.atlisp-email-config"

echo "@lisp 邮箱通知配置"
echo "=================="
echo ""
echo "163邮箱SMTP配置说明："
echo "1. 登录 163邮箱"
echo "2. 设置 -> POP3/SMTP/IMAP"
echo "3. 开启 SMTP 服务"
echo "4. 生成授权码（不是登录密码）"
echo ""

# 检查是否已配置
if [ -f "$CONFIG_FILE" ]; then
    echo "检测到已有配置"
    read -p "是否重新配置？(y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "跳过配置"
        exit 0
    fi
fi

# 输入授权码
read -s -p "请输入163邮箱SMTP授权码: " EMAIL_PASSWORD
echo

if [ -z "$EMAIL_PASSWORD" ]; then
    echo "错误: 授权码不能为空"
    exit 1
fi

# 保存配置
echo "EMAIL_PASSWORD=${EMAIL_PASSWORD}" > "$CONFIG_FILE"
chmod 600 "$CONFIG_FILE"

echo ""
echo "配置已保存到: $CONFIG_FILE"
echo ""
echo "测试发送..."
echo "请运行: python3 notify-email.py"
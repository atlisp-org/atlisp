#!/bin/sh

if [ -z "$1" ] || [ -z "$2" ]; then
    echo "用法: $0 \"用户名\" \"邮箱\""
    exit 1
fi

cd "$HOME"
git config --global user.name "$1"
git config --global user.email "$2"

echo "Git 用户已配置: $1 <$2>"
#!/bin/sh

TARGET_DIR="${HOME}/atlisp/packages"

if [ -z "$1" ] || [ -z "$2" ]; then
    echo "用法: $0 <包名> \"提交信息\""
    exit 1
fi

if [ ! -d "$TARGET_DIR/$1" ]; then
    echo "错误: 包 $1 不存在于 $TARGET_DIR"
    exit 1
fi

cd "$TARGET_DIR/$1"

if [ -z "$(git status --porcelain)" ]; then
    echo "没有需要提交的更改"
    exit 0
fi

if ! git pull; then
    echo "错误: pull 失败，请手动解决冲突后重试"
    exit 1
fi

git add .
git commit -m "$2"

if git push; then
    echo "推送成功"
else
    echo "错误: 推送失败"
    exit 1
fi
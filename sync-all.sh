#!/bin/sh

TARGET_DIR="${HOME}/atlisp"

if [ ! -d "$TARGET_DIR" ]; then
    echo "错误: $TARGET_DIR 不存在"
    exit 1
fi

cd "$TARGET_DIR"

echo "正在同步子模块..."

git submodule sync --recursive

if git submodule update --init --recursive; then
    echo "子模块初始化完成"
else
    echo "错误: 子模块初始化失败"
    exit 1
fi

git submodule foreach --quiet 'git checkout main' || echo "警告: 部分子模块 checkout 失败"

git submodule foreach --quiet 'git pull' || echo "警告: 部分子模块 pull 失败"

echo "同步完成"
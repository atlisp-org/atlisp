#!/bin/bash

# @lisp CAD应用云管理系统 - 包推送脚本
# 用法: ./push-pkg.sh <包名> "提交信息" [选项]
# 选项:
#   --check    仅检查，不推送
#   --lint     推送前运行lint检查
#   --force    强制推送

set -e

TARGET_DIR="${HOME}/atlisp/packages"
LINT_TOOL="${HOME}/atlisp/atlisp-lint/bin/atlisp-lint"
CHECK=false
LINT=false
FORCE=false

# 解析参数
PKG_NAME=""
COMMIT_MSG=""
while [[ $# -gt 0 ]]; do
    case $1 in
        --check)
            CHECK=true
            shift
            ;;
        --lint)
            LINT=true
            shift
            ;;
        --force)
            FORCE=true
            shift
            ;;
        *)
            if [ -z "$PKG_NAME" ]; then
                PKG_NAME="$1"
            elif [ -z "$COMMIT_MSG" ]; then
                COMMIT_MSG="$1"
            fi
            shift
            ;;
    esac
done

# 参数检查
if [ -z "$PKG_NAME" ] || [ -z "$COMMIT_MSG" ]; then
    echo "用法: $0 <包名> \"提交信息\" [选项]"
    echo "选项:"
    echo "  --check    仅检查，不推送"
    echo "  --lint     推送前运行lint检查"
    echo "  --force    强制推送"
    exit 1
fi

# 检查包是否存在
if [ ! -d "$TARGET_DIR/$PKG_NAME" ]; then
    echo "错误: 包 $PKG_NAME 不存在于 $TARGET_DIR"
    exit 1
fi

cd "$TARGET_DIR/$PKG_NAME"

# 检查是否为git仓库
if [ ! -d ".git" ]; then
    echo "错误: $PKG_NAME 不是git仓库"
    exit 1
fi

# 检查是否有变更
if [ -z "$(git status --porcelain)" ]; then
    echo "没有需要提交的更改"
    exit 0
fi

# 运行lint检查
if [ "$LINT" = true ]; then
    echo "运行lint检查..."
    if ! "$LINT_TOOL" --src .; then
        echo "错误: lint检查失败，请修复后再推送"
        exit 1
    fi
fi

# 仅检查模式
if [ "$CHECK" = true ]; then
    echo "检查模式 - 包 $PKG_NAME 有以下变更:"
    git status --short
    exit 0
fi

# 拉取最新代码
echo "拉取最新代码..."
if ! git pull; then
    echo "错误: pull 失败，请手动解决冲突后重试"
    exit 1
fi

# 添加所有变更
echo "添加变更..."
git add .

# 提交
echo "提交变更..."
git commit -m "$COMMIT_MSG"

# 推送
echo "推送到远程仓库..."
if [ "$FORCE" = true ]; then
    if git push --force; then
        echo "推送成功（强制）"
    else
        echo "错误: 推送失败"
        exit 1
    fi
else
    if git push; then
        echo "推送成功"
    else
        echo "错误: 推送失败，可能需要拉取最新代码"
        echo "提示: 使用 --force 选项强制推送"
        exit 1
    fi
fi
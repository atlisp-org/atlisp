#!/bin/sh

if [ ! -d ".git" ]; then
    echo "错误: 当前目录不是 git 仓库"
    exit 1
fi

CURRENT_BRANCH=$(git symbolic-ref --short HEAD 2>/dev/null)
if [ -n "$CURRENT_BRANCH" ]; then
    echo "当前已在分支 $CURRENT_BRANCH，无须处理"
    exit 0
fi

echo "检测到分离式 HEAD 状态，正在创建临时分支..."
git branch temp-head_backup

if git checkout main 2>/dev/null; then
    echo "已切换到 main 分支"
else
    echo "警告: main 分支不存在，尝试切换到 master"
    if git checkout master 2>/dev/null; then
        echo "已切换到 master 分支"
    else
        echo "错误: 无法切换分支，正在恢复..."
        git checkout temp-head_backup
        git branch -D temp-head_backup 2>/dev/null
        exit 1
    fi
fi

if git merge temp-head_backup --no-edit; then
    echo "已合并临时分支"
else
    echo "合并失败（临时分支可能为空），跳过合并"
fi

git branch -D temp-head_backup
echo "处理完成"
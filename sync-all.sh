#!/bin/bash

# @lisp CAD应用云管理系统 - 子模块同步脚本
# 用法: ./sync-all.sh [选项]
# 选项:
#   --force    强制同步（即使没有变更）
#   --check    仅检查状态，不执行同步
#   --quiet    静默模式

set +e  # 容错模式：单个任务失败不中断

TARGET_DIR="${HOME}/atlisp"
LOG_FILE="${TARGET_DIR}/logs/sync.log"
FORCE=false
CHECK=false
QUIET=false

# 解析参数
while [[ $# -gt 0 ]]; do
    case $1 in
        --force)
            FORCE=true
            shift
            ;;
        --check)
            CHECK=true
            shift
            ;;
        --quiet)
            QUIET=true
            shift
            ;;
        *)
            echo "未知参数: $1"
            exit 1
            ;;
    esac
done

# 日志函数
log() {
    if [ "$QUIET" = false ]; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
    fi
    mkdir -p "$(dirname "$LOG_FILE")"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"
}

# 错误处理
error_exit() {
    log "错误: $1"
    exit 1
}

# 检查目录
if [ ! -d "$TARGET_DIR" ]; then
    error_exit "$TARGET_DIR 不存在"
fi

cd "$TARGET_DIR"

# 检查是否为git仓库
if [ ! -d ".git" ]; then
    error_exit "当前目录不是git仓库"
fi

log "开始同步子模块..."

# 检查状态
if [ "$CHECK" = true ]; then
    log "检查子模块状态..."
    git submodule status
    exit 0
fi

# 同步子模块
log "执行 git submodule sync --recursive..."
git submodule sync --recursive

# 初始化并更新子模块
log "执行 git submodule update --init --recursive..."
if ! git submodule update --init --recursive; then
    error_exit "子模块初始化失败"
fi

# 检查所有子模块是否在main分支
log "检查子模块分支..."
git submodule foreach --quiet '
    current_branch=$(git symbolic-ref --short HEAD 2>/dev/null)
    if [ "$current_branch" != "main" ] && [ "$current_branch" != "master" ]; then
        echo "警告: $name 不在main/master分支 (当前: $current_branch)"
    fi
'

# 切换到main分支
log "切换子模块到main分支..."
git submodule foreach --quiet 'git checkout main 2>/dev/null || git checkout master 2>/dev/null || echo "警告: 无法切换 $name 到main/master分支"'

# 拉取最新代码
log "拉取子模块最新代码..."
git submodule foreach --quiet 'git pull 2>/dev/null || echo "警告: 无法拉取 $name 的最新代码"'

# 同步独立项目
log "同步独立项目..."
INDEPENDENT_PROJECTS=("kernel" "mcp-server" "agent" "parser" "server" "atlispcc" "atlisp-lint" "private-packages")

for project in "${INDEPENDENT_PROJECTS[@]}"; do
    PROJECT_DIR="${TARGET_DIR}/${project}"
    if [ -d "$PROJECT_DIR/.git" ]; then
        log "同步 $project..."
        cd "$PROJECT_DIR"
        
        # 检查是否在main分支
        current_branch=$(git symbolic-ref --short HEAD 2>/dev/null)
        if [ "$current_branch" != "main" ] && [ "$current_branch" != "master" ]; then
            log "警告: $project 不在main/master分支 (当前: $current_branch)"
            git checkout main 2>/dev/null || git checkout master 2>/dev/null || true
        fi
        
        # 拉取最新代码
        if git pull 2>/dev/null; then
            log "$project 同步完成"
        else
            log "警告: $project 同步失败"
        fi
    else
        log "跳过 $project (不是git仓库)"
    fi
done

cd "$TARGET_DIR"

# 检查是否有更新
if [ "$FORCE" = false ]; then
    log "检查是否有更新..."
    changes=$(git submodule status | grep -c "+" || true)
    if [ "$changes" -gt 0 ]; then
        log "检测到 $changes 个子模块有更新"
    else
        log "所有子模块已是最新"
    fi
fi

log "同步完成"
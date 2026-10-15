#!/bin/bash
# /home/vitalgg/atlisp/automation/check-vllm.sh
# 检查本地 vllm-cuda 服务是否就绪

VLLM_URL="${VLLM_URL:-http://localhost:8001/v1}"
VLLM_API_KEY="${VLLM_API_KEY:?未设置 VLLM_API_KEY，请先 export VLLM_API_KEY=xxx}"
TIMEOUT=5

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# 检查 vllm 服务
check_vllm() {
    local body response http_code models
    body=$(mktemp "${TMPDIR:-/tmp}/vllm-response-XXXXXX")
    response=$(curl -s -w "%{http_code}" -o "$body" \
        --connect-timeout "$TIMEOUT" \
        --max-time "$TIMEOUT" \
        -H "Authorization: Bearer $VLLM_API_KEY" \
        "$VLLM_URL/models" 2>/dev/null)
    
    http_code=$response
    
    if [ "$http_code" = "200" ]; then
        models=$(jq -r '.data[].id' "$body" 2>/dev/null)
        rm -f "$body"
        if [ -n "$models" ]; then
            log_info "vllm 服务就绪"
            log_info "可用模型: $models"
            return 0
        else
            log_warn "vllm 服务响应但无可用模型"
            return 1
        fi
    elif [ "$http_code" = "000" ]; then
        rm -f "$body"
        log_error "无法连接到 vllm 服务 ($VLLM_URL)"
        return 1
    else
        rm -f "$body"
        log_error "vllm 服务返回错误: HTTP $http_code"
        return 1
    fi
}

# 等待服务就绪
wait_for_vllm() {
    local max_wait=${1:-60}
    local interval=${2:-5}
    local elapsed=0
    
    log_info "等待 vllm 服务就绪 (最多 ${max_wait}s)..."
    
    while [ $elapsed -lt $max_wait ]; do
        if check_vllm > /dev/null 2>&1; then
            return 0
        fi
        
        sleep $interval
        elapsed=$((elapsed + interval))
        log_warn "等待中... (${elapsed}/${max_wait}s)"
    done
    
    log_error "等待超时，vllm 服务未就绪"
    return 1
}

# 主函数
main() {
    case "${1:-check}" in
        check)
            check_vllm
            ;;
        wait)
            wait_for_vllm "${2:-60}" "${3:-5}"
            ;;
        *)
            echo "用法: $0 {check|wait [max_wait] [interval]}"
            exit 1
            ;;
    esac
}

main "$@"

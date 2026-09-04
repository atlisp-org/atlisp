#!/bin/bash

# @lisp CAD应用云管理系统 - 开发建议生成器
# 自动分析项目并生成开发建议

set +e  # 容错模式：单个任务失败不中断

TARGET_DIR="${HOME}/atlisp"
REPORT_DIR="${TARGET_DIR}/reports"
REPORT_FILE="${REPORT_DIR}/dev-suggestions-$(date +%Y%m%d).md"
HISTORY_FILE="${REPORT_DIR}/dev-suggestions-history.md"

# 创建报告目录
mkdir -p "$REPORT_DIR"

# 开始生成报告
echo "# @lisp 开发建议报告" > "$REPORT_FILE"
echo "" >> "$REPORT_FILE"
echo "生成时间: $(date '+%Y-%m-%d %H:%M:%S')" >> "$REPORT_FILE"
echo "" >> "$REPORT_FILE"

# 1. 项目概况
echo "## 一、项目概况" >> "$REPORT_FILE"
echo "" >> "$REPORT_FILE"

# 子模块状态
echo "### 子模块" >> "$REPORT_FILE"
cd "$TARGET_DIR"
for submodule in packages lib docs vscode; do
    if [ -d "$submodule/.git" ]; then
        cd "$TARGET_DIR/$submodule"
        branch=$(git branch --show-current 2>/dev/null || echo "unknown")
        changes=$(git status --porcelain 2>/dev/null | wc -l)
        echo "- **$submodule**: 分支=$branch, 未提交=$changes" >> "$REPORT_FILE"
    fi
done
echo "" >> "$REPORT_FILE"

# 独立项目状态
echo "### 独立项目" >> "$REPORT_FILE"
for project in kernel mcp-server agent parser server; do
    if [ -d "$TARGET_DIR/$project/.git" ]; then
        cd "$TARGET_DIR/$project"
        branch=$(git branch --show-current 2>/dev/null || echo "unknown")
        changes=$(git status --porcelain 2>/dev/null | wc -l)
        echo "- **$project**: 分支=$branch, 未提交=$changes" >> "$REPORT_FILE"
    fi
done
cd "$TARGET_DIR"
echo "" >> "$REPORT_FILE"

# 2. 代码质量检查
echo "## 二、代码质量" >> "$REPORT_FILE"
echo "" >> "$REPORT_FILE"

# 检查LSP文件数量
echo "### 代码规模" >> "$REPORT_FILE"
lib_files=$(find lib/src -name "*.lsp" 2>/dev/null | wc -l)
pkg_files=$(find packages -name "*.lsp" -not -path "*/node_modules/*" 2>/dev/null | wc -l)
kernel_files=$(find kernel -name "*.lsp" 2>/dev/null | wc -l)
echo "- 函数库: $lib_files 个文件" >> "$REPORT_FILE"
echo "- 应用包: $pkg_files 个文件" >> "$REPORT_FILE"
echo "- 内核: $kernel_files 个文件" >> "$REPORT_FILE"
echo "" >> "$REPORT_FILE"

# 3. 测试覆盖检查
echo "### 测试覆盖" >> "$REPORT_FILE"
test_dirs=$(ls -d lib/test/*/ 2>/dev/null | wc -l)
src_dirs=$(ls -d lib/src/*/ 2>/dev/null | wc -l)
echo "- 源码目录: $src_dirs" >> "$REPORT_FILE"
echo "- 测试目录: $test_dirs" >> "$REPORT_FILE"

# 找出无测试的命名空间
echo "- **无测试的命名空间**:" >> "$REPORT_FILE"
for dir in lib/src/*/; do
    dirname=$(basename "$dir")
    if [ ! -d "lib/test/$dirname" ]; then
        file_count=$(ls -1 "$dir"/*.lsp 2>/dev/null | wc -l)
        if [ "$file_count" -gt 0 ]; then
            echo "  - $dirname ($file_count 个文件)" >> "$REPORT_FILE"
        fi
    fi
done
echo "" >> "$REPORT_FILE"

# 4. 文档检查
echo "## 三、文档状态" >> "$REPORT_FILE"
echo "" >> "$REPORT_FILE"

# 包文档
pkg_with_readme=$(find packages -maxdepth 2 -name "README*" 2>/dev/null | wc -l)
total_pkgs=$(ls -d packages/*/ 2>/dev/null | wc -l)
echo "- 有README的包: $pkg_with_readme / $total_pkgs" >> "$REPORT_FILE"

# 包定义
pkg_with_def=$(find packages -maxdepth 2 -name "pkg.lsp" 2>/dev/null | wc -l)
echo "- 有pkg.lsp的包: $pkg_with_def / $total_pkgs" >> "$REPORT_FILE"
echo "" >> "$REPORT_FILE"

# 5. 生成建议
echo "## 四、开发建议" >> "$REPORT_FILE"
echo "" >> "$REPORT_FILE"

# 建议1：测试覆盖
if [ "$test_dirs" -lt "$src_dirs" ]; then
    missing=$((src_dirs - test_dirs))
    echo "### 高优先级" >> "$REPORT_FILE"
    echo "" >> "$REPORT_FILE"
    echo "1. **补充测试覆盖** - 有 $missing 个命名空间缺少测试" >> "$REPORT_FILE"
    echo "   - 建议: 为 vectra, system, word 等核心模块添加测试" >> "$REPORT_FILE"
    echo "   - 影响: 代码质量和可维护性" >> "$REPORT_FILE"
    echo "" >> "$REPORT_FILE"
fi

# 建议2：文档完善
if [ "$pkg_with_readme" -lt "$total_pkgs" ]; then
    missing_readme=$((total_pkgs - pkg_with_readme))
    echo "### 中优先级" >> "$REPORT_FILE"
    echo "" >> "$REPORT_FILE"
    echo "2. **完善包文档** - 有 $missing_readme 个包缺少README" >> "$REPORT_FILE"
    echo "   - 建议: 为每个包添加使用说明" >> "$REPORT_FILE"
    echo "   - 影响: 用户体验" >> "$REPORT_FILE"
    echo "" >> "$REPORT_FILE"
fi

# 建议3：代码质量
echo "3. **代码质量优化**" >> "$REPORT_FILE"
echo "   - 建议: 定期运行 make lint-projects 检查" >> "$REPORT_FILE"
echo "   - 影响: 代码可维护性" >> "$REPORT_FILE"
echo "" >> "$REPORT_FILE"

# 建议4：文档结构
echo "4. **文档结构优化**" >> "$REPORT_FILE"
echo "   - 建议: 统一 docs/ 目录结构" >> "$REPORT_FILE"
echo "   - 影响: 项目可读性" >> "$REPORT_FILE"
echo "" >> "$REPORT_FILE"

# 6. 下一步行动
echo "## 五、下一步行动" >> "$REPORT_FILE"
echo "" >> "$REPORT_FILE"
echo "- [ ] 运行 \`make lint-projects\` 检查代码质量" >> "$REPORT_FILE"
echo "- [ ] 运行 \`make status-projects\` 查看项目状态" >> "$REPORT_FILE"
echo "- [ ] 选择一个建议开始执行" >> "$REPORT_FILE"
echo "" >> "$REPORT_FILE"

echo "---" >> "$REPORT_FILE"
echo "*此报告由自动生成脚本创建，建议每周更新一次*" >> "$REPORT_FILE"

# 生成历史记录
echo "# 开发建议历史" > "$HISTORY_FILE"
echo "" >> "$HISTORY_FILE"
ls -t "$REPORT_DIR"/dev-suggestions-*.md 2>/dev/null | head -10 | while read file; do
    date=$(basename "$file" | sed 's/dev-suggestions-//;s/.md//')
    echo "- [$date]($file)" >> "$HISTORY_FILE"
done

# 发送邮件通知
if [ -f "${HOME}/.atlisp-email-config" ]; then
    echo "发送邮件通知..."
    source "${HOME}/.atlisp-email-config"
    export EMAIL_PASSWORD
    python3 "${TARGET_DIR}/notify-email.py" 2>/dev/null || echo "邮件发送失败"
fi

echo "报告已生成: $REPORT_FILE"
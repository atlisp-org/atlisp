# @lisp CAD应用云管理系统 - 自动化维护 Makefile
# 使用方法: make [目标]

# 配置变量
SHELL := /bin/bash
TARGET_DIR := $(HOME)/atlisp
PACKAGES_DIR := $(TARGET_DIR)/packages
LIB_DIR := $(TARGET_DIR)/lib
VSCODE_DIR := $(TARGET_DIR)/vscode
DOCS_DIR := $(TARGET_DIR)/docs
LINT_TOOL := $(TARGET_DIR)/atlisp-lint/bin/atlisp-lint
PYTHON := python3

# 默认目标
.DEFAULT_GOAL := help

# 颜色定义
RED := \033[0;31m
GREEN := \033[0;32m
YELLOW := \033[1;33m
BLUE := \033[0;34m
NC := \033[0m # No Color

# 显示帮助信息
.PHONY: help
help:
	@echo "$(BLUE)@lisp CAD应用云管理系统 - 自动化维护工具$(NC)"
	@echo ""
	@echo "$(GREEN)可用目标:$(NC)"
	@echo "  sync          - 同步所有子模块"
	@echo "  sync-projects - 同步独立项目"
	@echo "  lint          - 运行代码检查"
	@echo "  lint-projects - 检查独立项目"
	@echo "  lint-fix      - 运行代码检查并自动修复"
	@echo "  lint-staged   - 检查git暂存区的文件"
	@echo "  lint-install  - 安装git pre-commit钩子"
	@echo "  lint-cache    - 清除lint缓存"
	@echo "  docs          - 生成文档"
	@echo "  build-vscode  - 构建VSCode扩展"
	@echo "  test-vscode   - 测试VSCode扩展"
	@echo "  clean         - 清理构建产物"
	@echo "  packages-list - 列出所有包"
	@echo "  packages-check - 检查包规范"
	@echo "  cron-install  - 安装定时任务"
	@echo "  cron-remove   - 移除定时任务"
	@echo "  cron-status   - 查看定时任务状态"
	@echo "  status        - 显示项目状态"
	@echo "  status-projects - 显示独立项目状态"
	@echo "  suggestions   - 生成开发建议报告"
	@echo "  suggestions-latest - 查看最新建议"
	@echo "  email-setup   - 配置邮件通知"
	@echo "  email-test    - 测试邮件发送"
	@echo "  all           - 运行所有检查"
	@echo ""
	@echo "$(GREEN)智能工作流:$(NC)"
	@echo "  smart-add     - 添加智能任务 (TASK=name PRIORITY=1 DEPENDS=dep)"
	@echo "  smart-run     - 执行智能任务队列"
	@echo "  smart-status  - 查看智能任务状态"
	@echo "  smart-monitor - 实时监控面板"
	@echo "  smart-clear   - 清空任务队列"
	@echo "  smart-retry   - 重试失败任务 (TASK=name)"
	@echo ""
	@echo "$(GREEN)快捷任务:$(NC)"
	@echo "  quick-sync    - 快速同步"
	@echo "  quick-lint    - 快速检查"
	@echo "  quick-test    - 快速测试"
	@echo "  full-check    - 完整检查"

# 同步所有子模块
.PHONY: sync
sync:
	@echo "$(BLUE)同步所有子模块...$(NC)"
	./sync-all.sh

# 代码检查
.PHONY: lint
lint:
	@echo "$(BLUE)运行代码检查...$(NC)"
	cd $(LIB_DIR) && $(LINT_TOOL) --src src
	cd $(PACKAGES_DIR) && $(LINT_TOOL) --src .

# 代码检查并自动修复
.PHONY: lint-fix
lint-fix:
	@echo "$(BLUE)运行代码检查并自动修复...$(NC)"
	cd $(LIB_DIR) && $(LINT_TOOL) --src src --fix
	cd $(PACKAGES_DIR) && $(LINT_TOOL) --src . --fix

# 检查git暂存区的文件
.PHONY: lint-staged
lint-staged:
	@echo "$(BLUE)检查git暂存区的文件...$(NC)"
	cd $(LIB_DIR) && $(LINT_TOOL) --staged
	cd $(PACKAGES_DIR) && $(LINT_TOOL) --staged

# 安装git pre-commit钩子
.PHONY: lint-install
lint-install:
	@echo "$(BLUE)安装git pre-commit钩子...$(NC)"
	cd $(LIB_DIR) && $(LINT_TOOL) --install-hook
	cd $(PACKAGES_DIR) && $(LINT_TOOL) --install-hook

# 清除lint缓存
.PHONY: lint-cache
lint-cache:
	@echo "$(BLUE)清除lint缓存...$(NC)"
	cd $(LIB_DIR) && $(LINT_TOOL) --clear-cache
	cd $(PACKAGES_DIR) && $(LINT_TOOL) --clear-cache

# 生成文档
.PHONY: docs
docs:
	@echo "$(BLUE)生成文档...$(NC)"
	cd $(LIB_DIR) && $(PYTHON) generate_manifest.py
	@echo "$(GREEN)文档生成完成$(NC)"

# 构建VSCode扩展
.PHONY: build-vscode
build-vscode:
	@echo "$(BLUE)构建VSCode扩展...$(NC)"
	cd $(VSCODE_DIR) && npm install && npm run esbuild
	@echo "$(GREEN)VSCode扩展构建完成$(NC)"

# 测试VSCode扩展
.PHONY: test-vscode
test-vscode:
	@echo "$(BLUE)测试VSCode扩展...$(NC)"
	cd $(VSCODE_DIR) && npm run test-compile

# 清理构建产物
.PHONY: clean
clean:
	@echo "$(BLUE)清理构建产物...$(NC)"
	cd $(VSCODE_DIR) && npm run clean 2>/dev/null || true
	cd $(LIB_DIR) && $(LINT_TOOL) --clear-cache 2>/dev/null || true
	find $(TARGET_DIR) -name "*.fas" -delete 2>/dev/null || true
	@echo "$(GREEN)清理完成$(NC)"

# 列出所有包
.PHONY: packages-list
packages-list:
	@echo "$(BLUE)所有包列表:$(NC)"
	@ls -1 $(PACKAGES_DIR) | grep -v "^\." | sort

# 检查包规范
.PHONY: packages-check
packages-check:
	@echo "$(BLUE)检查包规范...$(NC)"
	@for pkg in $(PACKAGES_DIR)/*/; do \
		if [ -f "$$pkg/pkg.lsp" ]; then \
			echo "$(GREEN)✓ $(basename $$pkg)$(NC)"; \
		else \
			echo "$(RED)✗ $(basename $$pkg) - 缺少pkg.lsp$(NC)"; \
		fi; \
	done

# 安装定时任务（fcron）
.PHONY: cron-install
cron-install:
	@echo "$(BLUE)安装fcron定时任务...$(NC)"
	./setup-fcron.sh --install

# 移除定时任务
.PHONY: cron-remove
cron-remove:
	@echo "$(BLUE)移除fcron定时任务...$(NC)"
	./setup-fcron.sh --remove

# 查看定时任务状态
.PHONY: cron-status
cron-status:
	./setup-fcron.sh --status

# 显示项目状态
.PHONY: status
status:
	@echo "$(BLUE)项目状态:$(NC)"
	@echo ""
	@echo "$(YELLOW)主仓库:$(NC)"
	@git status --short
	@echo ""
	@echo "$(YELLOW)子模块状态:$(NC)"
	@git submodule status
	@echo ""
	@echo "$(YELLOW)包数量:$(NC)"
	@ls -1 $(PACKAGES_DIR) | grep -v "^\." | wc -l
	@echo ""
	@echo "$(YELLOW)函数库函数数量:$(NC)"
	@find $(LIB_DIR)/src -name "*.lsp" | wc -l

# 生成开发建议报告
.PHONY: suggestions
suggestions:
	@echo "$(BLUE)生成开发建议报告...$(NC)"
	./generate-suggestions.sh
	@echo "$(GREEN)报告已生成: reports/dev-suggestions-$(shell date +%Y%m%d).md$(NC)"

# 查看最新建议
.PHONY: suggestions-latest
suggestions-latest:
	@cat reports/dev-suggestions-$(shell date +%Y%m%d).md 2>/dev/null || echo "$(YELLOW)今天没有报告，请运行 make suggestions$(NC)"

# 配置邮件通知
.PHONY: email-setup
email-setup:
	@echo "$(BLUE)配置邮件通知...$(NC)"
	./setup-email.sh

# 测试邮件发送
.PHONY: email-test
email-test:
	@echo "$(BLUE)测试邮件发送...$(NC)"
	python3 notify-email.py

# 同步独立项目
.PHONY: sync-projects
sync-projects:
	@echo "$(BLUE)同步独立项目...$(NC)"
	@for project in kernel mcp-server agent parser server atlispcc atlisp-lint private-packages; do \
		if [ -d "$(TARGET_DIR)/$$project/.git" ]; then \
			echo "$(BLUE)同步 $$project...$(NC)"; \
			cd $(TARGET_DIR)/$$project && git pull 2>/dev/null || echo "$(YELLOW)警告: $$project 同步失败$(NC)"; \
		fi; \
	done
	@echo "$(GREEN)独立项目同步完成$(NC)"

# 检查独立项目状态
.PHONY: status-projects
status-projects:
	@echo "$(BLUE)独立项目状态:$(NC)"
	@for project in kernel mcp-server agent parser server atlispcc atlisp-lint private-packages; do \
		if [ -d "$(TARGET_DIR)/$$project/.git" ]; then \
			echo "$(YELLOW)$$project:$(NC)"; \
			cd $(TARGET_DIR)/$$project && git status --short 2>/dev/null; \
		fi; \
	done

# Lint 独立项目
.PHONY: lint-projects
lint-projects:
	@echo "$(BLUE)Lint 独立项目...$(NC)"
	@for project in kernel mcp-server parser atlispcc atlisp-lint; do \
		if [ -d "$(TARGET_DIR)/$$project" ]; then \
			echo "$(BLUE)检查 $$project...$(NC)"; \
			cd $(TARGET_DIR)/$$project && $(LINT_TOOL) --src . 2>/dev/null || echo "$(YELLOW)警告: $$project lint 失败或无 LSP 文件$(NC)"; \
		fi; \
	done
	@echo "$(GREEN)独立项目 lint 完成$(NC)"

# 运行所有检查
.PHONY: all
all: sync sync-projects lint docs
	@echo "$(GREEN)所有检查完成$(NC)"

# 开发模式：安装所有钩子和定时任务
.PHONY: dev-setup
dev-setup: lint-install
	@echo "$(BLUE)安装开发环境...$(NC)"
	@mkdir -p $(TARGET_DIR)/logs
	@echo "$(GREEN)开发环境安装完成$(NC)"
	@echo "$(YELLOW)已安装: git pre-commit钩子$(NC)"
	@echo "$(YELLOW)可选: make cron-install 安装定时同步$(NC)"

# 智能工作流
.PHONY: smart-add
smart-add:
	@echo "$(BLUE)添加智能任务...$(NC)"
	./smart-scheduler.sh add $(TASK) $(PRIORITY) $(DEPENDS)

.PHONY: smart-run
smart-run:
	@echo "$(BLUE)执行智能任务队列...$(NC)"
	./smart-scheduler.sh run

.PHONY: smart-status
smart-status:
	./smart-scheduler.sh status

.PHONY: smart-monitor
smart-monitor:
	./smart-scheduler.sh monitor

.PHONY: smart-clear
smart-clear:
	./smart-scheduler.sh clear

.PHONY: smart-retry
smart-retry:
	./smart-scheduler.sh retry $(TASK)

# 快捷任务
.PHONY: quick-sync
quick-sync:
	@echo "$(BLUE)快速同步...$(NC)"
	./smart-scheduler.sh add sync 1
	./smart-scheduler.sh run

.PHONY: quick-lint
quick-lint:
	@echo "$(BLUE)快速检查...$(NC)"
	./smart-scheduler.sh add lint 2 sync
	./smart-scheduler.sh run

.PHONY: quick-test
quick-test:
	@echo "$(BLUE)快速测试...$(NC)"
	./smart-scheduler.sh add test 3 lint
	./smart-scheduler.sh run

.PHONY: full-check
full-check:
	@echo "$(BLUE)完整检查...$(NC)"
	./smart-scheduler.sh add sync 1
	./smart-scheduler.sh add lint 2 sync
	./smart-scheduler.sh add test 3 lint
	./smart-scheduler.sh add docs 4 lint
	./smart-scheduler.sh add suggestions 5 test,docs
	./smart-scheduler.sh run
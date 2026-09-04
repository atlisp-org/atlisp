# @lisp CAD应用云管理系统 - 自动化维护指南

## 概述

本项目提供了一套完整的自动化维护系统，用于管理包含多个git子模块的CAD应用云管理系统。

## 快速开始

### 1. 查看可用命令
```bash
make help
```

### 2. 安装开发环境
```bash
make dev-setup
```

### 3. 同步所有项目
```bash
make sync           # 同步子模块
make sync-projects  # 同步独立项目
make all            # 同步所有（子模块+独立项目）
```

## 主要功能

### 代码质量检查
```bash
# 运行代码检查（子模块）
make lint

# 运行代码检查（独立项目）
make lint-projects

# 运行代码检查并自动修复
make lint-fix

# 检查git暂存区的文件
make lint-staged

# 安装git pre-commit钩子
make lint-install

# 清除lint缓存
make lint-cache
```

### 包管理
```bash
# 列出所有包
make packages-list

# 检查包规范
make packages-check

# 推送包（示例）
./push-pkg.sh <包名> "提交信息" --lint
```

### 文档和构建
```bash
# 生成文档
make docs

# 构建VSCode扩展
make build-vscode

# 测试VSCode扩展
make test-vscode
```

### 定时任务（Fcron）
```bash
# 安装定时任务（每天凌晨2点同步）
make cron-install

# 移除定时任务
make cron-remove

# 查看定时任务状态
make cron-status
```

**Fcron优势**：
- 系统关机错过的任务会在开机后自动补执行
- 支持任务频率控制
- 支持依赖等待

### 项目状态
```bash
# 显示项目状态
make status            # 子模块状态
make status-projects   # 独立项目状态

# 运行所有检查
make all
```

## Git钩子

项目包含以下Git钩子：

### pre-commit钩子
- 在提交前自动运行代码检查
- 确保代码质量

### post-checkout钩子
- 在切换分支后提示是否同步子模块
- 保持子模块同步

## 定时任务

系统配置了以下定时任务：

1. **每天凌晨2点** - 同步所有子模块
2. **每周一凌晨3点** - 运行代码检查
3. **每月1号凌晨4点** - 生成文档

## CI/CD

项目包含Gitee CI配置（`.gitee/ci.yml`），提供：

- 代码质量检查
- 包规范检查
- 编码检查（UTF-8）
- VSCode扩展构建
- 文档生成
- 扩展部署（仅标签触发）

## 脚本说明

### sync-all.sh
增强版子模块同步脚本，支持：
- `--force` 强制同步
- `--check` 仅检查状态
- `--quiet` 静默模式
- 详细日志记录

### push-pkg.sh
增强版包推送脚本，支持：
- `--check` 仅检查不推送
- `--lint` 推送前运行lint检查
- `--force` 强制推送

### setup-cron.sh
定时任务配置脚本，支持：
- `--install` 安装定时任务
- `--remove` 移除定时任务
- `--list` 列出当前任务
- `--status` 显示状态

## 日志

所有操作日志保存在 `logs/` 目录：
- `sync.log` - 同步日志
- `lint.log` - 代码检查日志
- `docs.log` - 文档生成日志

## 故障排除

### 权限问题
```bash
chmod +x sync-all.sh push-pkg.sh setup-cron.sh
```

### Git钩子不工作
```bash
make lint-install
```

### 定时任务不执行
```bash
# 检查cron服务
systemctl status cron

# 查看cron日志
tail -f /var/log/syslog | grep CRON
```

### Lint工具不存在
```bash
cd atlisp-lint && npm install
```

## 最佳实践

1. **开发前**：运行 `make sync` 同步最新代码
2. **提交前**：运行 `make lint-staged` 检查暂存文件
3. **推送前**：使用 `./push-pkg.sh --lint` 确保代码质量
4. **定期维护**：运行 `make all` 执行所有检查
5. **查看状态**：运行 `make status` 了解项目状态

## 支持

如有问题，请检查：
1. 日志文件（`logs/` 目录）
2. Git钩子状态（`.git/hooks/`）
3. 定时任务状态（`crontab -l`）
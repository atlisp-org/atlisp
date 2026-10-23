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

### 自动化员工（atlisp-worker，推荐）

生产环境由 systemd 常驻服务 `atlisp-worker` 驱动（`automation/work-service.sh`），
不再依赖 cron/fcron：

- 服务单元：`automation/atlisp-worker.service`（安装：`sudo automation/install-service.sh`）
- 任务编排完全由数据驱动：`automation/schedule.json`（默认基线）→ `logs/schedule.json`（生效配置）
- 支持按天去重、宽限期补跑（`grace_seconds`）、按优先级并发（AI 任务 3 路 / 普通任务 2 路）
- 每天 06:00 的自我迭代任务会分析运行指标并**自动改写自身调度**（候选配置经
  `validate-schedule.py` 校验通过才生效，历史备份在 `logs/schedule-history/`）
- AI 报告有效性按「非空 + mtime ≥ 本次任务开始」判定；未写出报告时回退只写
  `*.attempt-fallback.bak`，不覆盖正式报告路径（防止残留转储被误判为成功）
- AI 任务超时按即败型处理（同 prompt 重试大概率再超时，直接归档失败 + 邮件告警）

work-service.sh 使用的任务类型（schedule.json 的 `type` 字段）：
`sync`、`lint`、`optimize`、`generate`、`docs`、`clean`、`full-check`
以及 `ai-*` 系列（`ai-review`、`ai-suggest`、`ai-plan`、`ai-article`、`ai-self-review`、
`ai-introspect`、`ai-fix-all`、`ai-execute-plan` 等）。

### 传统 cron/fcron（备选）

如需独立于 worker 的兜底定时，仍可用上面的 `make cron-install/cron-remove/cron-status`；
worker 的 `grace_seconds` 补跑机制与 fcron 的"错过后开机补执行"等价。

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

### automation/ 目录（自动化员工）

| 脚本 | 职责 |
|---|---|
| `work-service.sh` | worker 主服务：监听任务队列、按调度建任务、并发执行、重试、状态上报 |
| `schedule.sh` | 数据驱动调度（`source` 进 worker）：按天去重、宽限补跑、校验后应用自迭代调度 |
| `schedule.json` | 调度默认基线（生效配置在 `logs/schedule.json`） |
| `validate-schedule.py` | 校验 AI 生成的候选调度（类型/时间/优先级/days/schema + 关键任务保护） |
| `self-review.sh` | 汇总运行指标，生成 06:00 自我迭代任务的输入 |
| `introspect.sh` | 汇总决策与教训，生成 06:30 自省任务的输入 |
| `project-analyzer.py` | 扫描 git/lint/测试/文档/技术债，生成《开发建议报告》 |
| `log-manager.sh` | 日志轮转/清理（保留策略见文件头配置）；由 `clean` 任务自动调用 |
| `plan-manager.sh` | 计划审批（list/approve/reject/expire/status） |
| `check-vllm.sh` | 本地 vllm 服务就绪检查（`check` / `wait`） |
| `smart-scheduler.sh` | 独立任务队列调度器（备选，生产用 worker） |
| `install-service.sh` | 安装 systemd 服务与 `/etc/atlisp/atlisp-worker.env`（0600，存 VLLM_API_KEY） |

常用维护命令：
```bash
systemctl status atlisp-worker           # 服务状态
journalctl -u atlisp-worker -f           # 实时日志
bash automation/log-manager.sh status    # 日志/任务占用
bash automation/plan-manager.sh list     # 待审批计划
python3 automation/validate-schedule.py logs/schedule.json   # 校验生效调度
```

## 日志

所有操作日志保存在 `logs/` 目录：
- `sync.log` - 同步日志
- `lint.log` - 代码检查日志
- `docs.log` - 文档生成日志
- `worker.log` - worker 运行日志（含 AI 任务耗时/重试/失败）
- `opencode-<task>.log` - 单次 AI 会话输出

体积控制：worker 主循环对超过 `LOG_ROTATE_SIZE`（默认 10MB）的日志做一次轮转备份；
每天的 `clean` 任务调用 `automation/log-manager.sh cleanup`，保留最新
10 个 `opencode-*.log`、100 个已完成任务文件，并清理遗留的
`prompt-*`/`opencode-out-*` 临时文件。`logs/`、`tasks/`、`plans/`、`reports/` 均已 gitignore。

## 故障排除

### 权限问题
```bash
chmod +x sync-all.sh push-pkg.sh automation/*.sh
```

### Git钩子不工作
```bash
make lint-install
```

### 定时任务不执行
```bash
# 自动化员工（worker）
systemctl status atlisp-worker
journalctl -u atlisp-worker -n 100

# 传统 cron
systemctl status cron
tail -f /var/log/syslog | grep CRON
```

### AI 任务全部快速失败（约 10 秒）
多为 opencode CLI 升级后参数不再兼容（例如 v2.0 移除了 `--pure`）。
worker 启动时会预检 `OPENCODE_FLAGS`，失败时写 `[ERROR] opencode run 不支持参数 ...`；
按提示修正 `automation/work-service.sh` 的 `OPENCODE_FLAGS` 后重启服务。
```bash
grep -a '\[ERROR\]' logs/worker.log | tail -5
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
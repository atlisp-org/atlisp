# @lisp CAD应用云管理系统 — Agent Instructions

CAD 应用云管理系统（AutoCAD/ZWCAD/GStarCAD/BricsCAD 内的 AutoLISP 生态）：函数库 + 应用包 + 内核 + 工具链。

## 仓库结构（重要）

根仓库 + **4 个 git 子模块** + **9 个独立 git 仓库**，每个子目录都是独立仓库：

- 子模块：`packages/`（73 个应用包，各含 `pkg.lsp`；`gis-tools/` 缺 pkg.lsp）、`lib/`（862 个函数，`src/<ns>/<fn>.lsp` 每文件一个函数）、`docs/`、`vscode/`
- 独立仓库：`kernel/`、`mcp-server/`、`agent/`、`parser/`、`server/`、`atlispcc/`、`atlisp-lint/`、`private-packages/`、`atlisp-lsp/`
- `web/`、`dwg-knowledge-base/` 为独立实验目录，不在 Makefile 管理范围

**关键约束**：
- git 操作（commit/push）必须在对应子目录内执行；根仓库只跟踪子模块指针和根级文件，不要在根目录 `git add .` 把子目录内容一起提交
- `packages/<包名>/` 每个包本身也是独立 git 仓库
- `atlisp-lsp` 不在 `make sync-projects` 的循环列表里，需手动 pull
- 子项目有自己的 AGENTS.md（`lib/`、`kernel/`、`mcp-server/`、`atlispcc/`、`server/`、`atlisp-lint/`、`vscode/`），进入对应子项目工作前先读它
- `.opencode/skills/` 有 14 个技能（lint-pkg、compile-lsp、push-pkg、publish-atlisp、build-mcp、sync-all 等），按触发词自动加载

## 常用命令（Makefile）

```bash
make sync / sync-projects      # 同步子模块 / 独立项目
make status / status-projects  # 查看状态
make lint                      # 检查 lib/src + packages（用 atlisp-lint/bin/atlisp-lint）
make lint-fix                  # 自动修复
make lint-projects             # 检查 kernel/mcp-server/parser/atlispcc/atlisp-lint
make lint-install              # 安装 pre-commit 钩子（lib + packages 各装一次）
make packages-check            # 检查每个包是否有 pkg.lsp
make docs                      # 生成 lib 清单（lib/generate_manifest.py）
make build-vscode / test-vscode
make suggestions / suggestions-latest   # 生成/查看开发建议报告（reports/dev-suggestions-YYYYMMDD.md）
make forum-scan                # 抓 bbs.mjtd.com 热帖 → reports/forum-digest-YYYYMMDD.md
make forum-scan BOARD=3        # 抓 forum-3（AutoLISP 编程技术）→ reports/forum-3-digest-*.md
```

社区需求扫描：worker 任务 `ai-forum`（首页，周一/四 07:30）和 `ai-forum-3`
（forum-3 编程版，周二/五 07:45）把论坛摘要分析成（反爬：自适应退避 + 熔断，不绕过验证）
`reports/forum[-3]-insights-YYYYMMDD.md`，并把 Top 候选转成 `plans/pending/`
待审批计划；批准用 `bash automation/plan-manager.sh approve <id>`（详见 `AUTOMATION.md`）。

## 包发布（重要流程）

```bash
./push-pkg.sh <包名> "提交信息" [--lint] [--check] [--force]
```

- 每个包是独立 git 仓库，脚本在 `packages/<包名>/` 内执行 pull → add → commit → push（推到 gitee）
- 包内容变更必须用 push-pkg.sh 提交，不要手动在包目录外操作
- 子模块指针（根仓库）需要在根仓库单独 commit

## 代码规范（.lsp 文件）

```lisp
(defun namespace:function-name (param1 param2)
  "功能说明"
  "返回值类型"
  "示例代码"
  ;; 实现代码
)
```

- 函数名 `namespace:function-name`，命名空间与目录名一致；变量名 `-` 分隔，全局变量 `*...*`
- 依赖用 `(require '(ns:* ...))` 加载
- **UTF-8 编码**（不要 GB2312/ANSI）、行长 ≤ 100、无尾部空格、括号匹配
- 函数必须有 docstring（说明 + 返回值）

### 新功能归属（lib vs packages）

规则文档：`docs/@lisp/库与包归属规则.md`
- 原子函数（输入→输出、无交互、可复用、纯源码）→ `lib/src/<ns>/<fn>.lsp`
- 完整任务（交互流、菜单/命令、资源文件、外部依赖、全局状态）→ `packages/<包名>/`
- 拿不准默认归包，被 ≥2 个包复用时再提取到 lib

## 测试

- lib 测试在 **CAD 环境内运行**，不是命令行（框架：`lib/src/test/test-framework.lsp`，`test:run-all` 等）
- 测试文件放 `lib/test/`，按命名空间镜像 `src/` 布局（`test/<ns>/test-<fn>.lsp`）
- 各子项目的本地测试：kernel/Makefile、mcp-server（npm test + docker-compose.test.yml）、atlispcc（tests/、Makefile），详见各自 AGENTS.md

### 分析 `~/.atlisp/memory/` 的新对话（跳过已分析）

记忆目录只增不减（根目录 + `memory/u-<hash>/` 用户分区），不要每次从头扫全部文件。
用 `agent/scripts/memory-new.js` 记账，按「id + 内容 sha1」判断新增/变更：

```bash
cd agent
npm run memory:new                     # 列出还没分析过的（新增/变更），按时间正序
npm run memory:new -- --mark           # 分析完成后记账；下次只剩新对话
npm run memory:new -- --json           # 机器可读，便于管道/二次处理
npm run memory:new -- --agent general --since 2026-10-22 --limit 20
npm run memory:new -- --all            # 忽略状态强制全量
npm run memory:new -- --prune          # 清理状态里已删除的文件
```

状态文件在 `~/.atlisp/memory/.analysis-state.json`（只记「分析过」，不删改记忆文件）。
为什么用内容指纹而不是 mtime：`cp -p` 会保留旧 mtime 导致漏判，重写/迁移又会把旧文件
误判成新文件。别用 `memory-index.json` 当清单——它有 1000 条上限、会淘汰旧条目。

### 「在CAD中测试」的语义（重要）

用户说「在CAD中测试」「在CAD里跑一下」「把这段代码加载到CAD测试」时，意思是**把已经
生成好的那段代码真的加载进 CAD 执行**，拿回真实输出/报错：

1. 通过 MCP（atlisp-mcp / `eval_lisp_with_result`，必要时 `cad-ops`）把**原代码**送进 CAD；
2. 回报 CAD 的原话（返回值和报错），不要转述成「应该没问题」；
3. 报错才在原代码上修复后重跑，不要重新生成一份无关的新代码；
4. **不要**只把请求转给某个 AutoLISP 开发/工程团队（子代理）就当作「已测试」——
   团队产出的是代码，不是运行结果。

agent 项目（`agent/`）已按这个语义实现：`cad-run` 模式从会话历史取代码 → 静态门控
→ 在 CAD 中执行 → 确定性报告（见 `agent/src/cad-run.js`）。

## 错误处理

- lint 失败 → `make lint-fix` 自动修复，仍失败再手动处理
- 子模块/同步失败 → 检查网络后手动 `git pull` 对应子目录
- 提交前跑 `make lint-staged`（或依赖 `make lint-install` 的 pre-commit 钩子）

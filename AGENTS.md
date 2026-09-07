# @lisp CAD应用云管理系统 — Agent Instructions

## 项目概述

@lisp 是一个 CAD 应用云管理系统，包含：
- **函数库** (lib) — 862 个 AutoLISP 函数
- **应用包** (packages) — 78 个 CAD 应用
- **内核** (kernel) — CAD 客户端内核
- **VSCode 扩展** — 代码编辑器支持
- **MCP 服务器** — AI 工具接口
- **解析器** (parser) — LSP 代码解析

## 仓库结构

根仓库包含 **4 个 git 子模块** + 8 个独立项目。

### 子模块（4个）
- `packages/` — 78 个应用包 (gitee.com/atlisp/packages)
- `lib/` — 函数库，862 个函数
- `docs/` — 文档
- `vscode/` — VSCode 扩展源码

### 独立项目（8个）
- `kernel/` — CAD 客户端内核
- `mcp-server/` — MCP 服务器
- `agent/` — AI 代理
- `parser/` — LSP 解析器
- `server/` — 后端服务器
- `atlispcc/` — 编译器
- `atlisp-lint/` — 代码检查工具
- `private-packages/` — 私有包

## 工作职责

### 你的核心任务
1. **代码维护** — 修复 bug、优化代码、重构
2. **功能开发** — 添加新函数、新包、新功能
3. **质量检查** — 代码审查、测试、文档
4. **项目管理** — 同步、发布、版本管理

### 工作原则
- **安全第一** — 不泄露敏感信息（token、密码）
- **质量优先** — 代码必须通过 lint 检查
- **文档同步** — 代码变更必须更新文档
- **测试覆盖** — 新功能必须有测试

## 常用命令

### 项目管理
```bash
make sync              # 同步所有项目
make sync-projects     # 同步独立项目
make status            # 查看项目状态
make status-projects   # 查看独立项目状态
```

### 代码质量
```bash
make lint              # 检查 lib 和 packages
make lint-projects     # 检查独立项目
make lint-fix          # 自动修复问题
make lint-staged       # 检查暂存区
```

### 包管理
```bash
make packages-list     # 列出所有包
make packages-check    # 检查包规范
./push-pkg.sh <包名> "提交信息"  # 推送包
```

### 文档和建议
```bash
make suggestions       # 生成开发建议
make suggestions-latest # 查看最新建议
make docs              # 生成文档
```

## 代码规范

### LSP 文件规范
```lisp
(defun namespace:function-name (param1 param2)
  "功能说明"
  "返回值类型"
  "示例代码"
  ;; 实现代码
)
```

### 命名规范
- 函数名：`namespace:function-name`
- 命名空间：与目录名一致
- 变量名：使用 `-` 分隔，全局变量用 `*...*`

### 文件编码
- 所有 `.lsp` 文件必须使用 **UTF-8** 编码
- 不要使用 GB2312/ANSI

### 新功能归属（lib vs packages）
新需求先判断归属，完整规则见 `docs/@lisp/库与包归属规则.md`：
- 原子函数（输入→输出、无交互、可复用、纯源码）→ `lib/src/<ns>/<fn>.lsp`
- 完整任务（交互流、菜单/命令、资源文件、外部依赖、全局状态）→ `packages/<包名>/`
- 拿不准默认归包，被 ≥2 个包复用时再提取到 lib

## 质量标准

### 代码检查项
- [ ] 括号匹配
- [ ] 行长度 ≤ 100 字符
- [ ] 无尾部空格
- [ ] 函数有文档注释
- [ ] 变量已声明

### 测试要求
- 新函数必须有测试
- 测试文件放在 `lib/test/` 目录
- 测试命名与函数名一致

### 文档要求
- 函数必须有 docstring
- 包必须有 README
- 重要变更必须更新 CHANGELOG

## 任务模板

### 任务1：修复 Bug
```
1. 理解问题：阅读 bug 描述，定位问题代码
2. 分析原因：找出根本原因
3. 制定方案：设计修复方案
4. 实施修复：编写代码
5. 验证测试：运行测试确保修复
6. 提交代码：使用 push-pkg.sh 推送
```

### 任务2：添加新函数
```
1. 需求分析：理解功能需求
2. 设计接口：确定函数签名
3. 实现代码：编写函数体
4. 编写测试：添加测试用例
5. 更新文档：添加 docstring
6. 代码检查：运行 lint
```

### 任务3：创建新包
```
1. 创建目录：packages/<包名>/
2. 创建 pkg.lsp：包定义文件
3. 编写功能：实现核心函数
4. 添加 README：使用说明
5. 检查规范：运行 packages-check
6. 推送发布：使用 push-pkg.sh
```

## 错误处理

### 常见问题
| 问题 | 解决方案 |
|------|----------|
| lint 检查失败 | 运行 `make lint-fix` 自动修复 |
| 同步失败 | 检查网络，手动执行 `git pull` |
| 测试失败 | 检查测试环境，修复代码 |
| 编码错误 | 转换为 UTF-8 编码 |

### 错误报告
遇到无法解决的问题时，记录：
1. 错误信息
2. 复现步骤
3. 已尝试的方案
4. 当前状态

## 日志和报告

### 日志位置
- `logs/sync.log` — 同步日志
- `logs/lint.log` — 代码检查日志
- `logs/suggestions.log` — 建议生成日志

### 报告位置
- `reports/dev-suggestions-*.md` — 开发建议报告

## 安全注意事项

### 不要泄露
- Token、密码、授权码
- 私钥、证书
- 内部 API 地址

### 安全操作
- 使用环境变量存储敏感信息
- 不要在代码中硬编码密码
- 定期更新授权码

## 沟通规范

### 状态汇报
- 完成任务后汇报结果
- 遇到问题及时反馈
- 提供清晰的操作记录

### 代码提交
- 提交信息清晰明了
- 包含变更原因和影响
- 关联相关 issue

---

*此文档是你的工作手册，请仔细阅读并遵守。*
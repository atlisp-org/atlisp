# @lisp CAD应用云管理系统 — Agent Instructions

## 仓库结构

根仓库是 monorepo，包含多个独立子项目（各有 `AGENTS.md`）。

### Git 子模块
| 路径 | 说明 |
|------|------|
| `packages/` | 75+ AutoLISP 应用包 |
| `lib/` | AutoLISP 函数库，`src/` 下每文件一函数 |
| `docs/` | 文档 |
| `vscode/` | VSCode 扩展源码 |

### 本仓库子项目
| 路径 | 说明 | 构建 | 测试 |
|------|------|------|------|
| `mcp-server/` | MCP 服务器（AI↔CAD 桥接） | `npm run build` | `npm test` (vitest) |
| `agent/` | 多智能体系统 (LangGraph) | `npm run build` | `npm test` (vitest) |
| `atlisp-lint/` | AutoLISP 静态分析器 | `tsc` | `npm test` (jest) |
| `parser/` | S 表达式解析器 | `tsc` | `npm test` (vitest) |
| `server/` | Web 后端 (Common Lisp/SBCL) | `make all` | `make test` (FiveAM) |
| `vscode/` | VSCode 扩展（子模块） | `npm run esbuild` | `npm run test-compile` |

### 其他目录
- `kernel/` — CAD 客户端内核（独立 git 仓库）
- `pattern/` — ~1800 个 CAD 填充图案 `.pat` 文件
- `private-packages/` — 私有/非分发包

## 常用脚本

### 同步所有子模块
```sh
./sync-all.sh
# 或手动执行（必须在 ~/atlisp 目录运行，因为脚本硬编码了路径）
cd ~/atlisp
git submodule sync --recursive
git submodule update --init --recursive
git submodule foreach git checkout main
git submodule foreach git pull
```

### 推送 packages 包更改
```sh
./push-pkg.sh <包名> "提交信息"
```

### 配置 Git 用户
```sh
./config-git.sh "用户名" "邮箱"
```

## VSCode 扩展开发

唯一需要构建的是 `vscode/` 子目录。其他 TypeScript 子项目（mcp-server、agent、atlisp-lint、parser）在各自目录下构建。

### 构建命令（在 vscode/ 目录下运行）
```sh
npm install              # 安装依赖
npm run esbuild          # 开发构建（带 sourcemap）-> dist/main.js
npm run esbuild-watch    # 监听模式
npm run vscode:prepublish # 生产构建（压缩，执行预构建工具）
npm run test-compile     # TypeScript 编译检查
```

### 构建流程
`vscode:prepublish` 执行：`tools/pre-build.js`（从 snippet keys 生成 `syntaxes/autolisp.tmLanguage.json`）→ `merge-snippets.js` → esbuild 压缩。

入口文件：`src/extension.ts`，输出：`dist/main.js`。

### 语言 ID
- `autolisp` — `.lsp`、`.mnl` 文件
- `autolispdcl` — `.dcl` 文件

## @lisp 包规范

每个 `packages/` 下的包根目录必须有 `pkg.lsp` 文件（包定义）。

### 函数库规范（`lib/src/`）
- 每个 `.lsp` 文件一个函数
- 文件在 `src/` 下的路径决定函数命名空间：如 `src/color/rgb2truecolor.lsp` → 函数 `color:rgb2truecolor`
- 函数定义格式（用于文档生成）：
```lisp
(defun block:insert (para)
  "功能说明"
  "返回值类型"
  "示例代码"
  ;; 实现
)
```

## 编码
所有 LSP 源文件使用 **UTF-8** 编码。使用 GB2312/ANSI 会导致 CAD 环境下括号匹配错误。

## CAD 兼容性
@lisp 支持：AutoCAD 2006+、GstarCAD 2015+、ZWCAD 2015+、BricsCAD 等 VLISP 兼容的 CAD 平台。
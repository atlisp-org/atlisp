# @lisp CAD应用云管理系统 — Agent Instructions

## 仓库结构

根仓库包含 **4 个 git 子模块** + kernel（独立仓库）+ 私有目录。

### 子模块（已初始化）
- `packages/` — ~75 个应用包 (gitee.com/atlisp/packages)
- `lib/` — 函数库，`src/` 目录下每个 `.lsp` 文件一个函数
- `docs/` — 文档
- `vscode/` — VSCode 扩展源码

### 顶层目录
- `kernel/` — @lisp CAD 客户端内核（独立 git 仓库）
- `packages/` — **子模块**；应用包
- `lib/` — **子模块**；函数库
- `docs/` — **子模块**；文档
- `vscode/` — **子模块**；VSCode 扩展
- `pattern/` — CAD 填充图案 `.pat` 文件（约 1800 个）
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

唯一需要构建的是 `vscode/` 子目录。

### 构建命令（在 vscode/ 目录下运行）
```sh
npm install              # 安装依赖
npm run esbuild          # 开发构建（带 sourcemap）-> dist/main.js
npm run esbuild-watch    # 监听模式
npm run vscode:prepublish # 生产构建（压缩，执行预构建工具）
npm run test-compile     # TypeScript 编译检查（无测试运行器）
```

### 构建流程
`vscode:prepublish` 执行：`tools/pre-build.js`（从 snippet keys 生成 `syntaxes/autolisp.tmLanguage.json`）→ `merge-snippets.js` → esbuild 压缩。

入口文件：`src/extension.ts`，输出：`dist/main.js`。

### 语言 ID
- `autolisp` — `.lsp`、`.mnl` 文件
- `autolispdcl` — `.dcl` 文件

### 测试
`package.json` 中未配置测试运行器。`devDependencies` 包含 mocha、chai、ts-node、nyc，但无测试脚本或测试文件。

## @lisp 包规范

每个 `packages/` 下的包根目录必须有 `pkg.lsp` 文件（包定义）。

### 函数库规范（`lib/src/`）
- 每个 `.lsp` 文件一个函数
- 文件在 `src/` 下的路径决定函数命名空间：如 `src/color/rgb2truecolor.lsp` → 函数 `color:rgb2truecolor`
- 函数定义格式（用于文档生成）：
```lisp
(defun block:insert (para)
  "函数功能说明"
  "返回值类型"
  "示例代码"
  ;; 实现
)
```

## 编码
所有 LSP 源文件使用 **UTF-8** 编码。使用 GB2312/ANSI 会导致 CAD 环境下括号匹配错误。

## CAD 兼容性
@lisp 支持：AutoCAD 2006+、GstarCAD 2015+、ZWCAD 2015+、BricsCAD 等 VLISP 兼容的 CAD 平台。

---
name: build-vscode
description: "构建 VSCode 扩展。触发词：构建 vscode、build vscode、编译 vscode"
---

# 构建 VSCode 扩展

在 `vscode/` 目录下执行构建。

## 前置条件

确保已安装依赖：

```sh
cd vscode && npm install
```

## 构建命令

### 开发构建（带 sourcemap）

```sh
cd vscode && npm run esbuild
```

输出: `vscode/dist/main.js`

### 生产构建（压缩）

```sh
cd vscode && npm run vscode:prepublish
```

执行流程: `tools/pre-build.js`（生成语法文件 + 合并 snippets）→ esbuild 压缩

### TypeScript 类型检查

```sh
cd vscode && npx tsc --noEmit
```

## 注意事项

- `tools/pre-build.js` 必须在 esbuild 之前运行（注入函数关键字到语法文件、合并 snippets、复制语言配置到 dist/）
- 所有 npm scripts 会自动处理 pre-build
- 入口文件: `src/extension.ts` → 输出: `dist/main.js`
- 打包 VSIX: `npx @vscode/vsce package --baseContentUrl https://gitee.com/atlisp/atlispext`

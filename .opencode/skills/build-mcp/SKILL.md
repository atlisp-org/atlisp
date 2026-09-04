---
name: build-mcp
description: "构建 MCP 服务器。触发词：构建 mcp、build mcp"
---

# 构建 MCP 服务器

在 `mcp-server/` 目录下执行构建。

## 构建

```sh
cd mcp-server && npm install && npm run build
```

使用 esbuild 打包 `dist/atlisp-mcp.js` + 复制 worker/handlers/html。

## 注意事项

- 仅 Windows 可用完整功能（edge-js 依赖 .NET Runtime）
- Docker 下仅 stdio 模式可用
- 编译 `src/cad-rothelper.cs` → `dist/cad-rothelper.dll`（Windows only，需要 csc.exe）

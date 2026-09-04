---
name: test-mcp
description: "测试 MCP 服务器。触发词：测试 mcp、test mcp"
---

# 测试 MCP 服务器

## 运行全部测试

```sh
cd mcp-server && npm test
```

使用 vitest，53 个测试文件，684 用例。

## 其他命令

| 命令 | 说明 |
|------|------|
| `npm run test:watch` | 监视模式 |
| `npm run test:coverage` | 覆盖率报告 |
| `npm run lint` | eslint 检查（CI 强制 0 问题） |

## 注意事项

- 测试 mock CAD 连接（不依赖真实 CAD）
- 不支持 `node --experimental-vm-modules`

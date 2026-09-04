---
name: test-vscode
description: "测试 VSCode 扩展。触发词：测试 vscode、test vscode、类型检查 vscode"
---

# 测试 VSCode 扩展

## TypeScript 类型检查

```sh
cd vscode && npx tsc --noEmit
```

## 运行测试

```sh
cd vscode && npm test
```

使用 Mocha + Chai + tsx runner。测试模式: `tests/**/*.test.ts`。

## 注意事项

- VS Code API 通过 `node_modules/vscode/index.js` mock（已提交到仓库）
- `tsx` 是 TS loader（配置在 `.mocharc.json`: `--node-option import=tsx`）
- ESLint 检查: `cd vscode && npx eslint src/`
- 无测试运行器配置在 package.json 中，测试通过 `npm test` 脚本运行

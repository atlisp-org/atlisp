---
name: lint-pkg
description: "用 atlisp-lint 检查 LSP 文件。触发词：lint、检查代码、lint 包"
---

# Lint 检查

使用 `atlisp-lint` 对 AutoLISP 代码进行静态分析。

## 基本用法

```sh
node ../atlisp-lint/bin/atlisp-lint --file <包>/<文件>.lsp
```

## 常用选项

| 选项 | 作用 |
|------|------|
| `--src <目录>` | 指定源码目录 |
| `--project` | 跨文件分析 |
| `--cache` | 启用缓存 |
| `--fix` | 自动修复（尾空格/BOM/括号） |
| `--format-check` | 格式检查 |

## 配置文件

- `atlisp-lint.json` 或 `.atlisp-lint.json`
- 内联忽略: `; atlisp-lint: disable=规则名`

## 错误级规则

错误级规则命中时退出码为 1。

## 常用规则

| 规则 | 说明 |
|------|------|
| `parens` | 括号平衡 |
| `quit_exit` | quit/exit 调用 |
| `startapp` | 启动外部程序 |
| `command_shell` | (command "shell" ...) |
| `shadow_builtin` | 覆盖内建函数 |
| `extra_parens` | 多余括号 |
| `builtin_arg_count` | 内建函数参数数量 |

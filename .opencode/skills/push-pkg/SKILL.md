---
name: push-pkg
description: "推送包更改到 gitee。触发词：推送包、push pkg、发布包"
---

# 推送包更改

使用根目录的 `push-pkg.sh` 脚本推送 packages/ 子模块的更改。

## 用法

```sh
cd ~/atlisp
./push-pkg.sh <包名> "提交信息"
```

## 示例

```sh
./push-pkg.sh at-block "feat: 添加块属性批量修改功能"
./push-pkg.sh base "fix: 修复编码问题"
```

## 注意事项

- 必须在 `~/atlisp` 目录运行（脚本硬编码了路径）
- 提交信息习惯用 `feat:` / `fix:` / `update` / `sync sub` 前缀
- `.gitignore` 已忽略编译产物 `.fas`、`.zelx`、`*-whole.lsp`、`*.shx`
- `dev-tools/`、`at-pm/` 是独立 git 子模块，内部改动需在子模块仓库完成

---
name: sync-all
description: "同步所有 git 子模块。触发词：同步、sync、更新子模块"
---

# 同步所有子模块

## 方式一：使用脚本（推荐）

```sh
cd ~/atlisp && ./sync-all.sh
```

## 方式二：手动执行

```sh
cd ~/atlisp
git submodule sync --recursive
git submodule update --init --recursive
git submodule foreach git checkout main
git submodule foreach git pull
```

## 当前子模块

| 子模块 | 仓库 |
|--------|------|
| `packages/` | gitee.com/atlisp/packages |
| `lib/` | gitee.com/atlisp/lib |
| `docs/` | gitee.com/atlisp/docs |
| `vscode/` | gitee.com/atlisp/vscode |

## 注意事项

- 必须在 `~/atlisp` 目录运行
- `sync-all.sh` 会自动切换到 main 分支并拉取最新代码

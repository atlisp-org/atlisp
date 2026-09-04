---
name: compile-lsp
description: "用 atlispcc 编译 LSP 文件为 FAS 字节码。触发词：编译 lsp、compile、fas"
---

# 编译 AutoLISP 代码

使用 `atlispcc` 将 `.lsp` 编译为 FAS4 字节码。

## 安装

```sh
pip install atlispcc
```

## 基本用法

```sh
# 编译
atlispcc compile input.lsp output.fas

# 编译 + 优化
atlispcc compile -O2 input.lsp output.fas

# 反编译
atlispcc decompile input.fas output.lsp

# 语法验证
atlispcc validate input.lsp

# 链接多个 FAS
atlispcc link lib.fas main.fas -o combined.fas

# VLX 容器
atlispcc build-vlx a.fas b.fas -o output.vlx
```

## 优化级别

| 级别 | 说明 |
|------|------|
| `-O0` | 无优化 |
| `-O1` | 常量折叠、死分支消除、窥孔优化 |
| `-O2` | + 常量传播、死赋值消除 |
| `-O3` | + 跨函数常量传播、死代码消除、内联小函数、删除未引用函数 |

## 测试

```sh
cd ~/atlisp/atlispcc
python -m pytest              # 运行全部测试 (456 用例)
make check                    # 一键全量检查
```

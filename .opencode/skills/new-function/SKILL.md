---
name: new-function
description: "添加新函数助手。触发词：新函数、添加函数、新建函数、创建函数"
---

# 添加新函数助手

## 开发流程

1. 需求分析
2. 设计接口
3. 实现代码
4. 编写测试
5. 更新文档
6. 代码检查

## 命令

```bash
# 查看现有函数
ls lib/src/

# 运行 lint 检查
make lint

# 查看函数库状态
make status
```

## 函数命名规范

- 格式: `namespace:functionname`
- 命名空间: 与目录名一致
- 函数名: 使用 `-` 分隔

## 函数模板

```lisp
(defun namespace:function-name (param1 param2)
  "功能说明"
  "返回值类型"
  "示例代码"
  ;; 参数检查
  (if (or (null param1) (null param2))
    (progn
      (princ "\n错误: 参数不能为空")
      (exit)))
  ;; 实现代码
  (let ((result nil))
    ;; 业务逻辑
    result))
```

## 测试模板

```lisp
(defun test:namespace:function-name ()
  "测试函数"
  (let ((test-case-1 (namespace:function-name "input1" "input2")))
    (if (equal test-case-1 expected-result)
      (princ "\n测试通过")
      (princ "\n测试失败"))))
```

## 文档要求

- 功能说明：清晰描述函数作用
- 返回值类型：明确返回值
- 示例代码：提供使用示例

## 注意事项

- 遵循命名规范
- 添加错误处理
- 编写完整测试
- 更新相关文档
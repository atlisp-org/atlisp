---
name: daily-report
description: "生成每日工作报告。触发词：日报、工作汇报、今日工作、每日报告"
---

# 每日工作报告生成

## 工作流程

1. 检查项目状态
2. 汇总今日工作
3. 生成报告文件
4. 发送邮件通知

## 命令

```bash
# 查看项目状态
make status
make status-projects

# 生成开发建议
make suggestions

# 查看日志
cat logs/sync.log
cat logs/lint.log
```

## 报告模板

```markdown
# @lisp 每日工作报告 - YYYY-MM-DD

## 今日完成
- [ ] 任务1
- [ ] 任务2

## 进行中
- 任务3 (进度: 50%)

## 明日计划
- 任务4
- 任务5

## 问题和阻塞
- 无
```

## 注意事项

- 汇报要简洁明了
- 突出完成的工作
- 记录遇到的问题
- 明确下一步计划
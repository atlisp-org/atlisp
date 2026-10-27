#!/usr/bin/env python3
# /home/vitalgg/atlisp/automation/validate-schedule.py
# 校验 AI 自我迭代生成的候选调度，防止破坏 worker 的调度配置。
import json
import re
import sys

ALLOWED_TYPES = {
    "sync", "lint", "optimize", "generate", "docs", "clean", "full-check",
    "ai-fix", "ai-review", "ai-optimize", "ai-suggest", "ai-plan",
    "ai-refactor", "ai-document", "ai-test", "ai-daily", "ai-weekly",
    "ai-learn", "ai-article", "ai-monitor", "ai-security", "ai-deploy",
    "ai-compare", "ai-explain", "ai-refactor-batch", "ai-generate-pkg",
    "ai-fix-all", "ai-execute-plan", "ai-self-review", "ai-introspect",
    "ai-agent-optimize",
    # 社交推广（QQ空间/抖音），实现见 automation/autopost/
    "autopost",           # 发布：task_data 为平台名（qzone|douyin）
    "autopost-content",   # 生成：轮换挑包 → AI 文案 → 渲染视频 → 入队
}
TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
DAYS_RE = re.compile(
    r"^(\*|[1-7](,[1-7])*|dom:(0?[1-9]|[12]\d|3[01])(,(0?[1-9]|[12]\d|3[01]))*)$"
)


def fail(msg):
    print(f"invalid schedule: {msg}", file=sys.stderr)
    sys.exit(1)


def main():
    if len(sys.argv) < 2:
        fail("usage: validate-schedule.py <schedule.json>")
    try:
        with open(sys.argv[1], encoding="utf-8") as fh:
            data = json.load(fh)
    except Exception as exc:  # noqa: BLE001
        fail(f"JSON 解析失败: {exc}")

    if not isinstance(data, dict):
        fail("根节点必须是对象")
    tasks = data.get("tasks")
    if not isinstance(tasks, list) or not tasks:
        fail("tasks 必须是非空数组")

    ids = set()
    self_enabled = False
    introspect_enabled = False
    for idx, task in enumerate(tasks):
        if not isinstance(task, dict):
            fail(f"tasks[{idx}] 必须是对象")
        tid = task.get("id")
        if not isinstance(tid, str) or not tid:
            fail(f"tasks[{idx}].id 缺失或非法")
        if tid in ids:
            fail(f"id 重复: {tid}")
        ids.add(tid)
        if tid == "self-review":
            self_enabled = bool(task.get("enabled", True))
        if tid == "introspection":
            introspect_enabled = bool(task.get("enabled", True))

        if not isinstance(task.get("name"), str) or not task["name"]:
            fail(f"tasks[{idx}].name 非法")
        if task.get("type") not in ALLOWED_TYPES:
            fail(f"tasks[{idx}].type 非法: {task.get('type')}")
        if not isinstance(task.get("time"), str) or not TIME_RE.match(task["time"]):
            fail(f"tasks[{idx}].time 非法: {task.get('time')}")
        prio = task.get("priority", 5)
        if not isinstance(prio, int) or isinstance(prio, bool) or not 1 <= prio <= 5:
            fail(f"tasks[{idx}].priority 必须为 1-5 的整数")
        days = task.get("days", "*")
        if not isinstance(days, str) or not DAYS_RE.match(days):
            fail(f"tasks[{idx}].days 非法: {days}")
        if "enabled" in task and not isinstance(task["enabled"], bool):
            fail(f"tasks[{idx}].enabled 必须是布尔值")
        if "data" in task and not isinstance(task["data"], str):
            fail(f"tasks[{idx}].data 必须是字符串")
        if "dynamic" in task and task["dynamic"] not in ("", "article_pkg"):
            fail(f"tasks[{idx}].dynamic 非法: {task['dynamic']}")

    if not self_enabled:
        fail("必须保留并启用 id=self-review 的任务（防止自我迭代被关闭）")
    if not introspect_enabled:
        fail("必须保留并启用 id=introspection 的任务（防止自省闭环被关闭）")

    print("schedule ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())

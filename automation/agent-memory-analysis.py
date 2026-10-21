#!/usr/bin/env python3
# /home/vitalgg/atlisp/automation/agent-memory-analysis.py
# 汇总 ~/.atlisp/memory/ 里的真实用户会话，供 ai-agent-optimize 定时任务分析。
#
# memory 文件由 agent 服务端写入：每个文件是一轮 user/assistant 消息，
# 同一会话（sessionId）的多轮共享同一个 id。本脚本不做语义判断，
# 只给 AI 提供结构化素材：
#   1. 总览统计（会话数 / 消息数 / agentType 分布 / 日期范围）
#   2. 最近 48 小时会话详情（逐轮摘录，截断必须显式标注）
#   3. 全量会话索引（AI 可据此按需读取 memory 原文交叉核对）
#
# 截断标注是硬性要求（教训 [2026-10-20] 输入截断必须显式标注）：
# 部分缺失无标注比完全缺失更隐蔽，消费端必须知道「看到的不是全部」。
#
# 用法: agent-memory-analysis.py [输出文件]

import collections
import glob
import json
import os
import sys
from datetime import datetime, timedelta, timezone

MEMORY_DIR = os.path.expanduser("~/.atlisp/memory")
RECENT_HOURS = 48
USER_CAP = 600        # 单条用户消息摘录上限
ASSISTANT_CAP = 800   # 单条助手回复摘录上限
INDEX_PREVIEW = 120   # 索引里用户请求预览上限
MAX_INDEX_ROWS = 300  # 索引最多列多少个会话
MAX_RECENT_SESSIONS = 50  # 最近 48h 详情最多列多少个会话


def clip(text, cap, path):
    """截断到 cap 字符；超长时返回摘录 + 显式标注（含原文路径）。"""
    text = " ".join(str(text or "").split())
    if len(text) <= cap:
        return text
    return text[:cap] + f"\n  > [截断, 仅前 {cap} 字符, 原文在 {path}]"


def load_all():
    messages = []
    for path in glob.glob(os.path.join(MEMORY_DIR, "memory.*.json")):
        try:
            with open(path, encoding="utf-8") as fh:
                data = json.load(fh)
        except Exception:
            continue
        if not isinstance(data, dict):
            continue
        try:
            ts = datetime.fromisoformat(data.get("createdAt", "").replace("Z", "+00:00"))
        except ValueError:
            continue
        role = str(data.get("metadata", {}).get("role", "?"))
        # user 消息内容在 input 字段，assistant 消息内容在 output 字段
        text = data.get("input", "") if role == "user" else data.get("output", "")
        messages.append(
            {
                "path": os.path.basename(path),
                "sessionId": str(data.get("sessionId", "?")),
                "agentType": str(data.get("agentType", "?")),
                "role": role,
                "text": text or "",
                "ts": ts,
            }
        )
    messages.sort(key=lambda m: m["ts"])
    return messages


def group_sessions(messages):
    sessions = collections.OrderedDict()
    for msg in messages:
        sessions.setdefault(msg["sessionId"], []).append(msg)
    return sessions


def render_recent(sessions, now):
    """最近 48 小时会话详情：按会话分组、按时间排序的逐轮摘录。"""
    cutoff = now - timedelta(hours=RECENT_HOURS)
    recent = {
        sid: msgs
        for sid, msgs in sessions.items()
        if any(m["ts"] >= cutoff for m in msgs)
    }
    # 按会话最后活动时间倒序，新的在前
    ordered = sorted(recent.items(), key=lambda kv: max(m["ts"] for m in kv[1]), reverse=True)
    ordered = ordered[:MAX_RECENT_SESSIONS]

    lines = []
    for sid, msgs in ordered:
        first, last = min(m["ts"] for m in msgs), max(m["ts"] for m in msgs)
        agent_types = sorted({m["agentType"] for m in msgs})
        lines.append(
            f"### [{first:%m-%d %H:%M} ~ {last:%H:%M} UTC] 会话 {sid[:8]} "
            f"({'/'.join(agent_types)}, {len(msgs)} 轮)"
        )
        for msg in msgs:
            if msg["role"] == "user":
                label = "用户请求"
                cap = USER_CAP
            elif msg["role"] == "assistant":
                label = "助手回复"
                cap = ASSISTANT_CAP
            else:
                continue
            text = clip(msg["text"], cap, f"~/.atlisp/memory/{msg['path']}")
            lines.append(f"- **{label}** ({msg['ts']:%H:%M} UTC): {text}")
        lines.append("")
    return lines


def render_index(sessions):
    """全量会话索引：一行一个会话，供 AI 按需读原文。"""
    rows = []
    for sid, msgs in sessions.items():
        user_msgs = [m for m in msgs if m["role"] == "user"]
        preview = clip(user_msgs[0]["text"] if user_msgs else "", INDEX_PREVIEW, "")
        rows.append(
            {
                "day": min(m["ts"] for m in msgs).strftime("%Y-%m-%d"),
                "agent": "/".join(sorted({m["agentType"] for m in msgs})),
                "rounds": len(msgs),
                "sid": sid,
                "preview": preview,
            }
        )
    rows.sort(key=lambda r: r["day"], reverse=True)
    rows = rows[:MAX_INDEX_ROWS]

    lines = ["| 日期 | agentType | 轮数 | sessionId | 首条用户请求预览 |", "|---|---|---|---|---|"]
    for r in rows:
        lines.append(f"| {r['day']} | {r['agent']} | {r['rounds']} | {r['sid']} | {r['preview']} |")
    return lines


def main():
    out_path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
        "/home/vitalgg/atlisp/logs", "agent-optimize-input.md"
    )
    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)

    now = datetime.now(timezone.utc)
    messages = load_all()
    sessions = group_sessions(messages)

    if not messages:
        with open(out_path, "w", encoding="utf-8") as fh:
            fh.write(f"# agent 项目内存分析输入\n\n- 生成时间: {now:%Y-%m-%d %H:%M UTC}\n\n(无 memory 数据: {MEMORY_DIR} 为空或不可读)\n")
        print(out_path)
        return

    role_counts = collections.Counter(m["role"] for m in messages)
    type_counts = collections.Counter(m["agentType"] for m in messages)
    span = (min(m["ts"] for m in messages), max(m["ts"] for m in messages))

    cutoff = now - timedelta(hours=RECENT_HOURS)
    recent_msgs = [m for m in messages if m["ts"] >= cutoff]
    recent_sessions = {m["sessionId"] for m in recent_msgs}

    lines = []
    lines.append("# agent 项目内存分析输入")
    lines.append("")
    lines.append(f"- 生成时间: {now:%Y-%m-%d %H:%M UTC}")
    lines.append(f"- 记忆目录: ~/.atlisp/memory（{len(messages)} 个消息文件, {len(sessions)} 个会话）")
    lines.append("")
    lines.append("## 总览")
    lines.append(f"- 时间范围: {span[0]:%Y-%m-%dT%H:%M}Z → {span[1]:%Y-%m-%dT%H:%M}Z")
    lines.append(
        "- 消息: "
        + " / ".join(f"{role} {n}" for role, n in role_counts.most_common())
    )
    lines.append(
        "- agentType 分布: " + ", ".join(f"{k} {n}" for k, n in type_counts.most_common())
    )
    lines.append(
        f"- 最近 {RECENT_HOURS} 小时: {len(recent_sessions)} 个会话 / {len(recent_msgs)} 条消息"
    )
    lines.append("")
    lines.append(f"## 最近 {RECENT_HOURS} 小时会话详情（{len(recent_sessions)} 个会话）")
    lines.extend(render_recent(sessions, now) or ["(无)"])
    lines.append("")
    lines.append(f"## 全量会话索引（{len(sessions)} 个会话, 最多 {MAX_INDEX_ROWS} 行, 新→旧）")
    lines.append("需要更多细节时按 sessionId 读取 ~/.atlisp/memory/memory.<sessionId>.json 原文。")
    lines.append("")
    lines.extend(render_index(sessions))
    lines.append("")

    with open(out_path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines))
    print(out_path)


if __name__ == "__main__":
    main()

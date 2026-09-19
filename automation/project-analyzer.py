#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""@lisp 项目分析器

扫描仓库（git 状态、atlisp-lint 结果、测试/文档/技术债），
生成数据驱动的《开发建议报告》Markdown。

用法:
    python3 automation/project-analyzer.py [--root DIR] [--output FILE]
"""

import argparse
import collections
import datetime
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

SUBMODULES = ["packages", "lib", "docs", "vscode"]
PROJECTS = ["kernel", "mcp-server", "agent", "parser", "server",
            "atlispcc", "atlisp-lint", "private-packages"]
LINT_TARGETS = [
    ("lib", "lib", "src"),
    ("packages", "packages", "."),
    ("kernel", "kernel", "src"),
]
TODO_RE = re.compile(r"\b(TODO|FIXME|HACK|XXX)\b")
CHANGED_LIMIT = 8


def run(cmd, cwd=None, timeout=1800):
    """执行命令，返回 (returncode, stdout)。stderr 静默。"""
    try:
        proc = subprocess.run(
            cmd, cwd=str(cwd) if cwd else None,
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            timeout=timeout, text=True, errors="replace")
        return proc.returncode, proc.stdout
    except Exception:
        return 1, ""


def run_to_file(cmd, cwd, out_path, timeout=1800):
    """执行命令并将 stdout 写入文件。

    必须走文件而非管道：atlisp-lint 在 stdout 为管道时会在进程退出前
    丢失未刷新的缓冲数据（约 72KB 处被截断）。
    """
    try:
        with open(out_path, "w", encoding="utf-8") as fh:
            proc = subprocess.run(
                cmd, cwd=str(cwd) if cwd else None,
                stdout=fh, stderr=subprocess.DEVNULL, timeout=timeout, text=True)
        return proc.returncode
    except Exception:
        return 1


def git_info(path):
    """收集单个仓库的 git 状态，非 git 目录返回 None。"""
    rc, _ = run(["git", "-C", str(path), "rev-parse", "--is-inside-work-tree"])
    if rc != 0:
        return None

    branch = run(["git", "-C", str(path), "branch", "--show-current"])[1].strip() or "(detached)"
    status = run(["git", "-c", "core.quotepath=false", "-C", str(path),
                  "status", "--porcelain"])[1]
    changed = [line for line in status.splitlines() if line.strip()]

    last = run(["git", "-C", str(path), "log", "-1",
                "--format=%h %s"])[1].strip().splitlines()
    last = last[0] if last else "-"

    behind = ahead = 0
    rc, out = run(["git", "-C", str(path), "rev-list", "--left-right", "--count",
                   "@{u}...HEAD"])
    if rc == 0:
        parts = out.split()
        if len(parts) == 2:
            behind, ahead = int(parts[0]), int(parts[1])

    return {
        "branch": branch,
        "changed": changed,
        "changed_count": len(changed),
        "ahead": ahead,
        "behind": behind,
        "last": last,
    }


def load_rule_meta(root):
    """解析 atlisp-lint --list-rules，返回 rule -> {default, category, desc}。"""
    tool = root / "atlisp-lint" / "bin" / "atlisp-lint"
    if not tool.exists():
        return {}
    rc, out = run([str(tool), "--list-rules"], timeout=120)
    if rc != 0:
        return {}
    meta = {}
    for line in out.splitlines():
        m = re.match(r"^(\S+)\s+(\S+)\s+(\S+)\s+(.+?)\s*$", line)
        if not m or m.group(1) == "Rule":
            continue
        meta[m.group(1)] = {
            "default": m.group(2),
            "category": m.group(3),
            "desc": m.group(4),
        }
    return meta


def count_src_files(cwd, src):
    """统计 lint 目标目录下的 .lsp 文件数（忽略隐藏目录）。"""
    base = cwd / src
    if not base.is_dir():
        return 0
    return len([f for f in base.rglob("*.lsp")
                if not any(part.startswith(".") for part in f.relative_to(base).parts)])


def lint_project(root, cwd, src):
    """运行 atlisp-lint 并返回结构化结果，失败返回 None。

    注意：不使用 --cache/--parallel，因为缓存模式会向 stdout 输出「已缓存」提示，
    并行模式的 JSON 输出会被截断（约 60KB），且会在源码目录生成
    .atlisp-lint-cache 垃圾目录。
    """
    tool = root / "atlisp-lint" / "bin" / "atlisp-lint"
    if not tool.exists():
        return None

    fd, tmp_path = tempfile.mkstemp(prefix="atlisp-lint-", suffix=".json")
    os.close(fd)
    try:
        run_to_file([str(tool), "--src", src, "--format", "json"], cwd, tmp_path)
        data = json.loads(Path(tmp_path).read_text(encoding="utf-8", errors="replace"))
    except Exception:
        return None
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
    issues = [i for i in data.get("issues", []) if i.get("severity") != "off"]
    sev = collections.Counter(i.get("severity", "warn") for i in issues)
    rules = collections.Counter(i.get("rule", "?") for i in issues)
    files = collections.Counter(i.get("file", "?") for i in issues)
    return {
        "issues": issues,
        "errors": sev.get("error", 0),
        "warnings": sev.get("warn", 0),
        "infos": sev.get("info", 0),
        "rules": rules,
        "files": files,
        "file_total": len(files),
        "src_files": count_src_files(cwd, src),
    }


def top_items(counter, n=10):
    return counter.most_common(n)


def top_files_for_rule(issues, rule, n=5):
    c = collections.Counter(i["file"] for i in issues if i.get("rule") == rule)
    return c.most_common(n)


def collect_tests(root):
    """返回每个 lib/src 命名空间的 (源码数, 测试数)。"""
    src_root = root / "lib" / "src"
    test_root = root / "lib" / "test"
    rows = []
    if not src_root.is_dir():
        return rows
    for d in sorted(p for p in src_root.iterdir() if p.is_dir()):
        sfiles = list(d.rglob("*.lsp"))
        tdir = test_root / d.name
        tfiles = list(tdir.rglob("*.lsp")) if tdir.is_dir() else []
        rows.append({
            "name": d.name,
            "src": len(sfiles),
            "test": len(tfiles),
        })
    return rows


def collect_docs(root):
    pkg_root = root / "packages"
    result = {"total": 0, "missing_readme": [], "missing_pkg": [], "no_lsp": []}
    if not pkg_root.is_dir():
        return result
    pkgs = sorted(p for p in pkg_root.iterdir()
                  if p.is_dir() and not p.name.startswith("."))
    result["total"] = len(pkgs)
    for d in pkgs:
        if not list(d.glob("README*")):
            result["missing_readme"].append(d.name)
        if not (d / "pkg.lsp").exists():
            result["missing_pkg"].append(d.name)
        if not list(d.rglob("*.lsp")):
            result["no_lsp"].append(d.name)
    return result


def collect_todos(root):
    bases = [root / "lib" / "src", root / "packages", root / "kernel"]
    hits = []
    for base in bases:
        if not base.is_dir():
            continue
        for f in base.rglob("*.lsp"):
            rel = f.relative_to(base)
            if "node_modules" in rel.parts or any(p.startswith(".") for p in rel.parts):
                continue
            try:
                lines = f.read_text(encoding="utf-8", errors="replace").splitlines()
            except Exception:
                continue
            for n, line in enumerate(lines, 1):
                if TODO_RE.search(line):
                    hits.append((str(f.relative_to(root)), n, line.strip()[:100]))
    return hits


def md_escape(text):
    return str(text).replace("|", "\\|").replace("\n", " ")


def render_git_section(out, root):
    out.append("## 一、项目概况\n")
    out.append("| 项目 | 分支 | 未提交 | 领先/落后 | 最近提交 |")
    out.append("|------|------|--------|-----------|----------|")
    detail = []
    for name in SUBMODULES + PROJECTS:
        info = git_info(root / name)
        if not info:
            continue
        delta = f"+{info['ahead']}/-{info['behind']}"
        out.append("| {} | {} | {} | {} | {} |".format(
            md_escape(name), md_escape(info["branch"]),
            info["changed_count"], delta, md_escape(info["last"])))
        if info["changed"]:
            detail.append((name, info["changed"]))
    out.append("")

    if detail:
        out.append("### 未提交变更明细\n")
        for name, changed in detail:
            out.append("- **{}** ({} 项)".format(name, len(changed)))
            for line in changed[:CHANGED_LIMIT]:
                out.append("  - `{}`".format(md_escape(line)))
            if len(changed) > CHANGED_LIMIT:
                out.append("  - …另有 {} 项".format(len(changed) - CHANGED_LIMIT))
        out.append("")
    else:
        out.append("所有仓库工作区干净，无未提交变更。\n")


def render_quality_section(out, lint_results, rule_meta):
    out.append("## 二、代码质量（atlisp-lint 实测）\n")

    if not lint_results:
        out.append("未找到可用的 atlisp-lint，跳过代码质量分析。\n")
        return

    out.append("### 质量总览\n")
    out.append("| 模块 | LSP 文件 | 错误 | 警告 | 信息 | 问题文件 |")
    out.append("|------|----------|------|------|------|----------|")
    for name, r in lint_results.items():
        out.append("| {} | {} | {} | {} | {} | {} |".format(
            md_escape(name), r["src_files"],
            r["errors"], r["warnings"], r["infos"], r["file_total"]))
    out.append("")

    merged_rules = collections.Counter()
    for r in lint_results.values():
        merged_rules.update(r["rules"])
    if merged_rules:
        out.append("### 高频问题规则 Top 15\n")
        out.append("| 规则 | 数量 | 类别 | 说明 |")
        out.append("|------|------|------|------|")
        for rule, count in top_items(merged_rules, 15):
            meta = rule_meta.get(rule, {})
            out.append("| `{}` | {} | {} | {} |".format(
                rule, count, meta.get("category", "-"), meta.get("desc", "-")))
        out.append("")

    merged_files = collections.Counter()
    for r in lint_results.values():
        merged_files.update(r["files"])
    if merged_files:
        out.append("### 问题最集中的文件 Top 10\n")
        out.append("| 文件 | 问题数 |")
        out.append("|------|--------|")
        for f, count in top_items(merged_files, 10):
            out.append("| `{}` | {} |".format(md_escape(f), count))
        out.append("")

    errors = []
    for name, r in lint_results.items():
        for i in r["issues"]:
            if i.get("severity") == "error":
                errors.append((name, i))
    if errors:
        out.append("### 错误级问题（必须修复）\n")
        for name, i in errors[:30]:
            out.append("- **{}** `{}:{}` [{}] {}".format(
                md_escape(name), md_escape(i.get("file", "?")),
                i.get("line", "?"), i.get("rule", "?"),
                md_escape(i.get("message", ""))))
        if len(errors) > 30:
            out.append("- …另有 {} 个错误".format(len(errors) - 30))
        out.append("")
    else:
        out.append("无错误级问题（0 errors）。\n")


def render_test_section(out, tests):
    out.append("## 三、测试覆盖\n")
    total_ns = len(tests)
    covered = sum(1 for t in tests if t["test"] > 0)
    src_files = sum(t["src"] for t in tests)
    test_files = sum(t["test"] for t in tests)
    rate = (covered / total_ns * 100) if total_ns else 0

    out.append("- 命名空间: {} 个，其中有测试的 {} 个（{:.0f}%）".format(
        total_ns, covered, rate))
    out.append("- 源码文件: {} 个，测试文件: {} 个".format(src_files, test_files))
    out.append("")

    empty = [t for t in tests if t["test"] == 0]
    if empty:
        out.append("### 缺少测试的命名空间（{} 个）\n".format(len(empty)))
        out.append("| 命名空间 | 源码文件 |")
        out.append("|----------|----------|")
        for t in empty:
            out.append("| `{}` | {} |".format(t["name"], t["src"]))
        out.append("")

    weak = [t for t in tests if t["test"] > 0 and t["src"] > t["test"] * 3]
    weak.sort(key=lambda t: t["src"] / max(t["test"], 1), reverse=True)
    if weak:
        out.append("### 测试薄弱命名空间（源码/测试 > 3，Top 10）\n")
        out.append("| 命名空间 | 源码 | 测试 | 比例 |")
        out.append("|----------|------|------|------|")
        for t in weak[:10]:
            out.append("| `{}` | {} | {} | {:.1f}:1 |".format(
                t["name"], t["src"], t["test"], t["src"] / t["test"]))
        out.append("")


def render_docs_section(out, docs):
    out.append("## 四、文档状态\n")
    out.append("- 应用包总数: {}".format(docs["total"]))
    out.append("- 缺少 README: {} 个".format(len(docs["missing_readme"])))
    out.append("- 缺少 pkg.lsp: {} 个".format(len(docs["missing_pkg"])))
    out.append("- 无任何 .lsp 的包: {} 个".format(len(docs["no_lsp"])))
    out.append("")
    for label, items in [("缺少 README 的包", docs["missing_readme"]),
                         ("缺少 pkg.lsp 的包", docs["missing_pkg"]),
                         ("无源码的包", docs["no_lsp"])]:
        if items:
            out.append("**{}**: {}".format(label, "、".join("`{}`".format(x) for x in items)))
            out.append("")


def render_debt_section(out, todos, lint_results, rule_meta):
    out.append("## 五、技术债清单\n")

    missing_doc = sum(r["rules"].get("missing_doc", 0) for r in lint_results.values())
    commented = sum(r["rules"].get("commented_code", 0) for r in lint_results.values())
    out.append("- 缺少文档注释的函数: {} 处（`missing_doc`）".format(missing_doc))
    out.append("- 被注释掉的代码: {} 处（`commented_code`）".format(commented))
    out.append("- TODO/FIXME/HACK 标记: {} 处".format(len(todos)))
    out.append("")

    if todos:
        out.append("### TODO/FIXME 明细\n")
        for path, line, text in todos[:25]:
            out.append("- `{}:{}` {}".format(md_escape(path), line, md_escape(text)))
        if len(todos) > 25:
            out.append("- …另有 {} 处".format(len(todos) - 25))
        out.append("")


def build_suggestions(lint_results, tests, docs, todos, git_reports):
    """根据实测数据动态生成建议列表。"""
    suggestions = []

    total_errors = sum(r["errors"] for r in lint_results.values())
    if total_errors:
        err_files = []
        for name, r in lint_results.items():
            for i in r["issues"]:
                if i.get("severity") == "error":
                    err_files.append(i["file"])
        uniq = sorted(set(err_files))[:5]
        suggestions.append({
            "priority": "P0",
            "title": "修复 {} 个错误级问题".format(total_errors),
            "evidence": "涉及文件: " + "、".join("`{}`".format(f) for f in uniq),
            "action": "查看报告「错误级问题」章节逐项修复，然后运行 `make lint` 验证",
        })

    total_rules = collections.Counter()
    for r in lint_results.values():
        total_rules.update(r["rules"])

    autofix = total_rules.get("trailing_whitespace", 0) + \
        total_rules.get("trailing_paren", 0) + total_rules.get("encoding", 0)
    if autofix:
        suggestions.append({
            "priority": "P1",
            "title": "自动修复 {} 处格式问题".format(autofix),
            "evidence": "行尾空格 {}、多余括号 {}、编码问题 {}".format(
                total_rules.get("trailing_whitespace", 0),
                total_rules.get("trailing_paren", 0),
                total_rules.get("encoding", 0)),
            "action": "运行 `make lint-fix`（可自动修复行尾空格/BOM/尾部括号）",
        })

    undeclared = total_rules.get("undeclared_setq", 0)
    if undeclared:
        ev = []
        for name, r in lint_results.items():
            ev += top_files_for_rule(r["issues"], "undeclared_setq", 3)
        ev = sorted(ev, key=lambda x: -x[1])[:5]
        suggestions.append({
            "priority": "P1",
            "title": "声明 {} 处未声明的局部变量".format(undeclared),
            "evidence": "集中在: " + "、".join("`{}`({})".format(f, c) for f, c in ev),
            "action": "将 `setq` 的临时变量加入 `defun` 的 `/` 私有变量表，避免全局污染",
        })

    missing_doc = total_rules.get("missing_doc", 0)
    if missing_doc:
        ev = []
        for name, r in lint_results.items():
            ev += top_files_for_rule(r["issues"], "missing_doc", 3)
        ev = sorted(ev, key=lambda x: -x[1])[:5]
        suggestions.append({
            "priority": "P1",
            "title": "为 {} 个函数补充文档注释".format(missing_doc),
            "evidence": "集中在: " + "、".join("`{}`({})".format(f, c) for f, c in ev),
            "action": "按 AGENTS.md 规范补充 docstring（功能/返回值/示例）",
        })

    vlax = total_rules.get("vlax_without_loading", 0)
    if vlax:
        vlax_files = set()
        for r in lint_results.values():
            vlax_files |= {i["file"] for i in r["issues"]
                           if i.get("rule") == "vlax_without_loading"}
        sample = "、".join("`{}`".format(f) for f in sorted(vlax_files)[:3])
        suggestions.append({
            "priority": "P1",
            "title": "为 {} 个文件的 vlax 调用补充 vl-load-com".format(len(vlax_files)),
            "evidence": "使用 `vlax-*` 但未确保 COM 已加载，共 {} 处；涉及 {} 个文件，如 {}".format(
                vlax, len(vlax_files), sample),
            "action": "在模块入口统一调用 `(vl-load-com)` 或加防御性检查",
        })

    empty_tests = [t for t in tests if t["test"] == 0]
    if empty_tests:
        suggestions.append({
            "priority": "P1",
            "title": "为 {} 个命名空间补充测试".format(len(empty_tests)),
            "evidence": "缺少测试: " + "、".join(
                "`{}`".format(t["name"]) for t in empty_tests[:10]),
            "action": "在 `lib/test/<命名空间>/` 下添加测试文件",
        })

    loop_concat = total_rules.get("string_concat_loop", 0)
    entget = total_rules.get("entget_in_loop", 0)
    if loop_concat or entget:
        suggestions.append({
            "priority": "P2",
            "title": "优化循环内的性能问题（{} 处）".format(loop_concat + entget),
            "evidence": "循环内字符串拼接 {}、循环内 entget {}".format(loop_concat, entget),
            "action": "将 `strcat`/`entget` 移出循环，或收集到列表后一次性处理",
        })

    naming = total_rules.get("global_function_naming", 0) + \
        total_rules.get("missing_export", 0)
    if naming:
        suggestions.append({
            "priority": "P2",
            "title": "规范 {} 处函数命名/导出".format(naming),
            "evidence": "全局函数命名 {}、未注册模块 {}".format(
                total_rules.get("global_function_naming", 0),
                total_rules.get("missing_export", 0)),
            "action": "按 `namespace:function-name` 命名并注册到 `@::*modules*`",
        })

    if docs["missing_readme"] or docs["missing_pkg"]:
        suggestions.append({
            "priority": "P2",
            "title": "完善包元数据与文档",
            "evidence": "缺 README {} 个、缺 pkg.lsp {} 个".format(
                len(docs["missing_readme"]), len(docs["missing_pkg"])),
            "action": "为相关包补 `README.md` 与 `pkg.lsp` 定义",
        })

    if todos:
        suggestions.append({
            "priority": "P2",
            "title": "清理 {} 处 TODO/FIXME 技术债".format(len(todos)),
            "evidence": "见「技术债清单」章节",
            "action": "逐项评估：实现、转 issue 或删除过时注释",
        })

    dirty = [n for n, info in git_reports.items() if info and info["changed_count"]]
    if dirty:
        suggestions.append({
            "priority": "P2",
            "title": "提交 {} 个仓库的未提交变更".format(len(dirty)),
            "evidence": "仓库: " + "、".join("`{}`".format(n) for n in dirty),
            "action": "检查变更后提交或推送，保持工作区干净",
        })

    order = {"P0": 0, "P1": 1, "P2": 2}
    suggestions.sort(key=lambda s: order.get(s["priority"], 9))
    return suggestions


def render_suggestions_section(out, suggestions):
    out.append("## 六、开发建议（按优先级）\n")
    if not suggestions:
        out.append("未发现需要处理的明显问题。\n")
        return
    for idx, s in enumerate(suggestions, 1):
        out.append("### {}. [{}] {}\n".format(idx, s["priority"], s["title"]))
        out.append("- **依据**: {}".format(s["evidence"]))
        out.append("- **操作**: {}".format(s["action"]))
        out.append("")


def render_actions_section(out, suggestions):
    out.append("## 七、下一步行动\n")
    for s in suggestions[:5]:
        out.append("- [ ] [{}] {}".format(s["priority"], s["title"]))
    out.append("- [ ] 运行 `make lint` 验证修复结果")
    out.append("- [ ] 运行 `make suggestions` 重新生成报告对比进展")
    out.append("")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default=str(Path.home() / "atlisp"))
    parser.add_argument("--output", default=None)
    args = parser.parse_args()
    root = Path(args.root).resolve()

    now = datetime.datetime.now()
    out = []
    out.append("# @lisp 开发建议报告\n")
    out.append("生成时间: {}\n".format(now.strftime("%Y-%m-%d %H:%M:%S")))
    out.append("分析范围: lib/src、packages、kernel/src 全量 LSP 源码")
    out.append("数据来源: git 状态 + `atlisp-lint --format json` 实测 + 文件扫描\n")

    git_reports = {}
    for name in SUBMODULES + PROJECTS:
        git_reports[name] = git_info(root / name)
    render_git_section(out, root)

    rule_meta = load_rule_meta(root)
    lint_results = collections.OrderedDict()
    for label, sub, src in LINT_TARGETS:
        cwd = root / sub
        if not cwd.is_dir():
            continue
        r = lint_project(root, cwd, src)
        if r is not None:
            lint_results[label] = r

    render_quality_section(out, lint_results, rule_meta)

    tests = collect_tests(root)
    render_test_section(out, tests)

    docs = collect_docs(root)
    render_docs_section(out, docs)

    todos = collect_todos(root)
    render_debt_section(out, todos, lint_results, rule_meta)

    suggestions = build_suggestions(lint_results, tests, docs, todos, git_reports)
    render_suggestions_section(out, suggestions)
    render_actions_section(out, suggestions)

    out.append("---")
    out.append("*本报告由 automation/project-analyzer.py 基于实测数据自动生成*")

    content = "\n".join(out) + "\n"
    if args.output:
        Path(args.output).write_text(content, encoding="utf-8")
    else:
        sys.stdout.write(content)
    return 0


if __name__ == "__main__":
    sys.exit(main())

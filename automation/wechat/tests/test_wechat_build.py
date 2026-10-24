"""The WeChat variant must stay uploadable.

WeChat's draft API has two hard limits (body < 20,000 characters, cover thumb
≤ 64KB) and strips <style>/class CSS, so these invariants are checked here
instead of discovering the rejection only after an API call.

Run:  python -m pytest automation/wechat/tests
"""
import importlib.util
import sys
from pathlib import Path

import pytest

pytest.importorskip("markdown")

HERE = Path(__file__).resolve().parents[1]

ARTICLE = """\
# 某篇推广文章

> 目标读者：测试用。
> 文中数字为测试数据。
**一句话卖点**：一条命令把 DWG 变成知识图谱——数据优先，证据留痕。

---

## 标题备选

1. **测试标题：把 DWG 变成档案库**
2. **备选标题二**

---

## 正文

### 导语

第一段导语，带 `行内代码` 与 **加粗**。

第二个导语段落，说明这行不会因为软换行而断开。

---

### 一、它把 DWG 变成了什么

正文段落。

| 从图里拿到什么 | 用来干什么 |
|---|---|
| 图层 / 块 | 专业识别 |

### 二、场景

- 列表项一
- 列表项二

```bash
pip install "atlisp-dwg-kb[all]"
```

## 转发用短文案（编辑用，不应出现在正文）

> 这段话属于编辑备注。
"""


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def wechat():
    return _load("build_promo_wechat", HERE / "build-promo-wechat.py")


@pytest.fixture(scope="module")
def common():
    return _load("promo_common_under_test", HERE / "promo_common.py")


@pytest.fixture()
def article(tmp_path):
    p = tmp_path / "推广文章.md"
    p.write_text(ARTICLE, encoding="utf-8")
    return p


def test_prepare_extracts_title_lede_and_drops_editor_blocks(common, article):
    title, lede, text = common.prepare(article)

    assert title == "测试标题：把 DWG 变成档案库"
    assert lede.startswith("一条命令把 DWG")
    # 编辑用区块不进正文
    assert "备选标题二" not in text
    assert "转发用短文案" not in text
    assert "目标读者" not in text
    assert "### 导语" not in text
    # 小节标题提升一级（h2），表格与代码块保留
    assert text.startswith("第一段导语")
    assert "\n## 一、它把 DWG 变成了什么" in text
    assert "| 图层 / 块 | 专业识别 |" in text
    assert "```bash" in text


def test_prepare_falls_back_to_h1_without_candidates(common, tmp_path):
    p = tmp_path / "plain.md"
    p.write_text("# 直接写在 H1 的标题\n\n正文一段。\n", encoding="utf-8")

    title, lede, text = common.prepare(p)

    assert title == "直接写在 H1 的标题"
    assert lede == ""
    assert text.strip() == "正文一段。"


def test_wechat_fragment_is_inline_styled_and_safe(wechat, article):
    title, summary, fragment = wechat.build(article)

    assert title == "测试标题：把 DWG 变成档案库"
    assert summary and len(summary) <= 120       # 摘要 ≤ 120 字
    assert fragment.startswith("<section")
    # 微信会整段丢弃 <style> 与 class 选择器
    assert "<style" not in fragment
    assert "class=" not in fragment
    assert "<script" not in fragment
    # 结构块必须自带内联样式
    assert '<table style="' in fragment
    assert "<pre style=" in fragment


def test_wechat_fragment_fits_body_limit(wechat, article):
    _, _, fragment = wechat.build(article)

    assert len(fragment) < 20000, (
        f"正文 {len(fragment):,} 字符 ≥ 微信 2 万字符上限，"
        "精简内联样式或删减小节"
    )

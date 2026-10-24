# wechat — 文章 → 公众号草稿 工具链

把一个 Markdown 文章渲染成三种产物并上传成公众号草稿：

| 产物 | 说明 |
|---|---|
| `<文章>.html` | 独立网页版：自带 CSS、内联品牌图标、目录、打印/PDF 友好 |
| `<文章>-wechat.html` | 公众号正文：**全内联样式**，无 `<style>`/`class`/JS（微信会过滤），表格用原生 table 兜底 |
| `assets/cover.png` / `assets/cover-thumb.jpg` | 封面 1080×460，缩略图 900×383 且 ≤64KB（微信 thumb 素材上限） |

上传只创建**草稿**，不会群发；`--publish` 才会调 `freepublish/submit`。

## 快速开始

```bash
# 生成三种产物（不联网）
./publish.sh ../../atlisp-dwg-kb/docs/推广文章.md --dry-run

# 只建草稿
export WECHAT_APPID=wx...
export WECHAT_APPSECRET=...
./publish.sh ../../atlisp-dwg-kb/docs/推广文章.md

# 建草稿 + 发布
./publish.sh ../../atlisp-dwg-kb/docs/推广文章.md --publish
```

也可以单独跑某一步：

```bash
python3 build-promo-html.py   article.md                    # -> article.html
python3 build-promo-wechat.py article.md                    # -> article-wechat.html
python3 build-promo-cover.py  article.md --outdir /tmp/assets
python3 publish_wechat.py --html article-wechat.html --cover assets/cover-thumb.jpg --dry-run
```

## 环境要求

- Python 3.10+；`pip install markdown Pillow`（封面需要 CJK 字体：Noto Sans SC / 微软雅黑 / 文泉驿任一）
- 公众号：**已认证**的订阅号/服务号（个人主体号没有草稿/发布接口权限）
- `WECHAT_APPID` + `WECHAT_APPSECRET`：后台 → 设置与开发 → 基本配置 → 公众号开发信息
- 调用机器的**公网出口 IP** 必须在后台 → 基本配置 → IP 白名单里，否则报
  `40164 invalid ip ... not in whitelist`

`publish_wechat.py` 只用标准库（urllib），不需要装 requests。

## 文章 Markdown 约定

```markdown
# 任意文件名标题                     ← 会被丢弃，不作为文章标题

> 目标读者：...                      ← 编辑备注，不进正文
**一句话卖点**：...                  ← 会成为导语 / 公众号摘要
---

## 标题备选
1. **真正的文章标题**                ← 取第 1 条作为 <h1> 与公众号标题
2. **备选二**

## 正文
### 导语
正文段落……

### 一、小节
……

## 转发用短文案                        ← 编辑备注，到这里截断
```

没有 `## 标题备选` 时回退用文件里的第一个 `# 标题`。

## 脚本

| 文件 | 作用 |
|---|---|
| `promo_common.py` | 共用：剥离编辑备注、取标题/导语、合并中文软换行、生成摘要 |
| `build-promo-html.py` | Markdown → 独立网页（含目录、打印样式） |
| `build-promo-wechat.py` | Markdown → 公众号正文片段（`WECHAT:BEGIN/END` 标记包裹）+ 预览页 |
| `build-promo-cover.py` | 生成封面与 ≤64KB 缩略图（品牌名/小字可用 `--brand/--sub` 覆盖） |
| `publish_wechat.py` | token → 上传封面（永久素材 thumb）→ `draft/add`（可选 `freepublish/submit`） |
| `publish.sh` | 上面四步一条命令 |

## 硬限制（脚本会先在本地拦住）

- 正文 HTML **< 20,000 字符**（微信后台限制），超出直接拒跑
- 封面 ≤ **64KB**，建议 900×383
- 摘要 ≤ **120 字**（`promo_common.digest()` 自动截断）

## 测试

```bash
python -m pytest tests/          # 片段合法性、2 万字符上限、标题/导语提取
```

## 安全提示

`AppSecret` 不要写进脚本或仓库。用环境变量，或在服务器上用
`umask 077; cat > ~/.wx_env` 临时文件（跑完删除）。凭据一旦出现在聊天记录/日志里，
建议到后台「重置开发者密码」。

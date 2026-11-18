# 公众号草稿箱 · 平台硬约束（一手核实）

> 核实日期 2026-10-23。官方文档已整站迁移，老 URL（`developers.weixin.qq.com/doc/offiaccount/…`）**全部 404**，
> 页面上写着「该页面内容已经迁移 — 请访问 `https://developers.weixin.qq.com/doc/service/guide/product/draft.html`」。
> 新站三棵树：服务号 `/doc/service/` · 订阅号 `/doc/subscription/` · API 参考 `/doc/service/api/`。
> ⚠️ 路径里的目录层级别凭印象写：例如 `draft/add` 的规格页真实路径是
> `/doc/service/api/draftbox/draftmanage/api_draft_add.md`（少一级就 404）。
> 拿不准就从 `developers.weixin.qq.com/doc/llms.txt`（全站索引）现场搜。
> **每个页面都有 `.md` 纯文本端点**（例：`/doc/service/api/material/permanent/api_uploadimage.md`），
> 抓规格用它，比抓 HTML 干净得多。

来源入口：`developers.weixin.qq.com/doc/llms.txt`（全站索引）、各页 `.md` 端点、
`mp.weixin.qq.com/opshowpage?action=newoplaw&oplaw_id=132`（运营规范原文）。

---

## 1. 素材与图片

| 项 | 规格 | 出处 |
|---|---|---|
| 正文图接口 | `media/uploadimg`：**仅 jpg/png**，**大小必须 <1MB**；**SVG 不支持** | `/doc/service/api/material/permanent/api_uploadimage.md` |
| 正文图错误码 | `40005` 文件类型不对 · `40009` 图片尺寸太大 | 同上 |
| 正文图配额 | 不占素材库 100000 张额度 | 同上 |
| 封面素材 | `material/add_material?type=image`：**10M**，bmp/png/jpeg/jpg/gif | `/doc/service/api/material/permanent/api_addmaterial.md` |
| thumb 类型 | 另有限制：**64KB，仅 JPG** | 同上 |
| 外部图片 URL | 「涉及图片 url 必须来源上传图文消息内的图片获取 URL 接口获取。**外部图片 url 将被过滤**」 | `/doc/service/api/draftbox/draftmanage/api_draft_add.md` content 说明 |
| 同源佐证 | 「图文消息的具体内容中，微信后台将过滤外部的图片链接」 | `/doc/service/api/material/permanent/api_addmaterial.md` #4、`/doc/service/api/material/permanent/api_uploadimage.md` #2 |

## 2. 草稿字段

| 字段 | 规格 | 出处 |
|---|---|---|
| `title` | 「总长度不超过 **32** 个字」 | `/doc/service/api/draftbox/draftmanage/api_draft_add.md` |
| `author` | 「总长度不超过 **16** 个字」 | 同上 |
| `digest` | 「总长度不超过 **120** 个字」；**留空则默认抓取正文前 54 个字** | 同上 |
| `content` | 原文并列三个限制且量纲冲突：「大小不可超过 2kb，支持 HTML 标签，必须少于 2万字符，小于 1M，且此处会去除 JS」 | 同上 |
| `thumb_media_id` | 图文消息时**必填**，且**必须是永久 MediaID** | 同上 |
| `cover_info.crop_percent_list` | 裁剪比例：图文消息**仅支持 `2.35_1` 与 `1_1`**；以图片左上角 (0,0)、右下角 (1,1) 建立平面坐标系。官方示例**同一张封面给了两组坐标** | 同上 |
| `content_source_url` | 「阅读原文」地址，**大小不可超过 1 kb**；字段为单值 → **每篇 1 个** | 同上 |
| `need_open_comment` / `only_fans_can_comment` | 留言开关 | 同上 |
| 字段全集 | `article_type / title / author / digest / content / content_source_url / thumb_media_id / need_open_comment / only_fans_can_comment / image_info / cover_info / product_info` —— **没有任何关注/点赞/在看字段** | 同上 |

**`content` 三个限制自相矛盾时的取法**：按最严口径（≤2 万字符、总体积 ≤1M、单图 URL 短）准备；
不要按 2kb 理解（那会把正文压到 2KB，不现实），官方也没说「每个 URL 2KB」。

## 3. 正文内容能力（编辑器规范 `/doc/service/api/.../plugin_spec.md`）

- `<pre>` 默认带 `white-space: pre`，**移动端窄屏内容被水平截断**；推荐改用 `<section>` / `<p>`
- `<table>` 表头固定列宽超出容器会**水平溢出、用户在移动端读不全**
- 嵌套：同一标签名 + 同一内联样式 + 单子节点的连续嵌套**不应超过 10 层**
- `<span leaf>` 只能放行内元素
- **不建议设置任何 `font-family`**；默认栈是 `mp-quote, PingFang SC, system-ui, …`；
  自定义栈在 **iOS 17+ 部分版本**会出现字大小/字距不一致
- SVG 作正文媒体：后台不支持修改 SVG 背景图

## 4. 正文外链

- 官方只明确支持「**自己账号和其他公众号/服务号已群发文章链接**」（三处同文：
  `/doc/service/api/material/permanent/api_addmaterial.md` #6、`/doc/service/api/material/permanent/api_uploadimage.md` #2、`/doc/service/api/.../Batch_Sends.md` 第 7 条）
- 官方文档**只对图片 URL** 明说会被过滤，对 `<a href>` 无处理说明
  → 稳妥做法：正文外链按「点不动」设计（纯文本），完整 URL 放 `content_source_url`

## 5. 权限、开关、限额

| 项 | 结论 | 出处 |
|---|---|---|
| 草稿箱开关 | **不需要开**：`draft/switch` 接口**已废弃**，草稿箱与发布功能已全量开放 | `/doc/service/api/draftbox/draftmanage/api_draft_switch.md` |
| 接口权限位 | 微信开发者平台 → 我的业务 → 公众号/服务号 → **接口管理 → 接口权限与额度** | `/doc/service/api/.../migration.md` |
| 谁进得去 | 必须是公众号的**开发者或管理员**，运营者无权限 | `/doc/service/api/.../migration.md` |
| 适用范围 | `draft/add`：**公众号 ✔ / 服务号 ✔**（未认证个人订阅号在接口层可用） | `/doc/service/api/draftbox/draftmanage/api_draft_add.md` §7 |
| 真正的门槛 | 个人主体若**管理员未实名**，启用 AppSecret 会提示「该账号尚未完成实名」 | `/doc/service/api/.../migration.md` 补充说明 4 |
| 草稿箱配额 | 新建草稿 1000 / 获取草稿 500 / 删除草稿 1000 / 修改草稿 1000 | `/doc/service/api/.../limit.md` |
| IP 白名单 | 「白名单内的 IP 才可以调用获取接口调用凭据接口」→ **不加必报 61004**。入口：基础信息 → 开发密钥 | 《服务端 API 调用说明》（订阅号/服务号两份同文） |
| IP 加错 | 返回 **89503** 并同时下发模板消息给管理员确认；**管理员拒绝后 1 小时内该 IP 不能再发起调用** | 风险调用流程 |

## 6. 合规（必读）

运营规范 **3.27 非真人自动化创作行为**：
「公众号和服务号不得利用 AI、脚本、接口或其他自动化方式，替代真人完成内容创作、发布等流程…
**3.27.2 通过脚本、程序托管等自动化方式批量、连续发布内容的行为**」——
处理规则：流量限制、删除…能力限制、封禁。

另有 **3.28 套路化模板写作行为**：模板化内容高频发布本身就有风险点。

**边界**：推草稿 + 人工发布 = 安全；**自动推完自动发 = 踩线**。
系列横评类模板稿（本项目的 A1 等）高频同模板发布，自身就要留意 3.28。

另见 3.16.2（正文无有效内容、需点「阅读原文」才能看到主要内容）、3.16.4（不正当引流）。

## 7. 本地工具 `wechat-draft` 的四个坑

（读源码 + 实跑干跑得出，不是猜的）

1. **`--body-only` 是必需的**：只取 `## 正文` 到下一个 `## ` 之间的内容。
   不带它，文末「给用户的清单」会**连同 HTML 注释一起被推进草稿**。
   代价：正文里的小节标题必须比 `###` 深一级（`## 一、…` 会被截断）。
2. **frontmatter 的 `author` 是死字段**：`parseCli()` 里 `author: { default: '阿茶' }`，
   取值是 `args.author || parsed.data.author || '阿茶'` → **CLI 默认值恒真，frontmatter 永远读不到**。
   必须显式 `--author`。
3. **`validateClean` 连 HTML 注释一起扫**：它查整个 body 字符串，注释里的
   `发布前必做清单 / 必润色点 / 标题（5 选 1）/ AI 代笔红线自检 / 数据核实 / 待你重算 / 字数：` 照样触发拒绝。
4. **封面字节必须真是 JPEG**：上传时 multipart 文件名被写死为 `cover.jpg`。
   另：非 bmp/png/jpeg/jpg/gif 会被脚本直接拒绝（SVG 推上去只会拿到 40005）。

## 8. 实跑才暴露出来的另外几处

（2026-10-23 评测轮实跑得出；与官方规格不完全一致的地方以**实跑**为准）

1. **正文图与封面实际都走 `material/add_material`（永久素材），不是 `media/uploadimg`**。
   ⇒ 每推一次草稿，后台素材库多 4 条素材（3 正文图 + 1 封面）。素材库上限 100000，不紧张，但要心里有数。
2. **裁切坐标实际没发**。wenyan 发的是顶层 `pic_crop_235_1` / `pic_crop_1_1`，
   而官方字段是 `cover_info.crop_percent_list`（数组，可给两组坐标）。
   ⇒ 顶层这两个字段**不是官方规格**，大概率被忽略；**别依赖它**，用「一张图两种裁法都不丢字」的设计。
3. **图片路径含空格、或用绝对路径 → 图片正则 `[^)\s]+` 匹配不到 → 静默留下裸 markdown**
   （在公众号里变成裂开的文字），干跑不一定报错。**必须用相对路径且不含空格。**
4. **缺 `.env` 时真推干净失败**：`checkEnv()` 在唯一一次网络调用**之前**抛错 →
   exit 1、零请求、**不留垃圾草稿**。所以「先试一次」是安全的。
5. **`digest` 确实会进 API**：它由 `@wenyan-md/core` 的 `handleFrontMatter` 读取
   （在 `core/dist/core.js`），不在 CLI 包的 dist 里——grep 时别只 grep 一层就下结论。
6. **正文承诺 ↔ 字段必须对得上**（干跑产物里看不到，只能回稿件 frontmatter 核）：
   - 正文说「链接放在文末『阅读原文』」→ 必须真有 `source_url`
   - 正文说「评论区聊聊」→ 必须设 `need_open_comment: 1`（官方默认 0 = 关闭）
   这类不一致读者一眼能看出来，且**不会在干跑时报警**。
7. **图片路径必须相对且不含空格**。wenyan 的图片正则 `[^)\s]+` 匹配不到含空格的路径，
   会**静默留下裸 markdown**（在公众号里变成裂开的文字），干跑不一定报错。改绝对路径同样会踩。

## 9. 官方规格 ↔ 工具实现不一致时，以实跑为准

| 项 | 官方规格 | 工具实际 | 结论 |
|---|---|---|---|
| 封面裁切坐标 | `cover_info.crop_percent_list`（数组，可给 2.35_1 + 1_1 两组坐标） | wenyan 把 `pic_crop_235_1` / `pic_crop_1_1` 当**顶层字段**发 | **顶层写法微信不认** → 别指望这个字段救裁切，用「一张图两种裁法都不丢字」的设计 |
| 正文图接口 | `media/uploadimg`（不占素材库额度） | wenyan 的正文图与封面**都走** `material/add_material`（永久素材） | 每推一次后台 +4 条素材（3 正文图 + 1 封面） |
| 缺 `.env` | — | `checkEnv()` 在**唯一一次网络调用之前**抛错 | exit 1、零请求、**不留垃圾草稿** → 「先试一次」是安全的 |

**通用原则**：这个工具链的 README 和官方文档对不上时，**读源码 + 跑对照实验**，
不要照抄任何一方的说法（包括本 skill）。

## 10. 证明「某个参数必需」要用对照实验，别照抄

skill 里写「`--body-only` 必需」「`--author` 必需」——要验证就**跑一次 A/B 对照**：

| 对照 | 实跑结果 | 判定 |
|---|---|---|
| 去掉 `--body-only` | 干跑**不报错**，但产物泄漏整节「给阿茶的选择清单」+ HTML 注释，preview.html 7,644 → 12,971 B | 必须带 |
| 去掉 `--author` | 作者变成默认值「阿茶」，frontmatter 的 author 读不到 | 必须带 |
| 去掉 `--cover` | 也能跑（frontmatter 的 `cover:` 相对路径能解析） | 可选，显式写更稳 |

⚠️ 注意 `--body-only` 漏了**不会报错**——`validateClean` 的 8 个拦阻词一个都命中不了那节，
它静默放行。所以「干跑没报错」不等于「没泄漏」，**必须去产物里查**。

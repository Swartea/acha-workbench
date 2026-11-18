---
name: wechat-draft-push
description: |
  把一篇 Markdown 稿推进微信公众号**草稿箱**（官方 draft/add，只建草稿不发布），并交付
  符合公众号硬约束的图文（正文图 jpg/png <1MB、封面两种比例都不丢字、标题 ≤32 字）。
  Use when the user says 推到公众号后台 / 进草稿箱 / 发公众号 / 公众号排版 / wechat draft /
  公众号封面或正文图能不能过审 / 公众号外链要不要留。Do NOT use for 直接发布或定时发布
  （运营规范禁止脚本代发）；本 skill 只负责推送，不负责写稿或改稿——写稿走 `09-编辑部` / `06-工作台` 的 AI 自主流程。
---

# 公众号草稿箱推送

## Inputs to collect

- 稿件绝对路径（`.md`），以及 frontmatter 里 `title` / `digest` / `cover` 是否齐
- 是否已有 `wechat-draft` 工具（本仓库 `02-发布工具/wechat-draft`）；没有就先说明这是外部依赖
- **账号侧三件人工前置是否已就绪**：管理员实名、AppID+AppSecret、IP 白名单（见下）
  这三件只有账号持有人能做，推之前问一次，别把失败原因归到代码上

## Procedure

1. **先核平台硬约束，别拿旧记忆当现行规则**。官方文档已整站迁移到
   `developers.weixin.qq.com/doc/{service,subscription}/…`，老路径（`/doc/offiaccount/…`）
   全 404。每个页面都有 `.md` 纯文本端点（如 `.../api_draft_add.md`），用它抓最干净。
   完整约束清单与原文摘录见 `references/platform-constraints.md`——**以那份为准，本文只列最容易踩的**：
   - 正文图接口只收 **jpg/png 且 <1MB**，**SVG 不收** → 配图必须先光栅化
   - 封面走 `material/add_material`（10M，bmp/png/jpeg/jpg/gif）；`thumb` 类型另有限制
   - **标题 ≤32 字**（不是 64）→ 长标题会被接口拒收，改标题而不是等报错
   - `digest` ≤120 字；**留空会自动抓正文前 54 字**，通常不是你想要的那句 → 显式写
   - 正文 `content` 上限按最严口径（官方三个数字自相矛盾）→ 控制在 2 万字符内
   - **正文只支持"已群发文章链接"**；外部图片 URL 会被过滤 → 正文里的外链要么纯文本，要么走「阅读原文」
   - 运营规范 3.27.2：禁止脚本批量连续发布 → **只调 draft/add，人工点发表**

2. **把配图转成平台能收的格式**。正文图宽度按手机栏位给 900px，封面给 JPEG
   （上传时 multipart 文件名常被写死成 `cover.jpg`，字节得真是 JPEG）。
   裁切与可读性的验收方法见 skill `figure-crop-acceptance`。

3. **干跑，不要直推**。`--dry-run` 不调微信接口、不需要密钥，产出 `publish.md` 与
   `preview.html`：
   ```bash
   cd "<仓库根>/02-发布工具/wechat-draft" && npm run draft -- \
     -f "<稿件绝对路径>" --body-only --author "<作者名>" --dry-run
   ```
   `--body-only` 与 `--author` 都不能省：
   - 少了 `--body-only`：文末的"给用户的清单"连同 HTML 注释会一起被推进草稿
   - 少了 `--author`：frontmatter 的 `author` 是死字段（CLI 默认值恒真），作者会变成默认值

4. **审干跑产物，不审源码**。先跑预检脚本，把机械检查一次性做完：
   ```bash
   node "02-发布工具/skills/wechat-draft-push/scripts/preflight.mjs" \
     --md "<稿件绝对路径>" --html "<dry-run 产出的 preview.html>"
   ```
   它查：长度上限、正文承诺↔字段、图片存在/格式/体积、路径含空格或绝对路径、
   工作稿残留词、HTML 注释泄漏、外链数、`<pre>`/`<table>`、正文字符数。
   **脚本只覆盖机械项，下面 4b/4c/4d 是它查不出来的，仍要人工核。**
   另外脚本查不到、但要自己看的：
   - 图注是否**可见**（转成标准 markdown 后 alt 不会自动显示，需要单独的可见图注行）
   - 摘要是不是你想说的那句（留空会自动抓正文前 54 字）

4b. 🚨 **查「正文承诺 ↔ 实际字段」是否对得上**（最容易漏、且读者看得见）：
   - 正文说「完整链接放在文末『阅读原文』」→ frontmatter 必须真有 `source_url`，
     否则 `content_source_url` 是 undefined，**承诺落空**
   - 正文引导「评论区聊聊」→ 必须设 `need_open_comment: 1`（官方默认 0 = 关闭）
   - 正文提到某个口径日期 → 正文、两张图、frontmatter 的 `digest` 口径要一致
   干跑产物里看不到这些字段，只能**回到稿件 frontmatter 对一遍**。

4c. **图片路径必须是相对路径且不含空格**。wenyan 的图片正则 `[^)\s]+` 匹配不到含空格的路径，
   会**静默留下裸 markdown**（在公众号里变成裂开的文字），干跑不一定报错。
   改成绝对路径同样会踩。

4d. **封面/正文图实际走的不是 `media/uploadimg`**，wenyan 用的都是
   `material/add_material`（永久素材）——每推一次后台就多 4 条素材，自己心里有数。

5. **确认人工前置后再真推**（去掉 `--dry-run`）。`wechat-draft` 需要 `02-发布工具/wechat-draft/.env`
   里有 `WECHAT_APP_ID` / `WECHAT_APP_SECRET`；IP 白名单没加会直接报 **61004**。
   缺 `.env` 时 `checkEnv()` 在**唯一一次网络调用之前**就抛错 → exit 1、零请求、
   **不会留下垃圾草稿**，可以放心先试。
   出口 IP 用 `curl -4 ifconfig.me` 查（家宽是动态 IP，重推前重查）。
   推完终端会打印"草稿已创建，未发布"，然后告诉用户去
   **mp.weixin.qq.com → 草稿箱 → 手机预览 → 自己点「发表」**。

6. **交付给用户的清单**：草稿已进后台（附 media_id）、发布日当天还要人工做的
   （价格/链接复核、封面裁切确认、外链可点性）、以及**没有发布**这一事实。

## Output contract

- 一条可直接复制的推送命令（含 `--body-only` `--author`，必要时含 `--cover`）
- 干跑产物的核查结论：泄漏检查 / 外链数 / 图表数 / 体积
- 三件人工前置的当前状态（就绪 / 缺哪件 / 缺了会报什么错）
- 明确声明"只进草稿箱，未发布"

## Failure handling

- `61004` → IP 不在白名单，不是代码问题，让用户加出口 IP
- `40013` / `40125` → AppID / AppSecret 不对
- `40005` → 文件类型不对（多半是 SVG 封面）
- `40007` / 标题被拒 → 标题超 32 字
- `48001` → 接口没开，去开发者平台 → 接口管理 → 接口权限与额度
- 加错 IP 会收到 **89503** + 管理员模板消息，**1 小时内该 IP 不能再用** → 一次加准
- 干跑就报错 → 先修稿，不要带着问题去真推（真推失败会留垃圾草稿）

## Examples

Input: "把这篇稿子推到公众号后台给我看看"
Output: 跑干跑 → 报「正文 5,210 字符、0 外链、3 图、0 泄漏」→ 给出真推命令 →
  列出「还差：AppID/Secret、IP 白名单、管理员实名」→ 说明推完只进草稿箱，发布由用户点。

## Windows (win32) platform notes

`wechat-draft` 与 `sips` 都是 macOS 工具。Windows 上改用 Python 的 Pillow 做裁切与格式转换，
`npm run draft` 需在 WSL 里跑；其余流程与约束完全一致。

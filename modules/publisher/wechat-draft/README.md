# wechat-draft

把 Obsidian Markdown 推到微信公众号**草稿箱**，不发布。

- 使用官方 `draft/add`，不是网页自动化。
- 自动处理 frontmatter、封面、图片、Obsidian `![[...]]`。
- 推完你在公众号后台/手机预览，自己点「发表」或「定时发表」。

## 一次性配置

```bash
cd ~/Documents/ChatGPT/wechat-draft
cp .env.example .env
# 编辑 .env，填入 AppID 和 AppSecret
```

公众号后台还需要：

1. 设置与开发 → 基本配置 → 生成 AppSecret。
2. 同一页 → IP 白名单 → 加上当前公网 IP（`curl -4 ifconfig.me`）。
3. 设置与开发 → 接口权限 → 确认「草稿箱」已获得。

## 用法

先干跑（不调用微信接口，不需要密钥）：

```bash
npm run draft -- -f "文章.md" --cover "封面.png" --dry-run
```

推草稿：

```bash
npm run draft -- -f "文章.md" --cover "封面.png"
```

针对工作稿（只取 `## 正文`，去掉 📌/⚠️/🚨/字数 批注和 `### 段 N` 标题）：

```bash
npm run draft -- \
  -f "文章 A1 - 全文草稿 v1 - 2026-09-27.md" \
  --cover "稿件/素材/A1配图/对比表.png" \
  --body-only --strip-meta
```

## 它会拦什么

- 正文里还有「发布前必做清单」「必润色点」「数据核实」「字数：」等字样 → 拒绝，除非 `--force`。
- 图片找不到 → 拒绝，不会静默丢图。
- 推草稿没给封面 → 拒绝。
- `![[图片]]` 会自动转成标准 Markdown 并复制到临时目录；相对路径、中文、空格都不会传给微信。

## 常见报错

| 错误码 | 原因 | 处理 |
|---|---|---|
| 40164 | IP 不在白名单 | 后台 → 基本配置 → IP 白名单，加 `curl ifconfig.me` |
| 48001 | 接口未授权 | 草稿箱接口没开；把报错发我，改走浏览器自动化 |
| 40013 | AppID 无效 | 检查 `.env` |
| 40125 | AppSecret 无效 | 重新生成并更新 `.env` |
| 40007 | media_id 无效 | 通常是图片上传失败，检查格式/大小 |

## 安全

- `.env` 已在 `.gitignore` 里，不要提交、不要贴聊天。
- AppSecret 等于账号写权限，泄露后立即在后台重置。
- 本工具只调用草稿接口，不调用 `freepublish/*`。

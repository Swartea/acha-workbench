# example-ws · 数据工作区示例

工作台**只索引、不写内容**：你的选题库、看板、稿件、素材都是普通 markdown/图片，
放在这个目录（或你自己的目录）下即可。缺哪个模块，对应功能自动停用，其余照常。

## 目录约定

```
01-内容库/
├─ 选题库 - 阿茶AI实验室.md     # 可选；没有则选题台为空
├─ 看板 - 阿茶AI实验室.md       # 可选
├─ 稿件/                        # 你的文章 markdown（frontmatter 可带 cover:）
│  └─ 素材/自动封面/            # 自动写稿的封面落点
└─ 研究/                        # 可选
02-发布工具/wechat-draft/       # 可选模块：推草稿到公众号（需自己配置凭据）
09-编辑部/
├─ scripts/draft-check.mjs      # 可选模块：发稿检查器
├─ 素材池/                      # 素材
└─ 返工记录/
04-参考/封面图/                 # 可选模块：自动封面模板
```

## 一键安装可选模块

```bash
bash /path/to/acha-workbench/example-ws/setup.sh /path/to/acha-workbench
```

## 接入工作台

`.env.local` 里设 `ACHA_WS_ROOT=/本目录的绝对路径`，启动后所有页面即时可读你的内容。
账号凭据（公众号 appid/secret、访问口令等）只进 `.env.local`，永不入库。

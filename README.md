# Acha Workbench · 公众号工作台

一个自托管的微信公众号工作台（Next.js）：稿件流水线、选题雷达、事实核实、发布预检、自主写稿。
**代码与内容完全分离** —— 仓库里没有任何账号状态与文章，把你的 markdown 内容目录指过来就能用。

## 快速开始

```bash
git clone <本仓库> acha-workbench && cd acha-workbench
npm install
npm run build

# 访问口令（必填）
echo 'WORKBENCH_PASSCODE=你的口令' > .env.local
# 指向你的数据工作区（目录结构见 example-ws/；先用示例骨架也行）
echo "ACHA_WS_ROOT=$PWD/example-ws" >> .env.local

npm run start        # http://127.0.0.1:8787 · 局域网 0.0.0.0:8787
```

打开后各页面从 `ACHA_WS_ROOT` 实时解析你的 markdown（只读索引）：
没有内容库页面就是空的，放入 `01-内容库/稿件/*.md` 即出现稿件流水线。

## 设计：内容即文件

- **内容不入库**：选题库 / 看板 / 写作包 / 稿件 / 雷达日志全是普通 markdown + 图片，
  工作台只建只读索引；状态（勾选、机器轮次、发布留档）进本地 SQLite（`data/`，已 gitignore）。
- **凭据不入库**：口令、公众号 appid/secret 等只进 `.env.local`（已 gitignore）。
- **路径真源唯一**：所有跨目录路径收敛在 `lib/paths.ts`，`ACHA_WS_ROOT` 一个变量完成分离部署。

## 功能

| 页面 | 作用 |
| --- | --- |
| `/manuscripts` | 稿件流水线（选题分组、当前稿指针、九步状态） |
| `/topics` | 选题雷达台（选题状态机 + 筛选） |
| `/radar` | 资料源雷达（Folo / RSS 双源，条目合并筛选） |
| `/intake` | 素材入库（公开来源标注，可补实跑） |
| `/verify` | 事实核实台（稿件数字 ↔ 来源台账对撞，标新鲜度） |
| `/titles` | 标题审计（模板 vs 平台字数口径） |
| `/publish` | 发布台（干跑 → 预检 → 预览 → 推草稿） |
| `/autopilot` | 自主写稿闭环（选题 → 研究 → 写稿 → 检查 → 返工 → 封面） |
| `/review` `/quality` `/figures` `/experts` | 复盘、质检、配图、专家咨询 |
| `/settings` | 设置（凭据状态 / 网络 / 数据 / 合规） |

## 可选模块（modules/）

核心工作台零依赖可跑；以下功能需要把模块装进数据工作区：

| 模块 | 解锁功能 | 安装落点（相对 ACHA_WS_ROOT） |
| --- | --- | --- |
| `modules/publisher/wechat-draft` | 推草稿到公众号草稿箱 | `02-发布工具/wechat-draft` |
| `modules/publisher/wechat-draft-push` | 推送前平台预检 | `02-发布工具/skills/wechat-draft-push` |
| `modules/editorial-checker/draft-check.mjs` | 发稿检查器（autopilot / publish 用） | `09-编辑部/scripts/draft-check.mjs` |
| `modules/cover-template/自动封面-模板.md` | 自动封面模板 | `04-参考/封面图/` |

一键安装：

```bash
bash example-ws/setup.sh "$PWD"          # 在example-ws里执行；对自己的目录同样适用
```

依赖说明：`/radar` 的 Folo 源需要外部 `folo` CLI（`npm i -g folocli && folo login`）；
RSS 源用内置零依赖解析器，feed 清单在 `rss-feeds.json` 手编即生效。

## 目录结构

```
├─ app/            Next.js App Router（页面 + /api）
├─ components/     交互组件
├─ lib/            领域逻辑（paths.ts 是路径唯一出口）
├─ tests/          node:test 单测
├─ modules/        可选功能模块（上表）
└─ example-ws/     数据工作区示例骨架 + setup.sh
```

## 安全边界

- 写操作（拉雷达、自主写稿、推草稿）默认仅本机；局域网为只读 + 口令。
- 自动投料只抓公开资料，稿件须标来源，不冒充实测。
- 不自动发表：所有「发布」动作只到公众号草稿箱，由人点发表。

## 开发

```bash
npm test             # node:test（数据目录指向临时目录，不碰真实数据）
npm run build        # Turbopack 构建
```

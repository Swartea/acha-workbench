#!/bin/sh
# 把 modules/ 下的可选模块安装到本数据工作区（example-ws 或你自己的目录）。
# 用法：在数据工作区根目录执行  bash /path/to/acha-workbench/example-ws/setup.sh /path/to/acha-workbench
set -e
BENCH="${1:?用法: setup.sh <acha-workbench 路径>}"
WS="$(cd "$(dirname "$0")" && pwd)"
[ -f "$BENCH/package.json" ] || { echo "找不到 $BENCH/package.json"; exit 1; }

mkdir -p "$WS/01-内容库/稿件/素材/自动封面" "$WS/01-内容库/研究" \
         "$WS/09-编辑部/scripts" "$WS/09-编辑部/素材池" "$WS/09-编辑部/返工记录" \
         "$WS/02-发布工具/skills" "$WS/04-参考/封面图"

cp -R "$BENCH/modules/publisher/wechat-draft" "$WS/02-发布工具/wechat-draft"
mkdir -p "$WS/02-发布工具/skills/wechat-draft-push"
cp -R "$BENCH/modules/publisher/wechat-draft-push/." "$WS/02-发布工具/skills/wechat-draft-push/"
cp "$BENCH/modules/editorial-checker/draft-check.mjs" "$WS/09-编辑部/scripts/"
cp "$BENCH/modules/cover-template/自动封面-模板.md" "$WS/04-参考/封面图/" 2>/dev/null || true

echo "完成。启动工作台："
echo "  cd $BENCH && npm install && npm run build"
echo "  echo 'WORKBENCH_PASSCODE=你的口令' > .env.local"
echo "  echo \"ACHA_WS_ROOT=$WS\" >> .env.local"
echo "  npm run start   # http://127.0.0.1:8787"

import path from 'node:path';

/** 06-工作台 目录 */
export const WB_ROOT = process.cwd();
/**
 * 工作区根目录（数据与兄弟模块所在处）。
 *
 * 默认取工作台上级目录（阿茶AI实验室 仓库布局）；
 * 也可用环境变量 ACHA_WS_ROOT 指向任意目录 —— 代码与个人内容分离后，
 * 分享/试用场景下把 ACHA_WS_ROOT 指向自己的数据工作区即可，无需改动代码。
 */
export const WS_ROOT = process.env.ACHA_WS_ROOT
  ? path.resolve(process.env.ACHA_WS_ROOT)
  : path.resolve(WB_ROOT, '..');

/**
 * 仓库内兄弟模块路径 —— 全站唯一出口。
 * 谁需要跨模块路径都从这里 import，不许自己 path.join 拼一遍
 * （历史上「稿件」目录拼过 3 份、检查器路径拼过 2 份，改名要人肉同步）。
 */

/** 01-内容库：内容真源（vault 镜像，只读索引，工作台不写内容） */
export const LIB = path.join(WS_ROOT, '01-内容库');
/** 02-发布工具：推草稿 */
export const PUSH_DIR = path.join(WS_ROOT, '02-发布工具', 'wechat-draft');
export const PREFLIGHT_SCRIPT = path.join(
  WS_ROOT,
  '02-发布工具',
  'skills',
  'wechat-draft-push',
  'scripts',
  'preflight.mjs',
);
/** 03-生产工具 */
export const TOOLS = path.join(WS_ROOT, '03-生产工具');
/** 04-参考 */
export const REFERENCE_DIR = path.join(WS_ROOT, '04-参考');
export const COVER_TEMPLATE = path.join(REFERENCE_DIR, '封面图', '自动封面-模板.md');
/** 09-编辑部：检查器 / 素材池 / 返工记录 */
export const EDITORIAL_DIR = path.join(WS_ROOT, '09-编辑部');
export const CHECKER = path.join(EDITORIAL_DIR, 'scripts', 'draft-check.mjs');
export const REWORK_DIR = path.join(EDITORIAL_DIR, '返工记录');
export const INTAKE_DIR = path.join(EDITORIAL_DIR, '素材池');

/** 01-内容库 里的权威文件与目录 */
export const TOPIC_FILE = path.join(LIB, '选题库 - 阿茶AI实验室.md');
export const KANBAN_FILE = path.join(LIB, '看板 - 阿茶AI实验室.md');
export const SKILL_FILE = path.join(LIB, 'Skill 库 - 阿茶AI实验室.md');
export const PLAN_FILE = path.join(LIB, '内容生产执行方案-v2-2026-10-16.md');
export const MANUSCRIPT_DIR = path.join(LIB, '稿件');
export const MATERIAL_DIR = path.join(MANUSCRIPT_DIR, '素材');
/** 自动封面落点（autopilot 封面产出） */
export const COVER_DIR = path.join(MATERIAL_DIR, '自动封面');
/** 自动正文配图落点（autopilot 配图产出，替换正文【图 N】占位符） */
export const FIGURE_DIR = path.join(MATERIAL_DIR, '自动配图');

/**
 * 状态库目录。
 *
 * 默认 06-工作台/data；测试用 WORKBENCH_DATA_DIR 指向临时目录，
 * 保证测试永远不碰真实的 data/workbench.db。
 */
export const DATA_DIR = process.env.WORKBENCH_DATA_DIR
  ? path.resolve(process.env.WORKBENCH_DATA_DIR)
  : path.join(WB_ROOT, 'data');
export const PREVIEW_DIR = path.join(DATA_DIR, 'previews');
export const BACKUPS_DIR = path.join(DATA_DIR, 'backups');
export const DRAFTS_DIR = path.join(DATA_DIR, 'drafts');
export const EXPERTS_DATA_DIR = path.join(DATA_DIR, 'experts');
export const HERMES_DATA_DIR = path.join(DATA_DIR, 'hermes');
export const AUTOPILOT_DATA_DIR = path.join(DATA_DIR, 'autopilot');
export const FOLO_TRANSLATE_WORK_DIR = path.join(DATA_DIR, 'folo-translate');
export const FOLO_STATE_FILE = path.join(DATA_DIR, 'folo-state.json');
export const FOLO_RADAR_FILE = path.join(DATA_DIR, 'folo-radar.json');
export const FOLO_TRANSLATIONS_FILE = path.join(DATA_DIR, 'folo-translations.json');

/** RSS 资料源：feed 清单（checked-in 可手编）与运行态（状态去重 + 候选缓存） */
export const RSS_FEEDS_FILE = path.join(WB_ROOT, 'rss-feeds.json');
export const RSS_STATE_FILE = path.join(DATA_DIR, 'rss-state.json');
export const RSS_RADAR_FILE = path.join(DATA_DIR, 'rss-radar.json');

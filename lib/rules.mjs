/**
 * 检查词表与守卫常量 —— 唯一真源（同 limits.mjs 模式）。
 *
 * 此前分散在 4 处各抄一份：draft.mjs（发布硬门槛）、preflight.mjs（预检）、
 * lib/quality.ts（质检页）、09-编辑部/draft-check.mjs（写作门形状检查）。
 * 改词表只改这里；词表口径变更要在 09-编辑部/写作门-v2.md 同步说明。
 */

/** 工作稿残留词：正文出现即视为还没清成发布稿（draft.mjs 会硬拦）。 */
export const LEAK_WORDS = [
  '发布前必做清单',
  '必润色点',
  '标题（5 选 1）',
  'AI 代笔红线自检',
  '数据核实',
  '待你重算',
  '字数：',
  '字数:',
];

/** 公众号正文图硬门槛（官方：仅支持 JPG/PNG，单张 1M 以内，SVG 不支持）。 */
export const IMG_EXT_OK = new Set(['.jpg', '.jpeg', '.png']);
export const IMG_MAX_BYTES = 1024 * 1024;

/** AI 套话词表（写作门「无 AI 套话」检查项的准则）。 */
export const AI_WORDS = [
  '值得一提的是',
  '首先',
  '其次',
  '综上所述',
  '由此可见',
  '赋能',
  '闭环',
  '抓手',
  '助力',
  '打造',
  '在当今',
  '随着',
  '不可否认',
  '众所周知',
  '总的来说',
];

/**
 * 「假实测」表述：流程没有真实执行记录时，第一人称实测措辞一律拦截；
 * 改成「未实测，基于公开资料」。真跑过的稿件（有命令/输出/时间/环境）可豁免，
 * 所以 draft-check 里只作 warn，autopilot 场景（必然没跑过）升级为 blocker。
 */
export const FAKE_TEST_RE = /(我|我们)(实测|跑过|装过|试了|用了|亲测|跑了一遍)/;

/** 工作稿占位符：【待补】/【待作者补】/必润色点/方案 B/TODO。 */
export const PLACEHOLDER_RE = /【待补|【待作者补|必润色点|方案\s?B|TODO/;

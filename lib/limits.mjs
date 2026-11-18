/**
 * 标题 / 摘要 / 作者字数口径 —— 唯一真源。
 *
 * 为什么单独一个 .mjs：
 *   - 09-编辑部/scripts/draft-check.mjs 是独立 Node 脚本（ESM），要能直接 import；
 *   - Next/TS 侧（lib/quality.ts、lib/titles.ts、页面）也要 import 同一份。
 *   放在 06-工作台/lib/ 下，两边都够得着；JSON 会踩 import attributes 版本坑，故用 .mjs。
 *
 * 两套口径，不要混：
 *   模板口径（template）—— 编辑部自定的安全线，超了会被折叠 / 看着啰嗦；
 *   平台硬上限（platform）—— 微信接口拒收线，超了直接推不进去。
 * 平台硬上限不许改（核实于 2026-10-23，公众号后台「基本配置 → 开发者文档」）。
 */

export const LIMITS = {
  /** 模板口径：自定安全线。 */
  template: {
    title: 22,
    digest: 35,
  },
  /** 平台硬上限：接口拒收线，改这里等于改平台行为。 */
  platform: {
    title: 32,
    author: 16,
    digest: 120,
  },
};

/** 平台硬上限的展示文案（页面直接用，避免各处各写一份）。 */
export const LIMIT_LABEL = {
  template: '模板口径',
  platform: '平台硬上限',
};

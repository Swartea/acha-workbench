/**
 * 自主写稿的质量评审层（从 autopilot.ts 拆出）。
 *
 * autopilot.ts 是编排状态机（选题→研究→成稿→评审→返工→封面→落盘）。
 * 评审核心是纯函数：shape 结果由调用方注入（runShapeCheck 在 autopilot.ts，
 * 含子进程调用，质检页从 autopilot.ts 直接 import 复用）。
 */
import { LIMITS } from '../limits.mjs';
import type { ResearchResult, ResearchSource } from './research';

export interface Article {
  title: string;
  digest: string;
  body: string;
  sources: ResearchSource[];
  /** 相对 01-内容库/稿件 的封面路径；写进 frontmatter cover */
  cover?: string;
}

export interface ShapeCheck {
  score: number | null;
  verdict: string | null;
  blockers: string[];
  checks: Array<{ id: string; label: string; pass: boolean; detail: string; blocking?: boolean }>;
  chars: number | null;
}

export interface CheckResult {
  verdict: 'pass' | 'warn' | 'blocked';
  blockers: string[];
  warnings: string[];
  shape: ShapeCheck;
  checkedAt: string;
  /** 最后一版稿件的来源台账；随检查结果一起落库，供界面直接展示。 */
  sources?: ResearchSource[];
}

export function countCjk(s: string): number {
  return (s.match(/[\u4e00-\u9fa5]/g) || []).length;
}

/**
 * 正文硬数据抽取（FacTool 简化版，零模型调用）：百分比 / 金额 / 万亿次计数 /
 * 版本号 / 其余 ≥2 位数值。图片引用和裸 URL 先剥掉（路径里的时间戳不是数据），
 * 【图 N】【证据 N】占位符里的序号也不算。
 */
export function extractHardTokens(body: string): string[] {
  const text = body
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*\]\(https?:[^)]*\)/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/【图\s?\d[^】]*】|【证据\s?\d[^】]*】/g, ' ');
  const patterns = [
    /\d[\d,]*(?:\.\d+)?\s*%/g,
    /(?:\$|￥)\s?\d[\d,]*(?:\.\d+)?/g,
    /\d[\d,]*(?:\.\d+)?\s?(?:万|亿|[kKmM]\b)/g,
    /\b\d+\.\d+\.\d+\b/g,
    /\b\d{2,}(?:\.\d+)?\b/g,
  ];
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const re of patterns) {
    for (const m of text.match(re) || []) {
      const token = m.replace(/[\s,]/g, '');
      if (token && !seen.has(token)) {
        seen.add(token);
        tokens.push(token);
      }
    }
  }
  return tokens;
}

/**
 * claim 级核对：正文每个硬数据都要能溯源——台账（claim/quote/url）里有 → 过；
 * 研究材料里有但台账没登记 → 提醒补台账行；两边都没有 → 疑似编造，拦截。
 * 没有研究材料时跳过（无法核对，不误伤）。
 */
export function auditClaims(
  article: Article,
  research?: ResearchResult,
): { blockers: string[]; warnings: string[] } {
  const tokens = extractHardTokens(article.body);
  if (!tokens.length) return { blockers: [], warnings: [] };
  const ledger = article.sources
    .map((s) => `${s.claim} ${s.quote} ${s.url}`)
    .join('\n')
    .replace(/[\s,]/g, '');
  const material = (research?.markdown ?? '').replace(/[\s,]/g, '');
  const blockers: string[] = [];
  const warnings: string[] = [];
  for (const token of tokens) {
    if (ledger.includes(token)) continue;
    if (material && material.includes(token)) {
      warnings.push(`硬数据「${token}」在研究材料里有，但来源台账没登记，建议补台账行`);
    } else {
      blockers.push(
        `硬数据「${token}」在来源台账和研究材料里都找不到，疑似编造；删掉该数字或补可追溯来源`,
      );
    }
  }
  return { blockers, warnings };
}

/**
 * 评审核心（纯函数）：shape 由调用方注入（autopilot.runShapeCheck 或测试桩）。
 * 平台硬上限/占位符/假实测/证据位已下沉到写作门检查器；这里保留依赖
 * article 对象与研究材料才能判的项：模板口径提醒、900 字下限、来源台账、时间限定。
 */
export function evaluateArticleWithShape(
  article: Article,
  shape: ShapeCheck,
  research?: ResearchResult,
): CheckResult {
  const blockers: string[] = [...shape.blockers];
  const warnings: string[] = [];
  const title = article.title.trim();
  const digest = article.digest.trim();
  const body = article.body.trim();
  const chars = shape.chars ?? countCjk(body);
  const evidence = (body.match(/【图\s?[0-9]|【证据\s?[0-9]|!\[|^>\s*证据\s?[0-9]/gm) || []).length;

  // 平台硬上限（标题/摘要为空或超限）已下沉到 draft-check 的 frontmatter 检查项；
  // 这里只保留模板口径的安全线提醒（超线会被折叠/啰嗦，不拦稿）。
  if (title && title.length > LIMITS.template.title) {
    warnings.push(`标题 ${title.length} 字，超过模板 ${LIMITS.template.title} 字`);
  }
  if (digest && digest.length > LIMITS.template.digest) {
    warnings.push(`摘要 ${digest.length} 字，超过模板 ${LIMITS.template.digest} 字`);
  }
  if (chars < 900) blockers.push(`正文 ${chars} 字，少于 900 字`);
  if (chars > 3000) warnings.push(`正文 ${chars} 字，超过 3000 字`);
  if (evidence < 2) blockers.push(`证据位 ${evidence} 个，少于 2 个（【证据 N】/【图 N】/图片）`);

  if (article.sources.length < 2) blockers.push('来源少于 2 条');
  for (const s of article.sources) {
    if (!/^https?:\/\//i.test(s.url)) blockers.push(`来源缺少有效 URL：${s.claim.slice(0, 30)}`);
    if (!['S1', 'S2', 'S3'].includes(s.level)) blockers.push(`来源级别不合法：${s.claim.slice(0, 30)}`);
  }
  // 多源提醒（温和，不阻断）：全部台账指向同一域名时，提示补独立第二来源。
  // 单篇深度解读单一官方来源是合理形态，只提醒不拦稿。
  const hosts = new Set(
    article.sources.map((s) => {
      try {
        return new URL(s.url).host.replace(/^www\./, '');
      } catch {
        return s.url;
      }
    }),
  );
  if (article.sources.length >= 2 && hosts.size === 1) {
    warnings.push(
      `来源台账 ${article.sources.length} 条全部来自 ${[...hosts][0]}，关键事实建议回溯原始出处或补一个独立来源`,
    );
  }
  // 假实测：draft-check 只 warn（真跑过的稿件可豁免）；autopilot 流程必然没有真实
  // 执行记录，所以这里升级为 blocker。
  const fakeTest = shape.checks.find((c) => c.id === 'fake-test');
  if (fakeTest && !fakeTest.pass) {
    blockers.push('出现第一人称实测表述，但本次流程没有真实执行记录；改成「未实测，基于公开资料」');
  }
  const researchText = (research?.markdown ?? '').toLowerCase();
  const timeRules: Array<[RegExp, RegExp]> = [
    [/最后一周|上周/, /last week/],
    [/昨天/, /yesterday/],
    [/前天/, /the day before/],
    [/月初/, /early (this|the) month/],
    [/月底/, /end of (the|this) month/],
  ];
  for (const sentence of body.match(/[^。\n]*(最后一周|上周|昨天|前天|月初|月底)[^。\n]*/g) || []) {
    for (const [cn, en] of timeRules) {
      if (cn.test(sentence) && !en.test(researchText) && !cn.test(researchText)) {
        blockers.push(`时间限定缺少来源支持：「${sentence.trim().slice(0, 50)}」`);
        break;
      }
    }
  }

  // claim 级核对（有研究材料才做；无材料时无法核对，不误伤）
  if (research) {
    const claimAudit = auditClaims(article, research);
    blockers.push(...claimAudit.blockers);
    warnings.push(...claimAudit.warnings);
  }

  const unique = [...new Set(blockers)];
  const verdict: CheckResult['verdict'] = unique.length ? 'blocked' : warnings.length ? 'warn' : 'pass';
  return { verdict, blockers: unique, warnings, shape, checkedAt: new Date().toISOString() };
}

import { LIMITS } from './limits.mjs';
export type TitleStatus = 'candidate' | 'chosen' | 'archived' | 'killed';

export interface TitleInput {
  article_id: string;
  text: string;
  formula: string;
  hook: string;
  digest: string;
  info: number;
  curiosity: number;
  trust: number;
  search: number;
  safe: number;
  note: string;
}

export interface TitleRow extends TitleInput {
  id: number;
  score: number;
  status: TitleStatus;
  votes: number;
  created_at: string;
  updated_at: string;
}

export const STATUS_LABEL: Record<TitleStatus, string> = {
  candidate: '候选',
  chosen: '已选定',
  archived: '归档',
  killed: '不可推',
};

export const DIMS = [
  { key: 'info', label: '信息', hint: '一眼能看出讲什么' },
  { key: 'curiosity', label: '好奇', hint: '想不想点开' },
  { key: 'trust', label: '可信', hint: '像人不像营销号' },
  { key: 'search', label: '搜索', hint: '搜一搜能不能找到' },
  { key: 'safe', label: '合规', hint: '不碰绝对化与引战' },
] as const;

export const FORMULAS = [
  { id: 'f1', name: '数字代价', shape: '数字 + 代价', sample: '4 家 AI 编程工具，账单最多差 50%' },
  { id: 'f2', name: '决策清单', shape: '动作 + 问题数', sample: '选 AI 编程工具前，先回答这 3 个问题' },
  { id: 'f3', name: '场景差异', shape: '场景 + 差异', sample: '同一件活，4 家 AI 编程工具差在哪' },
  { id: 'f4', name: '反直觉', shape: '否定常识 + 前提', sample: '自托管不等于不出网：选 AI 编程工具前必须知道' },
  { id: 'f5', name: '身份', shape: '人群 + 动作', sample: '独立开发者怎么选 AI 编程工具：先算三笔账' },
  { id: 'f6', name: '搜索型', shape: '年份 + 品类 + 怎么选', sample: '2026 年 AI Agent 工具栈怎么选' },
  { id: 'f7', name: '时间承诺', shape: '时长 + 结果', sample: '30 秒选对 AI 编程工具：三个问题就够' },
  { id: 'f8', name: '全景数字', shape: '品类 + 数量 + 一张图', sample: 'AI 编程工具怎么选？一张图看完 17 个' },
] as const;

export const BRANDS = [
  'Claude Code',
  'Claude',
  'Codex',
  'Cursor',
  'Hermes',
  'Copilot',
  'Antigravity',
  'Windsurf',
  'Aider',
  'OpenHands',
  'Cline',
  'Continue',
  'Gemini',
  'GPT',
];

export const ABSOLUTE_WORDS = [
  '最强',
  '最好',
  '最佳',
  '第一',
  '唯一',
  '震惊',
  '千万别',
  '必看',
  '绝对',
  '史上',
  '彻底',
  '完美',
];

export const COVER_LOCK = {
  locked: true,
  file: '03-生产工具/figures/a1-v3/cover.html',
  image: '01-内容库/稿件/素材/A1配图V3/a1-v3-cover-wide.jpg',
  note: 'V3 封面把 18 字标题烤进了图里，换标题必须重绘，否则图文不一致。',
};

export const SEED_TITLES: Array<Partial<TitleInput> & { text: string; status: TitleStatus }> = [
  {
    text: '4 家 AI 编程工具，账单最多差 50%',
    formula: '数字代价',
    hook: '账单差 50%',
    digest: '同一件活，四条路线：钱、隐私、上手成本，一次说清。',
    info: 5,
    curiosity: 5,
    trust: 5,
    search: 3,
    safe: 5,
    status: 'candidate',
    note: '主推：冷启动首选。⚠ 钩子要钉死到档位（$20 与 $30），别和 $100 档混比',
  },
  {
    text: '三个人的 AI 编程账单：$0、$28、$100+',
    formula: '数字代价',
    status: 'candidate',
    note: '好奇强，但三个价格略密',
  },
  {
    text: '2026 年 AI 编程工具：4 家、3 笔账、1 个结论',
    formula: '数字代价',
    status: 'candidate',
    note: '信息密度高，可能被折',
  },
  {
    text: '2026 年 AI Agent 工具栈怎么选',
    formula: '搜索型',
    hook: '2026 AI Agent 工具栈',
    digest: '同样用上 Claude，两档差 50%：钱、隐私、上手成本，一次说清。',
    info: 4,
    curiosity: 3,
    trust: 5,
    search: 5,
    safe: 5,
    status: 'candidate',
    note: '现标题，搜索最稳但没钩子。⚠ 原摘要 37 字超模板 35 上限，已换成压缩版',
  },
  {
    text: 'Claude Code、Codex、Cursor、Hermes 怎么选',
    formula: '搜索型',
    status: 'killed',
    note: '35 字，超硬上限，接口拒收',
  },
  {
    text: 'AI 编程工具怎么选：Codex / Claude Code / Cursor 对比',
    formula: '搜索型',
    status: 'killed',
    note: '42 字，超硬上限，接口拒收',
  },
  {
    text: 'Claude Code vs Codex vs Cursor：2026 横评',
    formula: '搜索型',
    status: 'killed',
    note: '38 字，超硬上限，接口拒收',
  },
  {
    text: '选 AI 编程工具前，先回答这 3 个问题',
    formula: '决策清单',
    hook: '3 个问题',
    digest: '钱、隐私、上手成本：三个问题问完，该用哪家自己就出来了。',
    info: 4,
    curiosity: 4,
    trust: 5,
    search: 4,
    safe: 5,
    status: 'candidate',
    note: '决策型，完读友好，适合做系列第二篇',
  },
  {
    text: '30 秒选对 AI 编程工具：三个问题就够',
    formula: '时间承诺',
    info: 4,
    curiosity: 4,
    trust: 4,
    search: 4,
    safe: 4,
    status: 'candidate',
    note: '承诺具体，和正文三问一致',
  },
  {
    text: 'AI 编程工具怎么选？一张图看完 17 个',
    formula: '全景数字',
    status: 'candidate',
    note: '和图库全景图联动',
  },
  {
    text: '自托管不等于不出网：选 AI 编程工具前必须知道',
    formula: '反直觉',
    status: 'candidate',
    note: '反直觉强，但「自托管」偏圈内',
  },
  {
    text: '免费档不等于能用：三家 AI 编程工具的隐藏门槛',
    formula: '反直觉',
    status: 'candidate',
    note: '痛点多，指向明确',
  },
  {
    text: '同一件活，4 家 AI 编程工具差在哪',
    formula: '场景差异',
    status: 'candidate',
    note: '好奇，弱关键词',
  },
  {
    text: '独立开发者怎么选 AI 编程工具：先算三笔账',
    formula: '身份',
    status: 'candidate',
    note: '身份 + 动作',
  },
  {
    text: '3 万行老项目，4 家 AI 编程工具怎么分工',
    formula: '场景差异',
    status: 'candidate',
    note: '场景具体，略长',
  },
  {
    text: '不想把代码交出去的人，AI 编程工具只剩一条路',
    formula: '立场',
    status: 'candidate',
    note: '立场强，略绝对',
  },
  {
    text: '2026 年 AI 编程工具怎么选：4 家的账单差 50%',
    formula: '数字代价',
    hook: '账单差 50%',
    digest: '同一件活，四条路线：钱、隐私、上手成本，一次说清。',
    info: 5,
    curiosity: 4,
    trust: 5,
    search: 5,
    safe: 5,
    status: 'candidate',
    note: '评分最高但 29 字，折叠会切掉钩子',
  },
  {
    text: '别再问哪个 AI 编程工具最强了',
    formula: '反直觉',
    status: 'candidate',
    note: '反问，信息量弱',
  },
];

export function titleScore(t: {
  info: number;
  curiosity: number;
  trust: number;
  search: number;
  safe: number;
}): number {
  return t.info + t.curiosity + t.trust + t.search + t.safe;
}

export function countChars(text: string): number {
  return Array.from(text.trim()).length;
}

export function brandHits(text: string): string[] {
  const hits: string[] = [];
  const lower = text.toLowerCase();
  for (const b of BRANDS) {
    if (lower.includes(b.toLowerCase())) hits.push(b);
  }
  return hits;
}

export function absoluteHits(text: string): string[] {
  return ABSOLUTE_WORDS.filter((w) => text.includes(w));
}

function longestCommon(a: string, b: string): number {
  if (!a || !b) return 0;
  const arr = Array.from(a);
  const brr = Array.from(b);
  const dp: number[] = new Array(brr.length + 1).fill(0);
  let best = 0;
  for (let i = 1; i <= arr.length; i += 1) {
    let prev = 0;
    for (let j = 1; j <= brr.length; j += 1) {
      const tmp = dp[j];
      if (arr[i - 1] === brr[j - 1]) {
        dp[j] = prev + 1;
        if (dp[j] > best) best = dp[j];
      } else {
        dp[j] = 0;
      }
      prev = tmp;
    }
  }
  return best;
}

export interface TitleFlag {
  level: 'bad' | 'warn' | 'info';
  label: string;
}

export interface TitleAudit {
  chars: number;
  band: 'ok' | 'fold' | 'reject';
  brands: string[];
  absolutes: string[];
  hookAtTail: boolean;
  hasNumber: boolean;
  digestClash: number;
  flags: TitleFlag[];
}

export function auditTitle(text: string, digest = ''): TitleAudit {
  const chars = countChars(text);
  const band: TitleAudit['band'] = chars > LIMITS.platform.title ? 'reject' : chars > LIMITS.template.title ? 'fold' : 'ok';
  const brands = brandHits(text);
  const absolutes = absoluteHits(text);
  const flags: TitleFlag[] = [];

  const numMatches = Array.from(text.matchAll(/[0-9]+%?|\$[0-9]+/g));
  const hasNumber = numMatches.length > 0;
  const last = numMatches[numMatches.length - 1];
  const hookAtTail = !!last && last.index !== undefined && (last.index + last[0].length) / chars > 0.6;

  if (band === 'reject') {
    flags.push({ level: 'bad', label: `${chars} 字，超平台硬上限 ${LIMITS.platform.title}，接口拒收` });
  }
  if (band === 'fold') {
    flags.push({ level: 'warn', label: `${chars} 字，列表页可能折叠` });
    if (hookAtTail) {
      flags.push({ level: 'warn', label: '钩子在尾部，折叠会切掉' });
    }
  }
  if (brands.length >= 3) {
    flags.push({
      level: brands.length > 4 ? 'bad' : 'warn',
      label: `堆了 ${brands.length} 个品牌词，字数必爆`,
    });
  }
  if (absolutes.length) {
    flags.push({ level: 'warn', label: `绝对化用语：${absolutes.join('、')}` });
  }
  if (band === 'ok' && !hasNumber) {
    flags.push({ level: 'info', label: '没有数字钩子' });
  }

  const clash = digest ? longestCommon(text, digest) : 0;
  if (clash >= 6) {
    flags.push({ level: 'warn', label: `摘要与标题撞车（${clash} 字重合）` });
  }

  return {
    chars,
    band,
    brands,
    absolutes,
    hookAtTail,
    hasNumber,
    digestClash: clash,
    flags,
  };
}

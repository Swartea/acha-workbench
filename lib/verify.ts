import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * 核实台账：把「写作包里的素材/来源」和「稿件里的数字」对起来。
 *
 * 为什么是确定性解析而不是让模型去核：
 * - 这个项目的红线是「数据必须标来源 + 核对日期」「没查到就写未核实」；
 * - 模型能写「已核实」，但它没有核对能力，写出来的只是句子；
 * - 所以这里只做三件可验证的事：抽出素材、算出新鲜度、反过来查稿件里的裸数字。
 * 判断哪条算数、哪条要重查，仍归人。
 */

export type ClaimKind = 'price' | 'version' | 'count' | 'date' | 'quote' | 'other';
export type ClaimStatus = 'fresh' | 'stale' | 'unchecked';

export const KIND_LABEL: Record<ClaimKind, string> = {
  price: '价格',
  version: '版本',
  count: '数字',
  date: '日期',
  quote: '引语',
  other: '其他',
};

/**
 * 各类数据的新鲜期（天）。超过就标「过期」，提醒发前重查。
 * 价格类按项目纪律是「发前 5 分钟必查」，这里给 3 天已经很松；
 * 页面会单独提示价格必须发前再查一次。
 */
export const STALE_DAYS: Record<ClaimKind, number> = {
  price: 3,
  version: 14,
  count: 21,
  date: 90,
  quote: 180,
  other: 180,
};

export interface PackageClaim {
  /** 稳定键：articleId + 规范化素材文本的 sha1，素材文本没改就不会变 */
  key: string;
  no: string;
  text: string;
  source: string;
  /** 写作包「核实 / 级别 / 可信」列原文 */
  note: string;
  kind: ClaimKind;
  /** 行内写明的核实日期；没有就用写作包的包级实拉日期 */
  checkedAt: string;
  dateOrigin: 'row' | 'package' | '';
  /** 素材本身已标「未核实 / 待核实」——不能当事实用 */
  flaggedUnverified: boolean;
  section: string;
  line: number;
}

export interface ClaimCheckRow {
  article_id: string;
  claim_key: string;
  checked_at: string | null;
  trust: string | null;
  note: string | null;
}

export interface ClaimState {
  status: ClaimStatus;
  ageDays: number | null;
  checkedAt: string;
  trust: string;
  note: string;
  humanChecked: boolean;
}

export interface ManuscriptFact {
  value: string;
  norm: string;
  kind: ClaimKind;
  line: number;
  context: string;
  /** 这一行自己写着「未核实」——提醒它只能当边界，不能当事实 */
  selfUnverified: boolean;
  /** 台账里有没有这条 */
  covered: boolean;
}

export function todayStr(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

export function normalizeClaim(s: string): string {
  return s.replace(/[，,\s]/g, '').toLowerCase();
}

/** 核对记录的稳定键：sha256 截 16 位（2026-11-19 起；此前为 sha1，表内无存量行，直接换算法）。 */
export function claimKey(articleId: string, text: string): string {
  return crypto.createHash('sha256').update(articleId + '::' + normalizeClaim(text)).digest('hex').slice(0, 16);
}

/** 只按文本特征分类，不猜内容。顺序即优先级：价格 > 版本 > 日期 > 数字 > 引语。 */
export function classifyClaim(text: string): ClaimKind {
  if (/[¥￥＄$]\s?\d|\d[\d,.]*\s*(?:元|美元)|\/(?:月|年)\s*(?:订阅|付费)?|定价|价格|收费|订阅费|免费额度/.test(text)) {
    return 'price';
  }
  if (/\bv\d+(?:\.\d+){1,3}\b/i.test(text) || /\b\d+(?:\.\d+){2,3}\b/.test(text) || /版本/.test(text)) {
    return 'version';
  }
  if (
    /\d+(?:\.\d+)?\s*%/.test(text) ||
    /★\s?\d[\d,]*/.test(text) ||
    /\d[\d,.]*\s*(?:万|亿|千|k|K|star|★|用户|下载|安装|次|条|倍|行|人)/.test(text) ||
    /\d+(?:\.\d+)?\s?[Bb]\b/.test(text)
  ) {
    return 'count';
  }
  if (/\b20\d{2}-\d{2}-\d{2}\b/.test(text)) return 'date';
  if (/[「」“”]/.test(text)) return 'quote';
  return 'other';
}

function splitRow(line: string): string[] {
  const t = line.trim();
  const inner = t.startsWith('|') ? t.slice(1) : t;
  const noTail = inner.endsWith('|') ? inner.slice(0, -1) : inner;
  return noTail.split('|').map((c) => c.trim());
}

const isTableRow = (line: string) => /^\s*\|/.test(line);
const isSeparator = (cells: string[]) => cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c.replace(/\s/g, '')));

function cellDate(s: string): string {
  const m = s.match(/(20\d{2})-(\d{2})-(\d{2})/);
  return m ? m[1] + '-' + m[2] + '-' + m[3] : '';
}

/** 写作包的包级实拉日期：本轮实拉时间 / 核实时间 / frontmatter 的 updated、created。 */
export function packagePullDate(md: string): string {
  const inline = md.match(/(?:本轮实拉时间|实拉时间|核实时间|数据核对)[：:]\s*(20\d{2}-\d{2}-\d{2})/);
  if (inline) return inline[1];
  const fm = md.match(/^updated:\s*(20\d{2}-\d{2}-\d{2})/m) ?? md.match(/^created:\s*(20\d{2}-\d{2}-\d{2})/m);
  return fm ? fm[1] : '';
}

/**
 * 解析写作包里的「素材表」。
 * 只认表头同时含「素材」和「来源」的表——别的表（大纲、标题候选）不是素材。
 */
export function parsePackageClaims(articleId: string, md: string): PackageClaim[] {
  const lines = md.split(/\r?\n/);
  const pullDate = packagePullDate(md);
  const out: PackageClaim[] = [];
  let section = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const h = line.match(/^#{2,4}\s+(.+?)\s*$/);
    if (h) {
      section = h[1].replace(/[#*`]/g, '').trim().slice(0, 40);
      continue;
    }
    if (!isTableRow(line)) continue;

    const header = splitRow(line);
    const iMat = header.findIndex((c) => c.includes('素材'));
    const iSrc = header.findIndex((c) => c.includes('来源'));
    if (iMat === -1 || iSrc === -1) continue;
    const iNo = header.findIndex((c) => /^#|序号/.test(c));
    const iChk = header.findIndex((c) => /核实|级别|可信/.test(c));

    for (let j = i + 1; j < lines.length; j++) {
      const row = lines[j];
      if (!isTableRow(row)) break;
      const cells = splitRow(row);
      if (isSeparator(cells)) continue;
      if (cells.length < Math.max(iMat, iSrc) + 1) continue;

      const text = (cells[iMat] ?? '').trim();
      if (!text || /^素材$/.test(text)) continue;
      const source = (cells[iSrc] ?? '').trim();
      const note = iChk >= 0 ? (cells[iChk] ?? '').trim() : '';
      // 只认「核实」列里的日期；素材正文里的日期是事实本身的日期，不是核对日期。
      const rowDate = cellDate(note);
      const checkedAt = rowDate || pullDate;
      const hay = text + ' ' + note;
      out.push({
        key: claimKey(articleId, text),
        no: iNo >= 0 ? (cells[iNo] ?? '').trim() : '',
        text,
        source,
        note,
        kind: classifyClaim(text),
        checkedAt,
        dateOrigin: rowDate ? 'row' : pullDate ? 'package' : '',
        flaggedUnverified: /未核实|未逐一核实|待核实|没有核实|没核实/.test(hay),
        section,
        line: j + 1,
      });
      i = j;
    }
  }
  return out;
}

function inferTrust(c: PackageClaim): string {
  if (c.flaggedUnverified) return '未核实';
  if (/⚠️|存疑|风险/.test(c.note)) return '存疑';
  if (/✅|实拉|官方原文|官方口径|实测/.test(c.note)) return '包内标注';
  return '未标注';
}

/** 一条素材当前算新鲜、过期，还是压根没核过。人工核对记录优先于写作包里的标注。 */
export function claimState(c: PackageClaim, check?: ClaimCheckRow, today = todayStr()): ClaimState {
  const humanChecked = !!check?.checked_at;
  const checkedAt = (check?.checked_at ?? '') || c.checkedAt;
  const trust = check?.trust || inferTrust(c);
  const note = check?.note || c.note;
  if (!checkedAt) return { status: 'unchecked', ageDays: null, checkedAt: '', trust, note, humanChecked };
  if (!humanChecked && c.flaggedUnverified) {
    return { status: 'unchecked', ageDays: null, checkedAt, trust, note, humanChecked };
  }
  const age = daysBetween(checkedAt, today);
  if (age === null) return { status: 'unchecked', ageDays: null, checkedAt, trust, note, humanChecked };
  const status: ClaimStatus = age > STALE_DAYS[c.kind] ? 'stale' : 'fresh';
  return { status, ageDays: age, checkedAt, trust, note, humanChecked };
}

export function daysBetween(from: string, to: string): number | null {
  const a = Date.parse(from + 'T00:00:00');
  const b = Date.parse(to + 'T00:00:00');
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

/** 把「204.5 万」「24,200 次」「¥199」这类值折成一个数，用来跨单位对撞。 */
export function parseAmount(s: string): number | null {
  const m = s.replace(/[，,]/g, '').match(/(\d+(?:\.\d+)?)\s*(万|亿|千|k|K)?/);
  if (!m) return null;
  const base = Number(m[1]);
  if (!Number.isFinite(base)) return null;
  return base * unitMultiplier(m[2]);
}

function unitMultiplier(unit: string | undefined): number {
  if (unit === '万') return 1e4;
  if (unit === '亿') return 1e8;
  if (unit === '千' || unit === 'k' || unit === 'K') return 1e3;
  return 1;
}

/** 台账侧的索引：原文（去空格逗号）+ 里面出现过的所有数值（带单位换算）。 */
function seedIndex(claims: PackageClaim[]) {
  return claims.map((c) => {
    const text = normalizeClaim(c.text) + ' ' + normalizeClaim(c.source);
    const nums: number[] = [];
    const re = /(\d+(?:\.\d+)?)\s*(万|亿|千|k|K)?/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) nums.push(Number(m[1]) * unitMultiplier(m[2]));
    return { text, nums };
  });
}

/** 稿件里的这个数，台账里有没有：先比原文，再比数值（跨单位）。 */
function isCovered(
  kind: ClaimKind,
  norm: string,
  value: string,
  seeds: Array<{ text: string; nums: number[] }>,
): boolean {
  if (seeds.some((s) => s.text.includes(norm))) return true;
  if (kind !== 'price' && kind !== 'count') return false;
  const v = parseAmount(value);
  if (v === null || Math.abs(v) < 100) return false;
  const tol = Math.max(1, Math.abs(v) * 0.001);
  return seeds.some((s) => s.nums.some((n) => Math.abs(n - v) <= tol));
}

const PATTERNS: Array<{ kind: ClaimKind; re: RegExp }> = [
  { kind: 'price', re: /[¥￥＄$]\s?\d[\d,]*(?:\.\d+)?/g },
  { kind: 'price', re: /\d[\d,]*(?:\.\d+)?\s*(?:元|美元)/g },
  { kind: 'version', re: /\bv\d+(?:\.\d+){1,3}\b/gi },
  { kind: 'version', re: /\b\d+(?:\.\d+){2,3}\b/g },
  { kind: 'date', re: /\b20\d{2}-\d{2}-\d{2}\b/g },
  { kind: 'count', re: /\d[\d,]*(?:\.\d+)?\s*%/g },
  { kind: 'count', re: /\d[\d,]*(?:\.\d+)?\s*(?:万|亿|千|k|K)\s*(?:star|★)?/g },
  { kind: 'count', re: /\d[\d,]*\s*(?:[个名位]\s*)?(?:star|★)/gi },
  { kind: 'count', re: /★\s?\d[\d,]*/g },
  { kind: 'count', re: /\d[\d,]*(?:\.\d+)?\s*(?:万|亿)?\s*(?:用户|下载|安装|次|条|倍|行|人)/g },
];

/**
 * 从稿件里抽「会被读者当事实」的数字。
 * 只抽能和台账对上的几类（价格/版本/日期/计数），引语和主观判断留给写作门。
 */
export function parseManuscriptFacts(md: string, claims: PackageClaim[] = []): ManuscriptFact[] {
  const lines = md.split(/\r?\n/);
  const seen = new Set<string>();
  const out: ManuscriptFact[] = [];
  const seeds = seedIndex(claims);

  // 跳过 frontmatter：只认文件开头的 --- 块，别把正文里的分割线当开关。
  let start = 0;
  if (/^---\s*$/.test(lines[0] ?? '')) {
    const close = lines.findIndex((l, idx) => idx > 0 && /^---\s*$/.test(l));
    if (close > 0) start = close + 1;
  }

  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    if (/^!\[/.test(line.trim())) continue;

    for (const { kind, re } of PATTERNS) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(line)) !== null) {
        const value = m[0].trim();
        const norm = normalizeClaim(value).replace(/^v/, '');
        if (!norm || seen.has(kind + '|' + norm)) continue;
        seen.add(kind + '|' + norm);
        const covered = isCovered(kind, norm, value, seeds);
        out.push({
          value,
          norm,
          kind,
          line: i + 1,
          context: line.trim().slice(0, 120),
          selfUnverified: /未核实|未核对|没核实|待核实/.test(line),
          covered,
        });
      }
    }
  }
  return out;
}

export interface VerifySummary {
  total: number;
  fresh: number;
  stale: number;
  unchecked: number;
  flagged: number;
  uncovered: number;
  selfUnverified: number;
}

export function summarize(states: ClaimState[], facts: ManuscriptFact[]): VerifySummary {
  return {
    total: states.length,
    fresh: states.filter((s) => s.status === 'fresh').length,
    stale: states.filter((s) => s.status === 'stale').length,
    unchecked: states.filter((s) => s.status === 'unchecked').length,
    flagged: states.filter((s) => s.trust === '未核实').length,
    uncovered: facts.filter((f) => !f.covered).length,
    selfUnverified: facts.filter((f) => f.selfUnverified).length,
  };
}

/** 找某篇的写作包：文件名以「写作包 - A11 」开头；A1 不会误配 A11/A10。 */
export function findPackageFile(articleId: string, libDir: string): string | null {
  if (!fs.existsSync(libDir)) return null;
  const re = new RegExp('^写作包\\s*-\\s*' + articleId + '(?!\\d)');
  const hit = fs
    .readdirSync(libDir)
    .filter((f) => f.endsWith('.md') && re.test(f))
    .sort()
    .pop();
  return hit ? path.join(libDir, hit) : null;
}

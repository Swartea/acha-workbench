import fs from 'node:fs';
import path from 'node:path';
import {
  KANBAN_FILE,
  LIB,
  MANUSCRIPT_DIR,
  MATERIAL_DIR,
  PLAN_FILE,
  SKILL_FILE,
  TOPIC_FILE,
} from './paths';
import { latestPublications, listCurrentFiles, listReviewArticleIds } from './db';
import { RADAR_LOG_FILE_RE } from './folo-core';

export type Priority = 'P0' | 'P1' | 'P2' | '—';

export const STEP_LABELS = [
  '选题',
  '大纲',
  '素材',
  '草稿',
  '配图',
  '排版',
  '发布',
  '复盘',
  '更新选题库',
] as const;

export const STEP_GATES = [
  '三问全过 + 来源级别已标',
  '五段大纲 + 配图位 + 真人实测位置已标',
  '每条素材带来源与核实日期',
  '机器检查无阻断项（draft-check）+ 来源台账齐',
  '有实测至少 1 张真截图',
  '标题 ≤22（模板）/≤32（平台）· 摘要 ≤35（模板）/≤120（平台）/ 自检清单过',
  '发布日定向快检零变动',
  '24h / 72h 数据回填',
  '「3 个数字 + 1 条选题调整」落库',
] as const;

/** 九步流水线里用到的产物事实（纯数据，方便单测）。 */
export interface StepFacts {
  /** 有写作包 */
  hasPackage: boolean;
  /** 有配图目录 */
  hasFigures: boolean;
  /** 有草稿 / 待审稿 */
  hasDraft: boolean;
  /** 有推送版 */
  hasPush: boolean;
  /** 作者登记过「已发表」 */
  published: boolean;
  /** 复盘表里有这个选题的记录 */
  reviewed: boolean;
}

/**
 * 九步流水线的步数 —— 全站唯一算法。
 *
 * 前六步按文件产物推；第七步「发布」看发布登记；第八步「复盘」看复盘表。
 * 第九步「更新选题库」不自动推进 —— 那是人写的动作，机器不替人宣布做完。
 */
export function computeStep(f: StepFacts): number {
  let step = 1;
  if (f.hasPackage) step = 3;
  if (f.hasDraft) step = Math.max(step, 4);
  if (f.hasFigures) step = Math.max(step, 5);
  if (f.hasPush) step = Math.max(step, 6);
  if (f.published) step = f.reviewed ? 8 : 7;
  return step;
}

/** 某个选题当前生效的稿件（指针或默认挑选结果）。 */
export interface CurrentFile {
  /** 文件名（在 稿件/ 目录下） */
  file: string;
  /** 绝对路径 */
  path: string;
  label: string;
  kind: Manuscript['kind'];
  date?: string;
  /** true = 作者显式钉过；false = 默认挑的 */
  pinned: boolean;
}

export interface Topic {
  id: string;
  title: string;
  priority: Priority;
  stars: number;
  hasPackage: boolean;
  packageDate?: string;
  hasDraft: boolean;
  hasFigures: boolean;
  hasPush: boolean;
  step: number;
  stage: string;
  /** 作者登记过已发表 */
  published: boolean;
  /** 复盘表里有这个选题 */
  reviewed: boolean;
  /** 最近一条发布登记的发表日期 */
  publishedAt: string | null;
  /** 最近一条发布登记指向的文件 */
  publishedFile: string | null;
  /** 当前稿 */
  currentFile: CurrentFile | null;
}

export interface Manuscript {
  /** 编号稿 = A数字；未编号稿 = U:<文件名去扩展名> */
  id: string;
  file: string;
  label: string;
  kind: 'push' | 'review' | 'preview' | 'draft';
  date?: string;
  isHtml: boolean;
  /** true = 「稿件 - A数字」编号稿；false = 未编号稿（随笔 / 贴图版等） */
  numbered: boolean;
}

export interface ScheduleItem {
  order: number;
  id: string;
  title?: string;
}

export interface StatusRow {
  label: string;
  state: string;
}

export interface GroupStatus {
  id: string;
  numbered: boolean;
  published: boolean;
  reviewed: boolean;
  publishedAt: string | null;
  publishedFile: string | null;
  step: number;
  stage: string;
  currentFile: CurrentFile | null;
}

export interface WorkspaceState {
  topics: Topic[];
  manuscripts: Manuscript[];
  /** 每个稿件分组（选题编号或未编号稿 id）的当前稿 */
  current: Record<string, CurrentFile>;
  /** 编号选题 + 未编号稿件的步数 / 发表状态（与 topics 同源算法） */
  groups: Record<string, GroupStatus>;
  radarDates: string[];
  weekly: string[];
  skillCount: number | null;
  kanban: { action: string; updated: string; statusRows: StatusRow[] };
  schedule: ScheduleItem[];
  planRange: string;
  a1: { qaTotal: number; counts: Record<string, number> };
  stats: {
    topicCount: number;
    p0: number;
    packageCount: number;
    manuscriptCount: number;
    radarCount: number;
    weeklyCount: number;
    skillCount: number | null;
  };
  scannedAt: string;
}

function readText(p: string): string {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return '';
  }
}

function cleanInline(s: string): string {
  return s
    .replace(/📌/g, '')
    .replace(/\*\*/g, '')
    .replace(/^>\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function listFiles(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isFile())
      .map((d) => d.name);
  } catch {
    return [];
  }
}

function listDirs(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
}

function detectPriority(block: string): Priority {
  const m = block.match(/(🔴|🟡|🟢)\uFE0F?\s*P([0-2])/);
  if (m) return `P${m[2]}` as Priority;
  const m2 = block.match(/P([0-2])(?![\d])/);
  return m2 ? (`P${m2[1]}` as Priority) : '—';
}

function cleanTopicTitle(raw: string): string {
  return raw
    .replace(/⭐/g, ' ')
    .replace(/[🔴🟡🟢🔵]\uFE0F?/g, ' ')
    .replace(/\*\*/g, '')
    .replace(/(^|\s)P[0-2](?=\s|$)/g, ' ')
    .replace(/（\d{4}-\d{2}-\d{2}[^）]*）/g, ' ')
    .replace(/（[^）]{0,40}(?:核实|入库|升级|转正|直接相关|本项目)[^）]{0,40}）/g, ' ')
    .replace(/（[^A-Za-z0-9（）]{0,14}）/g, ' ')
    .replace(/(^|\s)P[0-2](?=\s|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseTopics(md: string): Topic[] {
  const lines = md.split(/\r?\n/);
  const found: Array<{ id: string; title: string; stars: number; block: string }> = [];
  let cur: { id: string; title: string; stars: number; buf: string[] } | null = null;

  const flush = () => {
    if (cur) found.push({ ...cur, block: cur.buf.join('\n') });
    cur = null;
  };

  for (const line of lines) {
    const topic = line.match(/^#{2,3}\s+选题\s+(A\d+)\s*[—–-]\s*(.+?)\s*$/);
    if (topic) {
      flush();
      const stars = (topic[2].match(/⭐/g) || []).length;
      const title = cleanTopicTitle(topic[2]);
      cur = { id: topic[1], title, stars, buf: [] };
      continue;
    }
    if (/^##\s/.test(line)) {
      flush();
      continue;
    }
    if (cur) cur.buf.push(line);
  }
  flush();

  const dedup = new Map<string, (typeof found)[number]>();
  for (const f of found) if (!dedup.has(f.id)) dedup.set(f.id, f);

  return [...dedup.values()].map((f) => ({
    id: f.id,
    title: f.title,
    priority: detectPriority(f.block),
    stars: f.stars,
    step: 1,
    stage: STEP_LABELS[0],
    hasPackage: false,
    hasDraft: false,
    hasFigures: false,
    hasPush: false,
    published: false,
    reviewed: false,
    publishedAt: null,
    publishedFile: null,
    currentFile: null,
  }));
}

/**
 * 非正文文件（按文件名 / 前缀判断）。
 * 这些不是稿子：排期用的内容规划、交接用的交接单、作者批注、校对稿。
 * 它们不该进质检、不该能被登记成发布、不该被钉成当前稿。
 */
export const NON_BODY_MARKERS = ['内容规划', '交接单', '作者意见', '校对'];

/** 判断某个文件名是不是非正文文件。 */
export function isNonBodyFile(name: string): boolean {
  return NON_BODY_MARKERS.some((k) => name.includes(k));
}

/** 从文件名尾部抠出日期（- 2026-10-26 这种）。 */
function splitDate(rest: string): { label: string; date?: string } {
  const m = rest.match(/^(.*?)\s*-\s*(\d{4}-\d{2}-\d{2})(?:-\d+)?$/);
  if (!m) return { label: rest.trim() };
  return { label: m[1].trim(), date: m[2] };
}

/** 按文件名猜稿件类型（推送版 / 待审 / 预览 / 草稿）。 */
function guessKind(label: string): Manuscript['kind'] {
  if (/推送版/.test(label)) return 'push';
  if (/待审/.test(label)) return 'review';
  if (/预览/.test(label)) return 'preview';
  return 'draft';
}

/**
 * 列出稿件目录下的稿子。
 *
 * 两类都收：
 *   1) 编号稿 ——「稿件 - A数字 ……」（push / review / preview / draft）；
 *   2) 未编号稿 —— 直接躺在 稿件/ 下的其它 md / html（随笔、贴图版等）。
 *
 * 只看当前层，不递归子目录（listFiles 本身就是 files-only，素材/ 不会进来）。
 * 非正文文件（内容规划 / 交接单 / 作者意见 / 校对）排除在外。
 *
 * @param dir 稿件目录；单测传临时目录即可，不依赖 process.cwd()。
 */
export function parseManuscripts(dir: string = MANUSCRIPT_DIR): Manuscript[] {
  const out: Manuscript[] = [];
  for (const name of listFiles(dir)) {
    if (!/\.(md|html)$/i.test(name)) continue;

    const m = name.match(/^稿件\s*-\s*(A\d+)\s+(.+?)\.(md|html)$/);
    if (m) {
      const { label, date } = splitDate(m[2]);
      out.push({
        id: m[1],
        file: name,
        label,
        kind: guessKind(label),
        date,
        isHtml: m[3].toLowerCase() === 'html',
        numbered: true,
      });
      continue;
    }

    if (isNonBodyFile(name)) continue;

    // 未编号正文稿：id 用 U: 前缀，避免和 A数字 撞车
    const stem = name.replace(/\.(md|html)$/i, '');
    const { label, date } = splitDate(stem);
    out.push({
      id: `U:${stem}`,
      file: name,
      label,
      kind: guessKind(label),
      date,
      isHtml: /\.html$/i.test(name),
      numbered: false,
    });
  }
  return out;
}

/** 按稿件 id 分组（编号稿按选题，未编号稿自成一组）。 */
export function groupManuscripts(manuscripts: Manuscript[]): Map<string, Manuscript[]> {
  const map = new Map<string, Manuscript[]>();
  for (const m of manuscripts) {
    const arr = map.get(m.id) ?? [];
    arr.push(m);
    map.set(m.id, arr);
  }
  return map;
}

/** 分组排序：编号稿按数字升序，未编号稿排在后面按文件名。 */
export function compareManuscriptIds(a: string, b: string): number {
  const na = a.match(/^A(\d+)$/);
  const nb = b.match(/^A(\d+)$/);
  if (na && nb) return Number(na[1]) - Number(nb[1]);
  if (na) return -1;
  if (nb) return 1;
  return a.localeCompare(b, 'zh-CN');
}

function mtimeMs(dir: string, file: string): number {
  try {
    return fs.statSync(path.join(dir, file)).mtimeMs;
  } catch {
    return 0;
  }
}

/** 稿件按「日期新 → 修改时间新」排序。 */
export function sortByRecency(list: Manuscript[], dir: string = MANUSCRIPT_DIR): Manuscript[] {
  return [...list].sort((a, b) => {
    const d = (b.date ?? '').localeCompare(a.date ?? '');
    if (d !== 0) return d;
    return mtimeMs(dir, b.file) - mtimeMs(dir, a.file);
  });
}

/**
 * 决定某个分组的当前稿。
 *
 * 优先用作者钉的指针；没钉就沿用今天的默认挑法：
 * 先看推送版（日期新 → 修改时间新），没有推送版再退到该组的其它稿。
 */
export function resolveCurrentFile(
  articleId: string,
  list: Manuscript[],
  pointer: string | undefined,
  dir: string = MANUSCRIPT_DIR,
): CurrentFile | null {
  if (!list.length) return null;

  if (pointer) {
    const hit = list.find((m) => m.file === pointer);
    if (hit) {
      return {
        file: hit.file,
        path: path.join(dir, hit.file),
        label: hit.label,
        kind: hit.kind,
        date: hit.date,
        pinned: true,
      };
    }
  }

  const pushes = sortByRecency(
    list.filter((m) => m.kind === 'push'),
    dir,
  );
  const pick = pushes[0] ?? sortByRecency(list, dir)[0];
  if (!pick) return null;
  return {
    file: pick.file,
    path: path.join(dir, pick.file),
    label: pick.label,
    kind: pick.kind,
    date: pick.date,
    pinned: false,
  };
}

function parseKanban(): WorkspaceState['kanban'] {
  const md = readText(KANBAN_FILE);
  const updated = md.match(/^updated:\s*(\S+)/m)?.[1] ?? '';
  const actionRaw =
    md.match(/\*\*\[ \]\s*([^*]+?)\*\*/)?.[1] ??
    md.match(/\[ \]\s*(?:15 分钟|.*?推进)/)?.[1] ??
    '';
  const action = cleanInline(actionRaw);

  const statusRows: StatusRow[] = [];
  const sec = md.match(/^##\s*📊\s*当前状态[^\n]*\n([\s\S]*?)(?=^##\s)/m);
  if (sec) {
    for (const line of sec[1].split(/\r?\n/)) {
      if (!line.trim().startsWith('|')) continue;
      const cells = line.split('|').map((c) => c.trim());
      const label = cleanInline(cells[1] ?? '');
      const state = cleanInline(cells[2] ?? '');
      if (!label || !state) continue;
      if (label === '环节' || /^[-:]+$/.test((cells[1] ?? '').trim())) continue;
      // 看板把「本轮新出写作包 / 快检」也塞进了当前状态表；这些是流水账，
      // 不是账号状态。跳过它们，别让首页速览被 A58/A57 占满。
      if (/写作包|快检|Skill|本轮|上一轮/.test(label)) continue;
      statusRows.push({
        label: label.replace(/^🆕\s*/, '').slice(0, 24),
        state: state.length > 46 ? `${state.slice(0, 46)}…` : state,
      });
      if (statusRows.length >= 8) break;
    }
  }
  return { action, updated, statusRows };
}

function parseSchedule(md: string, topicMap: Map<string, Topic>): ScheduleItem[] {
  const items: ScheduleItem[] = [];
  const re = /^\|\s*(\d)\s*\|\s*\*\*(A\d+)/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md))) {
    items.push({ order: Number(m[1]), id: m[2], title: topicMap.get(m[2])?.title });
  }
  return items.slice(0, 6);
}

export function scanWorkspace(): WorkspaceState {
  const topicMd = readText(TOPIC_FILE);
  const topics = parseTopics(topicMd);
  const manuscripts = parseManuscripts(MANUSCRIPT_DIR);
  const planMd = readText(PLAN_FILE);
  const kanban = parseKanban();

  const pkgMap = new Map<string, { date: string; file: string }>();
  for (const name of listFiles(LIB)) {
    const m = name.match(/^写作包\s*-\s*(A\d+)\s+.+?\s*-\s*(\d{4}-\d{2}-\d{2})\.md$/);
    if (m && !pkgMap.has(m[1])) pkgMap.set(m[1], { date: m[2], file: name });
  }

  const figureDirs = listDirs(MATERIAL_DIR);
  const hasFigures = (id: string) =>
    figureDirs.some((d) => new RegExp(`^${id}\\s*配图|^${id}配图`).test(d));

  const byId = groupManuscripts(manuscripts);

  // 数据库事实：发布登记 / 复盘记录 / 当前稿指针
  const pubs = latestPublications();
  const reviewedIds = new Set(listReviewArticleIds());
  const pointers = listCurrentFiles();

  // 当前稿：每个分组一份（编号稿按选题，未编号稿自成一组）
  const current: Record<string, CurrentFile> = {};
  const groups: Record<string, GroupStatus> = {};
  const allIds = new Set<string>([...byId.keys(), ...topics.map((x) => x.id)]);
  for (const id of allIds) {
    const list = byId.get(id) ?? [];
    const cf = resolveCurrentFile(id, list, pointers.get(id), MANUSCRIPT_DIR);
    if (cf) current[id] = cf;
    const pub = pubs.get(id);
    const facts = {
      hasPackage: !!pkgMap.get(id),
      hasFigures: hasFigures(id),
      hasDraft: list.some((m) => m.kind === 'draft' || m.kind === 'review'),
      hasPush: list.some((m) => m.kind === 'push'),
      published: !!pub,
      reviewed: reviewedIds.has(id),
    };
    const step = computeStep(facts);
    groups[id] = {
      id,
      numbered: /^A\d+$/.test(id),
      published: facts.published,
      reviewed: facts.reviewed,
      publishedAt: pub?.published_at ?? null,
      publishedFile: pub?.file ?? null,
      step,
      stage: STEP_LABELS[step - 1],
      currentFile: cf,
    };
  }

  for (const t of topics) {
    const pkg = pkgMap.get(t.id);
    const g = groups[t.id];
    const ms = byId.get(t.id) ?? [];
    t.hasPackage = !!pkg;
    t.packageDate = pkg?.date;
    t.hasDraft = ms.some((m) => m.kind === 'draft' || m.kind === 'review');
    t.hasPush = ms.some((m) => m.kind === 'push');
    t.hasFigures = hasFigures(t.id);
    t.published = g?.published ?? false;
    t.publishedAt = g?.publishedAt ?? null;
    t.publishedFile = g?.publishedFile ?? null;
    t.reviewed = g?.reviewed ?? false;
    t.currentFile = g?.currentFile ?? null;
    t.step = g?.step ?? 1;
    t.stage = g?.stage ?? STEP_LABELS[0];
  }

  const topicMap = new Map(topics.map((t) => [t.id, t]));
  const schedule = parseSchedule(planMd, topicMap);
  const planRange = planMd.match(/两周排期（([^）]+)）/)?.[1]?.trim() ?? '';

  const radarDates = listFiles(LIB)
    .map((n) => n.match(RADAR_LOG_FILE_RE)?.[1])
    .filter((x): x is string => !!x)
    .sort()
    .reverse();

  const weekly = listFiles(LIB)
    .map((n) => n.match(/^周报\s*-\s*.+?\s*-\s*(\d{4}-W\d+)\.md$/)?.[1])
    .filter((x): x is string => !!x)
    .sort()
    .reverse();

  const skillMd = readText(SKILL_FILE);
  const skillCount = Number(skillMd.match(/(\d+)\s*个\s*skill/)?.[1] ?? 0) || null;

  const qaTotal = (planMd.match(/\*\*Q[1-9]/g) || []).length || 5;

  return {
    topics: topics.sort((a, b) => {
      const na = Number(a.id.slice(1));
      const nb = Number(b.id.slice(1));
      return na - nb;
    }),
    manuscripts,
    current,
    groups,
    radarDates,
    weekly,
    skillCount,
    kanban,
    schedule,
    planRange,
    a1: {
      qaTotal,
      counts: {},
    },
    stats: {
      topicCount: topics.length,
      p0: topics.filter((t) => t.priority === 'P0').length,
      packageCount: pkgMap.size,
      manuscriptCount: manuscripts.length,
      radarCount: radarDates.length,
      weeklyCount: weekly.length,
      skillCount,
    },
    scannedAt: new Date().toISOString(),
  };
}

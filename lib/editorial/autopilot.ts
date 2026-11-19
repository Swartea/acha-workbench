import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  AUTOPILOT_DATA_DIR,
  CHECKER,
  MANUSCRIPT_DIR,
  REWORK_DIR,
  WS_ROOT,
} from '../paths';
import { assertUnder } from '../guard';
import {
  addAutopilotEvent,
  addAutopilotRun,
  getAutopilotRun,
  listAutopilotEvents,
  listAutopilotRuns,
  runningAutopilot,
  updateAutopilotRun,
  type AutopilotEvent,
  type AutopilotRun,
} from '../db';
import { callModel, callModelGuarded, modelAvailable, type ModelKey } from '../experts/runtime';
import { pullFoloRadar } from '../folo';
import { readRadarAll } from '../radar';
import type { StoredFoloEntry } from '../folo-core';
import { safeName, stampLocal } from '../parse.mjs';
import { WRITING_RULES } from './prompt';
import { generateCover, verifyCoverForWechat, type CoverMeta } from './cover';
import {
  extractJsonObject,
  gatherResearch,
  pickTopic,
  selectCandidates,
  supplementSources,
  type ResearchResult,
  type ResearchSource,
} from './research';
import { checkLayoutMarkdown, type LayoutReport } from './layout';
import { generateFigures, type FiguresResult } from './figures';

const MAX_REVISIONS = 2;

export interface Brief {
  topic: string;
  thesis: string;
  angle: string;
  whyNow: string;
  outline: string[];
  keyFacts: Array<{ claim: string; source: string; quote?: string }>;
  uncertainties: string[];
}

import { countCjk, evaluateArticleWithShape, type Article, type CheckResult, type ShapeCheck } from './evaluate';
import { articleMarkdown, localDate } from './format';

export type { Article, ShapeCheck, CheckResult } from './evaluate';

export interface AutopilotDetail {
  run: AutopilotRun;
  events: AutopilotEvent[];
  article: string;
  research: string;
  checks: CheckResult | null;
  cover: CoverMeta | null;
  figures: FiguresResult | null;
  layout: LayoutReport | null;
  files: string[];
}

function write(file: string, text: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, 'utf8');
}

export function runShapeCheck(file: string): ShapeCheck {
  const r = spawnSync(process.execPath, [CHECKER, file, '--json'], {
    cwd: WS_ROOT,
    encoding: 'utf8',
    timeout: 30_000,
  });
  try {
    const j = JSON.parse(r.stdout || '{}') as {
      score?: number;
      verdict?: string;
      blockers?: string[];
      checks?: ShapeCheck['checks'];
      chars?: number;
    };
    return {
      score: j.score ?? null,
      verdict: j.verdict ?? null,
      blockers: j.blockers ?? [],
      checks: j.checks ?? [],
      chars: j.chars ?? null,
    };
  } catch {
    return { score: null, verdict: null, blockers: ['检查器没有返回 JSON'], checks: [], chars: null };
  }
}

/** 跑检查器 + 评审（保留旧签名，内部走 evaluate.ts 的纯函数核心）。 */
export function evaluateArticle(article: Article, file: string, research?: ResearchResult): CheckResult {
  return evaluateArticleWithShape(article, runShapeCheck(file), research);
}

function sourceList(research: ResearchResult): ResearchSource[] {
  return research.sources.filter((s) => /^https?:\/\//i.test(s.url));
}

function normalizeArticle(
  raw: unknown,
  fallbackTitle: string,
  sources: ResearchSource[],
  fallbackBody = '',
): Article {
  const rec = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const title = String(rec.title ?? fallbackTitle ?? '').replace(/^#+\s*/, '').trim();
  const digest = String(rec.digest ?? '').trim();
  let body = String(rec.body ?? fallbackBody ?? '').trim();
  body = body.replace(/^```(?:markdown)?\n?/i, '').replace(/```$/m, '').trim();
  if (!body && fallbackBody) body = fallbackBody;
  const parsedSources = Array.isArray(rec.sources)
    ? rec.sources
        .map((item): ResearchSource | null => {
          if (!item || typeof item !== 'object') return null;
          const s = item as Record<string, unknown>;
          const url = String(s.url ?? '').trim();
          if (!/^https?:\/\//i.test(url)) return null;
          const level = String(s.level ?? 'S2').toUpperCase();
          return {
            claim: String(s.claim ?? '').slice(0, 300),
            url,
            level: level === 'S1' || level === 'S3' ? (level as 'S1' | 'S3') : 'S2',
            accessed: String(s.accessed ?? new Date().toISOString().slice(0, 10)).slice(0, 20),
            quote: String(s.quote ?? '').slice(0, 600),
          };
        })
        .filter((s): s is ResearchSource => !!s)
    : [];
  return {
    title: title || '未命名',
    digest,
    body,
    sources: parsedSources.length >= 2 ? parsedSources : sources,
  };
}

function researchPrompt(research: ResearchResult, pickAngle: string): string {
  return [
    '你是「阿茶 AI 实验室」的研究编辑。下面是刚抓到的公开材料。',
    '任务：判断这个题值不值得写、提炼一个能站住的判断，并给出文章骨架。',
    '要求：只基于材料；材料没有的不要补；区分事实与推测；标出还不确定的地方。',
    '',
    `候选角度（可采纳可修正）：${pickAngle || '（无）'}`,
    '',
    '## 研究材料',
    research.markdown.slice(0, 18000),
    '',
    '只输出 JSON，不要解释、不要 markdown 代码块：',
    JSON.stringify(
      {
        topic: '一句话选题',
        thesis: '一句话核心判断',
        angle: '切入角度',
        whyNow: '为什么现在写',
        outline: ['第一层', '第二层', '第三层'],
        keyFacts: [{ claim: '事实', source: '来源名称或 URL', quote: '原文摘录' }],
        uncertainties: ['还不确定的事'],
      },
      null,
      2,
    ),
  ].join('\n');
}

function articlePrompt(research: ResearchResult, brief: Brief, sources: ResearchSource[]): string {
  return [
    WRITING_RULES,
    '',
    '## 研究简报',
    JSON.stringify(brief, null, 2),
    '',
    '## 可用来源（只能从这些来源里取数；优先 S1）',
    sources
      .map(
        (s, i) =>
          `${i + 1}. [${s.level}] ${s.claim}\n   ${s.url}\n   原文：${s.quote.slice(0, 300)}`,
      )
      .join('\n\n'),
    '',
    '来源使用规则：',
    '- 每个关键事实（数字 / 价格 / 版本 / 日期）都要落到来源台账，claim 写清口径。',
    '- 转引的数据（某研究 / 某报告）优先回溯原始出处；实在拿不到，claim 里写明是转引。',
    '- 关键事实尽量不要全部依赖同一篇文章；条件允许时补一个独立来源互证。',
    '',
    '## 研究材料',
    research.markdown.slice(0, 16000),
    '',
    '现在写完整文章。标题、摘要、正文、来源都要给全。',
  ].join('\n');
}

function revisionPrompt(article: Article, check: CheckResult, research: ResearchResult): string {
  return [
    WRITING_RULES,
    '',
    '下面这篇稿子没有过机器检查。只改未过项，保留已经成立的结构和判断。',
    '改动最小化：能改一句不改一段，保留原有文风和已核实的事实表述，不要重写全文。',
    '',
    '## 当前稿',
    JSON.stringify(
      { title: article.title, digest: article.digest, body: article.body, sources: article.sources },
      null,
      2,
    ),
    '',
    '## 未过项（必须全部修掉）',
    check.blockers.map((b) => '- ' + b).join('\n') || '- 无',
    '',
    '## 提醒（尽量处理）',
    check.warnings.map((w) => '- ' + w).join('\n') || '- 无',
    '',
    '## 可用研究材料',
    research.markdown.slice(0, 12000),
    '',
    '只输出修正后的完整 JSON：{"title":"…","digest":"…","body":"…","sources":[…]}',
  ].join('\n');
}

async function analyzeResearch(
  research: ResearchResult,
  pickAngle: string,
  model: ModelKey,
  workDir: string,
): Promise<Brief> {
  const res = await callModel(model, researchPrompt(research, pickAngle), workDir);
  if (res.ok) {
    const j = extractJsonObject<Partial<Brief>>(res.text);
    if (j && typeof j.thesis === 'string' && j.thesis.trim()) {
      return {
        topic: String(j.topic ?? research.title),
        thesis: String(j.thesis),
        angle: String(j.angle ?? pickAngle ?? ''),
        whyNow: String(j.whyNow ?? ''),
        outline: Array.isArray(j.outline) ? j.outline.map(String).slice(0, 8) : [],
        keyFacts: Array.isArray(j.keyFacts)
          ? j.keyFacts
              .map((f) => ({
                claim: String((f as { claim?: unknown })?.claim ?? ''),
                source: String((f as { source?: unknown })?.source ?? ''),
                quote: String((f as { quote?: unknown })?.quote ?? ''),
              }))
              .filter((f) => f.claim)
              .slice(0, 10)
          : [],
        uncertainties: Array.isArray(j.uncertainties) ? j.uncertainties.map(String).slice(0, 8) : [],
      };
    }
  }
  return {
    topic: research.title,
    thesis: pickAngle || `基于公开资料解读 ${research.title}`,
    angle: pickAngle || '公开资料解读',
    whyNow: '',
    outline: [],
    keyFacts: research.sources.slice(0, 4).map((s) => ({ claim: s.claim, source: s.url, quote: s.quote })),
    uncertainties: ['研究模型没有返回可解析的简报，按研究材料直接写'],
  };
}

async function writeArticle(
  research: ResearchResult,
  brief: Brief,
  model: ModelKey,
  workDir: string,
  sources: ResearchSource[],
  onFail?: (message: string) => void,
): Promise<Article> {
  const text = await callModelGuarded(model, articlePrompt(research, brief, sources), workDir, onFail);
  const parsed = extractJsonObject<Record<string, unknown>>(text);
  const article = normalizeArticle(parsed, brief.topic || research.title, sources, parsed ? '' : text);
  if (!article.body.trim()) throw new Error('写稿模型没有返回正文');
  return article;
}

async function reviseArticle(
  article: Article,
  check: CheckResult,
  research: ResearchResult,
  model: ModelKey,
  workDir: string,
  sources: ResearchSource[],
  onFail?: (message: string) => void,
): Promise<Article> {
  const text = await callModelGuarded(model, revisionPrompt(article, check, research), workDir, onFail);
  const parsed = extractJsonObject<Record<string, unknown>>(text);
  const revised = normalizeArticle(parsed, article.title, sources, parsed ? '' : text);
  if (!revised.body.trim()) throw new Error('返工模型没有返回正文');
  return revised;
}

function writeRunJson(runId: number, data: unknown) {
  const run = getAutopilotRun(runId);
  if (!run?.run_dir) return;
  write(assertUnder(run.run_dir, 'run.json'), JSON.stringify(data, null, 2));
}

function writeCheckReport(file: string, runId: number, article: Article, check: CheckResult, research: ResearchResult) {
  const rows = check.shape.checks
    .map((c) => `| ${c.pass ? '✅' : '❌'} | ${c.label} | ${c.detail} |`)
    .join('\n');
  const sources = article.sources
    .map((s) => `| ${s.level} | ${s.claim.replace(/\|/g, '/')} | ${s.url} | ${s.accessed} |`)
    .join('\n');
  const text = [
    `# 检查结果 · 自主写稿 #${runId}`,
    '',
    `- 生成时间：${new Date().toLocaleString('zh-CN', { hour12: false })}`,
    `- 结论：${check.verdict}`,
    `- 阻断项：${check.blockers.length} · 提醒：${check.warnings.length}`,
    '',
    '## 阻断项',
    check.blockers.length ? check.blockers.map((b) => `- ${b}`).join('\n') : '- 无',
    '',
    '## 提醒',
    check.warnings.length ? check.warnings.map((w) => `- ${w}`).join('\n') : '- 无',
    '',
    '## 形状检查',
    '| 结果 | 检查项 | 说明 |',
    '|---|---|---|',
    rows || '| — | 无 | — |',
    '',
    '## 来源台账',
    '| 级别 | 结论 | URL | 访问日期 |',
    '|---|---|---|---|',
    sources || '| — | 无 | — |',
    '',
    '## 研究材料',
    research.markdown.slice(0, 6000),
  ].join('\n');
  write(file, text);
}

function writeRework(runId: number, article: Article, check: CheckResult, articleFile: string, attempts: number) {
  fs.mkdirSync(REWORK_DIR, { recursive: true });
  const file = path.join(
    REWORK_DIR,
    `${localDate()}-autopilot-${runId}-${safeName(article.title, 18)}.md`,
  );
  const text = [
    `# 返工记录 · 自主写稿 #${runId}`,
    '',
    `- 日期：${localDate()}`,
    `- 稿件：\`${articleFile}\``,
    `- 轮次：初稿 + ${attempts - 1} 次返工（共 ${attempts} 次生成）`,
    '- 结论：机器检查仍有阻断项，停止本轮，换下一个选题',
    '',
    '## 未过项',
    check.blockers.map((b) => `- [ ] ${b}`).join('\n') || '- 无',
    '',
    '## 已尝试',
    `- 共生成 ${attempts} 版；最后一版仍被阻断。`,
    '',
    '## 下一步',
    '- 补到新的官方来源后重开；或换一个不依赖该事实的角度。',
  ].join('\n');
  write(file, text);
}

function pickModel(requested?: string): ModelKey {
  const order: ModelKey[] = ['kimi', 'minimax', 'glm', 'deepseek'];
  const want = (
    requested === 'minimax' || requested === 'glm' || requested === 'deepseek' || requested === 'kimi' ? requested : 'kimi'
  ) as ModelKey;
  if (modelAvailable(want)) return want;
  const fallback = order.find((m) => modelAvailable(m));
  if (!fallback) throw new Error('没有可用的模型 CLI（kimi / minimax / glm 都不可用）');
  return fallback;
}

/** 启动一次自主写稿；立即返回 runId，后台跑完整闭环。 */
export function startAutopilot(options: { model?: string; entryId?: string } = {}): number {
  if (runningAutopilot()) throw new Error('已有一轮自主写稿在跑，等它结束或 30 分钟后再试');
  const model = pickModel(options.model);
  const runId = addAutopilotRun(model);
  const runDir = assertUnder(AUTOPILOT_DATA_DIR, String(runId));
  fs.mkdirSync(runDir, { recursive: true });
  updateAutopilotRun(runId, { run_dir: runDir, stage: 'queued' });
  void runAutopilot(runId, model, options).catch((e: unknown) => {
    const message = e instanceof Error ? e.message : String(e);
    updateAutopilotRun(runId, { status: 'error', stage: 'error', error: message.slice(0, 2000) });
    addAutopilotEvent(runId, 'error', 'error', message.slice(0, 1000));
  });
  return runId;
}

async function runAutopilot(
  runId: number,
  model: ModelKey,
  options: { entryId?: string },
): Promise<void> {
  const runDir = assertUnder(AUTOPILOT_DATA_DIR, String(runId));
  const log = (stage: string, message: string, status = 'ok', data?: unknown) => {
    addAutopilotEvent(runId, stage, status, message, data);
    updateAutopilotRun(runId, { stage });
  };

  log('queued', `启动：模型 ${model}`, 'running');

  // 1. 选题（多源候选：Folo + RSS）
  updateAutopilotRun(runId, { stage: 'pick' });
  log('pick', '从资料源（Folo/RSS）挑选选题…', 'running');
  let entries = readRadarAll();
  if (!entries.length) {
    log('pick', '雷达为空，先拉一次 Folo…', 'running');
    await pullFoloRadar({ limit: 30 });
    entries = readRadarAll();
  }
  // 历史运行写过的线索不再选（避免连续几轮撞同一篇）；调用方明确指定条目时除外。
  let skippedWritten = 0;
  if (!options.entryId) {
    const written = new Set(
      listAutopilotRuns(50)
        .map((r) => (r.source_url ?? '').replace(/[?#].*$/, '').replace(/\/$/, ''))
        .filter(Boolean),
    );
    const before = entries.length;
    entries = entries.filter((e) => !written.has(e.url.replace(/[?#].*$/, '').replace(/\/$/, '')));
    skippedWritten = before - entries.length;
    if (skippedWritten) log('pick', `跳过 ${skippedWritten} 条已写过的线索，避免撞题`);
  }
  const candidates = selectCandidates(entries, 8);
  if (!candidates.length) {
    throw new Error(
      skippedWritten
        ? `雷达 ${skippedWritten} 条候选都已写过，没有新题（先更新雷达源）`
        : '雷达没有可用候选（需要公开原文/仓库，社交平台已排除）',
    );
  }
  let picked: { entry: StoredFoloEntry; reason: string; angle: string };
  if (options.entryId) {
    const entry = entries.find((e) => e.id === options.entryId);
    if (!entry) throw new Error('指定的 Folo 条目不存在');
    picked = { entry, reason: '调用方指定条目', angle: '' };
  } else {
    const pick = await pickTopic(candidates, model, runDir);
    picked = { entry: pick.entry, reason: pick.reason, angle: pick.angle };
  }
  updateAutopilotRun(runId, {
    topic: picked.entry.titleZh || picked.entry.title,
    source_title: picked.entry.title,
    source_url: picked.entry.url,
  });
  log('pick', `选中：${picked.entry.titleZh || picked.entry.title}（${picked.reason}）`, 'ok', {
    url: picked.entry.url,
    angle: picked.angle,
  });

  // 2. 研究
  updateAutopilotRun(runId, { stage: 'research' });
  log('research', '抓官方仓库/原文，建立来源台账…', 'running');
  let research = await gatherResearch(picked.entry);
  // 台账只有一个域时补独立交叉来源（HN / Bing CN）；抓不到维持单源，不硬凑。
  const domainCount = new Set(
    research.sources.map((s) => {
      try {
        return new URL(s.url).hostname.replace(/^www\./, '');
      } catch {
        return s.url;
      }
    }),
  ).size;
  if (domainCount <= 1) {
    log('research', '来源只有单一域，尝试补独立交叉来源（HN / Bing）…', 'running');
    research = await supplementSources(research, picked.entry.title);
    const gained = research.sources.filter((s) => s.claim.startsWith('Hacker News') || s.claim.startsWith('搜索交叉'));
    log(
      'research',
      gained.length ? `补到 ${gained.length} 条独立交叉来源` : '没抓到独立交叉来源，维持单源（检查会提醒）',
      gained.length ? 'ok' : 'warn',
      { added: gained.map((s) => ({ claim: s.claim, url: s.url })) },
    );
  }
  write(assertUnder(runDir, 'research.md'), research.markdown);
  log('research', `研究完成：${research.sources.length} 条来源，材料 ${research.markdown.length} 字`, 'ok', {
    sources: research.sources.map((s) => ({ claim: s.claim, url: s.url, level: s.level })),
  });

  // 3. 研究简报
  updateAutopilotRun(runId, { stage: 'brief' });
  log('brief', '提炼判断、角度和骨架…', 'running');
  const brief = await analyzeResearch(research, picked.angle, model, runDir);
  write(assertUnder(runDir, 'brief.json'), JSON.stringify(brief, null, 2));
  log('brief', `判断：${brief.thesis}`, 'ok', { angle: brief.angle, outline: brief.outline });

  // 4. 写稿
  updateAutopilotRun(runId, { stage: 'draft' });
  log('draft', '写完整文章…', 'running');
  const sources = sourceList(research);
  const onModelFail = (stage: string) => (message: string) => log(stage, message, 'warn');
  let article = await writeArticle(research, brief, model, runDir, sources, onModelFail('draft'));
  let articleFile = path.join(runDir, 'draft-v1.md');
  write(articleFile, articleMarkdown(article, runId));
  log('draft', `初稿完成：${article.title}（${countCjk(article.body)} 字）`, 'ok', {
    title: article.title,
    digest: article.digest,
  });

  // 5. 检查 + 返工
  updateAutopilotRun(runId, { stage: 'check' });
  let check = evaluateArticle(article, articleFile, research);
  write(assertUnder(runDir, 'check-v1.json'), JSON.stringify({ ...check, sources: article.sources }, null, 2));
  log(
    'check',
    check.blockers.length ? `检查未过：${check.blockers.join(' / ')}` : '机器检查通过',
    check.blockers.length ? 'warn' : 'ok',
    { blockers: check.blockers, warnings: check.warnings, score: check.shape.score },
  );

  let attempts = 1;
  while (check.blockers.length && attempts <= MAX_REVISIONS) {
    updateAutopilotRun(runId, { stage: 'revise' });
    log('revise', `第 ${attempts} 轮返工：原模型带 ${check.blockers.length} 个未过项修订…`, 'running');
    article = await reviseArticle(article, check, research, model, runDir, sources, onModelFail('revise'));
    attempts++;
    articleFile = path.join(runDir, `draft-v${attempts}.md`);
    write(articleFile, articleMarkdown(article, runId));
    check = evaluateArticle(article, articleFile, research);
    write(assertUnder(runDir, `check-v${attempts}.json`), JSON.stringify({ ...check, sources: article.sources }, null, 2));
    log(
      'check',
      check.blockers.length ? `第 ${attempts} 版仍未过：${check.blockers.join(' / ')}` : `第 ${attempts} 版通过`,
      check.blockers.length ? 'warn' : 'ok',
      { blockers: check.blockers, score: check.shape.score },
    );
  }

  if (check.blockers.length) {
    const lastFile = articleFile;
    writeRework(runId, article, check, lastFile, attempts);
    updateAutopilotRun(runId, {
      status: 'blocked',
      stage: 'blocked',
      article_file: lastFile,
      checks: JSON.stringify({ ...check, sources: article.sources }),
      error: check.blockers.join(' / ').slice(0, 2000),
    });
    log('blocked', `返工 ${attempts - 1} 轮仍不过，已写返工记录并停止`, 'warn', {
      blockers: check.blockers,
    });
    return;
  }

  // 5.5 正文配图：把【图 N】占位符替换成真实图片（非阻断；失败保留占位符）
  updateAutopilotRun(runId, { stage: 'figures' });
  log('figures', '按配图位生成正文配图（模型出 HTML → chromium 截图）…', 'running');
  let figures: FiguresResult | null = null;
  try {
    figures = await generateFigures(article, model, runDir, runId, research, onModelFail('figures'));
    write(assertUnder(runDir, 'figures.json'), JSON.stringify(figures, null, 2));
    for (const w of figures.warnings) log('figures', w, 'warn');
    if (figures.error) log('figures', `配图中断：${figures.error}`, 'warn');
    log(
      'figures',
      figures.figures.length
        ? `已生成 ${figures.figures.length} 张配图并替换占位符`
        : '没有生成正文配图（无配图位或全部未过门槛）',
      figures.figures.length ? 'ok' : 'warn',
      { figures: figures.figures.map((f) => ({ slot: f.slot, rel: f.rel })) },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    figures = { ok: false, figures: [], warnings: [], error: message.slice(0, 500) };
    write(assertUnder(runDir, 'figures.json'), JSON.stringify(figures, null, 2));
    log('figures', `配图环节失败（保留占位符继续）：${message.slice(0, 200)}`, 'warn');
  }

  // 6. 封面（Codex 内置 imagegen；不调外部付费 API）
  updateAutopilotRun(runId, { stage: 'cover' });
  log('cover', '按文章主题生成封面（Codex 内置 imagegen）…', 'running');
  let cover: CoverMeta | null = null;
  try {
    cover = await generateCover({ article, brief, runId, runDir });
    article.cover = cover.rel ?? undefined;
    log(
      'cover',
      `封面已生成：${cover.width}×${cover.height} ${cover.format.toUpperCase()} ${Math.round(cover.bytes / 1024)}KB` +
        (cover.compressed ? '（已裁切/压缩）' : ''),
      'ok',
      { file: cover.file, promptFile: cover.promptFile, compressed: cover.compressed },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    cover = {
      ok: false,
      file: null,
      rel: null,
      promptFile: null,
      prompt: '',
      width: 0,
      height: 0,
      bytes: 0,
      format: '',
      compressed: false,
      source: 'codex-imagegen',
      error: message.slice(0, 1000),
    };
    log('cover', `封面生成失败：${message}；继续交付无封面稿`, 'warn');
  }

  // 6.5 排版预检（markdown 结构风险；提醒级，不拦稿）
  updateAutopilotRun(runId, { stage: 'layout' });
  log('layout', '排版破版风险预检（图片存在性 / 围栏 / 表格 / 标签残留）…', 'running');
  const layout = checkLayoutMarkdown(fs.readFileSync(articleFile, 'utf8'));
  write(assertUnder(runDir, 'layout.json'), JSON.stringify(layout, null, 2));
  const layoutFails = layout.checks.filter((c) => !c.pass);
  log(
    'layout',
    layoutFails.length
      ? `排版预检 ${layoutFails.length} 项提醒：${layoutFails.map((f) => f.label).join('、')}`
      : '排版预检全过',
    layoutFails.length ? 'warn' : 'ok',
    { checks: layout.checks },
  );
  for (const w of layout.warnings) log('layout', w, 'warn');

  // 7. 交付
  updateAutopilotRun(runId, { stage: 'save' });
  log('save', '保存待发布稿、来源台账和检查结果…', 'running');
  fs.mkdirSync(MANUSCRIPT_DIR, { recursive: true });
  const finalName = `自动稿-${stampLocal()}-${safeName(article.title, 20)}.md`;
  const finalFile = assertUnder(MANUSCRIPT_DIR, finalName);
  write(finalFile, articleMarkdown(article, runId));
  write(assertUnder(runDir, 'final.md'), articleMarkdown(article, runId));
  writeCheckReport(assertUnder(runDir, '检查结果.md'), runId, article, check, research);

  if (cover) {
    if (cover.ok && cover.file) {
      cover.wechat = verifyCoverForWechat(finalFile, cover.file);
      log(
        'cover',
        cover.wechat.ok
          ? '封面通过微信草稿 dry-run 与 preflight'
          : `封面微信流程检查未过：dry-run ${cover.wechat.dryRunOk ? 'ok' : 'fail'} / preflight ${cover.wechat.preflightOk ? 'ok' : 'fail'}`,
        cover.wechat.ok ? 'ok' : 'warn',
        { dryRunOk: cover.wechat.dryRunOk, preflightOk: cover.wechat.preflightOk },
      );
    }
    write(assertUnder(runDir, 'cover.json'), JSON.stringify(cover, null, 2));
  }

  writeRunJson(runId, {
    runId,
    model,
    finishedAt: new Date().toISOString(),
    picked: { title: picked.entry.title, url: picked.entry.url, reason: picked.reason, angle: picked.angle },
    brief,
    article: { title: article.title, digest: article.digest, chars: countCjk(article.body), cover: article.cover ?? null },
    sources: article.sources,
    attempts,
    check,
    cover,
    figures,
    layout,
    files: { article: finalFile, cover: cover?.file ?? null, runDir },
  });

  updateAutopilotRun(runId, {
    status: 'ok',
    stage: 'done',
    article_file: finalFile,
    checks: JSON.stringify({ ...check, sources: article.sources }),
    cover_file: cover?.file ?? null,
    cover_prompt: cover?.promptFile ?? null,
    cover_meta: cover ? JSON.stringify(cover) : null,
    error: null,
  });
  log('done', `待发布稿已保存：${finalFile}${cover?.ok ? '（含封面）' : '（无封面）'}`, 'ok', { article: finalFile, attempts });
}

export function getAutopilotDetail(runId: number): AutopilotDetail | null {
  const run = getAutopilotRun(runId);
  if (!run) return null;
  let article = '';
  try {
    if (run.article_file && fs.existsSync(run.article_file)) {
      article = fs.readFileSync(run.article_file, 'utf8');
    }
  } catch {
    article = '';
  }
  let research = '';
  try {
    if (run.run_dir) {
      const p = assertUnder(run.run_dir, 'research.md');
      if (fs.existsSync(p)) research = fs.readFileSync(p, 'utf8');
    }
  } catch {
    research = '';
  }
  let checks: CheckResult | null = null;
  try {
    checks = run.checks ? (JSON.parse(run.checks) as CheckResult) : null;
  } catch {
    checks = null;
  }
  let files: string[] = [];
  try {
    if (run.run_dir && fs.existsSync(run.run_dir)) {
      files = fs.readdirSync(run.run_dir).sort();
    }
  } catch {
    files = [];
  }
  let cover: CoverMeta | null = null;
  try {
    cover = run.cover_meta ? (JSON.parse(run.cover_meta) as CoverMeta) : null;
  } catch {
    cover = null;
  }
  if (!cover && run.cover_file) {
    cover = {
      ok: true,
      file: run.cover_file,
      rel: path.relative(MANUSCRIPT_DIR, run.cover_file),
      promptFile: run.cover_prompt,
      prompt: '',
      width: 2400,
      height: 1020,
      bytes: 0,
      format: 'png',
      compressed: false,
      source: 'codex-imagegen',
    };
  }
  if (cover?.promptFile) {
    try {
      cover.prompt = fs.readFileSync(cover.promptFile, 'utf8').slice(0, 8000);
    } catch {
      /* 保留空 prompt */
    }
  }
  let figures: FiguresResult | null = null;
  let layout: LayoutReport | null = null;
  try {
    if (run.run_dir) {
      const fp = assertUnder(run.run_dir, 'figures.json');
      if (fs.existsSync(fp)) figures = JSON.parse(fs.readFileSync(fp, 'utf8')) as FiguresResult;
      const lp = assertUnder(run.run_dir, 'layout.json');
      if (fs.existsSync(lp)) layout = JSON.parse(fs.readFileSync(lp, 'utf8')) as LayoutReport;
    }
  } catch {
    /* figures/layout 解析失败不阻塞详情展示 */
  }
  return { run, events: listAutopilotEvents(runId), article, research, checks, cover, figures, layout, files };
}

export function latestAutopilotDetail(): AutopilotDetail | null {
  const runs = listAutopilotRuns(1);
  return runs.length ? getAutopilotDetail(runs[0].id) : null;
}

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { MANUSCRIPT_DIR, TOOLS } from './paths';
import { runShapeCheck } from './editorial/autopilot';
import { isUnder } from './guard';
import { LIMITS } from './limits.mjs';
import { extractBodySlice, parseFrontmatter } from './parse.mjs';
import { IMG_EXT_OK, IMG_MAX_BYTES, LEAK_WORDS as LEAKS } from './rules.mjs';

const SCRIPT = path.join(TOOLS, 'figures', 'a1_prose_metrics.py');
const PY_CANDIDATES = [
  process.env.WORKBENCH_PYTHON,
  '/opt/homebrew/bin/python3',
  '/usr/bin/python3',
  'python3',
].filter(Boolean) as string[];

export interface SentenceStats {
  n: number;
  max: number;
  median: number;
  mean: number;
}

export interface Metrics {
  visible_chars: number;
  cjk_chars: number;
  template_floor: number;
  missing_chars: number;
  dash_pairs: number;
  prose: SentenceStats;
  list: SentenceStats;
  over60_count: number;
  over60: Array<{ len: number; text: string }>;
  ai_words: Record<string, number>;
  adj_words: Record<string, number>;
}

export interface ImageCheck {
  ref: string;
  exists: boolean;
  bytes: number;
  ext: string;
  ok: boolean;
  reason?: string;
}

function findPython(): string | null {
  for (const p of PY_CANDIDATES) {
    if (p === 'python3') return p;
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function checkImages(body: string, mdDir: string): ImageCheck[] {
  const out: ImageCheck[] = [];
  for (const m of body.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) {
    const ref = m[1].trim();
    if (/^https?:/i.test(ref)) {
      out.push({ ref, exists: true, bytes: 0, ext: 'url', ok: true });
      continue;
    }
    const abs = path.resolve(mdDir, ref);
    const exists = fs.existsSync(abs);
    const bytes = exists ? fs.statSync(abs).size : 0;
    const ext = path.extname(abs).toLowerCase();
    let ok = exists;
    let reason = exists ? '' : '文件不存在';
    if (exists && !IMG_EXT_OK.has(ext)) {
      ok = false;
      reason = `${ext || '无扩展名'} 不被公众号接收（仅 jpg/png）`;
    }
    if (exists && bytes >= IMG_MAX_BYTES) {
      ok = false;
      reason = `${(bytes / IMG_MAX_BYTES).toFixed(2)}MB ≥ 1MB`;
    }
    out.push({ ref, exists, bytes, ext, ok, reason });
  }
  return out;
}

export function runQuality(file: string) {
  const abs = path.resolve(file);
  if (!isUnder(MANUSCRIPT_DIR, abs)) {
    return { ok: false as const, error: '只允许检查 01-内容库/稿件 下的文件' };
  }
  if (!fs.existsSync(abs)) return { ok: false as const, error: '稿件不存在' };

  const raw = fs.readFileSync(abs, 'utf8');
  const body = extractBodySlice(raw) ?? raw;
  const fm = parseFrontmatter(raw);

  let metrics: Metrics | null = null;
  let pyError = '';
  const py = findPython();
  if (py) {
    const r = spawnSync(py, [SCRIPT, '--json', abs], { encoding: 'utf8', timeout: 30_000 });
    if (r.status === 0 && r.stdout) {
      try {
        metrics = JSON.parse(r.stdout) as Metrics;
      } catch {
        pyError = '指标脚本输出无法解析';
      }
    } else {
      pyError = (r.stderr || r.stdout || `退出码 ${r.status}`).slice(0, 300);
    }
  } else {
    pyError = '找不到 python3，改用简化统计';
  }

  const limits = [
    { key: 'title', label: '标题', max: LIMITS.platform.title },
    { key: 'author', label: '作者', max: LIMITS.platform.author },
    { key: 'digest', label: '摘要', max: LIMITS.platform.digest },
  ].map((x) => {
    const value = (fm[x.key] ?? '').trim();
    const len = [...value].length;
    return { ...x, value, len, ok: !!value && len <= x.max };
  });

  const images = checkImages(body, path.dirname(abs));
  const leaks = LEAKS.filter((w) => body.includes(w));
  const headings = (body.match(/^###\s+\S/gm) || []).length;
  const paragraphs = body
    .split(/\n{2,}/)
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith('!') && !s.startsWith('#')).length;

  // 写作门形状检查（同一口径：09-编辑部/draft-check.mjs）。跑不出结果不算失败。
  const shape = runShapeCheck(abs);
  const shapeBlockers = shape.verdict === null ? [] : shape.blockers;

  const reasons: string[] = [];
  for (const l of limits) {
    if (!l.value) reasons.push(`${l.label} 未设置`);
    else if (l.len > l.max) reasons.push(`${l.label} ${l.len} 字，超过 ${l.max}`);
  }
  for (const i of images) if (!i.ok) reasons.push(`图 ${i.ref}：${i.reason}`);
  if (leaks.length) reasons.push(`正文含拦截词：${leaks.join('、')}`);
  if (metrics && metrics.over60_count > 0) reasons.push(`有 ${metrics.over60_count} 句超过 60 字`);
  if (metrics && metrics.missing_chars > 0) reasons.push(`距模板下限还差 ${metrics.missing_chars} 字（可豁免）`);
  for (const b of shapeBlockers) reasons.push(`写作门：${b}`);

  const hardFail =
    images.some((i) => !i.ok) ||
    leaks.length > 0 ||
    limits.some((l) => l.len > l.max) ||
    shapeBlockers.length > 0;
  const verdict: 'pass' | 'warn' | 'fail' = hardFail ? 'fail' : reasons.length ? 'warn' : 'pass';

  return {
    ok: true as const,
    file: abs,
    name: path.basename(abs),
    metrics,
    pyError,
    limits,
    images,
    leaks,
    structure: { headings, paragraphs },
    shape,
    verdict,
    reasons,
  };
}

export type QualityResult = ReturnType<typeof runQuality>;

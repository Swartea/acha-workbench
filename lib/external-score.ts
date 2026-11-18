/**
 * 外部 AI 味评分：调用 wechat-publisher 的 ai_score.py（不 vendor，外部 clone）。
 *
 * 边界（见 00-项目治理/docs/融合评估-wechat-publisher-Folo-2026-11-09.md）：
 * - 只出 advisory，不拦发布、不改稿；
 * - 输入必须接近发布稿：剥 frontmatter、只取「## 正文」、清掉工作稿批注；
 * - 外部 clone 默认 ~/Tools/wechat-publisher，可用 WECHAT_PUBLISHER_DIR 覆盖。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MANUSCRIPT_DIR } from './paths';
import { isUnder } from './guard';
import {
  extractBodySlice,
  stripFrontmatter,
  stripInlineMeta,
  stripMeta,
} from './parse.mjs';

const PY_CANDIDATES = [
  process.env.WORKBENCH_PYTHON,
  '/opt/homebrew/bin/python3',
  '/usr/bin/python3',
  'python3',
].filter(Boolean) as string[];

export interface ExternalAdvisory {
  id: string;
  line?: number;
  message?: string;
  excerpt?: string;
}

export interface ExternalScore {
  ok: true;
  total: number;
  threshold: number;
  verdict: string;
  charCount: number;
  dimensions: Record<string, number>;
  advisories: ExternalAdvisory[];
  exit: number;
}

export interface ExternalScoreFailure {
  ok: false;
  error: string;
}

function findPython(): string {
  if (process.env.WORKBENCH_PYTHON) return process.env.WORKBENCH_PYTHON;
  for (const candidate of ['/opt/homebrew/bin/python3', '/usr/bin/python3']) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return 'python3';
}

export function publisherDir(): string {
  const fromEnv = (process.env.WECHAT_PUBLISHER_DIR ?? '').trim();
  return fromEnv || path.join(os.homedir(), 'Tools', 'wechat-publisher');
}

/** 生成给 ai_score.py 的干净正文（清洗口径与 draft.mjs --strip-meta 同源，见 lib/parse.mjs）。 */
export function buildCleanBody(raw: string): string {
  const body = extractBodySlice(stripFrontmatter(raw)) ?? raw;
  return stripInlineMeta(stripMeta(body).body).trim();
}

/**
 * 跑外部 AI 味评分。返回 advisory；不在这里做任何拦截。
 * @param file - 01-内容库/稿件 下的绝对路径。
 */
export function runExternalAiScore(file: string): ExternalScore | ExternalScoreFailure {
  const abs = path.resolve(file);
  if (!isUnder(MANUSCRIPT_DIR, abs)) return { ok: false, error: '只允许评分 01-内容库/稿件 下的文件' };
  if (!fs.existsSync(abs)) return { ok: false, error: '稿件不存在' };

  const dir = publisherDir();
  const script = path.join(dir, 'scripts', 'ai_score.py');
  if (!fs.existsSync(script)) {
    return {
      ok: false,
      error: `未找到 ${script}。先在仓库外 clone：git clone https://github.com/jiji262/wechat-publisher.git ~/Tools/wechat-publisher`,
    };
  }

  const raw = fs.readFileSync(abs, 'utf8');
  const clean = buildCleanBody(raw);
  if (!clean) return { ok: false, error: '正文为空，无法评分' };

  const tmp = path.join(os.tmpdir(), `acha-ai-score-${process.pid}-${Date.now()}.md`);
  try {
    fs.writeFileSync(tmp, clean, 'utf8');
    const result = spawnSync(findPython(), [script, tmp, '--json', '--advisory'], {
      cwd: dir,
      encoding: 'utf8',
      timeout: 120_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    if (result.error) return { ok: false, error: `执行失败：${result.error.message}` };
    const stdout = (result.stdout ?? '').trim();
    if (!stdout) {
      return {
        ok: false,
        error: (result.stderr ?? '').trim().slice(0, 400) || `ai_score.py 没有输出（退出码 ${result.status}）`,
      };
    }
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(stdout) as Record<string, unknown>;
    } catch {
      return { ok: false, error: `输出不是 JSON：${stdout.slice(0, 200)}` };
    }
    const dimsRaw = (data.dimensions ?? {}) as Record<string, unknown>;
    const dimensions: Record<string, number> = {};
    for (const [key, value] of Object.entries(dimsRaw)) {
      if (value && typeof value === 'object' && 'score' in value) {
        const n = Number((value as { score: unknown }).score);
        if (Number.isFinite(n)) dimensions[key] = n;
      } else if (typeof value === 'number') {
        dimensions[key] = value;
      }
    }
    const advisories = Array.isArray(data.advisory) ? (data.advisory as ExternalAdvisory[]) : [];
    return {
      ok: true,
      total: Number(data.total_ai_score ?? 0),
      threshold: Number(data.threshold ?? 45),
      verdict: String(data.verdict ?? ''),
      charCount: Number(data.char_count ?? 0),
      dimensions,
      advisories,
      exit: result.status ?? 0,
    };
  } finally {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      /* 忽略清理失败 */
    }
  }
}

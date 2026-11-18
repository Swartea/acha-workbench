import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  COVER_DIR,
  COVER_TEMPLATE,
  MANUSCRIPT_DIR,
  PUSH_DIR,
  WS_ROOT,
} from '../paths';
import { safeName, stampLocal } from '../parse.mjs';

const CODEX_TIMEOUT_MS = 6 * 60 * 1000;
const WECHAT_MAX_BYTES = 10 * 1024 * 1024;

export interface CoverWechatCheck {
  dryRunOk: boolean;
  preflightOk: boolean;
  ok: boolean;
  dryRun: string;
  preflight: string;
}

export interface CoverMeta {
  ok: boolean;
  file: string | null;
  /** 相对 `01-内容库/稿件`，用于 frontmatter 和 /api/asset */
  rel: string | null;
  promptFile: string | null;
  prompt: string;
  width: number;
  height: number;
  bytes: number;
  format: string;
  compressed: boolean;
  source: 'codex-imagegen';
  codexThread?: string;
  codexLog?: string;
  wechat?: CoverWechatCheck;
  error?: string;
}

export interface CoverArticle {
  title: string;
  digest: string;
  body: string;
}

export interface CoverBrief {
  thesis: string;
  angle: string;
  outline?: string[];
}

/** 封面上的大标题要短；优先第一个语义段，太短再选最长段。 */
export function shortCoverTitle(title: string): string {
  const clean = String(title || '').replace(/\s+/g, ' ').trim();
  if (!clean) return '阿茶 AI 实验室';
  const parts = clean
    .split(/[：:，,。；;、|]/)
    .map((s) => s.trim())
    .filter(Boolean);
  let chosen = parts[0] && parts[0].length >= 8 ? parts[0] : [...parts].sort((a, b) => b.length - a.length)[0] || clean;
  chosen = chosen.replace(/^["'「」“”]+|["'「」“”]+$/g, '').trim();
  if (chosen.length > 14) chosen = chosen.slice(0, 14);
  return chosen || clean.slice(0, 14);
}

function pickVisual(article: CoverArticle, brief: CoverBrief): { visual: string; palette: string } {
  const text = `${article.title} ${brief.thesis} ${brief.angle} ${article.body.slice(0, 1200)}`;
  if (/(评审|审阅|review|PR\b|代码|commit|diff)/i.test(text)) {
    return {
      visual:
        'a translucent glass review lens over layered code-diff panels; one glowing changed line pulled into focus; thin git-branch light traces and small approval checkmarks floating in glass',
      palette: 'deep midnight navy, emerald and jade light, restrained warm amber accent, white typography',
    };
  }
  if (/(agent|智能体|多 ?agent|编排|orchestrat)/i.test(text)) {
    return {
      visual:
        'a constellation of small translucent agent nodes connected by light threads around one central glass orchestrator core; each node has a tiny terminal cursor, some edges glowing brighter than others',
      palette: 'deep midnight navy, cyan and jade light, subtle violet accent, white typography',
    };
  }
  if (/(模型|推理|LLM|token|上下文|context|memory)/i.test(text)) {
    return {
      visual:
        'a crystalline neural lattice suspended inside a glass vessel; flowing token particles and soft memory rings; the core looks like a laboratory instrument and a tea bowl at the same time',
      palette: 'midnight blue, jade green, pale cyan, white typography',
    };
  }
  if (/(开源|仓库|GitHub|repo|release|项目)/i.test(text)) {
    return {
      visual:
        'a glass repository vault made of stacked translucent code plates and branching commit lines; one bright plate is being lifted out for inspection',
      palette: 'deep navy, teal, warm amber accent, white typography',
    };
  }
  return {
    visual:
      'a translucent glass core, a refined hybrid of a laboratory flask and a tea bowl, with neural-circuit traces and flowing points of light inside; a few small code symbols suspended in the glass',
    palette: 'deep midnight navy, teal and jade light, white typography',
  };
}

function readTemplate(): string {
  try {
    const raw = fs.readFileSync(COVER_TEMPLATE, 'utf8');
    const fenced = raw.match(/```(?:text)?\r?\n([\s\S]*?)\r?\n```/);
    return fenced ? fenced[1] : raw;
  } catch {
    return [
      'Use case: ads-marketing.',
      'Create one finished WeChat public account cover image, ultra-wide 2.35:1, approximately 2400x1020 pixels, PNG.',
      'Account brand, small top-left, verbatim: 阿茶 AI 实验室',
      'Article cover title, large left, verbatim: {{COVER_TITLE}}',
      'Small English subtitle: ACHA AI LAB',
      'Article context: {{ARTICLE_TITLE}}',
      'Visual metaphor: {{VISUAL}}',
      'Palette: {{PALETTE}}',
      'Only the built-in image_gen tool; no external paid API; no shell commands.',
    ].join('\n');
  }
}

export function buildCoverPrompt(article: CoverArticle, brief: CoverBrief): string {
  const { visual, palette } = pickVisual(article, brief);
  const values: Record<string, string> = {
    COVER_TITLE: shortCoverTitle(article.title),
    ARTICLE_TITLE: article.title.replace(/\s+/g, ' ').slice(0, 160),
    VISUAL: visual,
    PALETTE: palette,
  };
  return readTemplate().replace(/\{\{(\w+)\}\}/g, (_m, key: string) => values[key] ?? '');
}

function codexBin(): string {
  return (process.env.WB_CODEX_BIN ?? '').trim() || 'codex';
}

export function codexAvailable(): boolean {
  const r = spawnSync(codexBin(), ['--version'], { encoding: 'utf8', timeout: 10_000 });
  return r.status === 0;
}

interface CodexRun {
  ok: boolean;
  threadId: string;
  image: string | null;
  log: string;
  error?: string;
}

function walkImages(dir: string, out: string[], depth = 0) {
  if (depth > 3 || !fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walkImages(p, out, depth + 1);
    else if (/\.(png|jpe?g|webp)$/i.test(entry.name)) out.push(p);
  }
}

function findGeneratedImage(threadId: string, startedAt: number): string | null {
  const root = path.join(os.homedir(), '.codex', 'generated_images');
  const candidates: Array<{ file: string; mtime: number }> = [];
  const dirs = threadId ? [path.join(root, threadId)] : [root];
  for (const dir of dirs) {
    const files: string[] = [];
    walkImages(dir, files);
    for (const file of files) {
      try {
        const mtime = fs.statSync(file).mtimeMs;
        if (mtime >= startedAt - 10_000) candidates.push({ file, mtime });
      } catch {
        /* ignore */
      }
    }
  }
  candidates.sort((a, b) => b.mtime - a.mtime);
  return candidates[0]?.file ?? null;
}

async function runCodex(prompt: string, runDir: string): Promise<CodexRun> {
  if (!codexAvailable()) {
    return { ok: false, threadId: '', image: null, log: '', error: 'Codex CLI 不可用' };
  }
  const startedAt = Date.now();
  const jsonl = path.join(runDir, 'codex-cover.jsonl');
  const lastFile = path.join(runDir, 'codex-cover-last.txt');
  fs.mkdirSync(runDir, { recursive: true });
  const out = fs.createWriteStream(jsonl, { encoding: 'utf8' });
  const args = [
    'exec',
    '--json',
    '--sandbox',
    'workspace-write',
    '-C',
    WS_ROOT,
    '-o',
    lastFile,
    prompt,
  ];

  return new Promise((resolve) => {
    let threadId = '';
    let stderr = '';
    let buffer = '';
    let completed = false;
    let settled = false;
    let timedOut = false;
    let killTimer: NodeJS.Timeout | null = null;

    const child = spawn(codexBin(), args, {
      cwd: WS_ROOT,
      env: { ...process.env, NO_COLOR: '1', TERM: 'dumb' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const finish = (error?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (killTimer) clearTimeout(killTimer);
      try {
        out.end();
      } catch {
        /* ignore */
      }
      try {
        child.kill('SIGTERM');
      } catch {
        /* ignore */
      }
      setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          /* ignore */
        }
      }, 1500);
      const image = findGeneratedImage(threadId, startedAt);
      resolve({
        ok: !timedOut && !!image,
        threadId,
        image,
        log: jsonl,
        error: timedOut ? 'Codex 生图超时（6 分钟）' : error,
      });
    };

    const timeout = setTimeout(() => {
      timedOut = true;
      finish('Codex 生图超时（6 分钟）');
    }, CODEX_TIMEOUT_MS);

    const handleLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      if (trimmed.length > 300_000) return;
      try {
        const evt = JSON.parse(trimmed) as { type?: string; thread_id?: string };
        if (evt.type === 'thread.started' && evt.thread_id) threadId = evt.thread_id;
        if (evt.type === 'turn.completed' && !completed) {
          completed = true;
          killTimer = setTimeout(() => finish(), 1500);
        }
      } catch {
        /* 非 JSON 行忽略 */
      }
    };

    child.stdout?.on('data', (chunk: Buffer) => {
      out.write(chunk);
      buffer += chunk.toString('utf8');
      let idx = buffer.indexOf('\n');
      while (idx >= 0) {
        handleLine(buffer.slice(0, idx));
        buffer = buffer.slice(idx + 1);
        idx = buffer.indexOf('\n');
      }
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length < 20_000) stderr += chunk.toString('utf8');
    });
    child.on('error', (error) => finish(error.message));
    child.on('close', () => finish());
  });
}

function sips(args: string[]): string {
  return execFileSync('sips', args, { encoding: 'utf8', timeout: 60_000, maxBuffer: 4 * 1024 * 1024 });
}

function imageInfo(file: string): { width: number; height: number; format: string } {
  const text = sips(['-g', 'pixelWidth', '-g', 'pixelHeight', '-g', 'format', file]);
  const width = Number(text.match(/pixelWidth:\s*(\d+)/)?.[1] ?? 0);
  const height = Number(text.match(/pixelHeight:\s*(\d+)/)?.[1] ?? 0);
  const format = (text.match(/format:\s*([a-z0-9]+)/i)?.[1] ?? '').toLowerCase();
  return { width, height, format };
}

/** 统一成 2400×1020 PNG；必要时中心裁切/缩放，>10MB 转 JPEG。 */
function normalizeCover(source: string, runId: number, title: string): CoverMeta {
  fs.mkdirSync(COVER_DIR, { recursive: true });
  const base = `自动封面-${runId}-${stampLocal()}-${safeName(title, 20, '封面')}`;
  const raw = path.join(COVER_DIR, `.${base}.raw.png`);
  let target = path.join(COVER_DIR, `${base}.png`);
  let compressed = false;

  sips(['-s', 'format', 'png', source, '--out', raw]);
  let info = imageInfo(raw);
  if (!info.width || !info.height) throw new Error('封面尺寸读取失败');

  const targetRatio = 2400 / 1020;
  if (Math.abs(info.width / info.height - targetRatio) > 0.01) {
    const cropW = info.width / info.height > targetRatio ? Math.round(info.height * targetRatio) : info.width;
    const cropH = info.width / info.height > targetRatio ? info.height : Math.round(info.width / targetRatio);
    const cropped = path.join(COVER_DIR, `.${base}.crop.png`);
    sips(['--cropToHeightWidth', String(cropH), String(cropW), raw, '--out', cropped]);
    fs.renameSync(cropped, raw);
    compressed = true;
  }
  if (info.width !== 2400 || info.height !== 1020) {
    sips(['-z', '1020', '2400', raw]);
    compressed = true;
  }

  let bytes = fs.statSync(raw).size;
  let format = 'png';
  if (bytes > WECHAT_MAX_BYTES) {
    target = path.join(COVER_DIR, `${base}.jpg`);
    sips(['-s', 'format', 'jpeg', '-s', 'formatOptions', '85', raw, '--out', target]);
    format = 'jpeg';
    bytes = fs.statSync(target).size;
    compressed = true;
    if (bytes > WECHAT_MAX_BYTES) {
      const q65 = path.join(COVER_DIR, `.${base}.q65.jpg`);
      sips(['-s', 'formatOptions', '65', target, '--out', q65]);
      fs.renameSync(q65, target);
      bytes = fs.statSync(target).size;
    }
    fs.rmSync(raw, { force: true });
  } else {
    fs.renameSync(raw, target);
  }

  if (bytes > WECHAT_MAX_BYTES) {
    throw new Error(`封面 ${Math.round(bytes / 1024 / 1024)}MB，超过微信 10MB 上限`);
  }
  const finalInfo = imageInfo(target);
  if (finalInfo.width !== 2400 || finalInfo.height !== 1020) {
    throw new Error(`封面尺寸 ${finalInfo.width}×${finalInfo.height}，不是 2400×1020`);
  }
  const rel = path.relative(MANUSCRIPT_DIR, target);
  return {
    ok: true,
    file: target,
    rel,
    promptFile: null,
    prompt: '',
    width: finalInfo.width,
    height: finalInfo.height,
    bytes,
    format: finalInfo.format || format,
    compressed,
    source: 'codex-imagegen',
  };
}

export async function generateCover(options: {
  article: CoverArticle;
  brief: CoverBrief;
  runId: number;
  runDir: string;
}): Promise<CoverMeta> {
  const prompt = buildCoverPrompt(options.article, options.brief);
  const promptFile = path.join(options.runDir, 'cover-prompt.txt');
  fs.mkdirSync(options.runDir, { recursive: true });
  fs.writeFileSync(promptFile, prompt, 'utf8');

  const result = await runCodex(prompt, options.runDir);
  if (!result.image) {
    throw new Error(result.error || 'Codex 没有返回图片');
  }
  const meta = normalizeCover(result.image, options.runId, options.article.title);
  const contentPromptFile = meta.file ? meta.file.replace(/\.[^.]+$/, '.prompt.txt') : null;
  if (contentPromptFile) fs.writeFileSync(contentPromptFile, prompt, 'utf8');
  meta.promptFile = contentPromptFile || promptFile;
  meta.prompt = prompt;
  meta.codexThread = result.threadId;
  meta.codexLog = result.log;
  return meta;
}

export function verifyCoverForWechat(articleFile: string, coverFile: string): CoverWechatCheck {
  const draftScript = path.join(PUSH_DIR, 'draft.mjs');
  const preflight = path.join(WS_ROOT, '02-发布工具', 'skills', 'wechat-draft-push', 'scripts', 'preflight.mjs');
  const dry = spawnSync(
    process.execPath,
    [draftScript, '-f', articleFile, '--cover', coverFile, '--dry-run'],
    { cwd: PUSH_DIR, encoding: 'utf8', timeout: 120_000, maxBuffer: 8 * 1024 * 1024 },
  );
  const pre = spawnSync(process.execPath, [preflight, '--md', articleFile], {
    cwd: WS_ROOT,
    encoding: 'utf8',
    timeout: 60_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  const dryRunOk = dry.status === 0;
  const preflightOk = pre.status === 0;
  return {
    dryRunOk,
    preflightOk,
    ok: dryRunOk && preflightOk,
    dryRun: `${dry.stdout || ''}${dry.stderr || ''}`.trim().slice(-4000),
    preflight: `${pre.stdout || ''}${pre.stderr || ''}`.trim().slice(-4000),
  };
}

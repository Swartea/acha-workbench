import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { isUnder } from '@/lib/guard';

/**
 * 三个模型 CLI 的一次性（one-shot）调用通道：提示词进 → 文本出。
 * 不维护会话，不自动重试；失败原因原样上报，便于人工判断。
 * 可执行文件路径与 AO agents-realflow.yaml 同源；机器路径变化时只改这里的常量。
 */

/** 先按名字在 PATH 里找；可用 WB_BIN_* 环境变量覆盖。找不到退回裸名字，由 modelAvailable 报不可用。 */
function resolveBin(name: string, envKey: string): string {
  const override = process.env[envKey];
  if (override) return override;
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, name);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      /* 继续找下一个 */
    }
  }
  return name;
}

const BIN = {
  glm: resolveBin('zcode-official', 'WB_BIN_GLM'),
  kimi: resolveBin('kimi', 'WB_BIN_KIMI'),
  minimax: resolveBin('mcode', 'WB_BIN_MINIMAX'),
};

export type ModelKey = keyof typeof BIN;

const TIMEOUT_MS = 8 * 60 * 1000; // 单专家一步上限
const MAX_CAPTURE = 60_000; // stdout/stderr 捕获上限，防异常输出刷爆内存

export interface ModelResult {
  ok: boolean;
  text: string;
  durationMs: number;
  exitCode: number | null;
  error?: string;
}

export function modelAvailable(model: ModelKey): boolean {
  try {
    fs.accessSync(BIN[model], fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** root 下允许写读的临时文件：resolve 后必须落在 root 内，文件名是白名单常量。 */
function fileUnder(root: string, name: 'prompt.txt' | 'answer.txt'): string {
  const target = path.resolve(root, name);
  if (!isUnder(root, target)) {
    throw new Error(`路径越界：${name}`);
  }
  return target;
}

function runProc(
  cmd: string,
  args: string[],
  opts: { timeoutMs: number; cwd?: string },
): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const p = spawn(cmd, args, {
      cwd: opts.cwd,
      env: { ...process.env, NO_COLOR: '1', TERM: 'dumb' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const timer = setTimeout(() => {
      timedOut = true;
      p.kill('SIGKILL');
    }, opts.timeoutMs);
    p.stdout.on('data', (d: Buffer) => {
      if (stdout.length < MAX_CAPTURE) stdout += d.toString();
    });
    p.stderr.on('data', (d: Buffer) => {
      if (stderr.length < MAX_CAPTURE) stderr += d.toString();
    });
    p.on('error', (e) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: `${stderr}\n${e.message}`, timedOut });
    });
    p.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}

async function callGlm(prompt: string, workDir: string): Promise<ModelResult> {
  const t0 = Date.now();
  fs.writeFileSync(fileUnder(workDir, 'prompt.txt'), prompt, 'utf8');
  const r = await runProc(BIN.glm, ['-p', prompt], { timeoutMs: TIMEOUT_MS, cwd: workDir });
  const text = r.stdout.trim();
  return {
    ok: !r.timedOut && r.code === 0 && text.length > 0,
    text: text || r.stderr.trim() || '(空回复)',
    durationMs: Date.now() - t0,
    exitCode: r.code,
    error: r.timedOut ? '超时' : text ? undefined : r.stderr.trim().slice(0, 500) || '空回复',
  };
}

async function callKimi(prompt: string, workDir: string): Promise<ModelResult> {
  const t0 = Date.now();
  fs.writeFileSync(fileUnder(workDir, 'prompt.txt'), prompt, 'utf8');
  const r = await runProc(
    BIN.kimi,
    ['-p', prompt, '--output-format', 'text'],
    { timeoutMs: TIMEOUT_MS, cwd: workDir },
  );
  const text = r.stdout.trim();
  return {
    ok: !r.timedOut && r.code === 0 && text.length > 0,
    text: text || r.stderr.trim() || '(空回复)',
    durationMs: Date.now() - t0,
    exitCode: r.code,
    error: r.timedOut ? '超时' : text ? undefined : r.stderr.trim().slice(0, 500) || '空回复',
  };
}

async function callMinimax(prompt: string, workDir: string): Promise<ModelResult> {
  const t0 = Date.now();
  fs.writeFileSync(fileUnder(workDir, 'prompt.txt'), prompt, 'utf8');
  const outFile = fileUnder(workDir, 'answer.txt');
  const r = await runProc(
    BIN.minimax,
    [
      'exec',
      '--cwd',
      workDir,
      '--output-format',
      'text',
      '-o',
      outFile,
      '--max-steps',
      '16',
      '--timeout',
      '8m',
      prompt,
    ],
    { timeoutMs: TIMEOUT_MS + 30_000, cwd: workDir },
  );
  let text = '';
  try {
    text = fs.readFileSync(outFile, 'utf8').trim();
  } catch {
    text = r.stdout.trim();
  }
  return {
    ok: !r.timedOut && text.length > 0,
    text: text || r.stderr.trim() || '(空回复)',
    durationMs: Date.now() - t0,
    exitCode: r.code,
    error: r.timedOut ? '超时' : text ? undefined : r.stderr.trim().slice(0, 500) || '空回复',
  };
}

export function callModel(model: ModelKey, prompt: string, workDir: string): Promise<ModelResult> {
  fs.mkdirSync(workDir, { recursive: true });
  if (!modelAvailable(model)) {
    return Promise.resolve({
      ok: false,
      text: '',
      durationMs: 0,
      exitCode: null,
      error: `模型 CLI 不可用：${BIN[model]} 不存在或不可执行`,
    });
  }
  if (model === 'glm') return callGlm(prompt, workDir);
  if (model === 'kimi') return callKimi(prompt, workDir);
  return callMinimax(prompt, workDir);
}

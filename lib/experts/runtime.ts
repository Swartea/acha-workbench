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
  // GLM / DeepSeek 都复用 claude CLI（本机已装），走各自官方 Anthropic 兼容端点；
  // 载体可用 WB_BIN_GLM / WB_BIN_DEEPSEEK 覆盖，端点/模型/Key 见下方 ENV_META。
  glm: resolveBin('claude', 'WB_BIN_GLM'),
  kimi: resolveBin('kimi', 'WB_BIN_KIMI'),
  minimax: resolveBin('mcode', 'WB_BIN_MINIMAX'),
  deepseek: resolveBin('claude', 'WB_BIN_DEEPSEEK'),
};

export type ModelKey = keyof typeof BIN;

/**
 * GLM / DeepSeek 的接入参数（两家官方 Anthropic 兼容端点）。
 * Key 从环境变量读：Next 会自动加载 06-工作台/.env.local，把
 * ZHIPUAI_API_KEY / DEEPSEEK_API_KEY 写进去即可。
 *
 * 调用形态（claude 2.1.x 实测验证）：模型目录强校验只认目录名，
 * 所以 --model 必须传 sonnet（目录名），再经 --settings 内联 JSON 把
 * ANTHROPIC_DEFAULT_SONNET/OPUS/HAIKU_MODEL 映射到第三方模型 id；
 * --setting-sources 跳过 user 级配置——本机全局 settings.json 指向
 * MiniMax 端点，不能让它串台。
 */
const ENV_META: Record<string, { baseUrl: string; keyEnv: string; modelId: string }> = {
  glm: {
    baseUrl: 'https://open.bigmodel.cn/api/anthropic',
    keyEnv: 'ZHIPUAI_API_KEY',
    modelId: process.env.ZHIPUAI_MODEL ?? 'glm-4.6',
  },
  deepseek: {
    baseUrl: 'https://api.deepseek.com/anthropic',
    keyEnv: 'DEEPSEEK_API_KEY',
    modelId: process.env.DEEPSEEK_MODEL ?? 'deepseek-flash',
  },
};

/** 组装 claude 载体的调用参数（Key 走 --settings 内联 JSON，不进进程环境）。 */
function claudeCarrierArgs(prompt: string, baseUrl: string, key: string, modelId: string): string[] {
  const settings = JSON.stringify({
    env: {
      ANTHROPIC_BASE_URL: baseUrl,
      ANTHROPIC_AUTH_TOKEN: key,
      ANTHROPIC_DEFAULT_SONNET_MODEL: modelId,
      ANTHROPIC_DEFAULT_OPUS_MODEL: modelId,
      ANTHROPIC_DEFAULT_HAIKU_MODEL: modelId,
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    },
  });
  return ['-p', prompt, '--model', 'sonnet', '--settings', settings, '--setting-sources', 'project,local'];
}

/** 该模型的 API Key 是否已配置（GLM/DeepSeek 需要；kimi/minimax 的 CLI 自带登录态）。 */
export function keyPresent(model: ModelKey): boolean {
  const meta = ENV_META[model];
  if (!meta) return true;
  return Boolean((process.env[meta.keyEnv] ?? '').trim());
}

export function apiKeyEnvName(model: ModelKey): string | null {
  return ENV_META[model]?.keyEnv ?? null;
}

const TIMEOUT_MS = 8 * 60 * 1000; // 单专家一步上限
const MAX_CAPTURE = 60_000; // stdout/stderr 捕获上限，防异常输出刷爆内存

export interface ModelResult {
  ok: boolean;
  text: string;
  durationMs: number;
  exitCode: number | null;
  error?: string;
  /** 超时属于「模型当下不可用」，调用方兜底时不应重试同一模型。 */
  timedOut?: boolean;
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
  opts: { timeoutMs: number; cwd?: string; env?: Record<string, string> },
): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const p = spawn(cmd, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env, NO_COLOR: '1', TERM: 'dumb' },
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
  const meta = ENV_META.glm;
  const key = (process.env[meta.keyEnv] ?? '').trim();
  if (!key) {
    return {
      ok: false,
      text: '',
      durationMs: 0,
      exitCode: null,
      error: `缺 ${meta.keyEnv}：把智谱 API Key 写进 06-工作台/.env.local 后重启工作台`,
    };
  }
  const r = await runProc(BIN.glm, claudeCarrierArgs(prompt, meta.baseUrl, key, meta.modelId), {
    timeoutMs: TIMEOUT_MS,
    cwd: workDir,
  });
  const text = r.stdout.trim();
  return {
    ok: !r.timedOut && r.code === 0 && text.length > 0,
    text: text || r.stderr.trim() || '(空回复)',
    durationMs: Date.now() - t0,
    exitCode: r.code,
    timedOut: r.timedOut,
    error: r.timedOut ? '超时' : text ? undefined : r.stderr.trim().slice(0, 500) || '空回复',
  };
}

async function callDeepseek(prompt: string, workDir: string): Promise<ModelResult> {
  const t0 = Date.now();
  fs.writeFileSync(fileUnder(workDir, 'prompt.txt'), prompt, 'utf8');
  const meta = ENV_META.deepseek;
  const key = (process.env[meta.keyEnv] ?? '').trim();
  if (!key) {
    return {
      ok: false,
      text: '',
      durationMs: 0,
      exitCode: null,
      error: `缺 ${meta.keyEnv}：把 DeepSeek API Key 写进 06-工作台/.env.local 后重启工作台`,
    };
  }
  const r = await runProc(BIN.deepseek, claudeCarrierArgs(prompt, meta.baseUrl, key, meta.modelId), {
    timeoutMs: TIMEOUT_MS,
    cwd: workDir,
  });
  const text = r.stdout.trim();
  return {
    ok: !r.timedOut && r.code === 0 && text.length > 0,
    text: text || r.stderr.trim() || '(空回复)',
    durationMs: Date.now() - t0,
    exitCode: r.code,
    timedOut: r.timedOut,
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
    timedOut: r.timedOut,
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
    timedOut: r.timedOut,
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
  if (model === 'deepseek') return callDeepseek(prompt, workDir);
  return callMinimax(prompt, workDir);
}

/** 通用安装执行器（/api/experts/install 用）：走既有 runProc，不新增 spawn 原语。 */
export function runInstall(
  cmd: string,
  args: string[],
  timeoutMs = 300_000,
): Promise<{ ok: boolean; output: string }> {
  return runProc(cmd, args, { timeoutMs }).then((r) => ({
    ok: !r.timedOut && r.code === 0,
    output: (r.stdout + '\n' + r.stderr).trim().slice(-4000),
  }));
}

export const FALLBACK_MODEL: Record<ModelKey, ModelKey> = {
  kimi: 'minimax',
  minimax: 'kimi',
  glm: 'minimax',
  deepseek: 'kimi',
};

/**
 * 「失败即整轮报废」的调用加兜底：失败重试 1 次；超时说明模型当下不可用，
 * 不浪费时间重试，直接换备用模型。失败重试没有产出内容，不计入「全篇 ≤3 次
 * 生成」预算；成功版本仍受生成次数约束（写稿 1 + 返工 2）。
 */
export async function callModelGuarded(
  model: ModelKey,
  prompt: string,
  workDir: string,
  onFail?: (message: string) => void,
): Promise<string> {
  const chain: ModelKey[] = [model, FALLBACK_MODEL[model]];
  let lastError = '';
  for (const m of chain) {
    for (let tries = 1; tries <= 2; tries++) {
      const res = await callModel(m, prompt, workDir);
      if (res.ok) {
        if (m !== model) onFail?.(`主模型失败，已降级到 ${m} 完成`);
        else if (tries > 1) onFail?.(`${model} 首次失败，重试成功`);
        return res.text;
      }
      lastError = `${m}：${res.error ?? '未知错误'}`;
      onFail?.(`${m} 第 ${tries} 次调用失败（${lastError.slice(0, 160)}）`);
      if (res.timedOut) break; // 超时不重试，换下一个模型
    }
  }
  throw new Error(`写稿调用连续失败：${lastError}`);
}

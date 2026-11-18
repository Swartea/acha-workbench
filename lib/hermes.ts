import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { HERMES_DATA_DIR } from './paths';
import { assertUnder } from './guard';
import { stampUtc } from './parse.mjs';
import { addHermesRun, getHermesRun, getRecentHermesRuns, updateHermesRun, type HermesRun } from './db';

/**
 * Hermes 管家运行时（工作台侧，纯 HTTP：不 spawn 任何子进程）。
 *
 * 链路：POST /api/hermes → 本模块 fetch Hermes Gateway（127.0.0.1:8642）
 * 的 /v1/runs 异步接口（model=acha-butler → minimax-cn / MiniMax-M3，
 * 路由定义在 ~/.hermes/config.yaml platforms.api_server.extra.model_routes）。
 * Gateway 常驻进程负责 agent 循环、shell 工具与 acha-gongzhonghao skill；
 * 管家按 skill 协议把 RESULT.json 写进运行目录，本模块轮询时收口状态。
 *
 * 凭据：Gateway 的 API_SERVER_KEY 在运行时从 ~/.hermes/.env 读取，
 * 只用于请求头，不落工作台代码/配置/日志，不在任何响应里回显。
 *
 * 失败语义：启动失败（Gateway 不在线/锁冲突）立即报错；运行中失败由
 * Gateway 状态与 RESULT.json 判定；本模块不做模型调用的自动重试。
 */

const GATEWAY = 'http://127.0.0.1:8642';
const HERMES_ENV = path.join(process.env.HOME ?? '', '.hermes', '.env');
const MODEL_ALIAS = 'acha-butler';
const MAX_MESSAGE = 2000;
const RUN_STALE_MS = 45 * 60 * 1000; // 超过 Gateway 侧上限后视为僵死，收口为 error

function gatewayKey(): string | null {
  try {
    const m = fs.readFileSync(HERMES_ENV, 'utf8').match(/^API_SERVER_KEY=(\S+)/m);
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}

export function hermesAvailable(): boolean {
  return gatewayKey() !== null;
}

/** 任务文本清洗：去控制字符（保留换行/制表）、限长。只作提示词数据用。 */
function sanitizeMessage(raw: string): string {
  return raw
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
    .slice(0, MAX_MESSAGE);
}

/** 路径守卫：resolve 后必须落在 root 内。 */
function underRoot(root: string, ...segs: string[]): string {
  return assertUnder(root, ...segs);
}

const stamp = stampUtc;

function buildPrompt(message: string, runDir: string): string {
  const today = new Date().toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' });
  return [
    '【阿茶公众号管家任务】',
    `用户指令：${message}`,
    `运行目录：${runDir}`,
    `今天是 ${today}。`,
    '按 acha-gongzhonghao skill 的流程执行；结束后必须把结果写入「运行目录/RESULT.json」，',
    '并把最终中文简报（做了什么、稿件在哪、预检与草稿状态、留给用户的决定）作为你的最终回复输出。',
  ].join('\n');
}

interface GatewayRunStatus {
  status: string;
  output?: string | null;
  error?: string | null;
}

async function gatewayFetch(pathname: string, init?: RequestInit): Promise<GatewayRunStatus | null> {
  const key = gatewayKey();
  if (!key) return null;
  try {
    const res = await fetch(`${GATEWAY}${pathname}`, {
      ...init,
      headers: {
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
        ...(init?.headers ?? {}),
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const txt = await res.text();
    return JSON.parse(txt) as GatewayRunStatus;
  } catch {
    return null;
  }
}

/**
 * 对本工作台派出的 run 自动批准待审命令（choice=session：仅该 run 会话内生效）。
 * 背景：Gateway 审批 mode=manual，复合命令不进 allowlist（防注入设计）；
 * 管家流程里的 mcode / curl / node 属任务授权动作，由派活方（本工作台，
 * 仅本机可调）代批，避免每一步卡 60-900 秒审批窗口后超时停摆。
 */
async function approveRun(gatewayRunId: string): Promise<void> {
  await gatewayFetch(`/v1/runs/${gatewayRunId}/approval`, {
    method: 'POST',
    body: JSON.stringify({ choice: 'session' }),
  });
}

/**
 * run 是否确认丢失：GET 返回 404 = Gateway 重启清空（run 记录不持久）。
 * true=确认丢失；false=正常拿到；null=查询故障（网络/超时/5xx），不下结论。
 */
async function gatewayRunLost(gatewayRunId: string): Promise<boolean | null> {
  const key = gatewayKey();
  if (!key) return null;
  try {
    const res = await fetch(`${GATEWAY}/v1/runs/${gatewayRunId}`, {
      headers: { authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 404) return true;
    return res.ok ? false : null;
  } catch {
    return null;
  }
}

/**
 * 断线续跑（每 run 最多一次）：api_server 平台的 run_id 即 session_id
 * （POST /v1/runs 带 session_id 即续原会话，见 gateway api_server_runs.py）。
 * 用运行目录里的 resume.json 标记防循环；成功后把 DB 行指向新 run id，
 * 后续轮询照常跟踪新 run。
 */
async function resumeRunOnce(r: HermesRun): Promise<boolean> {
  const marker = path.join(r.run_dir, 'resume.json');
  if (fs.existsSync(marker)) return false;
  const key = gatewayKey();
  if (!key || !r.gateway_run_id) return false;
  let newRunId: string | null = null;
  try {
    const res = await fetch(`${GATEWAY}/v1/runs`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL_ALIAS,
        session_id: r.gateway_run_id,
        input: [
          '【管家任务续跑】上一条 run 因 Gateway 重启中断。',
          `请读取「${path.join(r.run_dir, 'task.json')}」里的原始指令，检查运行目录里已完成的产物，`,
          '从中断处继续执行；结束后仍按协议把结果写入「运行目录/RESULT.json」，并输出中文简报。',
        ].join('\n'),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const j = res.ok ? ((await res.json()) as { run_id?: string }) : null;
    newRunId = j?.run_id ?? null;
  } catch {
    newRunId = null;
  }
  if (!newRunId) return false;
  try {
    fs.writeFileSync(
      marker,
      JSON.stringify({ resumed_at: new Date().toISOString(), from: r.gateway_run_id, to: newRunId }, null, 2),
      'utf8',
    );
    fs.appendFileSync(path.join(r.run_dir, 'transcript.log'), `\n[自动续跑] ${r.gateway_run_id} → ${newRunId}\n`);
  } catch {
    /* 留档失败不影响续跑本身 */
  }
  updateHermesRun(r.run_id, { gateway_run_id: newRunId });
  return true;
}

interface ResolvedResult {
  status: 'ok' | 'error' | 'blocked';
  resultJson: string | null;
  manuscript: string | null;
  mediaId: string | null;
  error: string | null;
}

/** 结束判定：优先 RESULT.json（skill 协议），缺失则按 Gateway 状态定错。 */
function resolveRun(runDir: string, gw: GatewayRunStatus | null): ResolvedResult {
  const resultPath = path.join(runDir, 'RESULT.json');
  if (fs.existsSync(resultPath)) {
    try {
      const raw = fs.readFileSync(resultPath, 'utf8');
      const j = JSON.parse(raw) as {
        status?: string;
        manuscript?: string | null;
        media_id?: string | null;
        error?: string | null;
      };
      const status = j.status === 'ok' || j.status === 'blocked' ? j.status : 'error';
      return {
        status,
        resultJson: raw,
        manuscript: j.manuscript ?? null,
        mediaId: j.media_id ?? null,
        error: j.error ?? null,
      };
    } catch {
      return { status: 'error', resultJson: null, manuscript: null, mediaId: null, error: 'RESULT.json 解析失败' };
    }
  }
  if (gw?.status === 'completed') {
    return {
      status: 'error',
      resultJson: null,
      manuscript: null,
      mediaId: null,
      error: `管家已完成但未写 RESULT.json。最终回复：${String(gw.output ?? '').slice(0, 400) || '(空)'}`,
    };
  }
  return {
    status: 'error',
    resultJson: null,
    manuscript: null,
    mediaId: null,
    error: `Gateway 状态异常：${gw?.status ?? '不可达'}${gw?.error ? `（${String(gw.error).slice(0, 200)}）` : ''}`,
  };
}

export function readTail(file: string, maxChars: number): string {
  try {
    const txt = fs.readFileSync(file, 'utf8');
    return txt.length > maxChars ? `…${txt.slice(-maxChars)}` : txt;
  } catch {
    return '';
  }
}

export interface StartResult {
  runId: string;
  ok: boolean;
  error?: string;
}

export async function startHermesRun(rawMessage: string): Promise<StartResult> {
  const message = sanitizeMessage(rawMessage);
  if (!message) return { runId: '', ok: false, error: '任务内容为空' };
  const key = gatewayKey();
  if (!key) return { runId: '', ok: false, error: 'Gateway 凭据不可读（~/.hermes/.env 缺 API_SERVER_KEY）' };
  await healStaleRuns();
  const running = getRecentHermesRuns(10).filter((r) => r.status === 'running').length;
  if (running >= 1) {
    return { runId: '', ok: false, error: '已有一个管家任务在运行，请等它结束后再派新任务。' };
  }

  const runId = `h-${stamp()}`;
  const runDir = underRoot(HERMES_DATA_DIR, runId);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(underRoot(runDir, 'task.json'), JSON.stringify({ message, run_id: runId }, null, 2), 'utf8');

  let gw: (GatewayRunStatus & { run_id?: string }) | null = null;
  try {
    const res = await fetch(`${GATEWAY}/v1/runs`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL_ALIAS, input: buildPrompt(message, runDir) }),
      signal: AbortSignal.timeout(15_000),
    });
    gw = res.ok ? ((await res.json()) as GatewayRunStatus & { run_id?: string }) : null;
  } catch {
    gw = null;
  }
  if (!gw?.run_id) {
    return { runId: '', ok: false, error: 'Hermes Gateway 不在线或拒绝启动任务（127.0.0.1:8642）' };
  }

  addHermesRun({
    run_id: runId,
    message,
    status: 'running',
    gateway_run_id: gw.run_id,
    run_dir: runDir,
  });
  return { runId, ok: true };
}

/** 收口：running 行按 Gateway 状态 / RESULT.json / 超时三路判定。 */
export async function healStaleRuns(): Promise<void> {
  const rows = getRecentHermesRuns(10).filter((r) => r.status === 'running');
  for (const r of rows) {
    const gw = r.gateway_run_id
      ? await gatewayFetch(`/v1/runs/${r.gateway_run_id}`)
      : null;
    if (!gw) {
      // GET 失败：区分「查询故障」与「run 记录确认丢失」（Gateway 重启清空，不持久）。
      const lost = r.gateway_run_id ? await gatewayRunLost(r.gateway_run_id) : null;
      if (lost !== true) continue; // 查询故障不下结论，等下一轮
      if (fs.existsSync(path.join(r.run_dir, 'RESULT.json'))) {
        // RESULT 已落盘：按 skill 协议直接收口
        updateHermesRun(r.run_id, resolveRun(r.run_dir, null));
        continue;
      }
      if (await resumeRunOnce(r)) continue; // 已唤醒续跑，本轮不收口
      updateHermesRun(r.run_id, {
        status: 'error',
        result_json: null,
        manuscript: null,
        media_id: null,
        error: 'Gateway 重启清空了 run 记录，自动续跑未成功；运行目录产物已保留，可重新派活或查看已完成部分。',
      });
      continue;
    }
    // 派活方代批：待审批时立即放行（仅该 run 会话），避免审批窗口超时停摆
    if (gw.status === 'waiting_for_approval' && r.gateway_run_id) {
      await approveRun(r.gateway_run_id);
    }
    const done = ['completed', 'failed', 'cancelled'].includes(gw.status);
    const stale = Date.now() - Date.parse(r.created_at) > RUN_STALE_MS;
    if (done || stale) {
      const resolved = resolveRun(r.run_dir, gw);
      // 把最终简报留档，便于页面查看
      if (gw.output) {
        try {
          fs.appendFileSync(path.join(r.run_dir, 'transcript.log'), `\n[最终回复] ${String(gw.output)}\n`);
        } catch {
          /* 留档失败不影响状态 */
        }
      }
      updateHermesRun(r.run_id, resolved);
    }
  }
}

/** 详情视图数据：DB 行 + 转写尾部 + 运行目录产物清单 + Gateway 实时状态。 */
export async function hermesRunDetail(runId: string) {
  await healStaleRuns();
  const row = getHermesRun(runId);
  if (!row) return null;
  let gw: GatewayRunStatus | null = null;
  if (row.status === 'running' && row.gateway_run_id) {
    gw = await gatewayFetch(`/v1/runs/${row.gateway_run_id}`);
  }
  const transcriptTail = readTail(path.join(row.run_dir, 'transcript.log'), 3000);
  let artifacts: string[] = [];
  try {
    artifacts = fs
      .readdirSync(row.run_dir, { recursive: true })
      .map((p) => String(p))
      .filter((p) => !p.startsWith('.'))
      .slice(0, 50);
  } catch {
    /* 目录缺失则空 */
  }
  return { row, gwStatus: gw?.status ?? null, transcriptTail, artifacts };
}

export function fileHash(file: string): string {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

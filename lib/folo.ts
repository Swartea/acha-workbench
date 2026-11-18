import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, FOLO_RADAR_FILE, FOLO_STATE_FILE, LIB } from './paths';
import { assertUnder } from './guard';
import { translateFoloEntries } from './folo-translate';
import {
  dateKey,
  markSeen,
  mergeRadarEntries,
  normalizeFoloEntry,
  parseEnvelope,
  radarLogFileName,
  renderRadarMarkdown,
  selectNewEntries,
  type FoloEntry,
  type FoloRadarFile,
  type FoloStatus,
  type StoredFoloEntry,
} from './folo-core';

const execFileAsync = promisify(execFile);

interface FoloState {
  seen: Record<string, string>;
}

export interface PullFoloResult {
  ok: boolean;
  code?: string;
  error?: string;
  status: FoloStatus;
  added?: number;
  total?: number;
  entries?: FoloEntry[];
  radar?: FoloRadarFile;
  logFile?: string;
  /** timeline = 未读时间线；feeds = 时间线为空时回退到订阅源最新条目 */
  mode?: 'timeline' | 'feeds';
  feedsScanned?: number;
  /** 本次新翻译的条数（缓存命中不算） */
  translated?: number;
  translateModel?: string;
  translateError?: string;
}

let statusCache: { at: number; value: FoloStatus } | null = null;

function bin(): string {
  return (process.env.WB_FOLO_BIN ?? '').trim() || 'folo';
}

/**
 * folo 走的 api.folo.is 本机直连不通，必须走系统代理（如 http://127.0.0.1:10808）。
 * Node ≥24 的 fetch 要显式开 NODE_USE_ENV_PROXY=1 才会读 HTTPS_PROXY。
 * 代理地址用 WB_FOLO_PROXY 覆盖；留空字符串可显式关闭代理。
 */
function foloEnv(): NodeJS.ProcessEnv {
  const proxy = (process.env.WB_FOLO_PROXY ?? 'http://127.0.0.1:10808').trim();
  return {
    ...process.env,
    ...(proxy
      ? {
          NODE_USE_ENV_PROXY: '1',
          HTTPS_PROXY: proxy,
          HTTP_PROXY: proxy,
        }
      : {}),
  };
}

function run(args: string[], timeout: number) {
  const started = Date.now();
  const result = spawnSync(bin(), args, {
    encoding: 'utf8',
    timeout,
    env: foloEnv(),
    maxBuffer: 20 * 1024 * 1024,
  });
  const error = result.error as NodeJS.ErrnoException | undefined;
  return {
    ok: !error && result.status === 0,
    status: result.status,
    stdout: typeof result.stdout === 'string' ? result.stdout : '',
    stderr: typeof result.stderr === 'string' ? result.stderr : '',
    errorCode: error?.code ?? '',
    errorMessage: error?.message ?? '',
    durationMs: Date.now() - started,
  };
}

async function runAsync(args: string[], timeout: number) {
  const started = Date.now();
  try {
    const { stdout, stderr } = await execFileAsync(bin(), args, {
      encoding: 'utf8',
      timeout,
      env: foloEnv(),
      maxBuffer: 20 * 1024 * 1024,
    });
    return {
      ok: true,
      status: 0,
      stdout: stdout ?? '',
      stderr: stderr ?? '',
      errorCode: '',
      errorMessage: '',
      durationMs: Date.now() - started,
    };
  } catch (error) {
    const e = error as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
      killed?: boolean;
      signal?: string;
    };
    return {
      ok: false,
      status: typeof e.code === 'number' ? e.code : null,
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? '',
      errorCode: e.killed ? 'ETIMEDOUT' : typeof e.code === 'string' ? e.code : '',
      errorMessage: e.message ?? '',
      durationMs: Date.now() - started,
    };
  }
}

function userOf(data: unknown): string {
  if (!data || typeof data !== 'object') return '';
  const d = data as Record<string, unknown>;
  const nested = d.user && typeof d.user === 'object' ? (d.user as Record<string, unknown>) : {};
  return String(
    d.name ?? d.email ?? d.username ?? nested.name ?? nested.email ?? nested.username ?? '',
  ).trim();
}

/**
 * Folo CLI 状态。`--version` 用来判断装没装，`whoami` 用来判断登没登。
 * 结果缓存 15 秒，避免每次进页面都等一次网络请求；force=true 供“重新检查”用。
 */
export function getFoloStatus(force = false): FoloStatus {
  const now = Date.now();
  if (!force && statusCache && now - statusCache.at < 15_000) return statusCache.value;

  const base: FoloStatus = {
    installed: false,
    authed: false,
    user: '',
    version: '',
    bin: bin(),
    error: '',
  };

  const version = run(['--version'], 5_000);
  if (version.errorCode === 'ENOENT') {
    base.error = `找不到 ${base.bin} 命令（可设 WB_FOLO_BIN 指向本地 folo）`;
    statusCache = { at: now, value: base };
    return base;
  }
  base.installed = true;
  base.version = (version.stdout || version.stderr)
    .trim()
    .split('\n')[0]
    .replace(/^folo\/?/i, '')
    .slice(0, 40);

  const me = run(['whoami'], 8_000);
  if (me.errorCode === 'ENOENT') {
    base.error = `找不到 ${base.bin} 命令（可设 WB_FOLO_BIN 指向本地 folo）`;
    base.installed = false;
    statusCache = { at: now, value: base };
    return base;
  }

  const envelope = parseEnvelope(me.stdout) ?? parseEnvelope(me.stderr);
  if (!envelope) {
    base.error = (me.stderr || me.stdout || `whoami 退出码 ${me.status}`).trim().slice(0, 500);
  } else if (!envelope.ok) {
    base.error = (envelope.error?.message || envelope.error?.code || 'Folo 未登录').slice(0, 500);
  } else {
    base.authed = true;
    base.user = userOf(envelope.data);
  }

  statusCache = { at: now, value: base };
  return base;
}

function readState(): FoloState {
  try {
    const raw = JSON.parse(fs.readFileSync(FOLO_STATE_FILE, 'utf8')) as unknown;
    const rec = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    const seen = rec.seen && typeof rec.seen === 'object' ? (rec.seen as Record<string, unknown>) : {};
    const clean: Record<string, string> = {};
    for (const [key, value] of Object.entries(seen)) {
      if (typeof value === 'string') clean[key] = value;
    }
    return { seen: clean };
  } catch {
    return { seen: {} };
  }
}

function writeJson(file: string, value: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

export function readFoloRadar(): FoloRadarFile {
  try {
    const raw = JSON.parse(fs.readFileSync(FOLO_RADAR_FILE, 'utf8')) as unknown;
    const rec = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    const entries = Array.isArray(rec.entries)
      ? rec.entries
          .map((entry): StoredFoloEntry | null => {
            if (!entry || typeof entry !== 'object') return null;
            const e = entry as Record<string, unknown>;
            if (typeof e.id !== 'string' || typeof e.title !== 'string') return null;
            return {
              id: e.id,
              title: e.title,
              url: typeof e.url === 'string' ? e.url : '',
              feed: typeof e.feed === 'string' ? e.feed : '',
              publishedAt: typeof e.publishedAt === 'string' ? e.publishedAt : '',
              description: typeof e.description === 'string' ? e.description : '',
              read: Boolean(e.read),
              pulledAt: typeof e.pulledAt === 'string' ? e.pulledAt : '',
              titleZh: typeof e.titleZh === 'string' ? e.titleZh : '',
              descriptionZh: typeof e.descriptionZh === 'string' ? e.descriptionZh : '',
            };
          })
          .filter((entry): entry is StoredFoloEntry => !!entry)
      : [];
    return {
      pulledAt: typeof rec.pulledAt === 'string' ? rec.pulledAt : '',
      entries,
    };
  } catch {
    return { pulledAt: '', entries: [] };
  }
}

async function fetchTimeline(limit: number) {
  const result = await runAsync(
    ['timeline', '--unread-only', '--limit', String(limit), '--format', 'json'],
    60_000,
  );
  const envelope = parseEnvelope(result.stdout) ?? parseEnvelope(result.stderr);
  if (!envelope) {
    return {
      ok: false,
      code: result.errorCode || 'BAD_OUTPUT',
      error: (result.stderr || result.stdout || `folo 退出码 ${result.status}`).trim().slice(0, 800),
    };
  }
  if (!envelope.ok) {
    return {
      ok: false,
      code: envelope.error?.code || 'FOLO_ERROR',
      error: (envelope.error?.message || 'Folo 返回失败').slice(0, 800),
    };
  }

  const data = envelope.data as unknown;
  const rec = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  const list = Array.isArray(rec.entries) ? rec.entries : Array.isArray(data) ? data : [];
  // 时间线里也可能混进 Elon / Trump / The Verge 这些默认源；
  // 和回退路径用同一套 AI/Agent 源过滤，避免把噪声写进雷达。
  const filtered = list.filter((item) => {
    if (!item || typeof item !== 'object') return false;
    const row = item as Record<string, unknown>;
    const feed = row.feeds && typeof row.feeds === 'object' ? (row.feeds as Record<string, unknown>) : {};
    return feedMatches({
      title: String(feed.title ?? ''),
      url: String(feed.url ?? ''),
    });
  });
  const entries = filtered
    .map((item) => normalizeFoloEntry(item))
    .filter((item): item is FoloEntry => !!item);

  return { ok: true, entries };
}

interface FoloSubscription {
  feedId: string;
  title: string;
  url: string;
  category: string;
  view: number;
}

const MAX_FALLBACK_FEEDS = 8;
const PER_FEED_ENTRIES = 3;

/** 订阅列表；跳过 onboarding 和明确隐藏的源。 */
async function listSubscriptions(): Promise<FoloSubscription[]> {
  const result = await runAsync(['subscription', 'list', '--format', 'json'], 20_000);
  const envelope = parseEnvelope(result.stdout) ?? parseEnvelope(result.stderr);
  if (!envelope || !envelope.ok) return [];
  const data = envelope.data as unknown;
  const rec = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  const list = Array.isArray(rec.subscriptions) ? rec.subscriptions : [];
  const out: FoloSubscription[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const x = item as Record<string, unknown>;
    const f = x.feeds && typeof x.feeds === 'object' ? (x.feeds as Record<string, unknown>) : {};
    const feedId = String(x.feedId ?? f.id ?? '').trim();
    const url = String(f.url ?? '').trim();
    if (!feedId || !url || url.startsWith('folo://')) continue;
    if (x.hideFromTimeline === true) continue;
    out.push({
      feedId,
      title: String(f.title ?? '').trim(),
      url,
      category: String(x.category ?? '').trim(),
      view: Number(x.view ?? 0),
    });
  }
  return out;
}

/**
 * 时间线返回 0 时的回退：直接读每个订阅源的最近条目。
 * 新账号 / 全已读时 timeline 会是空的，但 feed get 仍有条目。
 */
async function fetchFeedEntries(sub: FoloSubscription): Promise<FoloEntry[]> {
  const result = await runAsync(['feed', 'get', sub.feedId, '--format', 'json'], 8_000);
  const envelope = parseEnvelope(result.stdout) ?? parseEnvelope(result.stderr);
  if (!envelope || !envelope.ok) return [];
  const data = envelope.data as unknown;
  const rec = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  const feed =
    rec.feed && typeof rec.feed === 'object'
      ? (rec.feed as Record<string, unknown>)
      : { title: sub.title, url: sub.url };
  const list = Array.isArray(rec.entries) ? rec.entries : [];
  return list
    .map((entry) => normalizeFoloEntry({ entries: entry, feeds: feed }))
    .filter((entry): entry is FoloEntry => !!entry)
    .sort((a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || ''))
    .slice(0, PER_FEED_ENTRIES);
}

async function mapLimit<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      out[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return out;
}

const DEFAULT_FEED_FILTER =
  /(openai|anthropic|claude|codex|github|agent|llm|\bai\b|machine.?learning|deepmind|gemini|hugging|karpathy|altman|模型|智能|人工智能|开源)/i;

function feedMatches(sub: { title: string; url: string }): boolean {
  const custom = (process.env.FOLO_FEED_FILTER ?? '').trim();
  if (custom) {
    try {
      return new RegExp(custom, 'i').test(`${sub.title} ${sub.url}`);
    } catch {
      // 无效自定义正则时退回默认
    }
  }
  return DEFAULT_FEED_FILTER.test(`${sub.title} ${sub.url}`);
}

async function fetchFromSubscriptions(limit: number): Promise<{ entries: FoloEntry[]; scanned: number }> {
  const subscriptions = await listSubscriptions();
  const matched = subscriptions.filter(feedMatches);
  const chosen = (matched.length ? matched : subscriptions).slice(0, MAX_FALLBACK_FEEDS);
  const groups = await mapLimit(chosen, 8, (sub) => fetchFeedEntries(sub));
  const all = groups.flat();

  const cutoff = Date.now() - 30 * 24 * 3600_000;
  const seen = new Set<string>();
  const recent = all.filter((entry) => {
    if (seen.has(entry.id)) return false;
    seen.add(entry.id);
    if (!entry.publishedAt) return true;
    const time = Date.parse(entry.publishedAt);
    return Number.isNaN(time) || time >= cutoff;
  });

  return {
    entries: recent
      .sort((a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || ''))
      .slice(0, limit),
    scanned: chosen.length,
  };
}

function radarLogPath(date: string): string {
  return assertUnder(LIB, radarLogFileName('Folo', date));
}

/**
 * 拉一次未读时间线：只读 Folo，不标已读；本地去重后写 JSON + 当天雷达日志。
 */
export async function pullFoloRadar(
  options: { limit?: number; includeSeen?: boolean } = {},
): Promise<PullFoloResult> {
  const requested = Number(options.limit ?? 50);
  const limit = Number.isFinite(requested) ? Math.min(100, Math.max(1, Math.round(requested))) : 50;
  const includeSeen = Boolean(options.includeSeen);
  const status = getFoloStatus(true);

  if (!status.installed) {
    return {
      ok: false,
      code: 'NOT_INSTALLED',
      error: status.error || '没有安装 folocli',
      status,
    };
  }
  if (!status.authed) {
    return {
      ok: false,
      code: 'UNAUTHORIZED',
      error: status.error || 'Folo 未登录，先在终端跑 folo login',
      status,
    };
  }

  const timeline = await fetchTimeline(limit);
  if (!timeline.ok || !timeline.entries) {
    return {
      ok: false,
      code: timeline.code,
      error: timeline.error || '拉取 Folo 时间线失败',
      status,
    };
  }

  // 新账号 / 全部已读时 timeline 会返回空；回退到订阅源最近条目，
  // 否则用户会看到“登录成功但永远 0 条”。
  let mode: 'timeline' | 'feeds' = 'timeline';
  let candidates = timeline.entries;
  let feedsScanned = 0;
  if (!candidates.length) {
    const fallback = await fetchFromSubscriptions(limit);
    candidates = fallback.entries;
    feedsScanned = fallback.scanned;
    mode = 'feeds';
  }

  const translation = await translateFoloEntries(candidates);
  const translatedCandidates = candidates.map((entry) => {
    const item = translation.map.get(entry.id);
    return item
      ? { ...entry, titleZh: item.titleZh, descriptionZh: item.descriptionZh }
      : entry;
  });

  const now = new Date();
  const pulledAt = now.toISOString();
  const state = readState();
  const newOnes = selectNewEntries(translatedCandidates, state.seen);
  const fresh = includeSeen ? translatedCandidates : newOnes;
  const stored: StoredFoloEntry[] = fresh.map((entry) => ({ ...entry, pulledAt }));

  const radar = readFoloRadar();
  const merged = mergeRadarEntries(radar.entries, stored).map((entry) => {
    const item = translation.map.get(entry.id);
    return item
      ? { ...entry, titleZh: item.titleZh, descriptionZh: item.descriptionZh }
      : entry;
  });
  writeJson(FOLO_STATE_FILE, { seen: markSeen(state.seen, fresh, pulledAt) });
  writeJson(FOLO_RADAR_FILE, { pulledAt, entries: merged });

  const today = dateKey(now);
  const todays = merged.filter((entry) => dateKey(entry.pulledAt) === today);
  let logFile: string | undefined;
  if ((fresh.length > 0 || translation.translated > 0) && todays.length > 0) {
    logFile = radarLogPath(today);
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.writeFileSync(logFile, renderRadarMarkdown(todays, today), 'utf8');
  }

  return {
    ok: true,
    status,
    added: newOnes.length,
    total: candidates.length,
    entries: fresh,
    radar: { pulledAt, entries: merged },
    mode,
    ...(feedsScanned ? { feedsScanned } : {}),
    ...(translation.translated ? { translated: translation.translated } : {}),
    ...(translation.model ? { translateModel: translation.model } : {}),
    ...(translation.error ? { translateError: translation.error } : {}),
    ...(logFile ? { logFile } : {}),
  };
}

/** 读 Folo 条目的 readability 正文（HTML），供自动投料用。 */
export async function readFoloEntryContent(
  id: string,
): Promise<{ ok: boolean; content: string; error?: string }> {
  // 用 JSON 而不是 --format plain：0.0.5 的 plain 会把整个 data 对象 inspect 出来，
  // 正文会变成 "{ content: '...' }" 的 JS 字面量。
  const result = await runAsync(['entry', 'read', id, '--format', 'json'], 30_000);
  const envelope = parseEnvelope(result.stdout) ?? parseEnvelope(result.stderr);
  if (!envelope) {
    return {
      ok: false,
      content: '',
      error: (result.stderr || result.stdout || `entry read 退出码 ${result.status}`)
        .trim()
        .slice(0, 500),
    };
  }
  if (!envelope.ok) {
    return {
      ok: false,
      content: '',
      error: (envelope.error?.message || 'entry read 失败').slice(0, 500),
    };
  }
  const data = envelope.data as unknown;
  const rec = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  const content = typeof rec.content === 'string' ? rec.content : '';
  if (/log in or sign up for x|continue with phone|sign in to x/i.test(content.slice(0, 3000))) {
    return { ok: false, content: '', error: '登录墙：没有抓到正文' };
  }
  return { ok: true, content };
}

/** 读 Folo 条目的原始字段（含 content），用来抽推文/正文里的外链。 */
export async function readFoloEntryRaw(id: string): Promise<{
  content: string;
  description: string;
  title: string;
  url: string;
  error?: string;
}> {
  const result = await runAsync(['entry', 'get', id, '--format', 'json'], 20_000);
  const envelope = parseEnvelope(result.stdout) ?? parseEnvelope(result.stderr);
  if (!envelope || !envelope.ok) {
    return {
      content: '',
      description: '',
      title: '',
      url: '',
      error: (envelope?.error?.message || result.errorMessage || 'entry get 失败').slice(0, 500),
    };
  }
  const data = envelope.data as unknown;
  const rec = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  const entry = rec.entries && typeof rec.entries === 'object' ? (rec.entries as Record<string, unknown>) : {};
  const text = (value: unknown) => (typeof value === 'string' ? value : '');
  return {
    content: text(entry.content),
    description: text(entry.description),
    title: text(entry.title),
    url: text(entry.url),
  };
}

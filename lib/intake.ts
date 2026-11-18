import fs from 'node:fs';
import path from 'node:path';
import { INTAKE_DIR } from './paths';
import { assertUnder } from './guard';
import { stampLocal } from './parse.mjs';

export const MAX_TEXT = 5000;
export const MAX_FILES = 6;
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 15 * 1024 * 1024;

export interface IntakeFile {
  name: string;
  bytes: number;
  ext: string;
}

export type IntakeSource = 'manual' | 'folo' | 'rss';

export interface IntakeLink {
  url: string;
  label: string;
}

export interface IntakeEntry {
  id: string;
  at: string;
  text: string;
  files: IntakeFile[];
  /** manual = 人手投；folo/rss = 从雷达自动抓的公开资料 */
  source?: IntakeSource;
  sourceId?: string;
  sourceUrl?: string;
  sourceTitle?: string;
  /** false = 系统抓的公开资料；true = 作者补过实跑/判断 */
  firstHand?: boolean;
  updatedAt?: string;
  /** 去截图/看原文的链接；第一条通常是 sourceUrl */
  links?: IntakeLink[];
}

const EXT_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

/** 按文件头判类型，不信扩展名。 */
function sniff(buf: Buffer): string | null {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return '.png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return '.jpg';
  if (buf.length >= 6 && buf.subarray(0, 3).toString('ascii') === 'GIF') return '.gif';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return '.webp';
  return null;
}

function safeName(raw: string, ext: string): string {
  const stem = raw
    .replace(/\.[^.]+$/, '')
    .replace(/[^\w\u4e00-\u9fa5.-]+/g, '_')
    .slice(0, 40)
    .replace(/^[._]+/, '');
  return (stem || 'img') + ext;
}

function underRoot(root: string, ...segs: string[]): string {
  return assertUnder(root, ...segs);
}

export function listIntake(limit = 30): IntakeEntry[] {
  if (!fs.existsSync(INTAKE_DIR)) return [];
  return fs
    .readdirSync(INTAKE_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const metaPath = path.join(INTAKE_DIR, d.name, 'meta.json');
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as IntakeEntry;
        return meta;
      } catch {
        return null;
      }
    })
    .filter((x): x is IntakeEntry => !!x)
    .sort((a, b) => (a.at < b.at ? 1 : -1))
    .slice(0, limit);
}

function renderIntakeMarkdown(entry: IntakeEntry): string {
  return [
    '---',
    'type: 素材',
    'at: ' + entry.at,
    'files: ' + entry.files.length,
    'source: ' + (entry.source ?? 'manual'),
    ...(entry.sourceId ? ['source_id: ' + entry.sourceId] : []),
    ...(entry.sourceUrl ? ['source_url: ' + entry.sourceUrl] : []),
    'first_hand: ' + Boolean(entry.firstHand),
    ...(entry.updatedAt ? ['updated: ' + entry.updatedAt] : []),
    '---',
    '',
    entry.text,
    '',
    ...entry.files.map((f) => '![图](<' + f.name + '>)'),
    '',
    ...(entry.links?.length
      ? ['## 去截图', '', ...entry.links.map((l) => `- [${l.label || l.url}](${l.url})`), '']
      : []),
  ].join('\n');
}

function saveMeta(dir: string, entry: IntakeEntry) {
  fs.writeFileSync(underRoot(dir, 'meta.json'), JSON.stringify(entry, null, 2), 'utf8');
  fs.writeFileSync(underRoot(dir, '素材.md'), renderIntakeMarkdown(entry), 'utf8');
}

export async function saveIntake(
  text: string,
  files: File[],
  meta: Partial<
    Pick<IntakeEntry, 'source' | 'sourceId' | 'sourceUrl' | 'sourceTitle' | 'firstHand' | 'links'>
  > = {},
): Promise<IntakeEntry> {
  const clean = text.trim();
  if (!clean) throw new Error('素材内容不能为空');
  if (clean.length > MAX_TEXT) throw new Error('素材太长（上限 ' + MAX_TEXT + ' 字）');
  if (files.length > MAX_FILES) throw new Error('最多 ' + MAX_FILES + ' 张图');

  const now = new Date();
  const stamp = stampLocal('');
  const id = stamp + '-' + Math.random().toString(36).slice(2, 6);

  const dir = underRoot(INTAKE_DIR, id);
  fs.mkdirSync(dir, { recursive: true });

  const saved: IntakeFile[] = [];
  let total = 0;
  const source: IntakeSource = meta.source === 'folo' || meta.source === 'rss' ? meta.source : 'manual';
  const entry: IntakeEntry = {
    id,
    at: now.toISOString(),
    text: clean,
    files: saved,
    source,
    ...(meta.sourceId ? { sourceId: String(meta.sourceId).slice(0, 120) } : {}),
    ...(meta.sourceUrl ? { sourceUrl: String(meta.sourceUrl).slice(0, 2000) } : {}),
    ...(meta.sourceTitle ? { sourceTitle: String(meta.sourceTitle).slice(0, 300) } : {}),
    ...(Array.isArray(meta.links) && meta.links.length
      ? {
          links: meta.links
            .filter((item) => item && typeof item.url === 'string')
            .slice(0, 8)
            .map((item) => ({
              url: String(item.url).slice(0, 2000),
              label: String(item.label ?? '').slice(0, 100),
            })),
        }
      : {}),
    firstHand: typeof meta.firstHand === 'boolean' ? meta.firstHand : source === 'manual',
  };

  try {
    for (const f of files) {
      if (!f || typeof f === 'string' || !f.size) continue;
      const buf = Buffer.from(await f.arrayBuffer());
      total += buf.length;
      if (buf.length > MAX_FILE_BYTES) throw new Error('单张图超过 5MB：' + f.name);
      if (total > MAX_TOTAL_BYTES) throw new Error('图片总量超过 15MB');
      const ext = sniff(buf);
      if (!ext) throw new Error('只收 png / jpg / gif / webp，且按文件内容校验：' + f.name);
      const name = safeName(f.name || 'img', ext);
      fs.writeFileSync(underRoot(dir, name), buf);
      saved.push({ name, bytes: buf.length, ext });
    }

    saveMeta(dir, entry);
  } catch (err) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw err;
  }

  return entry;
}

/**
 * 给已有素材补充作者实跑/判断：追加一段文字 + 截图，可选标记 firstHand。
 * 自动抓的 folo/rss 条目用这个入口，不用重建一条。
 */
export async function appendIntake(
  id: string,
  text: string,
  files: File[],
  opts: { firstHand?: boolean } = {},
): Promise<IntakeEntry> {
  const dir = underRoot(INTAKE_DIR, id);
  const metaPath = underRoot(dir, 'meta.json');
  if (!fs.existsSync(metaPath)) throw new Error('素材不存在：' + id);

  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as IntakeEntry;
  const clean = text.trim();
  if (!clean && files.length === 0) throw new Error('至少写一句，或传一张图');

  const existingFiles = Array.isArray(meta.files) ? meta.files : [];
  if (existingFiles.length + files.length > MAX_FILES) {
    throw new Error('最多 ' + MAX_FILES + ' 张图（已有 ' + existingFiles.length + ' 张）');
  }
  if (meta.text.length + clean.length + 120 > MAX_TEXT) {
    throw new Error('素材太长（上限 ' + MAX_TEXT + ' 字）');
  }

  const startBytes = existingFiles.reduce((n, f) => n + (Number(f.bytes) || 0), 0);
  const saved: IntakeFile[] = [];
  let total = startBytes;
  try {
    for (const f of files) {
      if (!f || typeof f === 'string' || !f.size) continue;
      const buf = Buffer.from(await f.arrayBuffer());
      total += buf.length;
      if (buf.length > MAX_FILE_BYTES) throw new Error('单张图超过 5MB：' + f.name);
      if (total > MAX_TOTAL_BYTES) throw new Error('图片总量超过 15MB');
      const ext = sniff(buf);
      if (!ext) throw new Error('只收 png / jpg / gif / webp，且按文件内容校验：' + f.name);
      const name = `patch-${Date.now()}-${safeName(f.name || 'img', ext)}`;
      fs.writeFileSync(underRoot(dir, name), buf);
      saved.push({ name, bytes: buf.length, ext });
    }

    const updatedAt = new Date().toISOString();
    const note = clean || `（补了 ${saved.length} 张截图）`;
    meta.text = `${meta.text}\n\n【作者补充 · ${updatedAt}】\n${note}`.trim();
    meta.files = [...existingFiles, ...saved];
    if (opts.firstHand) meta.firstHand = true;
    meta.updatedAt = updatedAt;
    saveMeta(dir, meta);
    return meta;
  } catch (err) {
    for (const f of saved) {
      try {
        fs.rmSync(underRoot(dir, f.name), { force: true });
      } catch {
        /* 忽略清理失败 */
      }
    }
    throw err;
  }
}

export function removeIntake(id: string): void {
  const dir = underRoot(INTAKE_DIR, id);
  if (!fs.existsSync(dir)) throw new Error('素材不存在：' + id);
  fs.rmSync(dir, { recursive: true, force: true });
}

export function readIntakeFile(id: string, name: string): { buf: Buffer; mime: string } | null {
  const dir = underRoot(INTAKE_DIR, id);
  const abs = underRoot(dir, name);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return null;
  const ext = path.extname(abs).toLowerCase();
  const mime = EXT_MIME[ext];
  if (!mime) return null;
  return { buf: fs.readFileSync(abs), mime };
}

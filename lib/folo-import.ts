import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { readFoloEntryContent, readFoloEntryRaw } from './folo';
import { buildFoloIntakeText, htmlToText } from './folo-core';
import { listIntake, saveIntake, type IntakeEntry, type IntakeLink, type IntakeSource } from './intake';
import { extractLinks, type StoredFoloEntry } from './folo-core';
import { fetchText } from './http';

const execFileAsync = promisify(execFile);
const CHROME =
  (process.env.WB_CHROME_BIN ?? '').trim() ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const MAX_SCREENSHOT_BYTES = 4.5 * 1024 * 1024;
const SOCIAL_URL = /^https?:\/\/(www\.)?(x|twitter|threads|bsky)\.(com|net|app)\//i;

export interface ImportFoloResult {
  ok: boolean;
  error?: string;
  entry?: IntakeEntry;
  existing?: boolean;
  screenshot?: boolean;
  readOk?: boolean;
  readError?: string;
}

/** 用 Chrome headless 抓文章首屏；失败就只存文字，不阻塞投料。 */
async function captureScreenshot(url: string): Promise<Buffer | null> {
  if (!url || !fs.existsSync(CHROME)) return null;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'folo-shot-'));
  const out = path.join(dir, 'screenshot.png');
  const profile = path.join(dir, 'profile');
  try {
    await execFileAsync(
      CHROME,
      [
        '--headless=new',
        '--disable-gpu',
        '--hide-scrollbars',
        '--no-first-run',
        '--no-default-browser-check',
        `--user-data-dir=${profile}`,
        '--window-size=1200,1800',
        '--virtual-time-budget=8000',
        `--screenshot=${out}`,
        url,
      ],
      { timeout: 60_000, maxBuffer: 2 * 1024 * 1024 },
    );
    if (!fs.existsSync(out)) return null;
    const buf = fs.readFileSync(out);
    if (buf.length < 20_000 || buf.length > MAX_SCREENSHOT_BYTES) return null;
    return buf;
  } catch {
    return null;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}



function labelFor(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname === '/' ? '' : u.pathname;
    return `${u.hostname}${path}`.replace(/\/$/, '').slice(0, 80);
  } catch {
    return url.slice(0, 80);
  }
}

/** 源链接 + 推文/正文里抽到的外链；X/t.co 只保留源本身，避免一堆跳转。 */
function buildLinks(entry: StoredFoloEntry, rawContent: string, article: string): IntakeLink[] {
  const source = entry.url;
  const urls = [
    source,
    ...extractLinks(rawContent),
    ...extractLinks(entry.description),
    ...extractLinks(article),
  ];
  const seen = new Set<string>();
  const links: IntakeLink[] = [];
  for (const url of urls) {
    if (!url || seen.has(url)) continue;
    if (url !== source && /^https?:\/\/(www\.)?(x|twitter|t\.co)\//i.test(url)) continue;
    seen.add(url);
    const isSource = url === source;
    links.push({
      url,
      label: isSource ? (SOCIAL_URL.test(source) ? '推文' : '原文') : labelFor(url),
    });
    if (links.length >= 6) break;
  }
  return links;
}

/**
 * 把一条雷达线索（Folo / RSS）抓成素材池条目：
 * 正文（folo=readability，rss=直接抓原文页）+ 页面首屏截图 + “可选补充”模板。
 * 标为 source=<源>、firstHand=false；作者可后续补实跑/判断。
 */
export async function importRadarEntry(entry: StoredFoloEntry): Promise<ImportFoloResult> {
  const source: IntakeSource = entry.source === 'rss' ? 'rss' : 'folo';
  const sourceLabel = source === 'rss' ? 'RSS' : 'Folo';
  const existing = listIntake(500).find((item) => item.sourceId === entry.id);
  if (existing) {
    return { ok: true, entry: existing, existing: true, screenshot: false, readOk: true };
  }

  // X / Threads / Bluesky 的 readability 抓到的是登录墙，不是正文；
  // 直接用条目描述，也别浪费 60 秒抓一张登录页截图。
  const social = SOCIAL_URL.test(entry.url);
  let raw = '';
  let article = '';
  let readOk = true;
  let readError: string | undefined;

  if (source === 'folo') {
    const rawRes = await readFoloEntryRaw(entry.id);
    raw = rawRes.content;
    const read = social
      ? { ok: false, content: '', error: '社交平台：跳过正文抓取，使用 Folo 摘要' }
      : await readFoloEntryContent(entry.id);
    article = social
      ? raw || entry.description
      : read.content || raw || entry.description;
    readOk = read.ok;
    readError = read.error;
  } else {
    if (social) {
      readOk = false;
      readError = '社交平台：跳过正文抓取，使用 RSS 摘要';
      article = entry.description;
    } else {
      try {
        // 抓大一点再剥 head/style：截断在标签中间会让 <style> 剥离正则失配，CSS 漏进正文
        raw = await fetchText(entry.url, 150_000);
        article = htmlToText(raw.replace(/<head[\s\S]*?<\/head>/i, ' ')) || entry.description;
      } catch (e) {
        readOk = false;
        readError = '原文抓取失败：' + (e instanceof Error ? e.message : String(e));
        article = entry.description;
      }
    }
  }

  const links = buildLinks(entry, raw, article);
  const text = buildFoloIntakeText(entry, article, sourceLabel);
  const screenshot = social ? null : await captureScreenshot(entry.url);
  const safeId = entry.id.replace(/[^\w.-]+/g, '_').slice(0, 80);
  const files: File[] = screenshot
    ? [new File([new Uint8Array(screenshot)], `${source}-${safeId}.png`, { type: 'image/png' })]
    : [];

  try {
    const saved = await saveIntake(text, files, {
      source,
      sourceId: entry.id,
      sourceUrl: entry.url,
      sourceTitle: entry.title,
      firstHand: false,
      links,
    });
    return {
      ok: true,
      entry: saved,
      existing: false,
      screenshot: !!screenshot,
      readOk,
      ...(readError ? { readError } : {}),
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      screenshot: !!screenshot,
      readOk,
    };
  }
}

/** 兼容旧调用：Folo 条目投料。 */
export async function importFoloEntry(entry: StoredFoloEntry): Promise<ImportFoloResult> {
  return importRadarEntry({ ...entry, source: entry.source ?? 'folo' });
}

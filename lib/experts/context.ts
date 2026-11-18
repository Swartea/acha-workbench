import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getSetting } from '@/lib/db';
import { LIB, MANUSCRIPT_DIR, WS_ROOT } from '@/lib/paths';
import { isUnder } from '@/lib/guard';

/** Obsidian 权威内容库（只读）。MiniMax 自动化仍在向 vault 写入，专家绝不回写。 */
export function vaultContentDir(): string {
  const saved = getSetting('experts.vaultContentDir', '');
  if (saved && fs.existsSync(saved)) return saved;
  return path.join(os.homedir(), 'Documents', 'Obsidian Vault', '📂 工作区', '20 商业副业');
}

export const MAX_CHARS = 12_000;

export interface SourceDoc {
  label: string;
  path: string;
  mtime: string;
  truncated: boolean;
  content: string;
}

function provenance(label: string, filePath: string, truncated: boolean, raw: string): SourceDoc {
  let mtime = '—';
  try {
    mtime = fs.statSync(filePath).mtime.toISOString().slice(0, 19).replace('T', ' ');
  } catch {
    /* 文件可能刚被并发移动，mtime 缺失不阻断 */
  }
  return {
    label,
    path: filePath,
    mtime,
    truncated,
    content:
      raw.length > MAX_CHARS
        ? `${raw.slice(0, MAX_CHARS)}\n…（原文超长，已截断，完整版请看源文件）`
        : raw,
  };
}

function readIfExists(label: string, filePath: string): SourceDoc | null {
  try {
    return provenance(label, filePath, false, fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

/** 按编号找 vault 写作包，如 "A2" → 写作包 - A2 DSH本地部署实战 - 2026-10-17.md */
export function findVaultPack(articleId: string): SourceDoc | null {
  const dir = vaultContentDir();
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return null;
  }
  const hit = names
    .filter((n) => n.startsWith(`写作包 - ${articleId} `) && n.endsWith('.md'))
    .sort()
    .pop();
  return hit ? readIfExists(`写作包 ${articleId}（vault 权威库）`, path.join(dir, hit)) : null;
}

/** 工作台稿件目录里的指定文件（推送版 / 预览版等，相对 MANUSCRIPT_DIR）。 */
export function findWorkbenchManuscript(relName: string): SourceDoc | null {
  const target = path.resolve(MANUSCRIPT_DIR, relName);
  if (!isUnder(MANUSCRIPT_DIR, target)) return null; // 防目录穿越
  const doc = readIfExists(`稿件（工作台 01-内容库）：${relName}`, target);
  if (doc) return doc;
  if (!relName.endsWith('.md')) {
    return readIfExists(`稿件（工作台 01-内容库）：${relName}`, `${target}.md`);
  }
  return null;
}

export function listWorkbenchManuscripts(): string[] {
  try {
    return fs
      .readdirSync(MANUSCRIPT_DIR)
      .filter((n) => n.endsWith('.md'))
      .sort();
  } catch {
    return [];
  }
}

/** 选题库 + 看板（vault 权威库）。 */
export function loadTopicContext(): SourceDoc[] {
  const dir = vaultContentDir();
  const out: SourceDoc[] = [];
  const topic = readIfExists('选题库（vault 权威库）', path.join(dir, '选题库 - 阿茶AI实验室.md'));
  if (topic) out.push(provenance(topic.label, topic.path, true, topic.content));
  const kanban = readIfExists('看板（vault 权威库）', path.join(dir, '看板 - 阿茶AI实验室.md'));
  if (kanban) out.push(kanban);
  return out;
}

/** 品牌与结构规范：内容模板 + 对标账号。 */
export function loadBrandContext(): SourceDoc[] {
  const dir = vaultContentDir();
  const out: SourceDoc[] = [];
  const tpl = readIfExists('内容模板（vault 权威库）', path.join(dir, '内容模板 - 公众号文章 - 2026-09-27.md'));
  if (tpl) out.push(provenance(tpl.label, tpl.path, true, tpl.content));
  const bench = readIfExists('对标账号（vault 权威库）', path.join(dir, '对标账号 - 阿茶AI实验室.md'));
  if (bench) out.push(provenance(bench.label, bench.path, true, bench.content));
  return out;
}

/** 把 SourceDoc 列表排成注入提示词的文本块。 */
export function renderSources(docs: Array<SourceDoc | null>): string {
  return docs
    .filter((d): d is SourceDoc => d !== null)
    .map(
      (d) =>
        `===== ${d.label} =====\n【来源】${d.path}\n【最后修改】${d.mtime}\n\n${d.content}\n===== 来源结束 =====`,
    )
    .join('\n\n');
}

export const WORKBENCH_ROOT_NOTE = `工作台仓库根目录：${WS_ROOT}\n内容库目录：${LIB}（注意：这是 2026-10-26 冻结快照，权威内容以 vault 库为准）`;

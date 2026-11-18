/**
 * 标题写回稿件（服务端专用，不进 client bundle）。
 *
 * 单独一个文件而不是放进 lib/titles.ts：titles.ts 是领域逻辑（auditTitle/countChars/
 * 种子数据），客户端组件 TitlesBoard 也会 import；这里要碰 fs，混进去会让
 * node:fs 漏进浏览器包（Turbopack 直接构建失败）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { BACKUPS_DIR, MANUSCRIPT_DIR } from './paths';
import { assertUnder } from './guard';

function setLine(block: string, key: string, value: string): string {
  const re = new RegExp(`^${key}:.*$`, 'm');
  if (re.test(block)) return block.replace(re, `${key}: ${value}`);
  return `${block}\n${key}: ${value}`;
}

/**
 * 把选定标题写回稿件 frontmatter（title + digest 同步），原稿先备份进 data/backups。
 * 只接受 MANUSCRIPT_DIR 下的 .md 文件名（basename，防路径穿越）。
 */
export function applyTitleToFile(file: string, text: string, digest: string): string {
  const base = path.basename(String(file ?? ''));
  if (!base.endsWith('.md')) throw new Error('稿件文件名不合法');
  const abs = assertUnder(MANUSCRIPT_DIR, base);
  if (!fs.existsSync(abs)) throw new Error('稿件不存在');

  const raw = fs.readFileSync(abs, 'utf8');
  fs.mkdirSync(BACKUPS_DIR, { recursive: true });
  fs.writeFileSync(path.join(BACKUPS_DIR, `${Date.now()}-${base}`), raw, 'utf8');

  let out = raw;
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (m) {
    let fm = setLine(m[1], 'title', text);
    if (digest) fm = setLine(fm, 'digest', digest);
    out = raw.replace(m[0], `---\n${fm}\n---`);
  }
  out = out.replace(/^# .+$/m, `# ${text}`);
  fs.writeFileSync(abs, out, 'utf8');
  return base;
}

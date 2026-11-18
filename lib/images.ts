import fs from 'node:fs';
import path from 'node:path';
import { MATERIAL_DIR } from './paths';

export interface FigImage {
  dir: string;
  file: string;
  /** 相对 稿件/ 的路径，如 素材/A1配图V3/a1-v3-table.jpg */
  rel: string;
  bytes: number;
  width: number | null;
  height: number | null;
  ext: string;
}

export interface FigureGroup {
  dir: string;
  images: FigImage[];
}

const IMG_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);

function imageSize(p: string): { width: number | null; height: number | null } {
  try {
    const b = fs.readFileSync(p);
    if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50) {
      return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
    }
    if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
      let i = 2;
      while (i < b.length - 9) {
        if (b[i] !== 0xff) {
          i += 1;
          continue;
        }
        const marker = b[i + 1];
        if ([0xc0, 0xc1, 0xc2, 0xc3].includes(marker)) {
          return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
        }
        const len = b.readUInt16BE(i + 2);
        if (!len) break;
        i += 2 + len;
      }
    }
  } catch {
    /* ignore */
  }
  return { width: null, height: null };
}

export function scanFigures(): FigureGroup[] {
  let dirs: string[] = [];
  try {
    dirs = fs
      .readdirSync(MATERIAL_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort((a, b) => {
        const va = /V3/.test(a) ? 1 : 0;
        const vb = /V3/.test(b) ? 1 : 0;
        if (va !== vb) return vb - va; // V3 优先
        const na = Number(a.match(/A(\d+)/)?.[1] ?? 0);
        const nb = Number(b.match(/A(\d+)/)?.[1] ?? 0);
        return nb - na;
      });
  } catch {
    return [];
  }

  const groups: FigureGroup[] = [];
  for (const dir of dirs) {
    const abs = path.join(MATERIAL_DIR, dir);
    let images: FigImage[] = [];
    for (const f of fs.readdirSync(abs, { withFileTypes: true })) {
      if (!f.isFile()) continue;
      const ext = path.extname(f.name).toLowerCase();
      if (!IMG_EXT.has(ext)) continue;
      const full = path.join(abs, f.name);
      const size = fs.statSync(full).size;
      const dim = ext === '.svg' ? { width: null, height: null } : imageSize(full);
      images.push({
        dir,
        file: f.name,
        rel: `素材/${dir}/${f.name}`,
        bytes: size,
        ...dim,
        ext,
      });
    }
    images.sort((a, b) => {
      const cover = (x: FigImage) => (/cover/i.test(x.file) ? -1 : 0);
      return cover(a) - cover(b) || a.file.localeCompare(b.file);
    });

    // 同名 .png（2x 源）与 .jpg（推送用）并存时，只展示 jpg，避免重复
    const jpgBases = new Set(
      images.filter((i) => ['.jpg', '.jpeg'].includes(i.ext)).map((i) => i.file.replace(/\.jpe?g$/i, '')),
    );
    images = images.filter((i) => !(i.ext === '.png' && jpgBases.has(i.file.replace(/\.png$/i, ''))));

    if (images.length) groups.push({ dir, images });
  }
  return groups;
}

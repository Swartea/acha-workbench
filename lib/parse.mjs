/**
 * markdown 解析与文本工具 —— 唯一真源。
 *
 * 为什么单独一个 .mjs（同 limits.mjs）：
 *   - 02-发布工具/draft.mjs、09-编辑部/draft-check.mjs 是独立 Node 脚本（ESM），要能直接 import；
 *   - 06-工作台 TS 侧（lib/quality.ts、lib/external-score.ts、lib/titles.ts…）也要同一份。
 *   此前这些函数在 5 处各抄一份，口径漂移只能靠人肉对齐。
 *
 * 行为约定（改这里 = 改所有消费方，慎重）：
 *   - parseFrontmatter / extractBodySlice / isMetaBlock / stripMeta / stripInlineMeta
 *     与 02-发布工具/wechat-draft/draft.mjs 的发布口径逐字等价；
 *   - draft.mjs 会在「## 正文」缺失时抛错，本文件只返回 null，由调用方决定。
 */

/** 解析开头 YAML frontmatter 为 key→value（去引号）。无 frontmatter 返回空对象。 */
export function parseFrontmatter(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const out = {};
  if (!m) return out;
  for (const line of m[1].split(/\r?\n/)) {
    const mm = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (mm) out[mm[1]] = mm[2].trim().replace(/^['"]|['"]$/g, '');
  }
  return out;
}

/** 剥掉开头 YAML frontmatter 块；没有就原样返回。 */
export function stripFrontmatter(raw) {
  const m = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  return m ? raw.slice(m[0].length) : raw;
}

/**
 * 取「## 正文」到下一个「## 」标题之间的内容（不 trim）。
 * 没有该标题返回 null，调用方自行决定回落原稿还是报错。
 */
export function extractBodySlice(raw) {
  const lines = raw.split(/\r?\n/);
  const start = lines.findIndex((line) => /^##\s+正文\s*$/.test(line));
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^##\s+\S/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start + 1, end).join('\n');
}

/** 工作稿批注块判定（含行首引用标记）。 */
export function isMetaBlock(firstLine) {
  const first = firstLine.replace(/^>\s*/, '');
  return (
    /^📌\s*\*\*2026/.test(first) ||
    /^📌\s*\*\*数字待你重算/.test(first) ||
    /^📌\s*\*\*另/.test(first) ||
    /^⚠️/.test(first) ||
    /^🚨/.test(first) ||
    /^🆕/.test(first) ||
    /^💡/.test(first) ||
    /^字数[:：]/.test(first) ||
    /^4\s*个链接/.test(first) ||
    /^\*\*16:00\s*更新/.test(first) ||
    /^\*\*数字待你重算/.test(first)
  );
}

/**
 * 剥掉工作稿批注（### 段 N、📌/⚠️/🚨/💡/字数：… 引用块），返回 { body, removed }。
 * 与 draft.mjs --strip-meta 同口径。
 */
export function stripMeta(body) {
  const lines = body.split('\n');
  const kept = [];
  let removed = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    if (/^###\s*段\s*\d+\s*[-—]/.test(line)) {
      removed += 1;
      continue;
    }

    if (/^>\s*/.test(line)) {
      const block = [line];
      let j = i + 1;
      while (j < lines.length && /^>\s*/.test(lines[j])) {
        block.push(lines[j]);
        j += 1;
      }
      if (isMetaBlock(block[0])) {
        removed += block.length;
        i = j - 1;
        continue;
      }
      kept.push(...block);
      i = j - 1;
      continue;
    }

    kept.push(line);
  }

  return {
    body: kept.join('\n').replace(/\n{3,}/g, '\n\n').trim(),
    removed,
  };
}

/** 剥行内核实批注（✅ 日期、🚨）。 */
export function stripInlineMeta(body) {
  let out = body.replace(/[（(]\s*✅\s*\d{4}-\d{2}-\d{2}[^）)]*[）)]/g, '');
  out = out.replace(
    /\s*✅\s*\*\*\d{4}-\d{2}-\d{2}[^*]*更新核实\*\*\s*[（(][^）)]*[）)]/g,
    '',
  );
  out = out.replace(/\s*🚨\s*/g, ' ');
  return out;
}

/**
 * 本地时间戳 YYYYMMDD[sep]HHMMSS。
 * 文件名用本地时间，和界面显示一致（toISOString 是 UTC，会差 8 小时）。
 */
export function stampLocal(sep = '-') {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${sep}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** UTC 紧凑时间戳 YYYYMMDDHHMMSS（hermes 运行目录用）。 */
export function stampUtc() {
  return new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
}

/** 标题清洗成文件名安全段：非法字符转 -，截断到 max，空则用 fallback。 */
export function safeName(raw, max = 24, fallback = '未命名') {
  return (
    String(raw ?? '')
      .replace(/[\\/:*?"<>|：，。！？、；\s]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, max) || fallback
  );
}

#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import matter from 'gray-matter';
// 解析/清洗/词表共享真源（与 06-工作台/lib/quality.ts、09-编辑部/draft-check.mjs 同一份）
import { extractBodySlice, stripInlineMeta, stripMeta } from '../../06-工作台/lib/parse.mjs';
import {
  IMG_EXT_OK as BODY_IMG_EXT_OK,
  IMG_MAX_BYTES as BODY_IMG_MAX_BYTES,
  LEAK_WORDS,
} from '../../06-工作台/lib/rules.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const WENYAN = path.join(
  ROOT,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'wenyan.cmd' : 'wenyan',
);
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp']);

let imageIndex = null;

function usage() {
  console.log(`
用法: npm run draft -- --file <文章.md> [options]

必填:
  -f, --file         Markdown 文件

可选:
      --title        覆盖标题（默认 target_title / title / H1 / 文件名）
      --cover        封面图片路径（推草稿时必填）
      --author       作者（默认 阿茶）
      --digest       摘要（默认 frontmatter digest / summary / "## 摘要" 引用）
      --theme        文颜主题（默认 default）
      --body-only    只取 "## 正文" 到下一个 "## " 之间的内容
      --strip-meta   去掉工作稿里的 📌/⚠️/🚨/字数 等批注块与 "### 段 N" 标题
      --dry-run      只渲染 HTML，不推草稿（不需要 AppID/AppSecret）
      --force        跳过“像工作稿”检查
  -h, --help         显示帮助

示例:
  npm run draft -- -f "文章.md" --cover "封面.png" --dry-run
  npm run draft -- -f "文章.md" --cover "封面.png" --body-only --strip-meta
`);
}

function parseCli() {
  const { values } = parseArgs({
    options: {
      file: { type: 'string', short: 'f' },
      title: { type: 'string' },
      cover: { type: 'string' },
      // 默认空串（不是 '阿茶'）：默认值恒真会把 frontmatter 的 author 变成死字段，
      // 既覆盖掉稿件里写好的作者，也让「作者 ≤16 字」的守卫够不到真值。
      author: { type: 'string', default: '' },
      digest: { type: 'string' },
      theme: { type: 'string', default: 'default' },
      'body-only': { type: 'boolean', default: false },
      'strip-meta': { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
      force: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: true,
  });
  return values;
}

function findVaultRoot(startDir) {
  let dir = path.resolve(startDir);
  while (true) {
    if (fs.existsSync(path.join(dir, '.obsidian'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function getImageIndex(vaultRoot) {
  if (!vaultRoot) return new Map();
  if (imageIndex) return imageIndex;
  imageIndex = new Map();
  const stack = [vaultRoot];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile() && IMAGE_EXT.has(path.extname(entry.name).toLowerCase())) {
        const key = entry.name.toLowerCase();
        const list = imageIndex.get(key) || [];
        list.push(full);
        imageIndex.set(key, list);
      }
    }
  }
  return imageIndex;
}

function decodeTarget(target) {
  try {
    return decodeURIComponent(target);
  } catch {
    return target;
  }
}

function resolveLocalFile(target, mdFile, vaultRoot) {
  if (/^https?:\/\//i.test(target)) return target;
  const decoded = decodeTarget(target);
  const candidates = [
    path.isAbsolute(decoded) ? decoded : null,
    path.resolve(process.cwd(), decoded),
    path.resolve(path.dirname(mdFile), decoded),
    vaultRoot ? path.resolve(vaultRoot, decoded) : null,
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }

  const hits = getImageIndex(vaultRoot).get(path.basename(decoded).toLowerCase());
  if (hits?.length) return hits[0];
  throw new Error(`文件找不到：${target}`);
}

function resolveImage(target, mdFile, vaultRoot) {
  if (/^(https?:|data:)/i.test(target)) return null;
  return resolveLocalFile(target, mdFile, vaultRoot);
}

function materialize(absPath, assetsDir, cache) {
  if (cache.has(absPath)) return cache.get(absPath);
  if (absPath.startsWith(`${assetsDir}${path.sep}`)) return absPath;
  const ext = path.extname(absPath).toLowerCase() || '.png';
  // 格式守卫：SVG 平台不收，bmp/gif 也不收（封面另走 add_material，不经过这里）
  if (!BODY_IMG_EXT_OK.has(ext)) {
    throw new Error(
      `正文图格式不合规：${path.basename(absPath)}（${ext}）。公众号正文图只收 jpg/png，SVG 不支持；请先转成 PNG/JPG。`,
    );
  }
  // 体积守卫：按真实字节数判断，不四舍五入
  const bytes = fs.statSync(absPath).size;
  if (bytes >= BODY_IMG_MAX_BYTES) {
    throw new Error(
      `正文图超过 1MB：${path.basename(absPath)}（${bytes} 字节 ≥ ${BODY_IMG_MAX_BYTES}）。请压缩后再推。`,
    );
  }
  const dest = path.join(assetsDir, `img-${cache.size + 1}${ext}`);
  fs.copyFileSync(absPath, dest);
  cache.set(absPath, dest);
  return dest;
}

function convertImages(content, mdFile, vaultRoot, assetsDir) {
  const cache = new Map();
  const missing = [];

  let out = content.replace(
    /!\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g,
    (match, rawTarget, rawAlt) => {
      const target = rawTarget.trim();
      const alt = (rawAlt || path.basename(target)).trim();
      const abs = resolveImage(target, mdFile, vaultRoot);
      if (!abs) {
        missing.push(target);
        return match;
      }
      const dest = materialize(abs, assetsDir, cache);
      if (/^\d+$/.test(alt)) return `<img src="${dest}" width="${alt}" />`;
      return `![${alt.replace(/[[\]]/g, '')}](${dest})`;
    },
  );

  out = out.replace(
    /(!\[[^\]]*\]\()(<[^>]+>|[^)\s]+)(\s+"[^"]*")?(\))/g,
    (match, pre, rawTarget, title = '', post) => {
      const target = rawTarget.replace(/^<|>$/g, '');
      if (/^(https?:|data:)/i.test(target)) return match;
      const abs = resolveImage(target, mdFile, vaultRoot);
      if (!abs) {
        missing.push(target);
        return match;
      }
      const dest = materialize(abs, assetsDir, cache);
      return `${pre}${dest}${title}${post}`;
    },
  );

  out = out.replace(
    /(<img\b[^>]*\bsrc=["'])([^"']+)(["'])/gi,
    (match, pre, target, post) => {
      if (/^(https?:|data:)/i.test(target)) return match;
      const abs = resolveImage(target, mdFile, vaultRoot);
      if (!abs) {
        missing.push(target);
        return match;
      }
      const dest = materialize(abs, assetsDir, cache);
      return `${pre}${dest}${post}`;
    },
  );

  out = out.replace(
    /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
    (match, note, alias) => (alias || note).trim(),
  );

  const uniqueMissing = [...new Set(missing)];
  if (uniqueMissing.length) {
    throw new Error(
      `有 ${uniqueMissing.length} 张图片找不到，已中止（避免静默丢图）：\n- ${uniqueMissing.join('\n- ')}`,
    );
  }

  return { content: out, imageCount: cache.size };
}

function escapeCurrency(content) {
  const codeSegments = [];
  let out = content.replace(/```[\s\S]*?```|`[^`\n]+`/g, (segment) => {
    const token = `\u0000CODE${codeSegments.length}\u0000`;
    codeSegments.push(segment);
    return token;
  });
  out = out.replace(/(?<!\\)(?<!<span>)\$(?=\d)/g, '<span>$</span>');
  return out.replace(/\u0000CODE(\d+)\u0000/g, (match, index) => codeSegments[Number(index)]);
}

function extractBody(content, bodyOnly) {
  if (!bodyOnly) return content;
  const sliced = extractBodySlice(content);
  if (sliced === null) {
    throw new Error('没有找到 "## 正文" 标题；去掉 --body-only，或先给文章加上这个标题。');
  }
  return sliced.trim();
}

function stripLeadingH1(body) {
  const lines = body.split('\n');
  let i = 0;
  while (i < lines.length && lines[i].trim() === '') i += 1;
  if (i < lines.length && /^#\s+\S/.test(lines[i])) {
    lines.splice(i, 1);
    return { body: lines.join('\n').trim(), removed: 1 };
  }
  return { body, removed: 0 };
}

function extractDigest(content) {
  const match = content.match(/^##\s*摘要[^\n]*\n+\s*>\s*(.+?)\s*$/m);
  if (!match) return '';
  return match[1].replace(/^>\s*/, '').replace(/\*\*/g, '').trim();
}

function validateClean(body, force) {
  if (force) return;
  const hits = LEAK_WORDS.filter((marker) => body.includes(marker));
  if (hits.length) {
    throw new Error(
      `这看起来还是工作稿，检测到：${hits.join('、')}。\n` +
        '先清理成发布稿，或加 --strip-meta，或确认无误后加 --force。',
    );
  }
}

function checkEnv(envPath) {
  if (!fs.existsSync(envPath)) {
    throw new Error(`缺少 ${envPath}。先复制 .env.example 为 .env，填入 AppID / AppSecret。`);
  }
  const text = fs.readFileSync(envPath, 'utf8');
  // 值必须与键在同一行：空白只允许水平空白（不含换行），
  // 否则 "WECHAT_APP_ID=\nWECHAT_APP_SECRET=xxx" 会被判成 APP_ID 已有值。
  const missing = ['WECHAT_APP_ID', 'WECHAT_APP_SECRET'].filter(
    (key) => !new RegExp(`^[^\\S\\r\\n]*${key}[^\\S\\r\\n]*=[^\\S\\r\\n]*\\S`, 'm').test(text),
  );
  if (missing.length) {
    throw new Error(`.env 缺少：${missing.join('、')}`);
  }
}

function runWenyan(args) {
  if (!fs.existsSync(WENYAN)) {
    throw new Error(`找不到 wenyan：${WENYAN}。先在工具目录跑 npm install。`);
  }
  const result = spawnSync(WENYAN, args, {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 180000,
    env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
  });
  if (result.error) {
    throw new Error(`调用 wenyan 失败：${result.error.message}`);
  }
  return result;
}

function printHints(output) {
  const hints = [
    ['40164', 'IP 不在白名单：后台 → 设置与开发 → 基本配置 → IP 白名单，加上当前公网 IP。'],
    ['48001', '接口未授权：草稿箱接口可能没开。把这条报错发我，改走浏览器自动化。'],
    ['40013', 'AppID 无效，检查 .env。'],
    ['40125', 'AppSecret 无效，重新生成并更新 .env。'],
    ['40007', 'media_id 无效，通常是图片上传失败；检查图片格式/大小。'],
    ['45009', '接口调用超限，等一会儿再试。'],
  ];
  const hit = hints.filter(([code]) => output.includes(code));
  if (hit.length) {
    console.error('\n可能原因：');
    for (const [code, hint] of hit) console.error(`- ${code}: ${hint}`);
  }
}

/**
 * wenyan 把 access_token 缓存在 ~/.config/wenyan-md/token.json。
 * 其他调用（工作台的 token 检查、手动调试）一旦重新取 token，缓存里那个就作废，
 * 推送会报 40001 invalid credential。所以每次推送前清掉，强制重取。
 * （注：不要在推送后用 draft/update 改 content —— 微信保存时会强制把 <img> 归一化成
 * data-src，补 src 留不住；草稿里的图 blank 与 src 无关。）
 */
function clearWenyanTokenCache() {
  const dir = process.env.XDG_CONFIG_HOME
    ? path.join(process.env.XDG_CONFIG_HOME, 'wenyan-md')
    : path.join(os.homedir(), '.config', 'wenyan-md');
  try {
    fs.rmSync(path.join(dir, 'token.json'), { force: true });
  } catch {
    /* 清不掉就让 wenyan 自己处理 */
  }
}

async function main() {
  const args = parseCli();
  if (args.help) {
    usage();
    return;
  }
  if (!args.file) {
    usage();
    throw new Error('缺少 --file');
  }

  const mdFile = path.resolve(args.file);
  if (!fs.existsSync(mdFile)) throw new Error(`文件不存在：${mdFile}`);

  const raw = fs.readFileSync(mdFile, 'utf8');
  const parsed = matter(raw);
  const vaultRoot = findVaultRoot(path.dirname(mdFile));

  let body = parsed.content;
  if (args['body-only']) body = extractBody(body, true);

  let removed = 0;
  if (args['strip-meta']) {
    const stripped = stripMeta(body);
    body = stripInlineMeta(stripped.body);
    removed = stripped.removed;
  }

  const h1 = stripLeadingH1(body);
  body = h1.body;

  validateClean(body, args.force);

  const leftovers = ['📌', '⚠️', '🚨', '🆕', '💡'].filter((marker) => body.includes(marker));
  if (leftovers.length) {
    console.warn(`注意：正文里还有 ${leftovers.join(' ')}，确认不是工作稿批注再推。`);
  }

  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const workDir = path.join(ROOT, '.tmp', stamp);
  const assetsDir = path.join(workDir, 'assets');
  fs.mkdirSync(assetsDir, { recursive: true });

  const converted = convertImages(body, mdFile, vaultRoot, assetsDir);

  let title = args.title || parsed.data.target_title || parsed.data.title || '';
  if (!title) {
    const h1 = parsed.content.match(/^#\s+(.+)$/m);
    if (h1) title = h1[1].trim();
  }
  if (!title) title = path.basename(mdFile, '.md');
  title = String(title).trim();

  const author = String(args.author || parsed.data.author || '阿茶').trim();
  const digest = String(
    args.digest ||
      parsed.data.digest ||
      parsed.data.summary ||
      extractDigest(parsed.content) ||
      '',
  ).trim();

  // 官方 draft/add 规格：标题总长度不超过 32 个字 —— 这是硬门槛，超过就拒收，
  // 不能只告警（之前 33 字只 warning、退出码 0，本地预检等于没把关）。
  if (title.length > 32) {
    throw new Error(
      `标题 ${title.length} 字，超过公众号 32 字硬上限，接口会拒收；请先删减。`,
    );
  }
  if (author.length > 16) {
    throw new Error(
      `作者 ${author.length} 字，超过公众号 16 字硬上限，接口会拒收；请先删减。`,
    );
  }
  if (digest.length > 120) {
    throw new Error(`摘要 ${digest.length} 字，超过公众号 120 字硬上限，接口会拒收；请先删减。`);
  }
  // 「阅读原文」content_source_url：官方每篇 1 个、≤1KB
  const sourceUrl = String(parsed.data.source_url || '').trim();
  if (sourceUrl) {
    const urlBytes = Buffer.byteLength(sourceUrl, 'utf8');
    if (urlBytes > 1024) {
      throw new Error(
        `「阅读原文」链接 ${urlBytes} 字节，超过官方 1KB 上限，接口会拒收；请换成更短的地址。`,
      );
    }
  }

  let cover = args.cover || parsed.data.cover || '';
  if (cover) {
    const absCover = resolveLocalFile(cover, mdFile, vaultRoot);
    if (/^https?:/i.test(absCover)) {
      cover = absCover;
    } else {
      const ext = path.extname(absCover).toLowerCase() || '.png';
      // 封面最终以 multipart 文件名 "cover.jpg" 上传，字节必须真的是 JPEG/PNG/BMP/GIF。
      // SVG 公众号不收（add_material 只支持 bmp/png/jpeg/jpg/gif），推上去只会拿到 40005。
      if (!['.jpg', '.jpeg', '.png', '.bmp', '.gif'].includes(ext)) {
        throw new Error(
          `封面格式不支持：${ext}。公众号封面只接受 bmp/png/jpeg/jpg/gif（SVG 会被拒：40005）。` +
          `先转成 PNG/JPG 再推。`,
        );
      }
      const dest = path.join(assetsDir, `cover${ext}`);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(absCover, dest);
      cover = dest;
    }
  } else {
    const firstImage = converted.content.match(/!\[[^\]]*\]\(([^)]+)\)/);
    if (firstImage && !/^https?:/i.test(firstImage[1])) cover = firstImage[1];
  }

  if (!cover && !args['dry-run']) {
    throw new Error('推草稿需要封面：用 --cover 指定一张图片，或在 frontmatter 里加 cover。');
  }

  const outputMd = path.join(workDir, 'publish.md');
  const data = {
    title,
    author,
    ...(digest ? { digest } : {}),
    ...(cover ? { cover } : {}),
    // 以下几项 wenyan 的 frontmatter 处理器认，但本脚本此前没往输出里带，导致：
    //   source_url          → 「阅读原文」链接丢失（每篇 1 个，≤1KB）
    //   pic_crop_235_1/1_1 → 封面两组裁切坐标丢失，后台只能自动裁
    //   need_open_comment / only_fans_can_comment → 留言开关丢失
    ...(parsed.data.source_url ? { source_url: parsed.data.source_url } : {}),
    ...(parsed.data.pic_crop_235_1 ? { pic_crop_235_1: parsed.data.pic_crop_235_1 } : {}),
    ...(parsed.data.pic_crop_1_1 ? { pic_crop_1_1: parsed.data.pic_crop_1_1 } : {}),
    ...(parsed.data.need_open_comment !== undefined
      ? { need_open_comment: parsed.data.need_open_comment } : {}),
    ...(parsed.data.only_fans_can_comment !== undefined
      ? { only_fans_can_comment: parsed.data.only_fans_can_comment } : {}),
  };
  const renderBody = escapeCurrency(converted.content);
  fs.writeFileSync(outputMd, matter.stringify(`${renderBody.trim()}\n`, data), 'utf8');

  console.log(`源文件: ${mdFile}`);
  console.log(`标题: ${title}`);
  console.log(`作者: ${author}`);
  console.log(`摘要: ${digest || '(空)'}`);
  console.log(`封面: ${cover || '(dry-run 未指定)'}`);
  console.log(`图片: ${converted.imageCount} 张（已复制到临时目录）`);
  if (args['strip-meta']) console.log(`清理: 移除 ${removed} 行批注/段标题`);
  if (h1.removed) console.log('清理: 移除正文首行 H1（公众号标题单独显示）');
  console.log(`临时稿: ${outputMd}`);

  if (args['dry-run']) {
    const result = runWenyan(['render', '-f', outputMd]);
    if (result.status !== 0) {
      if (result.stdout) process.stderr.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
      printHints(`${result.stdout || ''}${result.stderr || ''}`);
      process.exit(1);
    }
    const htmlPath = path.join(workDir, 'preview.html');
    fs.writeFileSync(htmlPath, result.stdout, 'utf8');
    console.log(`[dry-run] HTML: ${htmlPath}`);
    return;
  }

  const envPath = path.join(ROOT, '.env');
  checkEnv(envPath);
  clearWenyanTokenCache();
  const result = runWenyan([
    'publish',
    '-f',
    outputMd,
    '--env-file',
    envPath,
    '--theme',
    args.theme,
  ]);

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  if (result.status !== 0) {
    printHints(`${result.stdout || ''}${result.stderr || ''}`);
    process.exit(1);
  }

  console.log('\n草稿已创建，未发布。');
  console.log('下一步：mp.weixin.qq.com → 草稿箱 → 手机预览 → 发表 / 定时发表。');
}

try {
  await main();
} catch (error) {
  console.error(`\n失败：${error.message}`);
  if (process.env.DEBUG) console.error(error.stack);
  process.exit(1);
}

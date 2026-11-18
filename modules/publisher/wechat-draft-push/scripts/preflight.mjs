#!/usr/bin/env node
/* ============================================================
   公众号推送前预检（确定性本地检查，不调任何接口）

   把每次推送都要手工核一遍的东西自动化：
     · frontmatter 的 title / digest / author 是否在官方长度上限内
     · 正文承诺 ↔ 字段是否对得上（阅读原文 / 评论区）
     · 图片引用是否存在、格式是否被平台接收、是否 <1MB
     · 图片路径是否含空格或用了绝对路径（wenyan 正则会静默漏掉 → 裂图）
     · 稿子里是否残留工作稿关键词（会撞 validateClean）
     · 预览 HTML 是否有泄漏 / 外链 / 会被移动端截断的标签

   用法：
     node preflight.mjs --md <稿件.md> [--html <preview.html>]
   退出码 0 = 全过；1 = 有 FAIL
   ============================================================ */
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname, isAbsolute } from 'node:path';
import { LIMITS } from '../../../../06-工作台/lib/limits.mjs';
import { IMG_EXT_OK as IMG_OK, IMG_MAX_BYTES as IMG_MAX, LEAK_WORDS } from '../../../../06-工作台/lib/rules.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const MD = arg('--md', '');
const HTML = arg('--html', '');
if (!MD) { console.error('用法: node preflight.mjs --md <稿件.md> [--html <preview.html>]'); process.exit(1); }

const mdPath = resolve(MD);
const mdDir = dirname(mdPath);
let fails = 0, warns = 0;
const ok = m => console.log(`  ✓ ${m}`);
const bad = m => { fails++; console.log(`  ✗ ${m}`); };
const warn = m => { warns++; console.log(`  ? ${m}`); };

// ---- 官方上限（真源 06-工作台/lib/limits.mjs；详见 references/platform-constraints.md） ----

const raw = readFileSync(mdPath, 'utf8');
const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
const fm = {};
if (m) {
  for (const line of m[1].split(/\r?\n/)) {
    const mm = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (mm) fm[mm[1]] = mm[2].trim().replace(/^['"]|['"]$/g, '');
  }
} else { bad('没有 frontmatter'); }
const body = m ? raw.slice(m[0].length) : raw;

console.log(`\n== 稿件 ${mdPath.split('/').pop()} ==\n`);

console.log('长度上限');
for (const [k, lim] of Object.entries(LIMITS.platform)) {
  const v = fm[k] || '';
  const len = [...v].length;
  if (!v) { warn(`${k} 未设置`); continue; }
  if (len > lim) bad(`${k} ${len} 字 > 上限 ${lim}`); else ok(`${k} ${len}/${lim} 字`);
}

console.log('\n正文承诺 ↔ 字段');
if (/阅读原文/.test(body)) {
  if (fm.source_url) ok(`source_url 已设（${fm.source_url}）`);
  else bad('正文提到「阅读原文」但 frontmatter 没有 source_url → 承诺会落空');
} else if (fm.source_url) { ok(`source_url 已设（${fm.source_url}）`); }
if (fm.source_url) {
  // 官方 content_source_url ≤1KB（每篇 1 个）——按 UTF-8 字节算
  const urlBytes = Buffer.byteLength(fm.source_url, 'utf8');
  if (urlBytes > 1024) bad(`source_url ${urlBytes} 字节 > 官方 1KB 上限`);
  else ok(`source_url ${urlBytes} 字节（≤1KB）`);
}
if (/评论区|留言|评论一下/.test(body)) {
  if (fm.need_open_comment !== undefined) ok(`need_open_comment = ${fm.need_open_comment}`);
  else bad('正文引导读者去评论区但没设 need_open_comment（官方默认 0 = 关闭）');
} else if (fm.need_open_comment === undefined) { ok('正文未引导评论，无需 need_open_comment'); }

console.log('\n图片');
const imgs = [...body.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map(x => x[1]);
if (!imgs.length) warn('正文里没有找到 markdown 图片');
for (const src of imgs) {
  if (/\s/.test(src)) { bad(`图片路径含空格 → wenyan 的正则 [^)\\s]+ 匹配不到，会静默裂图：${src}`); continue; }
  if (isAbsolute(src)) { bad(`图片路径是绝对路径 → wenyan 的正则匹配不到，会静默裂图：${src}`); continue; }
  const p = resolve(mdDir, src);
  if (!existsSync(p)) { bad(`图片不存在：${src}`); continue; }
  const ext = p.slice(p.lastIndexOf('.')).toLowerCase();
  const size = statSync(p).size;
  if (!IMG_OK.has(ext)) bad(`图片格式 ${ext} 不被平台接收（只收 jpg/png）：${src}`);
  else if (size >= IMG_MAX) bad(`图片 ${Math.round(size / 1024)}KB ≥ 1MB：${src}`);
  else ok(`${src}（${ext}，${Math.round(size / 1024)}KB）`);
}
if (fm.cover) {
  const p = resolve(mdDir, fm.cover);
  if (!existsSync(p)) bad(`封面不存在：${fm.cover}`);
  else {
    const ext = p.slice(p.lastIndexOf('.')).toLowerCase();
    if (!['.jpg', '.jpeg', '.png', '.bmp', '.gif'].includes(ext)) bad(`封面格式 ${ext} 不被接收`);
    else ok(`封面 ${fm.cover}（${ext}）`);
  }
} else warn('frontmatter 没有 cover（推草稿必填）');

console.log('\n工作稿残留');
const hits = LEAK_WORDS.filter(w => body.includes(w));
if (hits.length) bad(`撞 validateClean 的词：${hits.join('、')}`);
else ok('无 validateClean 拦阻词');

if (HTML) {
  console.log('\n预览 HTML');
  const hp = resolve(HTML);
  if (!existsSync(hp)) bad(`preview.html 不存在：${HTML}`);
  else {
    const h = readFileSync(hp, 'utf8');
    const n = re => (h.match(re) || []).length;
    const chars = h.replace(/<[^>]+>/g, '').length;
    if (n(/<!--/g)) bad(`HTML 注释 ${n(/<!--/g)} 处 —— 泄漏`);
    else ok('无 HTML 注释');
    if (n(/<a\s/g)) warn(`外链 ${n(/<a\s/g)} 处（未认证个人号正文外链点不动）`);
    else ok('无外链');
    if (n(/<pre|<table/g)) bad(`代码块/表格 ${n(/<pre|<table/g)} 处 —— 移动端会水平截断`);
    else ok('无 <pre>/<table>');
    if (n(/<img/g) !== imgs.length) warn(`HTML 里 <img> ${n(/<img/g)} 个，稿件里引用 ${imgs.length} 张`);
    else ok(`图片 ${n(/<img/g)} 张，与稿件一致`);
    // 正文体积：官方规格并列写了 2KB / 2 万字符 / 1M 三个自相矛盾的数字。
    // 本地只能拦得住后两档；2KB 那档无法本地判定，必须以真机推送为准。
    const bytes = Buffer.byteLength(h, 'utf8');
    if (chars > 20000) bad(`正文 ${chars} 字符 > 2 万`);
    else if (bytes > 1024 * 1024) bad(`正文 ${bytes} 字节 > 1MB`);
    else ok(`正文 ${chars} 字符 / ${bytes} 字节（≤2 万字符、≤1MB；官方另有 2KB 一档，本地判不了）`);
  }
}

console.log(`\n${fails ? `✗ FAIL ${fails} 项` : '✓ 全过'}${warns ? `，? 提醒 ${warns} 项` : ''}\n`);
process.exit(fails ? 1 : 0);

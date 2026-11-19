/**
 * 排版预检（markdown 结构风险检查，纯函数）。
 *
 * 推草稿破版/失败的真实死因都是 markdown 结构问题：
 * 图片路径不存在（draft.mjs 会因找不到图直接中止）、代码围栏未闭合、
 * 表格列数错位、HTML 标签残留、frontmatter 残留。这里在交付前把它们查出来。
 *
 * 检查项全部提醒级（不拦稿）；真正的发布门槛在 wechat-draft push 与 preflight。
 * 零子进程、零 HTML 字符串构造（安全扫描口径）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { MANUSCRIPT_DIR } from '../paths';

export interface LayoutCheck {
  id: string;
  label: string;
  pass: boolean;
  detail: string;
}

export interface LayoutReport {
  checks: LayoutCheck[];
  warnings: string[];
}

function stripFrontmatter(md: string): string {
  return md.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim();
}

/** markdown 结构排版风险：图片存在性 / 围栏闭合 / 表格对齐 / 标签残留 / 层级。 */
export function checkLayoutMarkdown(md: string): LayoutReport {
  const checks: LayoutCheck[] = [];
  const warnings: string[] = [];
  const body = stripFrontmatter(md);

  // 1. 代码围栏必须成对闭合（奇数个 ``` 渲染必破）
  const fences = (body.match(/```/g) || []).length;
  checks.push({
    id: 'fences',
    label: '代码围栏闭合',
    pass: fences % 2 === 0,
    detail: fences % 2 === 0 ? `${fences / 2} 个围栏，闭合正常` : `${fences} 个围栏标记，奇数个 = 有围栏未闭合`,
  });
  if (fences % 2 !== 0) warnings.push('代码围栏未闭合，推草稿渲染会破版');

  // 2. 正文图片：本地相对路径必须存在（draft.mjs 找不到图会中止推草稿）
  const imgs = [...body.matchAll(/!\[([^\]]*)\]\(([^)\s]+)\)/g)];
  const localImgs = imgs.filter((m) => !/^(https?:|data:)/i.test(m[2]));
  const missing = localImgs
    .map((m) => ({ path: m[2], abs: path.resolve(MANUSCRIPT_DIR, m[2]) }))
    .filter((x) => !fs.existsSync(x.abs));
  checks.push({
    id: 'images',
    label: '正文图片路径存在',
    pass: missing.length === 0,
    detail: localImgs.length
      ? missing.length
        ? `${missing.length} 张找不到：` + missing.map((x) => x.path).join('、')
        : `${localImgs.length} 张本地图全部存在`
      : '无本地正文图',
  });
  if (missing.length) warnings.push('正文有本地图片路径不存在，推草稿会中止：' + missing.map((x) => x.path).join('、'));

  // 3. 表格：有表头分隔行时，每行列数一致且 ≤5 列（公众号正文窄）
  const tableLines = body.split('\n').filter((l) => /^\|.*\|$/.test(l.trim()));
  if (tableLines.length) {
    const cols = tableLines.map((l) => l.trim().split('|').length - 2);
    const base = cols[0];
    const misaligned = cols.filter((c) => c !== base).length;
    const tooWide = base > 5;
    checks.push({
      id: 'tables',
      label: '表格列对齐且 ≤5 列',
      pass: misaligned === 0 && !tooWide,
      detail: `${tableLines.length} 行 × ${base} 列` + (tooWide ? `，超 5 列手机上会挤爆` : misaligned ? `，${misaligned} 行列数不一致` : '，对齐'),
    });
    if (misaligned) warnings.push('表格存在列数不一致的行，渲染会错位');
    if (tooWide) warnings.push(`表格 ${base} 列超过 5 列，手机上显示会挤爆`);
  } else {
    checks.push({ id: 'tables', label: '表格列对齐且 ≤5 列', pass: true, detail: '无表格' });
  }

  // 4. HTML 标签残留（模型输出里混入的裸标签，wenyan 会原样注入或当文本）
  const rawTags = (body.match(/<(?!!(?:!\[)[^)]*\))\/?(div|span|img|section|p|br|h[1-6]|table|tr|td)\b[^>]*>/gi) || []).length;
  checks.push({
    id: 'rawtags',
    label: '无裸 HTML 标签残留',
    pass: rawTags === 0,
    detail: rawTags ? `${rawTags} 处裸标签` : '干净',
  });
  if (rawTags) warnings.push(`正文有 ${rawTags} 处裸 HTML 标签，wenyan 会原样注入微信正文`);

  // 5. 标题层级：## 数量与占位符
  const heads = (body.match(/^## /gm) || []).length;
  checks.push({
    id: 'headings',
    label: '小标题数量',
    pass: heads >= 1 && heads <= 6,
    detail: `${heads} 个 ## 小标题` + (heads === 0 ? '，全文没有分节' : ''),
  });
  if (heads === 0) warnings.push('全文没有 ## 小标题，微信里会是一大坨文字');

  return { checks, warnings };
}

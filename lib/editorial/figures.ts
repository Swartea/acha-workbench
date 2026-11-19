/**
 * 自主写稿的正文配图管线：把正文【图 N：描述】占位符变成真实图片。
 *
 * 机制：写稿模型按账号视觉规范生成自包含 HTML（对比表 / 流程 / 数据卡）→
 * playwright chromium（npm 依赖，进程内 import，不用子进程脚本）截图 →
 * 校验平台门槛（PNG、宽 ≥1080、单张 ≤1MB）→ 落到 01-内容库/稿件/素材/自动配图/ →
 * 正文占位符替换成 ![](相对路径)。
 *
 * 非阻断设计：配图失败保留占位符继续交付（证据位检查仍成立），只记提醒。
 * 数字纪律：提示词约束图里只准用正文与研究材料出现过的数字。
 */
import fs from 'node:fs';
import path from 'node:path';
import { FIGURE_DIR, MANUSCRIPT_DIR } from '../paths';
import { IMG_MAX_BYTES } from '../rules.mjs';
import { callModelGuarded, type ModelKey } from '../experts/runtime';
import { extractJsonObject, type ResearchResult } from './research';
import { safeName, stampLocal } from '../parse.mjs';
import type { Article } from './evaluate';

export interface FigureItem {
  slot: string;
  title: string;
  file: string;
  rel: string;
  width: number;
  height: number;
  bytes: number;
}

export interface FiguresResult {
  ok: boolean;
  figures: FigureItem[];
  warnings: string[];
  error?: string;
}

interface Slot {
  match: string;
  num: string;
  desc: string;
}

function findSlots(body: string): Slot[] {
  const slots: Slot[] = [];
  const re = /【图\s?(\d+)[:：]\s*([^\】]+)】/g;
  for (const m of body.matchAll(re)) {
    slots.push({ match: m[0], num: m[1], desc: m[2].trim() });
  }
  return slots.slice(0, 2); // 一篇最多 2 张，控制成本与信息密度
}

function figurePrompt(article: Article, research: ResearchResult, slot: Slot): string {
  return [
    '你是「阿茶 AI 实验室」的配图工程师。给文章的下面这个配图位做一张结构图。',
    `配图位：${slot.match.replace(/[【】]/g, '')}`,
    '只输出 JSON，不要解释、不要 markdown 代码块：',
    '{"title":"图内大标题（≤14 字）","html":"<!doctype html> 开头的完整 HTML"}',
    '',
    'HTML 硬约束（违反即废图）：',
    '1. 画布固定 1080×810：body 要有 width:1080px;height:810px;overflow:hidden，内容超画布会被裁掉。',
    '2. 完全自包含：无外部图片、无 <link>、无 web 字体、无 JS；CSS 全部放在 <style>。',
    '3. 配色（账号视觉规范）：背景纸色 #f8f7f3、正文墨色 #1b1a18、强调绿 #2f6b4f、',
    '   警示铁锈红 #b23c2e、条件态琥珀 #9a6517、分隔线 #e3dfd5；字体 PingFang SC 栈。',
    '4. 只准使用「文章正文」和「研究材料」里出现过的数字与事实，一个都不能新造；',
    '   材料里没有的格子宁可不画，不要编。',
    `5. 图的类型按配图位描述定（对比表 / 流程步骤 / 数据卡）：${slot.desc}`,
    '6. 字号 ≥14px；信息不过载（主体内容 ≤7 行）；底部小字标注「阿茶 AI 实验室 · 依据正文数据绘制」。',
    '',
    '## 文章正文',
    `${article.title}\n${article.body.slice(0, 6000)}`,
    '',
    '## 研究材料',
    research.markdown.slice(0, 8000),
  ].join('\n');
}

/** 纯 Node 读 PNG 头（IHDR 宽高 + 文件体积），不 spawn 探测。 */
function pngInfo(file: string): { width: number; height: number; bytes: number } | null {
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(24);
    fs.readSync(fd, buf, 0, 24, 0);
    fs.closeSync(fd);
    if (buf.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') return null;
    return {
      width: buf.readUInt32BE(16),
      height: buf.readUInt32BE(20),
      bytes: fs.statSync(file).size,
    };
  } catch {
    return null;
  }
}

export async function generateFigures(
  article: Article,
  model: ModelKey,
  runDir: string,
  runId: number,
  research: ResearchResult,
  onFail?: (message: string) => void,
): Promise<FiguresResult> {
  const warnings: string[] = [];
  const slots = findSlots(article.body);
  if (!slots.length) {
    return { ok: true, figures: [], warnings: ['正文没有【图 N】配图位，跳过配图'] };
  }

  // 1. 模型产出每个配图位的自包含 HTML
  const htmls: Array<{ slot: string; html: string }> = [];
  for (const slot of slots) {
    const text = await callModelGuarded(model, figurePrompt(article, research, slot), runDir, onFail);
    const j = extractJsonObject<{ title?: string; html?: string }>(text);
    let html = String(j?.html ?? '').trim();
    html = html.replace(/^```(?:html)?\r?\n?/i, '').replace(/\r?\n?```\s*$/i, '').trim();
    if (!/<body[\s>]/i.test(html)) {
      warnings.push(`配图位 图 ${slot.num}：模型没返回合法 HTML，保留占位符`);
      continue;
    }
    if (/src=["']https?:/i.test(html)) {
      warnings.push(`配图位 图 ${slot.num}：HTML 里出现外链图片（不许引用外部资源），保留占位符`);
      continue;
    }
    htmls.push({ slot: `图 ${slot.num}`, html });
  }
  if (!htmls.length) {
    return { ok: true, figures: [], warnings, error: '没有可渲染的配图 HTML' };
  }

  // 2. playwright 进程内截图（npm 依赖动态 import；一次 launch 截全部）
  let browser: import('playwright').Browser | null = null;
  try {
    const pw = await import('playwright');
    browser = await pw.chromium.launch();
    for (const job of htmls) {
      const page = await browser.newPage({
        viewport: { width: 1080, height: 810 },
        deviceScaleFactor: 2,
      });
      await page.setContent(job.html, { waitUntil: 'load' });
      await page.waitForTimeout(250);
      await page.screenshot({ path: path.join(runDir, `${job.slot.replace(/\s+/g, '')}.png`) });
      await page.close();
    }
  } catch (e) {
    return {
      ok: true,
      figures: [],
      warnings,
      error: `playwright 截图失败：${e instanceof Error ? e.message : String(e)}`,
    };
  } finally {
    await browser?.close();
  }

  // 3. 平台门槛校验（PNG、宽 ≥1080、≤1MB）+ 落盘 + 替换占位符；超限放弃该图，不静默推大图
  const stamp = stampLocal();
  const figures: FigureItem[] = [];
  for (const job of htmls) {
    const raw = path.join(runDir, `${job.slot.replace(/\s+/g, '')}.png`);
    if (!fs.existsSync(raw)) continue;
    const meta = pngInfo(raw);
    if (!meta) {
      warnings.push(`配图位 ${job.slot}：产出不是有效 PNG，保留占位符`);
      continue;
    }
    const slot = slots.find((s) => `图 ${s.num}` === job.slot);
    if (!slot) continue;
    const destName = `自动配图-${runId}-${stamp}-图${slot.num}-${safeName(article.title, 16)}.png`;
    const dest = path.join(FIGURE_DIR, destName);
    fs.mkdirSync(FIGURE_DIR, { recursive: true });
    fs.copyFileSync(raw, dest);
    if (meta.bytes > IMG_MAX_BYTES || meta.width < 1080) {
      fs.rmSync(dest);
      warnings.push(
        `配图位 ${job.slot}：${meta.width}×${meta.height} ${Math.round(meta.bytes / 1024)}KB 不满足平台门槛（PNG、宽 ≥1080、≤1MB），保留占位符`,
      );
      continue;
    }
    const rel = path.relative(MANUSCRIPT_DIR, dest);
    const title = `${job.slot}：${slot.desc.slice(0, 40)}`;
    article.body = article.body.replace(slot.match, `![${title}](${rel})`);
    figures.push({
      slot: job.slot,
      title,
      file: dest,
      rel,
      width: meta.width,
      height: meta.height,
      bytes: meta.bytes,
    });
  }

  return { ok: true, figures, warnings };
}

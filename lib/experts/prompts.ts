import {
  findVaultPack,
  findWorkbenchManuscript,
  loadBrandContext,
  loadTopicContext,
  renderSources,
  vaultContentDir,
  WORKBENCH_ROOT_NOTE,
} from './context';
import { OUTPUT_TAIL, ROLES, SHARED_CONSTRAINTS, type RoleId } from './roles';

export type TaskType = 'prepare_next' | 'topic_plan' | 'article_check';

export const TASK_LABELS: Record<TaskType, string> = {
  prepare_next: '排期建议（总编单人）',
  topic_plan: '选题策划（总编→研究→总编）',
  article_check: '稿件体检（总编→创作→总编）',
};

export interface TaskPayload {
  articleId?: string;
  manuscriptName?: string;
  note?: string;
}

interface StepSpec {
  role: RoleId;
  title: string;
  buildPrompt: (p: TaskPayload, prev: string[]) => string;
}

function head(role: RoleId, title: string): string {
  return [
    `你是「阿茶 AI 实验室」公众号编辑部的${ROLES[role].name}。`,
    `你的职责：${ROLES[role].duty}`,
    `本次任务：${title}`,
    '',
    SHARED_CONSTRAINTS,
    '',
  ].join('\n');
}

function outputSpec(lines: string[]): string {
  return lines.join('\n');
}

export const STEPS: Record<TaskType, StepSpec[]> = {
  prepare_next: [
    {
      role: 'chief-editor',
      title: '安排下一篇',
      buildPrompt: (p) =>
        [
          head('chief-editor', '从选题库安排下一篇公众号文章'),
          '',
          '权威内容库的选题库与看板摘录（只读，来源已标注）：',
          renderSources(loadTopicContext()),
          '',
          p.note ? `用户补充要求：${p.note}` : '用户没有额外要求。',
          '',
          outputSpec([
            '请输出：',
            '## 推荐',
            '写哪一篇（编号+标题），2-3 条理由（看板状态 / 排期缺口 / 时效）。',
            '## 备选',
            '1-2 篇备选，各一句话理由。',
            '## 下一步',
            '推进推荐篇目还缺什么材料。',
            OUTPUT_TAIL,
          ]),
        ].join('\n'),
    },
  ],
  topic_plan: [
    {
      role: 'chief-editor',
      title: '分析写作包，布置核查',
      buildPrompt: (p) => {
        const id = p.articleId ?? 'A2';
        const pack = findVaultPack(id);
        return [
          head('chief-editor', `为写作包 ${id} 做选题策划：先分析与布置核查`),
          '',
          WORKBENCH_ROOT_NOTE,
          '',
          renderSources([pack, ...loadBrandContext()]),
          pack ? '' : `注意：在 ${vaultContentDir()} 未找到「写作包 - ${id} 」开头的文件。`,
          p.note ? `用户补充要求：${p.note}` : '',
          '',
          outputSpec([
            '请输出（内部步骤，供研究专家使用）：',
            '## 选题判断',
            '值不值得写、为什么现在写、目标读者，3-6 句。',
            '## 核查问题清单',
            '挑 3-6 条最易出错或过期的**事实性陈述**（版本 / 价格 / 发布时间 / 功能范围 / 数据），',
            '写成给研究专家的核查问题，每条注明为什么重要。',
            '## 大纲方向（初步）',
            '3-5 条要点。',
          ]),
        ].join('\n');
      },
    },
    {
      role: 'researcher',
      title: '按清单核查事实',
      buildPrompt: (p, prev) =>
        [
          head('researcher', `核查写作包 ${p.articleId ?? 'A2'} 的关键事实`),
          '',
          '总编的选题分析与核查问题清单：',
          prev[0] ?? '(总编步骤失败，无法核查，请直接说明)',
          '',
          '你只依据给定材料与既有知识作答，不联网；不确定一律标「未核实」。',
          '',
          outputSpec([
            '请输出：',
            '## 核查结论',
            '先总述你的信息边界（无法实时联网，基于模型既有知识）。',
            '再逐条对应清单：结论 / 可信级别（官方口径·第三方·写作包原文·未核实）/ 依据。',
            '## 对文章的影响',
            '哪些说法必须改口径、哪些可保留，各一句话。',
          ]),
        ].join('\n'),
    },
    {
      role: 'chief-editor',
      title: '汇总选题策划',
      buildPrompt: (p, prev) => {
        const id = p.articleId ?? 'A2';
        const pack = findVaultPack(id);
        return [
          head('chief-editor', `汇总 ${id} 选题策划（最终交付版）`),
          '',
          '研究专家核查结论：',
          prev[1] ?? '(研究步骤失败)',
          '',
          renderSources([...loadBrandContext(), pack]),
          '',
          outputSpec([
            '请汇总成「选题策划结果」，用户据此决定是否开写：',
            '## 一句话结论',
            '## 为什么是这篇 · 为什么是现在',
            '## 关键事实清单',
            '每条 = 事实 + 来源 + 可信级别；未核实的单独分组。',
            '## 建议大纲',
            '五段式，每段 1-2 句；标注需作者亲测/截图的位置。',
            '## 标题方向',
            '3 条候选（各 ≤ 32 字 + 一句 hook）。',
            '## 配图位建议',
            '2-4 个（截图 / 对比图 / 流程图）。',
            OUTPUT_TAIL,
          ]),
        ].join('\n');
      },
    },
  ],
  article_check: [
    {
      role: 'chief-editor',
      title: '通读稿件，圈事实疑点',
      buildPrompt: (p) => {
        const ms = p.manuscriptName ? findWorkbenchManuscript(p.manuscriptName) : null;
        return [
          head('chief-editor', `体检稿件：${p.manuscriptName ?? '(未指定)'}`),
          '',
          renderSources([ms]),
          !ms ? `注意：稿件目录未找到「${p.manuscriptName ?? ''}」，请输出无法执行说明。` : '',
          '',
          outputSpec([
            '请输出：',
            '## 稿件概况',
            '主题 / 结构 / 大致字数，3 句内。',
            '## 事实疑点清单',
            '只圈疑点不下结论：版本 / 价格 / 数据 / 引用中需人工核实的项。',
            '## 交给创作专家的重点',
            '最担心表达出问题的 2-3 处。',
          ]),
        ].join('\n');
      },
    },
    {
      role: 'writer',
      title: '表达与 AI 味检查',
      buildPrompt: (p, prev) => {
        const ms = p.manuscriptName ? findWorkbenchManuscript(p.manuscriptName) : null;
        return [
          head('writer', `稿件表达层体检：${p.manuscriptName ?? '(未指定)'}`),
          '',
          '总编圈出的重点：',
          prev[0] ?? '(总编步骤失败)',
          '',
          renderSources([ms, ...loadBrandContext()]),
          '',
          outputSpec([
            '请输出：',
            '## 表达与结构问题',
            '分 高/中/低 列出：位置（引原句片段）+ 问题 + 改写示例。',
            '## AI 味与空洞表述',
            '逐条指出套话 / 夸大 / 正确的废话，各给更实的替代句。',
            '## 保留亮点',
            '值得保留的 2-3 处。',
            '只做表达判断；事实口径一律按「未核实」处理，不改写事实本身。',
          ]),
        ].join('\n');
      },
    },
    {
      role: 'chief-editor',
      title: '汇总体检报告',
      buildPrompt: (p, prev) => {
        const ms = p.manuscriptName ? findWorkbenchManuscript(p.manuscriptName) : null;
        return [
          head('chief-editor', `汇总稿件体检报告：${p.manuscriptName ?? '(未指定)'}`),
          '',
          '创作专家意见：',
          prev[1] ?? '(创作步骤失败)',
          '',
          renderSources([ms]),
          '',
          outputSpec([
            '请汇总成「稿件体检报告」，供用户修改定稿发表参考：',
            '## 总体判断',
            '离可发布还差什么，3-5 句。',
            '## 问题清单（按优先级）',
            '合并创作意见与事实疑点；事实类一律标「待核实」。',
            '## 建议动作顺序',
            '先改什么后改什么，≤ 5 条。',
            OUTPUT_TAIL,
          ]),
        ].join('\n');
      },
    },
  ],
};

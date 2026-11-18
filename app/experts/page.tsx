import fs from 'node:fs';
import Link from 'next/link';
import {
  getExpertRunSteps,
  getRecentExpertRuns,
  type ExpertRun,
} from '@/lib/db';
import PasscodeGate from '@/components/PasscodeGate';
import { listWorkbenchManuscripts } from '@/lib/experts/context';
import { TASK_LABELS } from '@/lib/experts/prompts';
import { ROLES } from '@/lib/experts/roles';
import { modelAvailable } from '@/lib/experts/runtime';

export const dynamic = 'force-dynamic';

const ROLE_ORDER: Array<keyof typeof ROLES> = ['chief-editor', 'researcher', 'writer', 'visual'];

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function inline(s: string): string {
  return s
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/`([^`]+)`/g, '<code class="mono">$1</code>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}

/** 极简 Markdown 渲染（先转义再转换，防注入）：标题/加粗/行内码/列表/引用/分隔线。 */
function renderMd(src: string): string {
  const lines = esc(src).split('\n');
  const out: string[] = [];
  let inList = false;
  const closeList = () => {
    if (inList) {
      out.push('</ul>');
      inList = false;
    }
  };
  for (const line of lines) {
    const t = line.trim();
    if (!t) {
      closeList();
      continue;
    }
    const hm = t.match(/^(#{1,4})\s+(.*)$/);
    if (hm) {
      closeList();
      const h = `h${hm[1].length}`;
      out.push(`<${h} class="md-h">${inline(hm[2])}</${h}>`);
      continue;
    }
    if (/^(-{3,}|\*{3,})$/.test(t)) {
      closeList();
      out.push('<hr class="hr"/>');
      continue;
    }
    if (t.startsWith('&gt; ')) {
      closeList();
      out.push(`<blockquote class="md-q">${inline(t.slice(5))}</blockquote>`);
      continue;
    }
    if (/^[-*]\s+/.test(t) || /^\d+[.、]\s*/.test(t)) {
      if (!inList) {
        out.push('<ul class="md-ul">');
        inList = true;
      }
      out.push(`<li>${inline(t.replace(/^([-*]|\d+[.、])\s+/, ''))}</li>`);
      continue;
    }
    closeList();
    out.push(`<p class="md-p">${inline(t)}</p>`);
  }
  closeList();
  return out.join('\n');
}

interface RunGroup {
  runId: string;
  taskType: string;
  steps: ExpertRun[];
  latestAt: string;
  allOk: boolean;
}

function groupRuns(rows: ExpertRun[]): RunGroup[] {
  const map = new Map<string, RunGroup>();
  for (const r of rows) {
    const g = map.get(r.run_id);
    if (g) {
      g.steps.push(r);
      if (r.created_at > g.latestAt) g.latestAt = r.created_at;
      if (r.status !== 'ok') g.allOk = false;
    } else {
      map.set(r.run_id, {
        runId: r.run_id,
        taskType: r.task_type,
        steps: [r],
        latestAt: r.created_at,
        allOk: r.status === 'ok',
      });
    }
  }
  return [...map.values()].sort((a, b) => (a.latestAt < b.latestAt ? 1 : -1));
}

function readText(p: string | null): string | null {
  if (!p) return null;
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

export default async function ExpertsPage({
  searchParams,
}: {
  searchParams: Promise<{ run?: string; error?: string; failed?: string }>;
}) {
  const sp = await searchParams;
  const rows = getRecentExpertRuns(60);
  const groups = groupRuns(rows);
  const manuscripts = listWorkbenchManuscripts();
  const sel = sp.run ? groups.find((g) => g.runId === sp.run) : undefined;
  const selSteps = sp.run ? getExpertRunSteps(sp.run) : [];
  const resultText =
    selSteps.length && sel?.allOk ? readText(selSteps[selSteps.length - 1].output_file) : null;
  const models = {
    glm: modelAvailable('glm'),
    kimi: modelAvailable('kimi'),
    minimax: modelAvailable('minimax'),
  };
  const allModels = models.glm && models.kimi && models.minimax;

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <div className="eyebrow">AI 编辑部 · 公众号专家团队</div>
          <h1 className="page-title">AI 编辑部</h1>
          <p className="page-sub">
            总编组织研究与创作专家完成任务；简单任务单人完成，产物只落工作台，决策交回你。
          </p>
        </div>
        <span className={`pill ${allModels ? 'ok' : 'warn'}`}>
          GLM {models.glm ? '✓' : '未装'} · Kimi {models.kimi ? '✓' : '未装'} · MiniMax {models.minimax ? '✓' : '未装'}
        </span>
      </header>

      <PasscodeGate />

      {!models.glm && (
        <div className="hero-note">
          <b>GLM（zcode-official）未安装</b>：三个任务的第一步都是总编，点「运行专家任务」会立刻失败。
          装好 GLM，或用 <code className="mono">WB_BIN_GLM</code> 指到一个可执行文件再来；Kimi / MiniMax 通道状态见右上。
        </div>
      )}

      {sp.error && <div className="hero-note">⚠️ {sp.error}</div>}
      {sp.failed && (
        <div className="hero-note">⚠️ 上一次运行有步骤失败，展开各步的「错误」列定位原因后可重试。</div>
      )}

      <section className="card section-gap">
        <div className="card-head">
          <h2 className="card-title">专家岗位</h2>
          <span className="card-sub">角色是职责 + 模型通道，不是固定身份</span>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>岗位</th>
                <th>模型</th>
                <th>职责</th>
                <th>交付</th>
              </tr>
            </thead>
            <tbody>
              {ROLE_ORDER.map((id) => {
                const r = ROLES[id];
                return (
                  <tr key={id}>
                    <td><b>{r.name}</b></td>
                    <td className="mono">{r.model}{!models[r.model] && <span className="tiny faint"> 未装</span>}</td>
                    <td className="small">{r.duty}</td>
                    <td className="small">{r.deliverable}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card section-gap">
        <div className="card-head">
          <h2 className="card-title">派活</h2>
          <span className="card-sub">一次只跑一个任务（30 分钟锁）· 每步真实调用模型 CLI</span>
        </div>
        <form method="POST" action="/api/experts" className="form-grid">
          <label className="field">
            <span>任务类型</span>
            <select name="task_type" className="select" defaultValue="topic_plan">
              {Object.entries(TASK_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>文章编号（选题策划用）</span>
            <input name="articleId" className="select" defaultValue="A2" placeholder="如 A2" />
          </label>
          <label className="field">
            <span>稿件文件（稿件体检用，可留空）</span>
            <input
              name="manuscriptName"
              className="select"
              placeholder="01-内容库/稿件 下的文件名"
              list="ms-list"
            />
            <datalist id="ms-list">
              {manuscripts.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </label>
          <label className="field">
            <span>补充要求（可留空）</span>
            <input name="note" className="select" placeholder="如：侧重价格口径" />
          </label>
          <div className="field">
            <button type="submit" className="btn" disabled={!models.glm}>运行专家任务</button>
          </div>
        </form>
        <p className="tiny faint" style={{ marginBottom: 0 }}>
          运行中页面会等待（每步最长 8 分钟）。产物只写入 06-工作台/data/experts/，不碰 vault、不碰稿件。
        </p>
      </section>

      {sel && (
        <section className="card section-gap">
          <div className="card-head">
            <h2 className="card-title">结果：{sel.runId}</h2>
            <span className={`pill ${sel.allOk ? 'ok' : 'warn'}`}>{sel.allOk ? '全步骤成功' : '有失败步骤'}</span>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>#</th><th>专家</th><th>模型</th><th>状态</th><th>耗时</th><th>错误</th><th></th>
                </tr>
              </thead>
              <tbody>
                {selSteps.map((s) => (
                  <tr key={s.id}>
                    <td>{s.seq}</td>
                    <td>{ROLES[s.role as keyof typeof ROLES]?.name ?? s.role}</td>
                    <td className="mono">{s.model}</td>
                    <td>{s.status === 'ok' ? '✅' : '❌'}</td>
                    <td className="mono">{s.duration_ms ? `${Math.round(s.duration_ms / 1000)}s` : '—'}</td>
                    <td className="small">{s.detail ?? ''}</td>
                    <td>
                      <details>
                        <summary className="tiny">原始输出</summary>
                        <pre className="console tiny" style={{ whiteSpace: 'pre-wrap' }}>
                          {readText(s.output_file) ?? '(无)'}
                        </pre>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {resultText && (
            <div className="hero-note">
              <div
                className="md-body"
                dangerouslySetInnerHTML={{ __html: renderMd(resultText) }}
              />
            </div>
          )}
        </section>
      )}

      <section className="card section-gap">
        <div className="card-head">
          <h2 className="card-title">运行记录</h2>
          <span className="card-sub">最近 {groups.length} 次</span>
        </div>
        {groups.length === 0 ? (
          <p className="muted">还没有运行记录。</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>时间</th><th>任务</th><th>步骤链</th><th>状态</th><th></th></tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <tr key={g.runId}>
                    <td className="mono tiny">{new Date(g.latestAt).toLocaleString('zh-CN', { hour12: false })}</td>
                    <td>{TASK_LABELS[g.taskType as keyof typeof TASK_LABELS] ?? g.taskType}</td>
                    <td className="small">
                      {g.steps
                        .map((s) => ROLES[s.role as keyof typeof ROLES]?.name ?? s.role)
                        .join(' → ')}
                    </td>
                    <td>{g.allOk ? '✅' : '❌'}</td>
                    <td><Link href={`/experts?run=${encodeURIComponent(g.runId)}`}>查看</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

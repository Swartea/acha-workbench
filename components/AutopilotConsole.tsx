'use client';

import { useCallback, useEffect, useState } from 'react';

export interface AutopilotRunView {
  id: number;
  status: 'running' | 'ok' | 'blocked' | 'error';
  stage: string;
  topic: string | null;
  source_title: string | null;
  source_url: string | null;
  model: string;
  article_file: string | null;
  run_dir: string | null;
  checks: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface AutopilotEventView {
  id: number;
  run_id: number;
  at: string;
  stage: string;
  status: string;
  message: string | null;
  data: string | null;
}

export interface SourceView {
  claim: string;
  url: string;
  level: string;
  accessed: string;
  quote: string;
}

export interface CoverView {
  ok: boolean;
  file: string | null;
  rel: string | null;
  promptFile: string | null;
  prompt: string;
  width: number;
  height: number;
  bytes: number;
  format: string;
  compressed: boolean;
  source: string;
  wechat?: { dryRunOk: boolean; preflightOk: boolean; ok: boolean; dryRun: string; preflight: string };
  error?: string;
}

export interface CheckView {
  verdict: string;
  blockers: string[];
  warnings: string[];
  checkedAt: string;
  sources?: SourceView[];
  shape?: {
    score: number | null;
    verdict: string | null;
    blockers: string[];
    checks: Array<{ id: string; label: string; pass: boolean; detail: string }>;
    chars: number | null;
  };
}

export interface FigureView {
  slot: string;
  title: string;
  file: string;
  rel: string;
  width: number;
  height: number;
  bytes: number;
}

export interface FiguresView {
  ok: boolean;
  figures: FigureView[];
  warnings: string[];
  error?: string;
}

export interface LayoutCheckView {
  id: string;
  label: string;
  pass: boolean;
  detail: string;
}

export interface LayoutView {
  checks: LayoutCheckView[];
  warnings: string[];
}

export interface AutopilotDetailView {
  run: AutopilotRunView;
  events: AutopilotEventView[];
  article: string;
  research: string;
  checks: CheckView | null;
  cover: CoverView | null;
  figures: FiguresView | null;
  layout: LayoutView | null;
  files: string[];
}

const STAGES = [
  ['pick', '选题'],
  ['research', '研究'],
  ['brief', '判断'],
  ['draft', '写稿'],
  ['check', '检查'],
  ['revise', '返工'],
  ['figures', '配图'],
  ['cover', '封面'],
  ['layout', '排版'],
  ['save', '交付'],
  ['done', '完成'],
] as const;

const STATUS_LABEL: Record<string, string> = {
  running: '运行中',
  ok: '已交付',
  blocked: '返工未过',
  error: '失败',
};

function statusTone(status: string): string {
  if (status === 'ok') return 'ok';
  if (status === 'blocked') return 'warn';
  if (status === 'error') return 'bad';
  return 'warn';
}

export default function AutopilotConsole({
  initialRuns,
  initialDetail,
}: {
  initialRuns: AutopilotRunView[];
  initialDetail: AutopilotDetailView | null;
}) {
  const [runs, setRuns] = useState<AutopilotRunView[]>(initialRuns);
  const [detail, setDetail] = useState<AutopilotDetailView | null>(initialDetail);
  const [selected, setSelected] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const MODELS = ['kimi', 'minimax', 'glm', 'deepseek'] as const;
  const [model, setModel] = useState<(typeof MODELS)[number]>('kimi');

  const refresh = useCallback(async (forceLatest = false) => {
    try {
      const res = await fetch('/api/autopilot', { cache: 'no-store' });
      const j = (await res.json()) as {
        ok: boolean;
        runs?: AutopilotRunView[];
        detail?: AutopilotDetailView | null;
      };
      if (j.ok) {
        setRuns(j.runs ?? []);
        if (forceLatest || selected === null) setDetail(j.detail ?? null);
      }
    } catch {
      /* 下一轮再试 */
    }
  }, [selected]);

  const running = detail?.run.status === 'running' || runs.some((r) => r.status === 'running');
  useEffect(() => {
    const t = setInterval(refresh, running ? 4000 : 12000);
    return () => clearInterval(t);
  }, [refresh, running]);

  async function openRun(id: number) {
    try {
      const res = await fetch(`/api/autopilot?id=${id}`, { cache: 'no-store' });
      const j = (await res.json()) as { ok: boolean; detail?: AutopilotDetailView | null; error?: string };
      if (!j.ok) throw new Error(j.error || '读取失败');
      setSelected(id);
      setDetail(j.detail ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function start() {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/autopilot', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model }),
      });
      const j = (await res.json()) as { ok: boolean; error?: string };
      if (!j.ok) throw new Error(j.error || '启动失败');
      setSelected(null);
      await refresh(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const stage = detail?.run.stage ?? 'queued';
  const currentIndex = STAGES.findIndex(([id]) => id === stage);
  const checks = detail?.checks;
  const sources = checks?.sources ?? [];
  const attempts = detail?.files?.filter((f) => /^draft-v\d+\.md$/.test(f)).length ?? 0;
  const revised = attempts > 1;
  const articleBody = detail?.article ? detail.article.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '') : '';

  return (
    <div className="stack">
      {error && <div className="hero-note">{error}</div>}

      <section className="card">
        <div className="card-head">
          <h2 className="card-title">AI 自主写稿</h2>
          <span className="card-sub">选题 → 研究 → 判断 → 写稿 → 检查 → 返工 → 封面 → 待发布稿</span>
        </div>
        <p className="md-p">
          从 Folo 雷达自主选题，抓官方仓库 / 原文建来源台账，自己定角度、标题和结构；机器检查不过由原模型返工，
          最多 2 轮；通过后调用 Codex 内置 imagegen 生成文章封面。全程不需要人参与，<b>发表仍由你在公众号后台手点</b>。
        </p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12, flexWrap: 'wrap' }}>
          <button className="btn primary" disabled={busy || running} onClick={start}>
            {busy ? '启动中…' : running ? '正在写…' : '开始一篇（' + model + '）'}
          </button>
          <button
            className="btn"
            disabled={busy || running}
            onClick={() => setModel(MODELS[(MODELS.indexOf(model) + 1) % MODELS.length])}
          >
            切换模型：{model}
          </button>
          <button className="btn" disabled={busy} onClick={() => void refresh()}>刷新</button>
        </div>
        {running && (
          <div className="hero-note" style={{ marginTop: 10 }}>
            已启动。写稿 + 研究 + 返工通常 3–8 分钟；可以离开这个页面，回来会接着显示。
          </div>
        )}
      </section>

      {detail && (
        <section className="card">
          <div className="card-head">
            <h2 className="card-title">
              #{detail.run.id} · {detail.run.topic || detail.run.source_title || '选题中'}
            </h2>
            <span className={'pill ' + statusTone(detail.run.status)}>{STATUS_LABEL[detail.run.status] ?? detail.run.status}</span>
          </div>
          <div className="tiny faint mono">
            模型 {detail.run.model} · 开始 {new Date(detail.run.created_at).toLocaleString('zh-CN', { hour12: false })}
            {detail.run.source_url && (
              <>
                {' · '}
                <a href={detail.run.source_url} target="_blank" rel="noreferrer" style={{ textDecoration: 'underline' }}>
                  原始线索
                </a>
              </>
            )}
          </div>

          <div className="steps" style={{ margin: '14px 0' }}>
            {STAGES.map(([id, label], i) => {
              const skippedCover = id === 'cover' && (!detail.cover || !detail.cover.ok);
              const skipped = (id === 'revise' && !revised) || skippedCover;
              const done = !skipped && (currentIndex > i || detail.run.status === 'ok');
              const current = !skipped && id === stage;
              return (
                <div key={id} className={'step ' + (done ? 'done' : current ? 'current' : '')} title={skippedCover ? (detail.cover?.error || '本轮没有生成封面') : skipped ? '本轮初稿通过，未触发返工' : label}>
                  <div className={'step-bar ' + (done ? 'done' : current ? 'current' : '')} />
                  <div className="step-name">{label}</div>
                </div>
              );
            })}
          </div>

          {detail.figures && detail.figures.figures.length > 0 && (
            <div style={{ margin: '4px 0 14px' }}>
              <div className="tiny faint" style={{ marginBottom: 6 }}>
                正文配图 {detail.figures.figures.length} 张
                {detail.figures.figures.map((f) => `${f.slot} ${f.width}×${f.height}`).join(' · ')}
              </div>
              {detail.figures.figures.map((f) => (
                <img
                  key={f.slot}
                  src={'/api/asset?p=' + encodeURIComponent(f.rel)}
                  alt={f.title}
                  style={{ width: '100%', maxWidth: 720, borderRadius: 10, border: '1px solid var(--line)', display: 'block', marginBottom: 10 }}
                />
              ))}
            </div>
          )}

          {detail.layout && (
            <details style={{ marginBottom: 12 }}>
              <summary className="small" style={{ cursor: 'pointer' }}>
                排版预检（{detail.layout.checks.filter((c) => !c.pass).length} 项提醒）
              </summary>
              <div className="table-wrap" style={{ marginTop: 8 }}>
                <table className="table">
                  <thead>
                    <tr><th>状态</th><th>检查项</th><th>结果</th></tr>
                  </thead>
                  <tbody>
                    {detail.layout.checks.map((c) => (
                      <tr key={c.id}>
                        <td>{c.pass ? '✅' : '⚠️'}</td>
                        <td>{c.label}</td>
                        <td className="tiny">{c.detail}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}

          {checks && (
            <div className="hero-note" style={{ marginBottom: 12 }}>
              <b>检查 {checks.verdict}</b>
              {typeof checks.shape?.score === 'number' ? ` · 形状 ${checks.shape.score}/100` : ''}
              {checks.blockers.length ? ` · 阻断 ${checks.blockers.length}` : ' · 无阻断项'}
              {checks.warnings.length ? ` · 提醒 ${checks.warnings.length}` : ''}
              {attempts > 0 ? ` · 生成 ${attempts} 版${attempts === 1 ? '（初稿一次通过）' : ''}` : ''}
            </div>
          )}
          {checks?.blockers.length ? (
            <div className="tiny" style={{ marginBottom: 10 }}>
              未过：{checks.blockers.join(' / ')}
            </div>
          ) : null}
          {detail.run.error && <div className="hero-note">{detail.run.error}</div>}

          {detail.cover?.ok && detail.cover.rel ? (
            <div style={{ margin: '4px 0 14px' }}>
              <div className="tiny faint" style={{ marginBottom: 6 }}>
                封面 {detail.cover.width}×{detail.cover.height} · {detail.cover.format.toUpperCase()} ·{' '}
                {Math.round(detail.cover.bytes / 1024)}KB
                {detail.cover.compressed ? ' · 已裁切/压缩' : ''}
                {detail.cover.wechat
                  ? detail.cover.wechat.ok
                    ? ' · 微信 dry-run / preflight 通过'
                    : ' · 微信流程检查未过'
                  : ''}
              </div>
              <img
                src={'/api/asset?p=' + encodeURIComponent(detail.cover.rel)}
                alt="文章封面"
                style={{ width: '100%', maxWidth: 760, borderRadius: 10, border: '1px solid var(--line)', display: 'block' }}
              />
              {detail.cover.prompt ? (
                <details style={{ marginTop: 8 }}>
                  <summary className="small" style={{ cursor: 'pointer' }}>封面 Prompt</summary>
                  <pre className="console" style={{ maxHeight: 220, overflow: 'auto', whiteSpace: 'pre-wrap', marginTop: 8 }}>
                    {detail.cover.prompt}
                  </pre>
                </details>
              ) : null}
            </div>
          ) : detail.cover && !detail.cover.ok ? (
            <div className="hero-note" style={{ marginBottom: 12 }}>
              封面生成失败：{detail.cover.error || '未知错误'}。正文仍已保存，可稍后重跑。
            </div>
          ) : null}

          {detail.article ? (
            <details open>
              <summary className="small" style={{ cursor: 'pointer' }}>
                待发布稿（{detail.run.article_file?.split('/').pop()}）
              </summary>
              <pre className="console" style={{ maxHeight: 520, overflow: 'auto', whiteSpace: 'pre-wrap', marginTop: 10 }}>
                {articleBody}
              </pre>
            </details>
          ) : (
            <div className="empty">还没有成稿；等运行到「写稿」阶段。</div>
          )}

          {sources.length > 0 && (
            <details style={{ marginTop: 12 }}>
              <summary className="small" style={{ cursor: 'pointer' }}>来源台账（{sources.length} 条）</summary>
              <div className="table-wrap" style={{ marginTop: 8 }}>
                <table className="table">
                  <thead>
                    <tr><th>级别</th><th>结论</th><th>URL</th><th>访问日期</th></tr>
                  </thead>
                  <tbody>
                    {sources.map((s, i) => (
                      <tr key={i}>
                        <td className="mono">{s.level}</td>
                        <td>{s.claim}</td>
                        <td className="tiny mono">
                          <a href={s.url} target="_blank" rel="noreferrer" style={{ textDecoration: 'underline' }}>
                            {s.url.length > 52 ? s.url.slice(0, 52) + '…' : s.url}
                          </a>
                        </td>
                        <td className="mono tiny">{s.accessed}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}

          <details style={{ marginTop: 12 }}>
            <summary className="small" style={{ cursor: 'pointer' }}>过程日志（{detail.events.length} 条）</summary>
            <div className="console" style={{ marginTop: 8, maxHeight: 300, overflow: 'auto' }}>
              {detail.events.map((e) => (
                <div key={e.id} className="tiny mono">
                  {new Date(e.at).toLocaleTimeString('zh-CN', { hour12: false })} · {e.stage} · {e.message}
                </div>
              ))}
            </div>
          </details>

        </section>
      )}

      <section className="card">
        <div className="card-head">
          <h2 className="card-title">写稿记录</h2>
          <span className="card-sub">最近 10 轮</span>
        </div>
        {runs.length === 0 ? (
          <div className="empty">还没有跑过。点上面的「开始一篇」。</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>#</th><th>选题</th><th>状态</th><th>阶段</th><th>模型</th><th>开始</th></tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => void openRun(r.id)}>
                    <td className="mono">{r.id}</td>
                    <td>{r.topic || r.source_title || '—'}</td>
                    <td><span className={'pill ' + statusTone(r.status)}>{STATUS_LABEL[r.status] ?? r.status}</span></td>
                    <td className="mono tiny">{r.stage}</td>
                    <td className="mono tiny">{r.model}</td>
                    <td className="tiny">{new Date(r.created_at).toLocaleString('zh-CN', { hour12: false })}</td>
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

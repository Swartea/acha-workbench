'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface HermesRunRow {
  run_id: string;
  message: string;
  status: 'running' | 'ok' | 'error' | 'blocked';
  manuscript: string | null;
  media_id: string | null;
  error: string | null;
  created_at: string;
}

interface RunDetail {
  ok: boolean;
  row: HermesRunRow & { result_json: string | null; run_dir: string };
  gwStatus?: string | null;
  transcriptTail?: string;
  artifacts?: string[];
}

const STATUS_LABEL: Record<string, string> = {
  running: '运行中',
  ok: '完成',
  error: '失败',
  blocked: '受阻待人工',
};

const QUICK_TASKS = [
  '写 A11（Hermes 本地 Agent）：按写作包成稿，走完干跑、预检和手机预览；不推草稿箱',
  '写下一篇：从选题库挑一个窗口期内的选题，先给我写作包摘要再写稿',
];

export default function HermesPage() {
  const [message, setMessage] = useState('');
  const [runs, setRuns] = useState<HermesRunRow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [notice, setNotice] = useState('');
  const [dispatching, setDispatching] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/hermes', { cache: 'no-store' });
      const j = (await res.json()) as { ok: boolean; runs?: HermesRunRow[] };
      if (j.ok && j.runs) setRuns(j.runs);
    } catch {
      /* 下次轮询再试 */
    }
  }, []);

  const loadDetail = useCallback(async (runId: string) => {
    try {
      const res = await fetch(`/api/hermes?run=${encodeURIComponent(runId)}`, { cache: 'no-store' });
      const j = (await res.json()) as RunDetail;
      setDetail(j.ok ? j : null);
    } catch {
      setDetail(null);
    }
  }, []);

  useEffect(() => {
    refresh();
    pollRef.current = setInterval(() => {
      refresh();
      if (selected) loadDetail(selected);
    }, 10_000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [refresh, loadDetail, selected]);

  useEffect(() => {
    if (selected) loadDetail(selected);
  }, [selected, loadDetail]);

  async function dispatch() {
    if (!message.trim() || dispatching) return;
    setDispatching(true);
    setNotice('');
    try {
      const res = await fetch('/api/hermes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message }),
      });
      const j = (await res.json()) as { ok: boolean; runId?: string; error?: string };
      if (j.ok && j.runId) {
        setNotice(`已派出：${j.runId}（Hermes 管家开始执行，预计 10-25 分钟）`);
        setMessage('');
        setSelected(j.runId);
        refresh();
      } else {
        setNotice(`派出失败：${j.error ?? '未知原因'}`);
      }
    } catch {
      setNotice('派出失败：工作台接口不可达');
    } finally {
      setDispatching(false);
    }
  }

  let resultSteps: Record<string, string> | null = null;
  let resultNotes: string[] = [];
  let previewHtml: string | null = null;
  if (detail?.row?.result_json) {
    try {
      const r = JSON.parse(detail.row.result_json) as {
        steps?: Record<string, string>;
        notes?: string[];
        preview_html?: string | null;
      };
      resultSteps = r.steps ?? null;
      resultNotes = r.notes ?? [];
      previewHtml = r.preview_html ?? null;
    } catch {
      /* 显示原文 */
    }
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <div className="eyebrow">Hermes 管家 · 中文派活</div>
          <h1 className="page-title">Hermes 管家</h1>
          <p className="page-sub">
            中文派活 → Hermes（MiniMax-M3）读资料、调 MiniMax 写稿、走预检预览，按需推草稿箱。正式发表永远由你手动完成。
          </p>
        </div>
      </header>

      <div className="card">
        <div className="card-head">
          <div className="card-title">派活</div>
          <div className="card-sub">一次只跑一个任务；要推草稿箱请在指令里明确说「推草稿」</div>
        </div>
        <label className="field">
          <span>任务</span>
          <textarea
            rows={4}
            value={message}
            placeholder="例：写 A11，按写作包成稿，走完预检和手机预览，然后推草稿箱"
            onChange={(e) => setMessage(e.target.value)}
          />
        </label>
        <div className="chips" style={{ marginTop: 8 }}>
          {QUICK_TASKS.map((t) => (
            <button key={t} type="button" className="btn" onClick={() => setMessage(t)}>
              {t.slice(0, 18)}…
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' }}>
          <button className="btn primary" type="button" onClick={dispatch} disabled={dispatching || !message.trim()}>
            {dispatching ? '派出中…' : '派给管家'}
          </button>
          {notice && <span className="muted">{notice}</span>}
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div className="card-title">任务记录</div>
          <div className="card-sub">每 10 秒自动刷新</div>
        </div>
        {runs.length === 0 && <div className="empty">还没有任务。用上面的表单派第一个活。</div>}
        {runs.map((r) => (
          <button
            key={r.run_id}
            type="button"
            className={`check-row${selected === r.run_id ? ' active' : ''}`}
            style={{ width: '100%', textAlign: 'left', cursor: 'pointer' }}
            onClick={() => setSelected(r.run_id)}
          >
            <span className="check-main">
              <span className="check-label">{r.message.slice(0, 60)}</span>
              <span className="check-hint mono">
                {r.run_id} · {new Date(r.created_at).toLocaleString('zh-CN')} · {r.media_id ? `草稿 ${r.media_id} · ` : ''}
              </span>
            </span>
            <span className={`nav-badge${r.status === 'running' ? ' run' : r.status === 'ok' ? '' : ' err'}`}>
              {STATUS_LABEL[r.status] ?? r.status}
            </span>
          </button>
        ))}
      </div>

      {selected && (
        <div className="card">
          <div className="card-head">
            <div className="card-title">任务详情 · {selected}</div>
            <div className="card-sub">{detail ? `Gateway: ${detail.gwStatus ?? '—'}` : '加载中…'}</div>
          </div>
          {!detail && <div className="empty">加载中…</div>}
          {detail?.row && (
            <>
              {resultSteps && (
                <div className="mini-steps">
                  {Object.entries(resultSteps).map(([k, v]) => (
                    <span key={k} className={`chain-step ${v === 'ok' ? 'ok' : v === 'fail' ? 'bad' : ''}`}>
                      {k}: {v}
                    </span>
                  ))}
                </div>
              )}
              {detail.row.manuscript && (
                <p className="md-p">
                  稿件：<code className="mono">{detail.row.manuscript}</code>
                </p>
              )}
              {previewHtml && (
                <p className="md-p">
                  手机预览：<code className="mono">{previewHtml}</code>
                </p>
              )}
              {detail.row.media_id && (
                <p className="md-p">
                  草稿 Media ID：<code className="mono">{detail.row.media_id}</code>（已入公众号草稿箱）
                </p>
              )}
              {detail.row.error && <p className="md-p">错误：{detail.row.error}</p>}
              {resultNotes.length > 0 && (
                <ul className="md-ul">
                  {resultNotes.map((n, i) => (
                    <li key={i}>待人工：{n}</li>
                  ))}
                </ul>
              )}
              {detail.transcriptTail && (
                <details>
                  <summary className="muted">最终回复 / 转写尾部</summary>
                  <pre className="console">{detail.transcriptTail}</pre>
                </details>
              )}
              {detail.artifacts && detail.artifacts.length > 0 && (
                <details>
                  <summary className="muted">运行产物（{detail.row.run_dir}）</summary>
                  <pre className="console">{detail.artifacts.join('\n')}</pre>
                </details>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

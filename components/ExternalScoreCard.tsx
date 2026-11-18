'use client';

import { useState } from 'react';
import type { ExternalScore } from '@/lib/external-score';

/** 外部 AI 味评分卡：显式点按钮才跑，结果只做 advisory。 */
export default function ExternalScoreCard({ file }: { file: string }) {
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState<ExternalScore | null>(null);
  const [error, setError] = useState('');

  async function run() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/score?file=${encodeURIComponent(file)}`, { cache: 'no-store' });
      const json = (await res.json()) as { ok: boolean; error?: string } & Partial<ExternalScore>;
      if (!json.ok) throw new Error(json.error || '评分失败');
      setData(json as ExternalScore);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const shown = data ? data.advisories.slice(0, 30) : [];
  const rest = data ? Math.max(0, data.advisories.length - shown.length) : 0;

  return (
    <section className="card section-gap">
      <div className="card-head">
        <h2 className="card-title">AI 味 · 外部（wechat-publisher）</h2>
        <span className="card-sub">advisory · 不拦发布 · 先清排版噪音，再谈润色</span>
      </div>

      {!data && !error && (
        <p className="tiny muted" style={{ marginTop: 0 }}>
          用 wechat-publisher 的 `ai_score.py` 扫一遍干净正文：整句加粗、破折号、三连排比这类「AI 号指纹」会给到行号。
        </p>
      )}

      {error && (
        <div className="hero-note" style={{ whiteSpace: 'pre-wrap' }}>
          {error}
        </div>
      )}

      {data && (
        <>
          <div className="score-row" style={{ marginTop: 4 }}>
            <span className="score-num">{data.total}</span>
            <span className="score-unit">/ 100</span>
            <span className="score-sub">
              阈值 {data.threshold} · 字数 {data.charCount} ·{' '}
              {data.exit === 0 ? <span className="pill ok">PASS</span> : <span className="pill bad">超阈值</span>}
            </span>
          </div>
          <div className="chips" style={{ marginTop: 10 }}>
            {Object.entries(data.dimensions).map(([key, value]) => (
              <span key={key} className={value >= 60 ? 'pill bad' : value >= 30 ? 'pill warn' : 'pill'}>
                {key} {value}
              </span>
            ))}
          </div>

          <div className="card-head" style={{ marginTop: 18, marginBottom: 8 }}>
            <h3 className="card-title" style={{ fontSize: 13.5 }}>
              advisory · {data.advisories.length} 条
            </h3>
            <span className="card-sub">按行号逐条看，来源清单里的破折号可以保留</span>
          </div>
          {data.advisories.length === 0 ? (
            <div className="empty">没有 advisory；低分不等于像人，仍要自己读一遍。</div>
          ) : (
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, lineHeight: 1.8, color: 'var(--ink-2)' }}>
              {shown.map((item, index) => (
                <li key={`${item.id}-${item.line ?? index}`}>
                  <span className="mono tiny faint">L{item.line ?? '?'}</span> · <span className="mono tiny">{item.id}</span>{' '}
                  {item.message ?? ''}
                  {item.excerpt ? (
                    <div className="tiny muted" style={{ marginTop: 2, whiteSpace: 'pre-wrap' }}>
                      {item.excerpt}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {rest > 0 && <p className="tiny faint">还有 {rest} 条未展开。</p>}
        </>
      )}

      <div style={{ marginTop: 14, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn" type="button" onClick={run} disabled={busy}>
          {busy ? '评分中…' : data ? '重跑外部评分' : '跑外部 AI 味评分'}
        </button>
        <span className="tiny faint">只调用本机 python，不上传稿件。</span>
      </div>
    </section>
  );
}

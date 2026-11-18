import Link from 'next/link';
import path from 'node:path';
import { MANUSCRIPT_DIR } from '@/lib/paths';
import { runQuality } from '@/lib/quality';
import ExternalScoreCard from '@/components/ExternalScoreCard';
import { scanWorkspace } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

const KIND_LABEL: Record<string, string> = {
  push: '推送版',
  review: '待审',
  preview: '预览',
  draft: '草稿',
};

function Verdict({ v }: { v: 'pass' | 'warn' | 'fail' }) {
  if (v === 'pass') return <span className="pill ok">通过</span>;
  if (v === 'warn') return <span className="pill warn">有提醒</span>;
  return <span className="pill bad">不通过</span>;
}

export default async function QualityPage({
  searchParams,
}: {
  searchParams: Promise<{ f?: string }>;
}) {
  const sp = await searchParams;
  const s = scanWorkspace();
  const mds = s.manuscripts;
  const preferred = s.current['A1']?.file ?? s.topics.find((t) => t.currentFile)?.currentFile?.file;
  const initial = preferred ?? mds[0]?.file ?? '';
  const file = sp.f ?? initial;
  const abs = file ? path.join(MANUSCRIPT_DIR, file) : '';
  const q = abs ? runQuality(abs) : null;

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <div className="eyebrow">质检 · 确定性检查</div>
          <h1 className="page-title">审稿质检台</h1>
          <p className="page-sub">字数口径、句长、词表、平台硬约束、图片合规，一次跑完。</p>
        </div>
        {q?.ok && <Verdict v={q.verdict} />}
      </header>

      <div className="tabs">
        {mds.map((m) => (
          <Link
            key={m.file}
            href={`/quality?f=${encodeURIComponent(m.file)}`}
            className={`tab${m.file === file ? ' on' : ''}`}
          >
            {m.numbered ? m.id : '未编号'} · {m.label.replace('公众号', '')}
            {m.date ? ` · ${m.date.slice(5)}` : ''}
          </Link>
        ))}
      </div>

      {!q?.ok && <div className="card"><div className="empty">{q?.error ?? '没有可检查的稿件'}</div></div>}

      {q?.ok && (
        <>
          {q.pyError && (
            <div className="hero-note" style={{ marginBottom: 16 }}>
              指标脚本异常：{q.pyError}
            </div>
          )}

          <div className="grid2even">
            <section className="card">
              <div className="card-head">
                <h2 className="card-title">字数</h2>
                <span className="card-sub">可见字符口径（与推送工具一致）</span>
              </div>
              {q.metrics ? (
                <>
                  <div className="score-row">
                    <span className="score-num">{q.metrics.visible_chars}</span>
                    <span className="score-unit">可见字符</span>
                    <span className="score-sub">纯中文 {q.metrics.cjk_chars}</span>
                  </div>
                  <div className="meter">
                    <i style={{ width: `${Math.min(100, (q.metrics.visible_chars / q.metrics.template_floor) * 100)}%` }} />
                  </div>
                  <p className="tiny muted" style={{ marginTop: 8 }}>
                    模板下限 {q.metrics.template_floor} ·{' '}
                    {q.metrics.missing_chars > 0 ? `还差 ${q.metrics.missing_chars} 字（可豁免）` : '已达标'}
                  </p>
                </>
              ) : (
                <div className="empty">无指标</div>
              )}
            </section>

            <section className="card">
              <div className="card-head">
                <h2 className="card-title">句长</h2>
                <span className="card-sub">散文与列表分开算</span>
              </div>
              {q.metrics ? (
                <div className="kv">
                  <dt>散文</dt>
                  <dd className="mono">
                    {q.metrics.prose.n} 句 · 最长 {q.metrics.prose.max} · 中位 {q.metrics.prose.median} · 均值{' '}
                    {q.metrics.prose.mean}
                  </dd>
                  <dt>列表</dt>
                  <dd className="mono">
                    {q.metrics.list.n} 条 · 最长 {q.metrics.list.max} · 中位 {q.metrics.list.median} · 均值{' '}
                    {q.metrics.list.mean}
                  </dd>
                  <dt>超 60 字</dt>
                  <dd>
                    {q.metrics.over60_count === 0 ? (
                      <span className="pill ok">0 句</span>
                    ) : (
                      <span className="pill warn">{q.metrics.over60_count} 句</span>
                    )}
                  </dd>
                  <dt>破折号</dt>
                  <dd className="mono">{q.metrics.dash_pairs} 处</dd>
                </div>
              ) : (
                <div className="empty">无指标</div>
              )}
            </section>
          </div>

          {q.metrics && q.metrics.over60_count > 0 && (
            <section className="card section-gap">
              <div className="card-head">
                <h2 className="card-title">长句清单</h2>
                <span className="card-sub">读起来最费劲的几句</span>
              </div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.8, color: 'var(--ink-2)' }}>
                {q.metrics.over60.map((x, i) => (
                  <li key={i}>
                    <span className="mono tiny faint">{x.len} 字</span> · {x.text.slice(0, 80)}
                    {x.text.length > 80 ? '…' : ''}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div className="grid2even section-gap">
            <section className="card">
              <div className="card-head">
                <h2 className="card-title">平台硬约束</h2>
                <span className="card-sub">平台硬上限：标题 32 / 作者 16 / 摘要 120 · 模板口径：标题 22 / 摘要 35</span>
              </div>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr><th>字段</th><th style={{ width: 90 }}>长度</th><th style={{ width: 70 }}>状态</th></tr>
                  </thead>
                  <tbody>
                    {q.limits.map((l) => (
                      <tr key={l.key}>
                        <td className="name">{l.label}</td>
                        <td className="mono small">{l.len} / {l.max}</td>
                        <td>{l.ok ? <span className="pill ok">OK</span> : <span className="pill bad">超限</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="card">
              <div className="card-head">
                <h2 className="card-title">图片</h2>
                <span className="card-sub">{q.images.length} 张</span>
              </div>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr><th>文件</th><th style={{ width: 80 }}>体积</th><th style={{ width: 64 }}>结果</th></tr>
                  </thead>
                  <tbody>
                    {q.images.map((img) => (
                      <tr key={img.ref}>
                        <td className="mono tiny" style={{ wordBreak: 'break-all' }}>{img.ref}</td>
                        <td className="mono tiny">{img.bytes ? `${Math.round(img.bytes / 1024)}KB` : '—'}</td>
                        <td>{img.ok ? <span className="pill ok">OK</span> : <span className="pill bad">问题</span>}</td>
                      </tr>
                    ))}
                    {!q.images.length && <tr><td colSpan={3} className="empty">正文没有图片</td></tr>}
                  </tbody>
                </table>
              </div>
            </section>
          </div>

          <div className="grid2even section-gap">
            <section className="card">
              <div className="card-head">
                <h2 className="card-title">AI 味词表</h2>
                <span className="card-sub">命中才显示</span>
              </div>
              {q.metrics &&
              Object.values(q.metrics.ai_words).some((n) => n > 0) === false &&
              Object.values(q.metrics.adj_words).some((n) => n > 0) === false ? (
                <div className="empty">没有命中：表演性连接词 0 · 营销腔形容词 0</div>
              ) : (
                <div className="chips">
                  {q.metrics &&
                    Object.entries({ ...q.metrics.ai_words, ...q.metrics.adj_words })
                      .filter(([, n]) => n > 0)
                      .map(([w, n]) => (
                        <span key={w} className="pill warn">{w} × {n}</span>
                      ))}
                </div>
              )}
            </section>

            <section className="card">
              <div className="card-head">
                <h2 className="card-title">结构与拦截</h2>
                <span className="card-sub">三级标题 {q.structure.headings} · 段落 {q.structure.paragraphs}</span>
              </div>
              {q.leaks.length ? (
                <div className="hero-note">命中拦截词：{q.leaks.join('、')}</div>
              ) : (
                <div className="empty">无拦截词（8 个 validateClean 词全部干净）</div>
              )}
              {q.reasons.length > 0 && (
                <ul style={{ margin: '12px 0 0', paddingLeft: 18, fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.8 }}>
                  {q.reasons.map((r, i) => <li key={i}>{r}</li>)}
                </ul>
              )}
            </section>
          </div>

          <ExternalScoreCard key={file} file={file} />
        </>
      )}
    </div>
  );
}

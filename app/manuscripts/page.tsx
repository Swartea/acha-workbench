import CurrentFileSelect from '@/components/CurrentFileSelect';
import PublishRegisterForm from '@/components/PublishRegisterForm';
import {
  STEP_GATES,
  STEP_LABELS,
  compareManuscriptIds,
  groupManuscripts,
  scanWorkspace,
  type Manuscript,
  type Topic,
} from '@/lib/workspace';

export const dynamic = 'force-dynamic';

const KIND_LABEL: Record<string, string> = {
  push: '推送版',
  review: '待审',
  preview: '预览',
  draft: '草稿',
};

function NineSteps({ step }: { step: number }) {
  return (
    <div className="steps" style={{ marginBottom: 14 }}>
      {STEP_LABELS.map((name, i) => {
        const n = i + 1;
        const cls = n < step ? 'done' : n === step ? 'current' : '';
        return (
          <div key={name} className={`step ${cls}`} title={STEP_GATES[i]}>
            <div className={`step-bar ${cls}`} />
            <div className="step-name">{name}</div>
          </div>
        );
      })}
    </div>
  );
}

function stepCaption(topic: Topic | undefined, step: number) {
  const published = !!topic?.published;
  if (published && topic?.reviewed) return `已复盘${topic.publishedAt ? ` · ${topic.publishedAt}` : ''}`;
  if (published) return `已发表${topic.publishedAt ? ` · ${topic.publishedAt}` : ''} · 下一步是复盘`;
  return `当前 ${step}/9 ${STEP_LABELS[step - 1]}`;
}

export default function ManuscriptsPage() {
  const s = scanWorkspace();
  const byId = groupManuscripts(s.manuscripts);
  const ids = [...byId.keys()].sort(compareManuscriptIds);

  const groups = ids.map((id) => {
    const files = byId.get(id) ?? [];
    const topic = s.topics.find((t) => t.id === id);
    const first = files[0];
    return {
      id,
      title: topic?.title ?? first?.label ?? id,
      files: files.map((m) => ({ file: m.file, label: `${m.label}${m.isHtml ? '（html）' : ''}` })),
    };
  });

  const a1 = s.topics.find((t) => t.id === 'A1');
  const focus = a1 ?? s.topics.find((t) => t.published) ?? s.topics[0];
  const focusStep = focus?.step ?? 1;

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <div className="eyebrow">稿件 · 九步流水线</div>
          <h1 className="page-title">稿件流水线</h1>
          <p className="page-sub">
            {s.stats.manuscriptCount} 个稿件文件 · 覆盖 {ids.length} 组（含未编号）· 推送版{' '}
            {s.manuscripts.filter((m) => m.kind === 'push').length} 份
          </p>
        </div>
        <span className={`pill ${focus?.published ? 'ok' : 'none'}`}>
          {focus?.published ? `${focus.id} 已发表` : focus ? `${focus.id} · ${STEP_LABELS[focusStep - 1]}` : '尚无选题'}
        </span>
      </header>

      {focus && (
        <section className="card">
          <div className="card-head">
            <h2 className="card-title">
              {focus.id} · 九步状态{' '}
              <span className="idx">
                {focusStep}/9 {STEP_LABELS[focusStep - 1]}
              </span>
            </h2>
            <span className="card-sub">{stepCaption(focus, focusStep)}</span>
          </div>
          {focus.published ? (
            <div className="hero-note ok" style={{ marginBottom: 14 }}>
              已登记发表{focus.publishedFile ? ` · 发出文件：${focus.publishedFile}` : ''}
              {focus.reviewed ? '。复盘已录入。' : '。下一步：到 /review 补 24h / 72h 数据。'}
            </div>
          ) : null}
          <NineSteps step={focusStep} />
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 40 }}>#</th>
                  <th style={{ width: 90 }}>步骤</th>
                  <th>过关门槛（gate）</th>
                  <th style={{ width: 66 }}>状态</th>
                </tr>
              </thead>
              <tbody>
                {STEP_LABELS.map((name, i) => {
                  const n = i + 1;
                  const state = n < focusStep ? 'done' : n === focusStep ? 'current' : 'todo';
                  return (
                    <tr key={name}>
                      <td className="mono tiny muted">{String(n).padStart(2, '0')}</td>
                      <td className="name">{name}</td>
                      <td className="small muted">{STEP_GATES[i]}</td>
                      <td>
                        {state === 'done' && <span className="pill ok">已过</span>}
                        {state === 'current' && <span className="pill warn">当前</span>}
                        {state === 'todo' && <span className="pill none">待办</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div className="section-gap">
        <PublishRegisterForm groups={groups} />
      </div>

      {ids.map((id) => {
        const files: Manuscript[] = byId.get(id) ?? [];
        const topic = s.topics.find((t) => t.id === id);
        const numbered = !id.startsWith('U:');
        const current = s.current[id];
        const step = topic?.step;
        return (
          <section key={id} className="card section-gap">
            <div className="card-head">
              <h2 className="card-title">
                <span className="mono muted" style={{ fontSize: 12 }}>
                  {numbered ? id : '未编号'}
                </span>
                {topic?.title ?? files[0]?.label ?? '—'}
              </h2>
              <span className={`pill ${topic?.published ? 'ok' : topic?.priority === 'P0' ? 'p0' : topic?.priority === 'P1' ? 'p1' : 'none'}`}>
                {topic?.published
                  ? `已发表${topic.reviewed ? ' · 已复盘' : ''}`
                  : numbered
                    ? `${topic?.priority ?? '—'} · ${step ?? '—'}/9 ${step ? STEP_LABELS[step - 1] : '—'}`
                    : '未编号稿件'}
              </span>
            </div>
            <div style={{ marginBottom: 12, maxWidth: 420 }}>
              <CurrentFileSelect
                articleId={id}
                currentFile={current?.file ?? null}
                files={files.map((m) => ({ file: m.file, label: `${m.label}${m.isHtml ? '（html）' : ''}`, date: m.date }))}
              />
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: 80 }}>版本</th>
                    <th>文件</th>
                    <th style={{ width: 96 }}>日期</th>
                    <th style={{ width: 72 }}>指针</th>
                  </tr>
                </thead>
                <tbody>
                  {files.map((m) => (
                    <tr key={m.file}>
                      <td>
                        <span className={`pill ${m.kind === 'push' ? 'ok' : m.kind === 'review' ? 'warn' : 'none'}`}>
                          {KIND_LABEL[m.kind]}
                        </span>
                      </td>
                      <td className="mono small" style={{ wordBreak: 'break-all' }}>
                        稿件/{m.file}
                      </td>
                      <td className="mono tiny muted" style={{ whiteSpace: 'nowrap' }}>
                        {m.date ?? '—'}
                      </td>
                      <td>
                        {current?.file === m.file ? (
                          <span className="pill ok">{current.pinned ? '已钉' : '默认'}</span>
                        ) : (
                          <span className="tiny faint">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}

      {!ids.length && (
        <div className="card">
          <div className="empty">稿件目录里还没有可展示的正文文件。</div>
        </div>
      )}
    </div>
  );
}

import Link from 'next/link';
import { STEP_LABELS, scanWorkspace } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

const FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'p0', label: 'P0' },
  { key: 'pkg', label: '已备包' },
  { key: 'nopkg', label: '待写包' },
];

function MiniSteps({ step }: { step: number }) {
  return (
    <span className="mini-steps" title={`${step}/9 · ${STEP_LABELS[step - 1]}`}>
      {Array.from({ length: 9 }).map((_, i) => {
        const n = i + 1;
        const cls = n < step ? 'on' : n === step ? 'cur' : '';
        return <i key={i} className={cls} />;
      })}
    </span>
  );
}

export default async function TopicsPage({
  searchParams,
}: {
  searchParams: Promise<{ f?: string }>;
}) {
  const sp = await searchParams;
  const f = sp.f ?? 'all';
  const s = scanWorkspace();

  let topics = s.topics;
  if (f === 'p0') topics = topics.filter((t) => t.priority === 'P0');
  if (f === 'pkg') topics = topics.filter((t) => t.hasPackage);
  if (f === 'nopkg') topics = topics.filter((t) => !t.hasPackage);

  const pkgCount = s.topics.filter((t) => t.hasPackage).length;

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <div className="eyebrow">选题 · 雷达 → 三问 → 排期</div>
          <h1 className="page-title">选题雷达台</h1>
          <p className="page-sub">
            共 {s.stats.topicCount} 条正式选题（P0 {s.stats.p0}）· 已备包 {pkgCount} · 待写包{' '}
            {s.stats.topicCount - pkgCount} · 雷达日志 {s.stats.radarCount} 份
          </p>
        </div>
        <span className="pill none">数据源：选题库 v22</span>
      </header>

      <div className="tabs">
        {FILTERS.map((x) => (
          <Link key={x.key} href={x.key === 'all' ? '/topics' : `/topics?f=${x.key}`} className={`tab${f === x.key ? ' on' : ''}`}>
            {x.label}
          </Link>
        ))}
      </div>

      <section className="card">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 54 }}>编号</th>
                <th>选题</th>
                <th style={{ width: 66 }}>优先级</th>
                <th style={{ width: 200 }}>进度</th>
                <th style={{ width: 96 }}>写作包</th>
                <th style={{ width: 60 }}>稿件</th>
              </tr>
            </thead>
            <tbody>
              {topics.map((t) => {
                const drafts = s.manuscripts.filter((m) => m.id === t.id);
                const step = t.step;
                return (
                  <tr key={t.id}>
                    <td className="id">{t.id}</td>
                    <td className="name">
                      {t.title}
                      {t.stars > 0 && <span className="tiny faint" style={{ marginLeft: 6 }}>{'★'.repeat(Math.min(t.stars, 3))}</span>}
                    </td>
                    <td>
                      <span className={`pill ${t.priority === 'P0' ? 'p0' : t.priority === 'P1' ? 'p1' : t.priority === 'P2' ? 'p2' : 'none'}`}>
                        {t.priority}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' }}>
                        <MiniSteps step={step} />
                        <span className="tiny muted">{step}/9 {STEP_LABELS[step - 1]}</span>
                      </div>
                    </td>
                    <td className="mono tiny muted">{t.packageDate ?? '—'}</td>
                    <td className="tiny muted">{drafts.length ? `${drafts.length} 份` : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!topics.length && <div className="empty">该筛选下没有选题。</div>}
      </section>

      <p className="tiny faint" style={{ marginTop: 12 }}>
        九步：{STEP_LABELS.join(' → ')}。进度按文件产物推导（写作包 / 配图目录 / 稿件 / 推送版），
        发布与复盘状态由工作台记录。
      </p>
    </div>
  );
}

import PasscodeGate from '@/components/PasscodeGate';
import ReviewForm from '@/components/ReviewForm';
import ReviewTable from '@/components/ReviewTable';
import { listReviews } from '@/lib/db';
import { scanWorkspace } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

export default function ReviewPage() {
  const s = scanWorkspace();
  const rows = listReviews();
  const totalReads = rows.reduce((n, r) => n + r.reads, 0);
  const totalCompletes = rows.reduce((n, r) => n + r.completes, 0);
  const rate = totalReads ? Math.round((totalCompletes / totalReads) * 100) : 0;

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <div className="eyebrow">复盘 · 数据回流</div>
          <h1 className="page-title">复盘与周报</h1>
          <p className="page-sub">
            每篇留下「3 个数字 + 1 条选题调整」，喂回选题库。数据 API 权限开通后可半自动拉取。
          </p>
        </div>
        <span className="pill none">{rows.length} 条记录</span>
      </header>

      <PasscodeGate />

      <div className="stats">
        <div className="stat">
          <div className="stat-num">{rows.length}</div>
          <div className="stat-label">复盘条目</div>
          <div className="stat-sub">按发布日排序</div>
        </div>
        <div className="stat">
          <div className="stat-num">{totalReads}</div>
          <div className="stat-label">累计阅读</div>
          <div className="stat-sub">手工录入</div>
        </div>
        <div className="stat">
          <div className="stat-num">{totalReads ? `${rate}%` : '—'}</div>
          <div className="stat-label">平均完读率</div>
          <div className="stat-sub">完读 / 阅读</div>
        </div>
        <div className="stat">
          <div className="stat-num">{s.weekly.length}</div>
          <div className="stat-label">周报归档</div>
          <div className="stat-sub">{s.weekly[0] ?? '—'}</div>
        </div>
        <div className="stat">
          <div className="stat-num">{s.stats.radarCount}</div>
          <div className="stat-label">雷达日志</div>
          <div className="stat-sub">选题输入</div>
        </div>
      </div>

      <div className="section-gap">
        <ReviewForm topics={s.topics.map((t) => ({ id: t.id, title: t.title }))} />
      </div>

      <section className="card section-gap">
        <div className="card-head">
          <h2 className="card-title">复盘记录</h2>
          <span className="card-sub">24h / 72h 各一条，备注写结论</span>
        </div>
        <ReviewTable rows={rows} />
      </section>

      <section className="card section-gap">
        <div className="card-head">
          <h2 className="card-title">周报归档</h2>
          <span className="card-sub">markdown 仍在内容库</span>
        </div>
        {s.weekly.length ? (
          <div className="table-wrap">
            <table className="table">
              <tbody>
                {s.weekly.map((w) => (
                  <tr key={w}>
                    <td className="mono small" style={{ width: 110 }}>{w}</td>
                    <td className="small muted">01-内容库/周报 - 阿茶AI实验室 - {w}.md</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty">还没有周报。</div>
        )}
        <p className="tiny faint" style={{ marginTop: 10 }}>
          数据 API 开通后（图文分析 / 用户分析权限），这里会多一个「自动拉数」按钮；现在先手工填，
          字段已经对齐官方指标口径。
        </p>
      </section>
    </div>
  );
}

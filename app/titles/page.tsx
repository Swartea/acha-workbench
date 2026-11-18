import fs from 'node:fs';
import path from 'node:path';
import PasscodeGate from '@/components/PasscodeGate';
import TitlesBoard from '@/components/TitlesBoard';
import { getChosenTitle, getLatestReviewByArticle, listTitles } from '@/lib/db';
import { MANUSCRIPT_DIR } from '@/lib/paths';
import { COVER_LOCK, auditTitle, countChars } from '@/lib/titles';
import { scanWorkspace } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

function Triple({
  label,
  value,
  compare,
}: {
  label: string;
  value: string;
  compare?: string;
}) {
  const same = !compare || compare === value;
  return (
    <tr>
      <td className="name" style={{ width: 70 }}>{label}</td>
      <td className="small">{value || '—'}</td>
      <td style={{ width: 96 }}>
        {compare ? (
          <span className={`pill ${same ? 'ok' : 'warn'}`}>{same ? '同步' : '待同步'}</span>
        ) : (
          <span className="tiny faint">—</span>
        )}
      </td>
    </tr>
  );
}

export default function TitlesPage() {
  const s = scanWorkspace();
  const rows = listTitles('A1');
  const chosen = getChosenTitle('A1');
  const review = getLatestReviewByArticle('A1');
  const current = s.current['A1'];
  const pushFile = current?.path ?? null;
  const base = current?.file ?? null;
  const raw = pushFile ? fs.readFileSync(pushFile, 'utf8') : '';

  const get = (key: string) => {
    const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!m) return '';
    const r = m[1].match(new RegExp(`^${key}:\\s*(.*)$`, 'm'));
    return r ? r[1].trim() : '';
  };
  const curTitle = get('title');
  const curDigest = get('digest');
  const curCover = get('cover');

  const best = rows.reduce((m, r) => (r.status !== 'killed' && r.score > m ? r.score : m), 0);
  const killed = rows.filter((r) => r.status === 'killed').length;
  const titleAudit = auditTitle(curTitle, curDigest);

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <div className="eyebrow">标题 · 决策</div>
          <h1 className="page-title">标题决策台</h1>
          <p className="page-sub">
            候选入库 → 五维打分 → 卡字数与合规 → 选定后驱动摘要与封面。选定只记录，推草稿仍由你发令。
          </p>
        </div>
        <span className={`pill ${COVER_LOCK.locked ? 'warn' : 'ok'}`}>
          {COVER_LOCK.locked ? '封面锁标题' : '封面与标题解耦'}
        </span>
      </header>

      <PasscodeGate />

      <div className="stats">
        <div className="stat">
          <div className="stat-num">{rows.length}</div>
          <div className="stat-label">候选条目</div>
          <div className="stat-sub">含 3 条反面教材</div>
        </div>
        <div className="stat">
          <div className="stat-num">{chosen ? '1' : '0'}</div>
          <div className="stat-label">已选定</div>
          <div className="stat-sub">{chosen ? chosen.text : '还没拍板'}</div>
        </div>
        <div className="stat">
          <div className="stat-num">{best || '—'}</div>
          <div className="stat-label">最高总分</div>
          <div className="stat-sub">五维各 1–5，满分 25</div>
        </div>
        <div className="stat">
          <div className="stat-num">{killed}</div>
          <div className="stat-label">判死</div>
          <div className="stat-sub">超平台硬上限 32 字，接口拒收（模板口径 22）</div>
        </div>
        <div className="stat">
          <div className="stat-num">{curTitle ? countChars(curTitle) : '—'}</div>
          <div className="stat-label">现标题字数</div>
          <div className="stat-sub">{curTitle || '读不到稿件'}</div>
        </div>
      </div>

      <div className="grid2even section-gap">
        <section className="card">
          <div className="card-head">
            <h2 className="card-title">稿件当前生效值</h2>
            <span className="card-sub mono tiny">{base ?? '无推送稿'}</span>
          </div>
          <div className="table-wrap">
            <table className="table">
              <tbody>
                <Triple label="标题" value={curTitle} compare={chosen?.text} />
                <Triple label="摘要" value={curDigest} compare={chosen?.digest} />
                <Triple label="封面" value={curCover} />
              </tbody>
            </table>
          </div>
          <div className="chips" style={{ marginTop: 10 }}>
            {titleAudit.flags.length ? (
              titleAudit.flags.map((f, i) => (
                <span
                  key={i}
                  className={`pill ${f.level === 'bad' ? 'bad' : f.level === 'warn' ? 'warn' : 'none'}`}
                >
                  {f.label}
                </span>
              ))
            ) : (
              <span className="tiny faint">现标题没有触发任何规则</span>
            )}
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <h2 className="card-title">封面硬依赖</h2>
            <span className="card-sub">{COVER_LOCK.locked ? '换标题 = 必须重绘' : '已解耦'}</span>
          </div>
          <p className="small muted" style={{ marginTop: 0, lineHeight: 1.7 }}>
            {COVER_LOCK.note}
          </p>
          <div className="kv">
            <dt>封面源</dt>
            <dd className="mono tiny">{COVER_LOCK.file}</dd>
            <dt>出图</dt>
            <dd className="mono tiny">{COVER_LOCK.image}</dd>
            <dt>建议</dt>
            <dd className="small">做「标题无关封面」，标题才能长期做实验</dd>
          </div>
          <p className="tiny faint" style={{ marginTop: 10 }}>
            口径来源：01-内容库/研究/标题策略研究 - 阿茶AI实验室 - 2026-10-26.md
            （平台规则 2026-10-23 核实）
          </p>
        </section>
      </div>

      <div className="section-gap">
        {chosen ? (
          <section className="card">
            <div className="card-head">
              <h2 className="card-title">效果回看</h2>
              <span className="card-sub">
                {review
                  ? `最近复盘 ${review.created_at.slice(0, 10)} · 发表后 24h/72h 各记一笔`
                  : '发表后在 /review 录入 24h 数据，这里自动回看'}
              </span>
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>选定标题（公式）</th>
                    <th style={{ width: 56 }}>票数</th>
                    <th style={{ width: 56 }}>阅读</th>
                    <th style={{ width: 56 }}>完读</th>
                    <th style={{ width: 56 }}>在看</th>
                    <th style={{ width: 56 }}>转发</th>
                    <th style={{ width: 56 }}>涨粉</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>
                      <div className="name">{chosen.text}</div>
                      <div className="tiny faint">
                        {chosen.formula || '未分类'} · 总分 {chosen.score}
                      </div>
                    </td>
                    <td className="mono small">{chosen.votes || 0}</td>
                    {review ? (
                      <>
                        <td className="mono small">{review.reads}</td>
                        <td className="mono small">{review.completes}</td>
                        <td className="mono small">{review.wow}</td>
                        <td className="mono small">{review.shares}</td>
                        <td className="mono small">{review.follows}</td>
                      </>
                    ) : (
                      <td colSpan={5} className="tiny faint">
                        暂无复盘数据（A1 还没发表）
                      </td>
                    )}
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        ) : (
          <section className="card">
            <div className="card-head">
              <h2 className="card-title">效果回看</h2>
              <span className="card-sub">选定标题后生效</span>
            </div>
            <p className="small muted" style={{ margin: 0 }}>
              还没拍板。流程：候选入库 → 群里收投票 → 五维打分 → 选定 → 写入稿件 → 发表 → /review 录数 → 这里回看。
            </p>
          </section>
        )}
      </div>

      <div className="section-gap">
        <TitlesBoard
          rows={rows}
          pushFile={base}
          pushAbs={pushFile}
          current={{ title: curTitle, digest: curDigest, cover: curCover }}
        />
      </div>
    </div>
  );
}

import fs from 'node:fs';
import path from 'node:path';
import Link from 'next/link';
import PasscodeGate from '@/components/PasscodeGate';
import VerifyLedger, { type LedgerRow } from '@/components/VerifyLedger';
import { listClaimChecks } from '@/lib/db';
import { LIB } from '@/lib/paths';
import {
  KIND_LABEL,
  claimState,
  findPackageFile,
  parseManuscriptFacts,
  parsePackageClaims,
  summarize,
  todayStr,
} from '@/lib/verify';
import { scanWorkspace } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

/** 去掉 Markdown 装饰，只留人读的字（表格里不需要 ** 和反引号）。 */
function plain(s: string): string {
  return s.replace(/\*\*/g, '').replace(/`/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').trim();
}

export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ a?: string; f?: string }>;
}) {
  const sp = await searchParams;
  const s = scanWorkspace();
  const today = todayStr();

  // 可选选题：有写作包的、有稿件的，合起来
  const pkgIds = new Set<string>();
  if (fs.existsSync(LIB)) {
    for (const f of fs.readdirSync(LIB)) {
      const m = f.match(/^写作包\s*-\s*(A\d{1,3})(?!\d)/);
      if (m) pkgIds.add(m[1]);
    }
  }
  const msIds = new Set(s.manuscripts.filter((m) => !m.isHtml).map((m) => m.id));
  const ids = Array.from(new Set([...msIds, ...pkgIds])).sort((x, y) => Number(x.slice(1)) - Number(y.slice(1)));
  const wanted = sp.a && ids.includes(sp.a) ? sp.a : ids[0] ?? '';

  const files = s.manuscripts.filter((m) => m.id === wanted && !m.isHtml);
  const picked =
    (sp.f ? files.find((m) => m.file === sp.f) : undefined) ??
    files.filter((m) => m.kind === 'push').sort((x, y) => (y.date ?? '').localeCompare(x.date ?? ''))[0] ??
    files[0];
  // 稿件统一用 LIB/稿件 + 文件名，别依赖 scanWorkspace 返回的路径形态
  const msFile = picked ? path.join(LIB, '稿件', path.basename(picked.file)) : '';
  const msText = msFile && fs.existsSync(msFile) ? fs.readFileSync(msFile, 'utf8') : '';

  const pkgFile = wanted ? findPackageFile(wanted, LIB) : null;
  const pkgText = pkgFile ? fs.readFileSync(pkgFile, 'utf8') : '';
  const claims = wanted ? parsePackageClaims(wanted, pkgText) : [];
  const checks = new Map(listClaimChecks(wanted).map((c) => [c.claim_key, c]));
  const states = claims.map((c) => claimState(c, checks.get(c.key), today));
  const facts = parseManuscriptFacts(msText, claims);
  const sum = summarize(states, facts);

  const rows: LedgerRow[] = claims.map((c, i) => ({
    key: c.key,
    no: c.no,
    text: plain(c.text),
    source: plain(c.source),
    note: plain(c.note),
    kindLabel: KIND_LABEL[c.kind],
    status: states[i].status,
    ageDays: states[i].ageDays,
    checkedAt: states[i].checkedAt,
    trust: states[i].trust,
    humanChecked: states[i].humanChecked,
    section: c.section,
    line: c.line,
  }));

  const uncovered = facts.filter((f) => !f.covered);
  const selfUnverified = facts.filter((f) => f.selfUnverified);
  const verdict = sum.unchecked > 0 ? 'bad' : sum.stale > 0 ? 'warn' : 'ok';
  const verdictText =
    sum.unchecked > 0
      ? `${sum.unchecked} 条未核`
      : sum.stale > 0
        ? `${sum.stale} 条过期`
        : claims.length
          ? '台账都在新鲜期'
          : '无写作包';

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <div className="eyebrow">核实 · 确定性台账</div>
          <h1 className="page-title">事实核实台</h1>
          <p className="page-sub">
            写作包里的每条素材带来源和核对日期；稿件里出现、台账没有的数字单独列出来。
            价格类按纪律发前 5 分钟还要再查一次，这里的「新鲜」只代表相对时间。
          </p>
        </div>
        <span className={`pill ${verdict}`}>{verdictText}</span>
      </header>

      <PasscodeGate />

      <div className="tabs">
        {ids.map((id) => (
          <Link key={id} href={`/verify?a=${id}`} className={`tab${id === wanted ? ' on' : ''}`}>
            {id}
          </Link>
        ))}
        {!ids.length && <span className="tiny faint">内容库里还没有稿件或写作包。</span>}
      </div>

      {wanted && (
        <div className="stats">
          <div className="stat">
            <div className="stat-num">{sum.total}</div>
            <div className="stat-label">台账素材</div>
            <div className="stat-sub">{pkgFile ? plain(path.basename(pkgFile)) : '无写作包'}</div>
          </div>
          <div className="stat">
            <div className="stat-num">{sum.fresh}</div>
            <div className="stat-label">新鲜</div>
            <div className="stat-sub">在各自的新鲜期内</div>
          </div>
          <div className="stat">
            <div className="stat-num">{sum.stale}</div>
            <div className="stat-label">过期</div>
            <div className="stat-sub">发前要重查</div>
          </div>
          <div className="stat">
            <div className="stat-num">{sum.unchecked}</div>
            <div className="stat-label">未核</div>
            <div className="stat-sub">包内已标未核实或没日期</div>
          </div>
          <div className="stat">
            <div className="stat-num">{sum.uncovered}</div>
            <div className="stat-label">稿件里的裸数字</div>
            <div className="stat-sub">台账对不上，需人工确认</div>
          </div>
        </div>
      )}

      {wanted && !picked && (
        <div className="card">
          <div className="empty">这个选题还没有稿件文件，台账只能看到写作包一侧。</div>
        </div>
      )}

      <section className="card section-gap">
        <div className="card-head">
          <h2 className="card-title">
            素材台账 <span className="idx">{rows.length} 条</span>
          </h2>
          <span className="card-sub">
            {picked ? plain(picked.file) : '未选稿件'} · 核对记录存本机 SQLite
          </span>
        </div>
        <VerifyLedger articleId={wanted} rows={rows} />
      </section>

      {picked && (
        <section className="card section-gap">
          <div className="card-head">
            <h2 className="card-title">
              稿件里出现、台账没有的数字 <span className="idx">{uncovered.length} 个</span>
            </h2>
            <span className="card-sub">这些数字没有写作包来源，要么补进核实表，要么从正文删掉</span>
          </div>
          {uncovered.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: 130 }}>值</th>
                    <th style={{ width: 60 }}>类型</th>
                    <th style={{ width: 56 }}>行</th>
                    <th>上下文</th>
                  </tr>
                </thead>
                <tbody>
                  {uncovered.map((f) => (
                    <tr key={f.kind + ':' + f.norm + ':' + f.line}>
                      <td className="mono small">{f.value}</td>
                      <td className="tiny muted">{KIND_LABEL[f.kind]}</td>
                      <td className="mono tiny faint">L{f.line}</td>
                      <td className="tiny muted" style={{ overflowWrap: 'anywhere' }}>{f.context}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty">稿件里的数字都能在台账里找到对应素材。</div>
          )}
        </section>
      )}

      {selfUnverified.length > 0 && (
        <section className="card section-gap">
          <div className="card-head">
            <h2 className="card-title">正文自己标了「未核实」的段</h2>
            <span className="card-sub">这些只能当边界说明，不能写成事实；共 {selfUnverified.length} 处</span>
          </div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.8, color: 'var(--ink-2)' }}>
            {selfUnverified.map((f) => (
              <li key={f.kind + ':' + f.norm + ':' + f.line}>
                <span className="mono tiny faint">L{f.line}</span> · {f.context}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

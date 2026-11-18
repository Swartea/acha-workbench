import fs from 'node:fs';
import path from 'node:path';
import Checklist from '@/components/Checklist';
import PasscodeGate from '@/components/PasscodeGate';
import PublishConsole from '@/components/PublishConsole';
import PublishRegisterForm from '@/components/PublishRegisterForm';
import { getChecklist, getRecentPublishRuns, listClaimChecks } from '@/lib/db';
import { LIB, MANUSCRIPT_DIR } from '@/lib/paths';
import { envStatus } from '@/lib/publish';
import { claimState, findPackageFile, parseManuscriptFacts, parsePackageClaims, summarize, todayStr } from '@/lib/verify';
import { groupManuscripts, scanWorkspace } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

const KIND_LABEL: Record<string, string> = {
  push: '推送版',
  review: '待审',
  preview: '预览',
  draft: '草稿',
};

export default function PublishPage() {
  const s = scanWorkspace();
  const checklist = getChecklist();
  const env = envStatus();
  const runs = getRecentPublishRuns(60);
  const preflightCutoff = Date.now() - 24 * 3600_000;
  const doneByFile: Record<string, Record<string, boolean>> = {};
  for (const r of runs) {
    if (!r.file || !r.ok) continue;
    if (!['dryrun', 'preflight', 'preview', 'push'].includes(r.step)) continue;
    // 推草稿硬门只认 24h 内的预检；界面不能拿更早的 ✓ 骗自己。
    if (r.step === 'preflight' && new Date(r.created_at).getTime() < preflightCutoff) continue;
    doneByFile[r.file] = { ...(doneByFile[r.file] ?? {}), [r.step]: true };
  }

  const envOk = env.exists && env.ok && env.mode === '600';
  const checklistOk = checklist.every((c) => c.done);

  const envReason = !env.exists
    ? '.env 不存在'
    : env.mode !== '600'
      ? `.env 权限 ${env.mode}，需 600`
      : !env.hasId
        ? '缺 WECHAT_APP_ID'
        : !env.hasSecret
          ? '缺 WECHAT_APP_SECRET'
          : '';

  // 只把可推送的 .md 放进下拉：HTML 预览、旧草稿/待审混进来只会白跑一步。
  const ordered = [
    ...s.manuscripts.filter((m) => !m.isHtml && m.kind === 'push'),
    ...s.manuscripts.filter((m) => !m.isHtml && m.kind !== 'push'),
  ];
  const options = ordered.map((m) => ({
    path: path.join(MANUSCRIPT_DIR, m.file),
    label: `${m.id} · ${m.label}（${KIND_LABEL[m.kind]}）`,
    date: m.date,
  }));
  const pointer = s.current['A1']?.path ?? s.topics.find((t) => t.currentFile)?.currentFile?.path;
  const initialMd = pointer ?? options[0]?.path ?? '';

  // 发表登记：推完草稿、在后台点完发表，回到本页登记，看板与步数同步进入「发布/复盘」。
  const byId = groupManuscripts(s.manuscripts);
  const registerGroups = [...byId.keys()].sort().map((id) => {
    const files = byId.get(id) ?? [];
    const topic = s.topics.find((t) => t.id === id);
    return {
      id,
      title: topic?.title ?? files[0]?.label ?? id,
      files: files.map((m) => ({ file: m.file, label: m.label })),
    };
  });

  // 核实概况：只提示、不拦发布。推草稿前至少一眼看到哪篇的数字没台账。
  const today = todayStr();
  const verifyRows = s.manuscripts
    .filter((m) => !m.isHtml && m.kind === 'push')
    .map((m) => {
      const pkg = findPackageFile(m.id, LIB);
      const claims = pkg ? parsePackageClaims(m.id, fs.readFileSync(pkg, 'utf8')) : [];
      const checks = new Map(listClaimChecks(m.id).map((c) => [c.claim_key, c]));
      const states = claims.map((c) => claimState(c, checks.get(c.key), today));
      const msFile = path.join(MANUSCRIPT_DIR, m.file);
      const msText = fs.existsSync(msFile) ? fs.readFileSync(msFile, 'utf8') : '';
      const facts = parseManuscriptFacts(msText, claims);
      return { m, hasPackage: !!pkg, sum: summarize(states, facts) };
    })
    .filter((r) => r.sum.unchecked > 0 || r.sum.stale > 0 || r.sum.uncovered > 0)
    .slice(0, 6);

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <div className="eyebrow">发布 · 只进草稿箱</div>
          <h1 className="page-title">发布台</h1>
          <p className="page-sub">干跑 → 机械预检 → 手机宽预览 → draft/add。发表永远由你手动点。</p>
        </div>
        <span className={`pill ${envOk && checklistOk ? 'ok' : 'warn'}`}>
          {envOk && checklistOk ? '链路就绪' : '前置未全绿'}
        </span>
      </header>

      <PasscodeGate />

      {options.length ? (
        <PublishConsole
          manuscripts={options}
          initialMd={initialMd}
          envOk={envOk}
          envReason={envReason}
          checklistOk={checklistOk}
          lastRuns={runs.slice(0, 8).map((r) => ({ id: r.id, step: r.step, ok: r.ok, created_at: r.created_at }))}
          doneByFile={doneByFile}
        />
      ) : (
        <div className="card"><div className="empty">稿件目录里没有可推送的稿件。</div></div>
      )}

      <div className="section-gap">
        <PublishRegisterForm groups={registerGroups} />
      </div>

      <section className="card section-gap">
        <div className="card-head">
          <h2 className="card-title">核实概况 <span className="idx">推草稿前</span></h2>
          <span className="card-sub">只提示、不拦发布 · 数字来自写作包核实表与稿件对撞</span>
        </div>
        {verifyRows.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>推送版</th>
                  <th style={{ width: 80 }}>台账</th>
                  <th style={{ width: 80 }}>过期</th>
                  <th style={{ width: 80 }}>未核</th>
                  <th style={{ width: 100 }}>裸数字</th>
                  <th style={{ width: 90 }} />
                </tr>
              </thead>
              <tbody>
                {verifyRows.map((r) => (
                  <tr key={r.m.file}>
                    <td className="name small">{r.m.id} · {r.m.label}</td>
                    <td className="mono small">{r.hasPackage ? r.sum.total : '无包'}</td>
                    <td>{r.sum.stale ? <span className="pill warn">{r.sum.stale}</span> : <span className="tiny faint">0</span>}</td>
                    <td>{r.sum.unchecked ? <span className="pill bad">{r.sum.unchecked}</span> : <span className="tiny faint">0</span>}</td>
                    <td>{r.sum.uncovered ? <span className="pill warn">{r.sum.uncovered}</span> : <span className="tiny faint">0</span>}</td>
                    <td><a className="tiny" href={'/verify?a=' + r.m.id} style={{ textDecoration: 'underline' }}>去核实 →</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty">推送版里的数字都能在台账里对上，没有要重查的。</div>
        )}
      </section>

      <div className="grid2even section-gap">
        <section className="card">
          <div className="card-head">
            <h2 className="card-title">账号三前置 <span className="idx">{checklist.filter((c) => c.done).length}/3</span></h2>
            <a className="card-sub" href="https://mp.weixin.qq.com/" target="_blank" rel="noreferrer">公众号后台 ↗</a>
          </div>
          <Checklist items={checklist} />
        </section>

        <section className="card">
          <div className="card-head">
            <h2 className="card-title">.env 状态</h2>
            <span className={`pill ${envOk ? 'ok' : env.exists ? 'warn' : 'bad'}`}>
              {envOk ? '就绪' : env.exists ? '待补' : '不存在'}
            </span>
          </div>
          <dl className="kv">
            <dt>文件</dt><dd className="mono small">02-发布工具/wechat-draft/.env</dd>
            <dt>存在</dt><dd>{env.exists ? '是' : '否'}</dd>
            <dt>权限</dt><dd className="mono">{env.mode || '—'}{env.mode === '600' ? ' ✓' : env.exists ? '（需 600）' : ''}</dd>
            <dt>APP_ID</dt><dd>{env.hasId ? '已填' : '未填'}</dd>
            <dt>APP_SECRET</dt><dd>{env.hasSecret ? '已填' : '未填'}</dd>
          </dl>
          {!envOk && (
            <div className="hero-note" style={{ marginTop: 12 }}>
              {env.exists
                ? `还差：${envReason}。填好后 chmod 600，回到本页即可推草稿。`
                : '首次使用：cp .env.example .env → 填 AppID/AppSecret → chmod 600。去设置页有完整命令。'}
            </div>
          )}
        </section>
      </div>

    </div>
  );
}

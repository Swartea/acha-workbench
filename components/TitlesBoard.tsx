'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { LIMITS, LIMIT_LABEL } from '@/lib/limits.mjs';
import {
  DIMS,
  FORMULAS,
  STATUS_LABEL,
  auditTitle,
  countChars,
  type TitleRow,
  type TitleStatus,
} from '@/lib/titles';

const BAND: Record<string, { cls: string; label: string }> = {
  ok: { cls: 'ok', label: `≤${LIMITS.template.title}` },
  fold: { cls: 'warn', label: `${LIMITS.template.title + 1}–${LIMITS.platform.title}` },
  reject: { cls: 'bad', label: `>${LIMITS.platform.title}` },
};

function Copy({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn sm"
      onClick={() => {
        navigator.clipboard?.writeText(text).catch(() => {});
        setDone(true);
        setTimeout(() => setDone(false), 1200);
      }}
    >
      {done ? '已复制' : '复制'}
    </button>
  );
}

const EMPTY = {
  text: '',
  formula: '',
  hook: '',
  digest: '',
  info: 3,
  curiosity: 3,
  trust: 3,
  search: 3,
  safe: 5,
  note: '',
};

export default function TitlesBoard({
  rows,
  pushFile,
  pushAbs,
  current,
}: {
  rows: TitleRow[];
  pushFile: string | null;
  pushAbs: string | null;
  current: { title: string; digest: string; cover: string };
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [pushing, setPushing] = useState(false);
  const [pushMsg, setPushMsg] = useState('');
  const [pushErr, setPushErr] = useState('');
  const [editId, setEditId] = useState<number | null>(null);
  const [showLib, setShowLib] = useState(false);
  const [form, setForm] = useState({ ...EMPTY });

  const chosen = rows.find((r) => r.status === 'chosen') ?? null;
  const audit = auditTitle(form.text, form.digest);

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function reset() {
    setForm({ ...EMPTY });
    setEditId(null);
  }

  function loadEdit(r: TitleRow) {
    setEditId(r.id);
    setForm({
      text: r.text,
      formula: r.formula,
      hook: r.hook,
      digest: r.digest,
      info: r.info,
      curiosity: r.curiosity,
      trust: r.trust,
      search: r.search,
      safe: r.safe,
      note: r.note,
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function post(payload: Record<string, unknown>) {
    const res = await fetch('/api/titles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || '操作失败');
    return data as { ok: true; output?: string };
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.text.trim()) {
      setError('标题不能为空');
      return;
    }
    setBusy(true);
    setError('');
    setMsg('');
    try {
      if (editId) {
        await post({ action: 'update', id: editId, ...form });
        setMsg('已保存修改');
      } else {
        await post({ action: 'add', article_id: 'A1', ...form });
        setMsg('候选已入库');
      }
      reset();
      router.refresh();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  }

  async function act(payload: Record<string, unknown>, okMsg?: string) {
    setBusy(true);
    setError('');
    setMsg('');
    try {
      const data = await post(payload);
      if (okMsg) setMsg(data.output ? `${okMsg} · ${data.output}` : okMsg);
      router.refresh();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  }

  async function apply(r: TitleRow) {
    if (!window.confirm(`把标题「${r.text}」写进稿件 frontmatter 与正文 H1？\n写入前会自动备份原文件。`)) {
      return;
    }
    await act({ action: 'apply', id: r.id, file: pushFile }, '已写入稿件');
  }

  const pushCmd = pushAbs
    ? `cd "$HOME/Desktop/阿茶AI实验室/02-发布工具/wechat-draft" && rm -f ~/.config/wenyan-md/token.json && node draft.mjs -f "${pushAbs}" --body-only --author "阿茶 AI 实验室"`
    : '';

  const synced = !!chosen && chosen.text === current.title;

  async function pushDraft() {
    if (!pushAbs) {
      setPushErr('没有可推送的稿件文件');
      return;
    }
    const ok = window.confirm(
      `推送到草稿箱？\n\n稿件：${pushFile}\n标题：${chosen?.text ?? ''}\n\n` +
        '会新增一篇草稿（旧草稿需手动删除）；发表仍由你在后台手点。',
    );
    if (!ok) return;
    setPushing(true);
    setPushErr('');
    setPushMsg('');
    try {
      const res = await fetch('/api/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step: 'push', md: pushAbs }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || data.output || '推送失败');
      const media = String(data.output ?? '').match(/Media ID:\s*(\S+)/)?.[1];
      setPushMsg(media ? `已进草稿箱 · Media ID ${media.slice(0, 10)}…` : '已进草稿箱');
      router.refresh();
    } catch (err) {
      setPushErr(String(err instanceof Error ? err.message : err));
    } finally {
      setPushing(false);
    }
  }

  return (
    <>
      {chosen && (
        <section className="card section-gap">
          <div className="card-head">
            <h2 className="card-title">选定后的动作</h2>
            <span className="card-sub">
              {synced ? '标题已同步 · 可直接推草稿' : '先写入稿件，再推草稿'}
            </span>
          </div>
          <div className="table-wrap">
            <table className="table">
              <tbody>
                <tr>
                  <td style={{ width: 30 }} className="mono small">1</td>
                  <td className="small">
                    写入稿件：frontmatter title + digest + 正文首个 H1
                    <div className="tiny faint">
                      摘要同步为：{chosen.digest || '（未配摘要，沿用现摘要）'}
                    </div>
                  </td>
                  <td style={{ width: 92 }}>
                    {synced ? (
                      <span className="pill ok">已同步</span>
                    ) : (
                      <button className="btn sm" disabled={busy} onClick={() => apply(chosen)}>
                        写入
                      </button>
                    )}
                  </td>
                </tr>
                <tr>
                  <td className="mono small">2</td>
                  <td className="small">
                    重绘封面（标题烤在图里，需手工重画）
                    <div className="mono tiny faint">03-生产工具/figures/a1-v3/cover.html</div>
                  </td>
                  <td>
                    <Copy text="$HOME/Desktop/阿茶AI实验室/03-生产工具/figures/a1-v3/cover.html" />
                  </td>
                </tr>
                <tr>
                  <td className="mono small">3</td>
                  <td className="small">
                    推草稿箱（走账号守卫 + 自动留档）
                    <div className="tiny faint">
                      {synced ? '三前置不全绿会被拦下；会新增一篇草稿，旧草稿需手动删' : '标题还没写入稿件，已锁'}
                    </div>
                  </td>
                  <td>
                    <button
                      className="btn sm"
                      disabled={!synced || pushing || busy}
                      onClick={pushDraft}
                    >
                      {pushing ? '推送中…' : '推草稿'}
                    </button>
                  </td>
                </tr>
                <tr>
                  <td className="mono small">4</td>
                  <td className="small">
                    手机预览后手动发表
                    <div className="tiny faint">发表动作归你本人（运营规范 3.27.2）</div>
                  </td>
                  <td>
                    <a
                      className="btn sm"
                      href="https://mp.weixin.qq.com/"
                      target="_blank"
                      rel="noreferrer"
                    >
                      后台 ↗
                    </a>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          {pushErr && (
            <div className="hero-note" style={{ marginTop: 10 }}>
              推送失败：{pushErr}
            </div>
          )}
          {pushMsg && (
            <div className="hero-note ok" style={{ marginTop: 10 }}>
              {pushMsg} → 去后台草稿箱手机预览，确认无图裂再发表
            </div>
          )}
          <p className="tiny faint" style={{ marginTop: 10 }}>
            写入会先备份原文到 06-工作台/data/backups/，只改 frontmatter 与首个 H1，不碰正文。
            需要先跑质检可去 <a href="/quality" style={{ textDecoration: 'underline' }}>/quality</a>；
            命令行走法（等价）：
            <span className="mono"> {pushCmd || '—'}</span>
          </p>
        </section>
      )}

      <form className="card" onSubmit={submit}>
        <div className="card-head">
          <h2 className="card-title">{editId ? `改候选 #${editId}` : '加一条候选'}</h2>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {form.text ? (
              <span className={`pill ${BAND[audit.band].cls}`}>
                {audit.chars} 字 · {BAND[audit.band].label}
                {audit.band === 'reject' ? ' · 接口拒收' : ''}
              </span>
            ) : (
              <span className="card-sub">{LIMIT_LABEL.template} 标题 {LIMITS.template.title} / 摘要 {LIMITS.template.digest} · {LIMIT_LABEL.platform} 标题 {LIMITS.platform.title} / 摘要 {LIMITS.platform.digest}</span>
            )}
            <button
              type="button"
              className="btn sm"
              onClick={() => setShowLib((v) => !v)}
            >
              {showLib ? '收起公式库' : '公式库'}
            </button>
          </div>
        </div>

        {showLib && (
          <div className="table-wrap" style={{ marginBottom: 12 }}>
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 100 }}>公式</th>
                  <th style={{ width: 160 }}>结构</th>
                  <th>示例</th>
                  <th style={{ width: 74 }} />
                </tr>
              </thead>
              <tbody>
                {FORMULAS.map((f) => (
                  <tr key={f.id}>
                    <td className="name">{f.name}</td>
                    <td className="small muted">{f.shape}</td>
                    <td className="small">{f.sample}</td>
                    <td>
                      <button
                        type="button"
                        className="btn sm"
                        onClick={() => {
                          set('text', f.sample);
                          set('formula', f.name);
                        }}
                      >
                        套用
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <label className="field">
          <span>标题</span>
          <input
            value={form.text}
            onChange={(e) => set('text', e.target.value)}
            placeholder="先定这篇最想让人知道的一个事实，再套公式"
          />
        </label>

        <div className="form-grid">
          <label className="field">
            <span>公式</span>
            <select value={form.formula} onChange={(e) => set('formula', e.target.value)}>
              <option value="">未分类</option>
              {FORMULAS.map((f) => (
                <option key={f.id} value={f.name}>{f.name}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>钩子（最想让人知道的那个事实）</span>
            <input
              value={form.hook}
              onChange={(e) => set('hook', e.target.value)}
              placeholder="例：账单差 50%"
            />
          </label>
        </div>

        <label className="field">
          <span>配套摘要（{LIMIT_LABEL.template} ≤{LIMITS.template.digest} 字 · {LIMIT_LABEL.platform} ≤{LIMITS.platform.digest} 字，别和标题撞）</span>
          <textarea
            rows={2}
            value={form.digest}
            onChange={(e) => set('digest', e.target.value)}
            placeholder="例：同一件活，四条路线：钱、隐私、上手成本，一次说清。"
          />
        </label>

        <div className="form-grid five">
          {DIMS.map((d) => (
            <label className="field" key={d.key}>
              <span title={d.hint}>{d.label}</span>
              <select
                value={String(form[d.key])}
                onChange={(e) => set(d.key, Number(e.target.value) as never)}
              >
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>
          ))}
        </div>

        <label className="field">
          <span>备注</span>
          <input
            value={form.note}
            onChange={(e) => set('note', e.target.value)}
            placeholder="例：主推，和开头一致"
          />
        </label>

        {form.text && (
          <div className="chips" style={{ marginTop: 8 }}>
            <span className={`pill ${BAND[audit.band].cls}`}>
              {audit.chars} 字 · {BAND[audit.band].label}
            </span>
            <span className="pill none">五维合计 {form.info + form.curiosity + form.trust + form.search + form.safe}</span>
            {audit.flags.map((f, i) => (
              <span key={i} className={`pill ${f.level === 'bad' ? 'bad' : f.level === 'warn' ? 'warn' : 'none'}`}>
                {f.label}
              </span>
            ))}
          </div>
        )}

        {error && <div className="hero-note" style={{ marginTop: 10 }}>{error}</div>}
        {msg && <div className="hero-note ok" style={{ marginTop: 10 }}>{msg}</div>}

        <div style={{ marginTop: 12, display: 'flex', gap: 10, alignItems: 'center' }}>
          <button className="btn primary" disabled={busy}>{editId ? '保存修改' : '加入候选库'}</button>
          {editId && (
            <button type="button" className="btn sm" onClick={reset}>
              取消编辑
            </button>
          )}
          <span className="tiny faint">只存在本机 data/workbench.db，不上传。</span>
        </div>
      </form>


      <section className="card section-gap">
        <div className="card-head">
          <h2 className="card-title">候选库</h2>
          <span className="card-sub">{rows.length} 条 · 按总分排序</span>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>标题</th>
                <th style={{ width: 76 }}>字数</th>
                <th style={{ width: 88 }}>公式</th>
                <th style={{ width: 150 }}>五维</th>
                <th style={{ width: 56 }}>总分</th>
                <th style={{ width: 84 }}>群投票</th>
                <th style={{ width: 78 }}>状态</th>
                <th>风险</th>
                <th style={{ width: 150 }} />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const a = auditTitle(r.text, r.digest);
                const band = BAND[a.band];
                const active = chosen?.id === r.id;
                return (
                  <tr key={r.id} className={active ? 'row-on' : ''}>
                    <td>
                      <div className="name">{r.text}</div>
                      {r.digest && <div className="tiny faint">摘要：{r.digest}</div>}
                      {r.hook && <div className="tiny faint">钩子：{r.hook}</div>}
                      {r.note && <div className="tiny faint">备注：{r.note}</div>}
                    </td>
                    <td className="mono small">
                      <span className={`pill ${band.cls}`}>{a.chars}</span>
                    </td>
                    <td className="small muted">{r.formula || '—'}</td>
                    <td className="mono tiny">
                      信息{r.info} 好奇{r.curiosity} 可信{r.trust} 搜索{r.search} 合规{r.safe}
                    </td>
                    <td className="mono small"><b>{r.score}</b></td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <span className="mono small">{r.votes || 0}</span>
                        <button
                          className="btn sm"
                          disabled={busy}
                          title="发到群里收集投票后，在这里记数"
                          onClick={() => act({ action: 'vote', id: r.id }, '已记 1 票')}
                        >
                          +1
                        </button>
                      </div>
                    </td>
                    <td>
                      <span className={`pill ${active ? 'ok' : r.status === 'killed' ? 'bad' : 'none'}`}>
                        {STATUS_LABEL[r.status]}
                      </span>
                    </td>
                    <td>
                      <div className="chips">
                        {a.flags.length === 0 ? (
                          <span className="tiny faint">无</span>
                        ) : (
                          a.flags.map((f, i) => (
                            <span
                              key={i}
                              className={`pill ${f.level === 'bad' ? 'bad' : f.level === 'warn' ? 'warn' : 'none'}`}
                            >
                              {f.label}
                            </span>
                          ))
                        )}
                      </div>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {r.status !== 'chosen' && r.status !== 'killed' && (
                          <button
                            className="btn sm"
                            disabled={busy}
                            onClick={() => act({ action: 'choose', id: r.id }, '已选定')}
                          >
                            选定
                          </button>
                        )}
                        <button className="btn sm" disabled={busy} onClick={() => loadEdit(r)}>
                          改
                        </button>
                        {r.status !== 'killed' && r.status !== 'chosen' && (
                          <button
                            className="btn sm"
                            disabled={busy}
                            onClick={() => act({ action: 'status', id: r.id, status: 'killed' })}
                          >
                            判死
                          </button>
                        )}
                        {r.status === 'killed' && (
                          <button
                            className="btn sm"
                            disabled={busy}
                            onClick={() => act({ action: 'status', id: r.id, status: 'candidate' })}
                          >
                            复活
                          </button>
                        )}
                        {r.status !== 'chosen' && (
                          <button
                            className="btn sm danger"
                            disabled={busy}
                            onClick={() => {
                              if (window.confirm(`删除「${r.text}」？`)) {
                                act({ action: 'delete', id: r.id });
                              }
                            }}
                          >
                            删
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!rows.length && (
                <tr>
                  <td colSpan={9} className="empty">候选库是空的，上面加一条。</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

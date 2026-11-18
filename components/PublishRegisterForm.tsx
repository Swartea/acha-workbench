'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

export default function PublishRegisterForm({
  groups,
}: {
  groups: Array<{ id: string; title: string; files: Array<{ file: string; label: string }> }>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [form, setForm] = useState({
    article_id: groups[0]?.id ?? '',
    file: groups[0]?.files[0]?.file ?? '',
    published_at: '',
    note: '',
  });

  const files = useMemo(
    () => groups.find((g) => g.id === form.article_id)?.files ?? [],
    [groups, form.article_id],
  );

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setOk('');
    try {
      const res = await fetch('/api/publications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || '登记失败');
      setOk('已记下这次发表。各页会按「发布 / 复盘」同步步数，复盘去「稿件」或「复盘」页补一条记录。');
      set('note', '');
      router.refresh();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  }

  if (!groups.length) return null;

  return (
    <form className="card" onSubmit={submit}>
      <div className="card-head">
        <h2 className="card-title">登记已发表</h2>
        <span className="card-sub">只记状态，不调用公众号接口；发表永远在后台手动完成</span>
      </div>
      <div className="form-grid">
        <label className="field">
          <span>哪篇稿件</span>
          <select
            value={form.article_id}
            onChange={(e) => {
              const id = e.target.value;
              const g = groups.find((x) => x.id === id);
              set('article_id', id);
              set('file', g?.files[0]?.file ?? '');
            }}
          >
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.id.startsWith('U:') ? '未编号' : g.id} · {g.title}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>实际发出的文件</span>
          <select value={form.file} onChange={(e) => set('file', e.target.value)} required>
            {files.map((f) => (
              <option key={f.file} value={f.file}>
                {f.label} · {f.file}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>发表日期（可留空）</span>
          <input type="date" value={form.published_at} onChange={(e) => set('published_at', e.target.value)} />
        </label>
      </div>
      <label className="field" style={{ marginTop: 12 }}>
        <span>备注</span>
        <input value={form.note} onChange={(e) => set('note', e.target.value)} placeholder="可选，例如：后台手动群发" />
      </label>
      {error && <p className="hero-note" style={{ marginTop: 12 }}>{error}</p>}
      {ok && <p className="hero-note ok" style={{ marginTop: 12 }}>{ok}</p>}
      <div style={{ marginTop: 14 }}>
        <button className="btn primary" type="submit" disabled={busy || !form.file}>
          {busy ? '登记中…' : '记下已发表'}
        </button>
      </div>
    </form>
  );
}

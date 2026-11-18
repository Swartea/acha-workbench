'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

function todayLocal(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export default function ReviewForm({ topics }: { topics: Array<{ id: string; title: string }> }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    article_id: topics[0]?.id ?? '',
    title: topics[0]?.title ?? '',
    published_at: todayLocal(),
    reads: '',
    completes: '',
    wow: '',
    shares: '',
    follows: '',
    note: '',
  });

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || '保存失败');
      setForm((f) => ({ ...f, reads: '', completes: '', wow: '', shares: '', follows: '', note: '' }));
      router.refresh();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card" onSubmit={submit}>
      <div className="card-head">
        <h2 className="card-title">录入一篇复盘</h2>
        <span className="card-sub">发布后 24h / 72h 各记一次</span>
      </div>

      <div className="form-grid">
        <label className="field">
          <span>选题</span>
          <select
            value={form.article_id}
            onChange={(e) => {
              const t = topics.find((x) => x.id === e.target.value);
              set('article_id', e.target.value);
              if (t) set('title', t.title);
            }}
          >
            {topics.map((t) => (
              <option key={t.id} value={t.id}>{t.id} · {t.title}</option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>标题</span>
          <input value={form.title} onChange={(e) => set('title', e.target.value)} />
        </label>

        <label className="field">
          <span>发布日期</span>
          <input type="date" value={form.published_at} onChange={(e) => set('published_at', e.target.value)} />
        </label>
      </div>

      <div className="form-grid five">
        <label className="field"><span>阅读</span><input inputMode="numeric" placeholder="0" value={form.reads} onChange={(e) => set('reads', e.target.value)} /></label>
        <label className="field"><span>完读</span><input inputMode="numeric" placeholder="0" value={form.completes} onChange={(e) => set('completes', e.target.value)} /></label>
        <label className="field"><span>在看</span><input inputMode="numeric" placeholder="0" value={form.wow} onChange={(e) => set('wow', e.target.value)} /></label>
        <label className="field"><span>转发</span><input inputMode="numeric" placeholder="0" value={form.shares} onChange={(e) => set('shares', e.target.value)} /></label>
        <label className="field"><span>涨粉</span><input inputMode="numeric" placeholder="0" value={form.follows} onChange={(e) => set('follows', e.target.value)} /></label>
      </div>

      <label className="field">
        <span>3 个数字 + 1 条选题调整</span>
        <textarea
          rows={2}
          value={form.note}
          onChange={(e) => set('note', e.target.value)}
          placeholder="例：完读率 42%，在看 6，涨粉 3 → 下期把「价格对比」提前到第 2 段"
        />
      </label>

      {error && <div className="hero-note" style={{ marginTop: 10 }}>{error}</div>}

      <div style={{ marginTop: 12, display: 'flex', gap: 10, alignItems: 'center' }}>
        <button className="btn primary" disabled={busy}>{busy ? '保存中…' : '保存'}</button>
        <span className="tiny faint">数据只存在本机 data/workbench.db，不上传。</span>
      </div>
    </form>
  );
}

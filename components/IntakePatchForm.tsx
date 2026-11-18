'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

/**
 * 自动抓的 Folo/RSS 素材是公开资料；这里让作者在原条目上补自己的实跑截图/判断，
 * 勾选后标记为「已补实跑」（firstHand=true）。
 */
export default function IntakePatchForm({
  id,
  firstHand,
}: {
  id: string;
  firstHand: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(!firstHand);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const form = e.currentTarget;
    const data = new FormData(form);
    data.append('id', id);
    setBusy(true);
    setError('');
    setMsg('');
    try {
      const res = await fetch('/api/intake', { method: 'POST', body: data });
      const j = (await res.json()) as { ok: boolean; error?: string };
      if (!j.ok) throw new Error(j.error || '补充失败');
      form.reset();
      setMsg('已补进这条素材。');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm('删掉这条素材？抓坏了或不需要时可以删。')) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/intake?id=' + encodeURIComponent(id), { method: 'DELETE' });
      const j = (await res.json()) as { ok: boolean; error?: string };
      if (!j.ok) throw new Error(j.error || '删除失败');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <details
      className="card intake-patch"
      open={open}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
      style={{ marginTop: 12 }}
    >
      <summary>补充：我的实跑截图 + 一句判断</summary>
      <p className="tiny faint" style={{ margin: '6px 0 0' }}>
        系统抓的是公开文章/页面截图；这里可以补你真实跑过的截图/报错/判断。
        原文里的「- [ ]」只是清单，不是按钮——在这个表单里提交才算补进素材。
      </p>
      <form onSubmit={submit}>
        <label className="field">
          <span>我实际跑过 / 看到什么</span>
          <textarea
            name="text"
            rows={3}
            placeholder="例：我在 Claude Code 里跑了同一段任务，报错是……；我的判断是……"
          />
        </label>
        <label className="field">
          <span>我的截图（png / jpg / gif / webp，最多 6 张，单张 ≤5MB）</span>
          <input
            type="file"
            name="files"
            multiple
            accept="image/png,image/jpeg,image/gif,image/webp"
          />
        </label>
        <label className="tiny muted" style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
          <input type="checkbox" name="firstHand" defaultChecked={firstHand} /> 这是我实跑过的（我的截图 / 报错 / 判断）
        </label>

        {error && <div className="hero-note" style={{ marginTop: 10 }}>{error}</div>}
        {msg && <div className="hero-note ok" style={{ marginTop: 10 }}>{msg}</div>}

        <div style={{ marginTop: 10, display: 'flex', gap: 10, alignItems: 'center' }}>
          <button className="btn primary" type="submit" disabled={busy}>
            {busy ? '提交中…' : '补进这条'}
          </button>
          <button className="btn sm danger" type="button" onClick={remove} disabled={busy}>
            删掉这条
          </button>
          <span className="tiny faint">不勾也是有效素材：公开来源即可立项。</span>
        </div>
      </form>
    </details>
  );
}

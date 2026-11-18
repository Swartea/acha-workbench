'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

export default function IntakeForm({ initialText = '' }: { initialText?: string }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [okMsg, setOkMsg] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState(0);
  const [text, setText] = useState(initialText);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const form = formRef.current;
    if (!form) return;
    setBusy(true);
    setError('');
    setOkMsg('');
    try {
      const res = await fetch('/api/intake', { method: 'POST', body: new FormData(form) });
      const j = (await res.json()) as { ok: boolean; error?: string; entry?: { id: string } };
      if (!j.ok) throw new Error(j.error || '提交失败');
      form.reset();
      setText('');
      setPicked(0);
      setOkMsg('已收进素材池：' + (j.entry?.id ?? ''));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form ref={formRef} className="card" onSubmit={submit}>
      <div className="card-head">
        <h2 className="card-title">今天遇到了什么</h2>
        <span className="card-sub">1 分钟 · 截图 + 一句话</span>
      </div>

      <label className="field">
        <span>素材正文</span>
        <textarea
          name="text"
          rows={6}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={'例：今天用 Cursor 改一个 3 万行项目，导出功能跑到一半报 EACCES，截图在下面。我把坑记下来，顺便算了下四家订阅一年的账。'}
          required
        />
      </label>

      <label className="field">
        <span>截图（png / jpg / gif / webp，最多 6 张，单张 ≤5MB）</span>
        <input
          ref={fileRef}
          type="file"
          name="files"
          accept="image/png,image/jpeg,image/gif,image/webp"
          multiple
          onChange={(e) => setPicked(e.target.files?.length ?? 0)}
        />
        {picked > 0 && <span className="tiny faint">已选 {picked} 张</span>}
      </label>

      {error && <div className="hero-note" style={{ marginTop: 12 }}>{error}</div>}
      {okMsg && (
        <div className="hero-note ok" style={{ marginTop: 12 }}>
          {okMsg} · 写作门只认素材池里的东西
        </div>
      )}

      <div style={{ marginTop: 12, display: 'flex', gap: 10, alignItems: 'center' }}>
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? '上传中…' : '投进素材池'}
        </button>
        <span className="tiny faint">文件按内容校验类型，不信任扩展名；只存在本机。</span>
      </div>
    </form>
  );
}

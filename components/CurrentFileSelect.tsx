'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function CurrentFileSelect({
  articleId,
  currentFile,
  files,
}: {
  articleId: string;
  currentFile: string | null;
  files: Array<{ file: string; label: string; date?: string }>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function onChange(file: string) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/current-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ article_id: articleId, file }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || '切换失败');
      router.refresh();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  }

  if (!files.length) return <span className="tiny faint">暂无正文稿</span>;

  return (
    <div>
      <label className="field" style={{ margin: 0 }}>
        <span className="tiny muted">当前稿</span>
        <select
          value={currentFile ?? files[0]?.file ?? ''}
          disabled={busy}
          onChange={(e) => onChange(e.target.value)}
        >
          {files.map((f) => (
            <option key={f.file} value={f.file}>
              {f.label}
              {f.date ? ` · ${f.date}` : ''}
              {f.file === currentFile ? '（当前）' : ''}
            </option>
          ))}
        </select>
      </label>
      {error && <div className="tiny" style={{ color: 'var(--bad, #b00)', marginTop: 6 }}>{error}</div>}
    </div>
  );
}

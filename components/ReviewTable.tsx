'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface Row {
  id: number;
  article_id: string;
  title: string;
  published_at: string | null;
  reads: number;
  completes: number;
  wow: number;
  shares: number;
  follows: number;
  note: string | null;
}

export default function ReviewTable({ rows }: { rows: Row[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<number | null>(null);

  async function del(id: number) {
    if (!confirm('删除这条复盘记录？')) return;
    setBusy(id);
    try {
      await fetch('/api/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', id }),
      });
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  if (!rows.length) {
    return <div className="empty">还没有复盘记录。第一篇发表后，把 24h 数据填进来。</div>;
  }

  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th style={{ width: 90 }}>日期</th>
            <th style={{ width: 50 }}>编号</th>
            <th>标题</th>
            <th style={{ width: 64 }}>阅读</th>
            <th style={{ width: 74 }}>完读率</th>
            <th style={{ width: 52 }}>在看</th>
            <th style={{ width: 52 }}>转发</th>
            <th style={{ width: 52 }}>涨粉</th>
            <th>备注</th>
            <th style={{ width: 50 }} />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const rate = r.reads ? Math.round((r.completes / r.reads) * 100) : 0;
            return (
              <tr key={r.id}>
                <td className="mono tiny muted">{r.published_at ?? '—'}</td>
                <td className="mono tiny">{r.article_id}</td>
                <td className="name small">{r.title}</td>
                <td className="mono tiny">{r.reads || '—'}</td>
                <td className="mono tiny">{r.reads ? `${rate}%` : '—'}</td>
                <td className="mono tiny">{r.wow || '—'}</td>
                <td className="mono tiny">{r.shares || '—'}</td>
                <td className="mono tiny">{r.follows || '—'}</td>
                <td className="tiny muted" style={{ maxWidth: 260 }}>{r.note ?? '—'}</td>
                <td>
                  <button className="btn ghost sm" onClick={() => del(r.id)} disabled={busy === r.id}>删</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

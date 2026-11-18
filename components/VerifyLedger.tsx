'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export interface LedgerRow {
  key: string;
  no: string;
  text: string;
  source: string;
  note: string;
  kindLabel: string;
  status: 'fresh' | 'stale' | 'unchecked';
  ageDays: number | null;
  checkedAt: string;
  trust: string;
  humanChecked: boolean;
  section: string;
  line: number;
}

export const TRUSTS = ['人工核对', '官方口径', '第三方', '实测', '未核实'];

function StatusPill({ row }: { row: LedgerRow }) {
  if (row.status === 'fresh') {
    return <span className="pill ok">新鲜 · {row.ageDays} 天前</span>;
  }
  if (row.status === 'stale') {
    return <span className="pill warn">过期 · {row.ageDays} 天前</span>;
  }
  return <span className="pill bad">未核</span>;
}

export default function VerifyLedger({
  articleId,
  rows,
}: {
  articleId: string;
  rows: LedgerRow[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);

  async function post(key: string, action: string, value?: string) {
    setPending(key);
    try {
      const res = await fetch('/api/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ articleId, key, action, value }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        window.alert(data.error ?? '保存失败');
        return;
      }
      router.refresh();
    } finally {
      setPending(null);
    }
  }

  if (!rows.length) {
    return <div className="empty">这篇没有可核的素材表——要么还没写作包，要么包里的表头不是「素材 / 来源」。</div>;
  }

  let lastSection = '';
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th style={{ width: 44 }}>#</th>
            <th>素材</th>
            <th style={{ width: 140 }}>来源</th>
            <th style={{ width: 64 }}>类型</th>
            <th style={{ width: 120 }}>核对日期</th>
            <th style={{ width: 110 }}>状态</th>
            <th style={{ width: 210 }}>操作</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const showSection = Boolean(r.section) && r.section !== lastSection;
            lastSection = r.section;
            return (
              <FragmentRow key={r.key} r={r} showSection={showSection} pending={pending} post={post} />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function FragmentRow({
  r,
  showSection,
  pending,
  post,
}: {
  r: LedgerRow;
  showSection: boolean;
  pending: string | null;
  post: (key: string, action: string, value?: string) => void;
}) {
  const busy = pending === r.key;
  return (
    <>
      {showSection && (
        <tr>
          <td colSpan={7} className="tiny faint" style={{ paddingTop: 14 }}>
            {r.section}
          </td>
        </tr>
      )}
      <tr>
        <td className="mono tiny faint">{r.no || '—'}</td>
        <td className="small">
          <div title={r.text}>{r.text.length > 150 ? r.text.slice(0, 150) + '…' : r.text}</div>
          {r.note && <div className="tiny faint" style={{ marginTop: 2 }}>包内标注：{r.note.slice(0, 80)}</div>}
        </td>
        <td className="tiny muted" style={{ overflowWrap: 'anywhere' }}>
          {r.source.length > 60 ? r.source.slice(0, 60) + '…' : r.source || '—'}
        </td>
        <td className="tiny muted">{r.kindLabel}</td>
        <td className="mono tiny">{r.checkedAt || '—'}</td>
        <td><StatusPill row={r} /></td>
        <td>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            {r.humanChecked ? (
              <button className="btn" disabled={busy} onClick={() => post(r.key, 'uncheck')}>
                撤销
              </button>
            ) : (
              <button className="btn primary" disabled={busy} onClick={() => post(r.key, 'check')}>
                今天核过
              </button>
            )}
            <select
              className="select"
              style={{ width: 92, fontSize: 12 }}
              value={r.trust}
              disabled={busy}
              onChange={(e) => post(r.key, 'trust', e.target.value)}
            >
              {TRUSTS.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
        </td>
      </tr>
    </>
  );
}

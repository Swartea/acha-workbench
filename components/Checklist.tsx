'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export interface ChecklistItemView {
  key: string;
  label: string;
  hint: string;
  done: boolean;
}

function Check({ on }: { on: boolean }) {
  return (
    <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M2.5 8.5l3.5 3.5 7.5-8" opacity={on ? 1 : 0} />
    </svg>
  );
}

export default function Checklist({
  items,
  compact = false,
}: {
  items: ChecklistItemView[];
  compact?: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);

  async function toggle(key: string, done: boolean, label: string) {
    if (!done) {
      const ok = window.confirm(
        `取消勾选「${label}」？\n\n取消后推草稿会被守卫拦下，要三项全绿才能再推。`,
      );
      if (!ok) return;
    }
    setPending(key);
    try {
      await fetch('/api/account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, done }),
      });
      router.refresh();
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="checklist">
      {items.map((it) => (
        <div key={it.key} className={`check-row${it.done ? ' done' : ''}`}>
          <button
            type="button"
            aria-label={it.done ? `取消：${it.label}` : `完成：${it.label}`}
            className={`check-box${it.done ? ' on' : ''}`}
            disabled={pending === it.key}
            onClick={() => toggle(it.key, !it.done, it.label)}
          >
            <Check on={it.done} />
          </button>
          <div className="check-main">
            <div className="check-label">{it.label}</div>
            {!compact && <div className="check-hint">{it.hint}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

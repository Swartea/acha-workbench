'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function ScanButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function rescan() {
    setBusy(true);
    try {
      await fetch('/api/scan', { method: 'POST' });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button className="btn sm" onClick={rescan} disabled={busy}>
      {busy ? '扫描中…' : '刷新索引'}
    </button>
  );
}

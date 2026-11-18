'use client';

import { useEffect, useState } from 'react';

type State = 'loading' | 'ok' | 'locked' | 'unconfigured';

export default function PasscodeGate() {
  const [state, setState] = useState<State>('loading');
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch('/api/auth', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j: { authed: boolean; configured: boolean }) => {
        setState(j.authed ? 'ok' : j.configured ? 'locked' : 'unconfigured');
      })
      .catch(() => setState('locked'));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setErr('');
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const j = (await res.json()) as { ok: boolean; error?: string };
      if (!j.ok) throw new Error(j.error || '口令不对');
      location.reload();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : String(e2));
      setBusy(false);
    }
  }

  if (state === 'loading' || state === 'ok') return null;

  if (state === 'unconfigured') {
    return (
      <div className="hero-note">
        本机没设置 <code className="mono">WORKBENCH_PASSCODE</code>，非本机设备不能投料。在
        06-工作台/.env.local 里加一行再重启即可。
      </div>
    );
  }

  return (
    <form className="card" onSubmit={submit}>
      <div className="card-head">
        <h2 className="card-title">需要口令</h2>
        <span className="card-sub">这台设备第一次访问 · 30 天内免输</span>
      </div>
      <label className="field">
        <span>口令</span>
        <input
          type="password"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="本机设置的 WORKBENCH_PASSCODE"
          autoFocus
        />
      </label>
      {err && <div className="hero-note" style={{ marginTop: 12 }}>{err}</div>}
      <div style={{ marginTop: 12 }}>
        <button className="btn primary" type="submit" disabled={busy || !code.trim()}>
          {busy ? '验证中…' : '进入'}
        </button>
      </div>
    </form>
  );
}

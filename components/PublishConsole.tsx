'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export interface ManuscriptOption {
  path: string;
  label: string;
  date?: string;
}

const STEPS = [
  { key: 'dryrun', n: '01', label: '干跑', hint: '本地渲染，不调接口' },
  { key: 'preflight', n: '02', label: '机械预检', hint: '标题 / 图片 / 泄漏词' },
  { key: 'preview', n: '03', label: '手机宽预览', hint: '375px，与草稿同源' },
  { key: 'push', n: '04', label: '推草稿箱', hint: '只进草稿，不发布' },
] as const;

type StepKey = (typeof STEPS)[number]['key'];

interface RunView {
  id: number;
  step: string;
  ok: number;
  created_at: string;
}

export default function PublishConsole({
  manuscripts,
  initialMd,
  envOk,
  envReason,
  checklistOk,
  lastRuns,
  doneByFile = {},
}: {
  manuscripts: ManuscriptOption[];
  initialMd: string;
  envOk: boolean;
  envReason: string;
  checklistOk: boolean;
  lastRuns: RunView[];
  doneByFile?: Record<string, Record<string, boolean>>;
}) {
  const router = useRouter();
  const labelOf: Record<string, string> = { dryrun: '干跑 ✓', preflight: '预检 ✓', preview: '预览 ✓' };
  const summaryOf = (d: Record<string, boolean>) => {
    const parts = ['dryrun', 'preflight', 'preview'].filter((k) => d[k]).map((k) => labelOf[k]);
    return parts.length ? `上次执行：${parts.join(' · ')}\n可直接重跑任一步，或点「推草稿箱」。` : '';
  };
  const [md, setMd] = useState(initialMd);
  const [done, setDone] = useState<Record<string, boolean>>(doneByFile[initialMd] ?? {});
  const [running, setRunning] = useState<string | null>(null);
  const [output, setOutput] = useState(summaryOf(doneByFile[initialMd] ?? {}));
  const [lastStep, setLastStep] = useState('');
  const [previewKey, setPreviewKey] = useState<number | null>(
    (doneByFile[initialMd] ?? {}).preview ? Date.now() : null,
  );
  const [error, setError] = useState('');

  function enabled(key: StepKey) {
    if (running) return false;
    if (key === 'dryrun') return true;
    if (key === 'preflight') return !!done.dryrun;
    if (key === 'preview') return !!done.preflight;
    return !done.push && !!done.preview && envOk && checklistOk;
  }

  function reason(key: StepKey) {
    if (key === 'push' && done.push) return '已推草稿，避免重复';
    if (key === 'preflight' && !done.dryrun) return '先跑干跑';
    if (key === 'preview' && !done.preflight) return '先过预检';
    if (key === 'push') {
      if (!done.preview) return '先出预览';
      if (!checklistOk) return '账号三件未全绿';
      if (!envOk) return envReason || '凭据未就位';
    }
    return '';
  }

  async function run(step: StepKey) {
    setRunning(step);
    setError('');
    setOutput(`$ 正在执行 ${STEPS.find((s) => s.key === step)?.label}…\n`);
    try {
      const res = await fetch('/api/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step, md }),
      });
      const data = await res.json();
      setOutput(data.output || data.error || '（无输出）');
      setLastStep(step);
      if (data.ok) {
        setDone((d) => ({ ...d, [step]: true }));
        if (step === 'preview') setPreviewKey(Date.now());
      } else {
        setDone((d) => ({ ...d, [step]: false }));
        if (data.error) setError(data.error);
      }
      router.refresh();
    } catch (e) {
      setOutput(String(e));
      setError('请求失败');
    } finally {
      setRunning(null);
    }
  }

  return (
    <div className="stack">
      <div className="card">
        <div className="card-head" style={{ marginBottom: 12 }}>
          <h2 className="card-title">发布链路 <span className="idx">4 STEPS</span></h2>
          <span className="card-sub">只调 draft/add · 不调 freepublish</span>
        </div>

        <label className="small muted" htmlFor="ms-select">稿件</label>
        <select
          id="ms-select"
          className="select"
          value={md}
          onChange={(e) => {
            const next = e.target.value;
            setMd(next);
            setDone(doneByFile[next] ?? {});
            setPreviewKey((doneByFile[next] ?? {}).preview ? Date.now() : null);
            setOutput(summaryOf(doneByFile[next] ?? {}));
          }}
        >
          {manuscripts.map((m) => (
            <option key={m.path} value={m.path}>
              {m.label}{m.date ? ` · ${m.date}` : ''}
            </option>
          ))}
        </select>

        <div className="chain">
          {STEPS.map((s) => {
            const ok = done[s.key];
            const can = enabled(s.key);
            return (
              <button
                key={s.key}
                type="button"
                className={`chain-step${ok ? ' ok' : ''}`}
                disabled={!can}
                onClick={() => run(s.key)}
                title={!can ? reason(s.key) : ''}
              >
                <div className="chain-n">{s.n}{ok ? ' · 完成' : ''}</div>
                <div className="chain-label">{running === s.key ? '执行中…' : s.label}</div>
                <div className="chain-hint">{ok ? '✓ 已通过' : reason(s.key) || s.hint}</div>
              </button>
            );
          })}
        </div>

        {error && <div className="hero-note" style={{ marginTop: 14 }}>{error}</div>}

        {done.push && (
          <div className="hero-note ok" style={{ marginTop: 14 }}>
            草稿已创建，未发布。去{' '}
            <a href="https://mp.weixin.qq.com/" target="_blank" rel="noreferrer" style={{ textDecoration: 'underline' }}>
              公众号后台 → 草稿箱
            </a>{' '}
            手机预览后手动点发表。
          </div>
        )}

        <div className="terminal-head" style={{ marginTop: 16 }}>
          <div className="terminal-dots"><i /><i /><i /></div>
          <span className="tiny faint mono">{lastStep ? `last: ${lastStep}` : 'output'}</span>
        </div>
        <div className="console">
          {output || '等待执行。干跑 → 预检 → 预览 → 推草稿，按顺序来。'}
        </div>
      </div>

      {previewKey && (
        <div className="card">
          <div className="card-head">
            <h2 className="card-title">手机宽预览 <span className="idx">375PX</span></h2>
            <a className="btn sm" href={`/api/preview?t=${previewKey}`} target="_blank" rel="noreferrer">新窗口打开</a>
          </div>
          <div className="phone-frame">
            <iframe src={`/api/preview?t=${previewKey}`} title="手机宽预览" />
          </div>
        </div>
      )}

      {lastRuns.length > 0 && (
        <div className="card">
          <div className="card-head">
            <h2 className="card-title">最近执行</h2>
            <span className="card-sub">留档可查</span>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>步骤</th><th>结果</th><th>时间</th></tr>
              </thead>
              <tbody>
                {lastRuns.map((r) => (
                  <tr key={r.id}>
                    <td className="mono">{r.step}</td>
                    <td>{r.ok ? <span className="pill ok">通过</span> : <span className="pill bad">失败</span>}</td>
                    <td className="mono small muted">{new Date(r.created_at).toLocaleString('zh-CN', { hour12: false })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

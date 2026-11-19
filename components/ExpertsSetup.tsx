'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface ModelStatus {
  key: string;
  label: string;
  carrier: string;
  binOk: boolean;
  keyOk: boolean;
  keyEnv: string | null;
}

/**
 * 模型通道一键安装 / 体检卡：显示二进制与 Key 状态，点击跑安装命令或给指引。
 * 状态由服务端页算好传进来；按钮 POST /api/experts/install 后 router.refresh()。
 */
export default function ExpertsSetup({ models }: { models: ModelStatus[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [hints, setHints] = useState<Record<string, string>>({});

  async function install(key: string) {
    setBusy(key);
    try {
      const res = await fetch('/api/experts/install', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: key }),
      });
      const j = (await res.json()) as { ok?: boolean; hint?: string; error?: string };
      setHints((h) => ({ ...h, [key]: j.hint ?? j.error ?? '完成' }));
      router.refresh();
    } catch (e) {
      setHints((h) => ({ ...h, [key]: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="card section-gap">
      <div className="card-head">
        <h2 className="card-title">模型通道</h2>
        <span className="card-sub">一键安装 / 体检 · GLM 与 DeepSeek 复用 claude CLI + 各家官方兼容端点</span>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>模型</th>
              <th>载体</th>
              <th>二进制</th>
              <th>API Key</th>
              <th style={{ width: 130 }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {models.map((m) => (
              <tr key={m.key}>
                <td><b>{m.label}</b></td>
                <td className="small">{m.carrier}</td>
                <td>{m.binOk ? '✅' : '❌ 未装'}</td>
                <td>
                  {m.keyEnv === null ? (
                    <span className="tiny muted">CLI 自带登录态</span>
                  ) : m.keyOk ? (
                    '✅'
                  ) : (
                    <span className="tiny">缺 <code className="mono">{m.keyEnv}</code></span>
                  )}
                </td>
                <td>
                  <button className="btn" disabled={busy === m.key} onClick={() => void install(m.key)}>
                    {busy === m.key ? '执行中…' : m.binOk ? '体检 / 修复' : '一键安装'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {Object.entries(hints).map(([k, v]) => (
        <div key={k} className="tiny" style={{ marginTop: 8 }}>
          <b>{k}</b>：{v}
        </div>
      ))}
      <p className="tiny faint" style={{ marginTop: 10, marginBottom: 0 }}>
        Key 配置：把 <code className="mono">ZHIPUAI_API_KEY</code> /{' '}
        <code className="mono">DEEPSEEK_API_KEY</code> 写进 <code className="mono">06-工作台/.env.local</code>{' '}
        （chmod 600，不入库），重启工作台生效。GLM / DeepSeek 调用按各家官方 API 计费。
      </p>
    </section>
  );
}

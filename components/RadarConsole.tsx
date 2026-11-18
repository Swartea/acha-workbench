'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  formatCst,
  type FoloRadarFile,
  type FoloStatus,
  type StoredFoloEntry,
} from '@/lib/folo-core';
import type { RssStatus } from '@/lib/rss';

function intakeHref(entry: StoredFoloEntry): string {
  const query = new URLSearchParams({
    from: entry.source === 'rss' ? 'rss' : 'folo',
    title: entry.titleZh || entry.title,
    url: entry.url,
    feed: entry.feed,
  });
  return `/intake?${query.toString()}`;
}

type SourceFilter = 'all' | 'folo' | 'rss';

export default function RadarConsole({
  initialRadar,
  initialEntries,
  initialRssStatus,
}: {
  initialRadar: FoloRadarFile;
  initialEntries: StoredFoloEntry[];
  initialRssStatus: RssStatus;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<FoloStatus | null>(null);
  const [radar, setRadar] = useState<FoloRadarFile>(initialRadar);
  const [rssStatus, setRssStatus] = useState<RssStatus>(initialRssStatus);
  const [entries, setEntries] = useState<StoredFoloEntry[]>(initialEntries);
  const [filter, setFilter] = useState<SourceFilter>('all');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'folo' | 'rss' | ''>('');
  const [limit, setLimit] = useState(50);
  const [includeSeen, setIncludeSeen] = useState(false);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [importingId, setImportingId] = useState('');
  const [imported, setImported] = useState<{
    sourceId?: string;
    id?: string;
    existing?: boolean;
    screenshot?: boolean;
  } | null>(null);

  async function load(force = false) {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/radar${force ? '?force=1' : ''}`, { cache: 'no-store' });
      if (res.status === 401) {
        setError('需要口令：在上方输入，或在本机打开。');
        return;
      }
      const j = (await res.json()) as {
        ok: boolean;
        error?: string;
        status?: FoloStatus;
        radar?: FoloRadarFile;
        rssStatus?: RssStatus;
        entries?: StoredFoloEntry[];
      };
      if (!j.ok || !j.status) throw new Error(j.error || '读取资料源状态失败');
      setStatus(j.status);
      if (j.radar) setRadar(j.radar);
      if (j.rssStatus) setRssStatus(j.rssStatus);
      if (j.entries) setEntries(j.entries);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function pull(source: 'folo' | 'rss') {
    if (busy) return;
    setBusy(source);
    setError('');
    setMsg('');
    try {
      const res = await fetch('/api/radar', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(source === 'folo' ? { source, limit, includeSeen } : { source }),
      });
      const j = (await res.json()) as {
        ok: boolean;
        error?: string;
        status?: FoloStatus;
        added?: number;
        total?: number;
        logFile?: string;
        mode?: 'timeline' | 'feeds';
        feedsScanned?: number;
        translated?: number;
        translateModel?: string;
        translateError?: string;
        feedErrors?: Array<{ id: string; name: string; error: string }>;
        enabledCount?: number;
      };
      if (j.status) setStatus(j.status);
      if (!j.ok) throw new Error(j.error || '拉取失败');
      const translateNote = j.translated
        ? ` · 翻译 ${j.translated} 条${j.translateModel ? `（${j.translateModel}）` : ''}`
        : j.translateError
          ? ` · 翻译跳过：${j.translateError.slice(0, 80)}`
          : '';
      const feedErrNote = j.feedErrors?.length
        ? ` · 失败源：${j.feedErrors.map((f) => `${f.name}（${f.error.slice(0, 40)}）`).join('、')}`
        : '';
      setMsg(
        `${source === 'rss' ? 'RSS' : 'Folo'} 拉到 ${j.total ?? 0} 条，新增 ${j.added ?? 0} 条${translateNote}${feedErrNote}` +
          (j.logFile ? ' · 已写当天雷达日志' : '') +
          '（不标已读，不动原始源）',
      );
      await load();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
    }
  }

  async function importEntry(entry: StoredFoloEntry) {
    if (importingId) return;
    setImportingId(entry.id);
    setError('');
    setMsg('');
    setImported(null);
    try {
      const res = await fetch('/api/radar/import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: entry.id, source: entry.source === 'rss' ? 'rss' : 'folo' }),
      });
      const j = (await res.json()) as {
        ok: boolean;
        error?: string;
        entry?: { id: string; sourceId?: string };
        existing?: boolean;
        screenshot?: boolean;
      };
      if (!j.ok) throw new Error(j.error || '抓取失败');
      setImported({
        sourceId: j.entry?.sourceId,
        id: j.entry?.id,
        existing: j.existing,
        screenshot: j.screenshot,
      });
      setMsg(
        j.existing
          ? '这条已经在素材池了，不用重复抓。'
          : `已抓成素材${j.screenshot ? '（含页面截图）' : '（截图没抓到，可手动补）'}；可在素材池补你的判断。`,
      );
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setImportingId('');
    }
  }

  const shown = entries
    .filter((e) => (filter === 'all' ? true : (e.source ?? 'folo') === filter))
    .slice(0, 80);

  return (
    <div className="stack">
      <section className="card">
        <div className="card-head">
          <h2 className="card-title">Folo 连接</h2>
          {loading ? (
            <span className="pill none">检查中…</span>
          ) : status?.authed ? (
            <span className="pill ok">已登录</span>
          ) : status?.installed ? (
            <span className="pill warn">未登录</span>
          ) : (
            <span className="pill bad">未安装</span>
          )}
        </div>

        {!status && loading && <div className="empty">正在检查本机 folo 命令…</div>}

        {status && !status.installed && (
          <>
            <div className="hero-note">
              没找到 <code className="mono">{status.bin}</code>。先装 CLI：
            </div>
            <div className="cmd">{`npm i -g folocli
folo login`}</div>
            <p className="tiny faint" style={{ marginBottom: 0 }}>
              也可以把 <code className="mono">WB_FOLO_BIN</code> 指向仓库外的 folo 路径，不把 AGPL
              依赖装进工作台。
            </p>
            <div style={{ marginTop: 10 }}>
              <button className="btn sm" type="button" onClick={() => load(true)} disabled={loading || busy !== ''}>
                已安装？重新检查
              </button>
            </div>
          </>
        )}

        {status && status.installed && !status.authed && (
          <>
            <div className="hero-note">
              CLI 已装{status.version ? `（${status.version}）` : ''}，但还没登录。在终端跑一次：
            </div>
            <div className="cmd">{`folo login`}</div>
            <p className="tiny faint" style={{ marginBottom: 0 }}>
              登录态由 Folo CLI 自己保存，工作台不碰 token。
            </p>
            <div style={{ marginTop: 10 }}>
              <button className="btn sm" type="button" onClick={() => load(true)} disabled={loading || busy !== ''}>
                已登录？重新检查
              </button>
            </div>
          </>
        )}

        {status && status.authed && (
          <>
            <div className="radar-controls">
              <label className="tiny muted">
                拉取条数{' '}
                <select
                  className="select"
                  style={{ width: 78, display: 'inline-block', marginLeft: 6 }}
                  value={limit}
                  onChange={(e) => setLimit(Number(e.target.value))}
                >
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </label>
              <label className="tiny muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="checkbox"
                  checked={includeSeen}
                  onChange={(e) => setIncludeSeen(e.target.checked)}
                />
                包含已拉过的
              </label>
              <button
                className="btn primary"
                type="button"
                onClick={() => pull('folo')}
                disabled={busy !== ''}
              >
                {busy === 'folo' ? '拉取中…' : '拉取线索'}
              </button>
              <button
                className="btn sm"
                type="button"
                onClick={() => load(true)}
                disabled={loading || busy !== ''}
              >
                重新检查
              </button>
            </div>
            <p className="tiny faint" style={{ marginTop: 10, marginBottom: 0 }}>
              {status.user ? `${status.user} · ` : ''}
              只读时间线/订阅源；不自动标已读。拉取 + 翻译约 1–2 分钟（首次；之后走缓存）。默认只显示本地没见过的新条目。
            </p>
          </>
        )}

        {status?.error && status.installed && !status.authed && (
          <p className="tiny faint" style={{ marginTop: 10, marginBottom: 0 }}>
            CLI 返回：{status.error}
          </p>
        )}

        {error && <div className="hero-note" style={{ marginTop: 12 }}>{error}</div>}
        {msg && <div className="hero-note ok" style={{ marginTop: 12 }}>{msg}</div>}
      </section>

      <section className="card">
        <div className="card-head">
          <h2 className="card-title">RSS 资料源</h2>
          {rssStatus.configured ? (
            <span className="pill ok">
              {rssStatus.enabledCount}/{rssStatus.total} 个启用
            </span>
          ) : (
            <span className="pill none">未配置</span>
          )}
        </div>
        {rssStatus.configured ? (
          <>
            <div className="radar-controls">
              <button
                className="btn primary"
                type="button"
                onClick={() => pull('rss')}
                disabled={busy !== '' || !rssStatus.enabledCount}
              >
                {busy === 'rss' ? '拉取中…' : '拉 RSS 线索'}
              </button>
              <span className="tiny faint">
                逐个抓启用的 feed，去重后入库；单 feed 上限 30 条。
              </span>
            </div>
            <ul style={{ margin: '10px 0 0', paddingLeft: 18, fontSize: 12.5, lineHeight: 1.9, color: 'var(--ink-2)' }}>
              {rssStatus.feeds.map((f) => (
                <li key={f.id}>
                  <span className={f.enabled ? '' : 'faint'} style={{ opacity: f.enabled ? 1 : 0.55 }}>
                    {f.name}
                  </span>
                  {!f.enabled && (
                    <span className="tiny faint"> · 未启用{f.note ? `（${f.note}）` : ''}</span>
                  )}
                </li>
              ))}
            </ul>
            <p className="tiny faint" style={{ marginTop: 8, marginBottom: 0 }}>
              feed 清单在 <code className="mono">rss-feeds.json</code>，手编即生效。标「需
              RSSHub」的源要先起 docker（脚本在 04-参考/信息源）。
            </p>
          </>
        ) : (
          <div className="empty">rss-feeds.json 里没有可用 feed；加一条再回来。</div>
        )}
      </section>

      {imported?.id && (
        <div className="hero-note ok">
          已抓成素材（二手资料）·{' '}
          <Link href={`/intake#${imported.id}`} style={{ textDecoration: 'underline' }}>
            去素材池补充判断 →
          </Link>
          <div className="tiny" style={{ marginTop: 4 }}>
            可以补你自己的截图和一句话判断；公开来源即可立项，补充是加分项。
          </div>
        </div>
      )}

      <section className="card">
        <div className="card-head">
          <h2 className="card-title">最近拉到的线索</h2>
          <span className="card-sub">
            {entries.length} 条
            {radar.pulledAt ? ` · Folo 最近 ${formatCst(radar.pulledAt)}` : ''}
          </span>
        </div>

        <div className="radar-controls" style={{ marginBottom: 10 }}>
          {(
            [
              ['all', `全部 ${entries.length}`],
              ['folo', `Folo ${entries.filter((e) => (e.source ?? 'folo') === 'folo').length}`],
              ['rss', `RSS ${entries.filter((e) => e.source === 'rss').length}`],
            ] as Array<[SourceFilter, string]>
          ).map(([key, label]) => (
            <button
              key={key}
              className={`btn sm${filter === key ? ' primary' : ''}`}
              type="button"
              onClick={() => setFilter(key)}
            >
              {label}
            </button>
          ))}
        </div>

        {shown.length === 0 ? (
          <div className="empty">
            {entries.length
              ? '这个源还没有线索，换一个筛选或先拉取。'
              : '还没有拉过。登录 Folo 或点「拉 RSS 线索」；这里只放候选，抓成素材即可进研究。'}
          </div>
        ) : (
          <div className="radar-list">
            {shown.map((entry) => (
              <article className="radar-item" key={entry.id}>
                <div className="radar-meta">
                  <span className="pill none">{entry.feed || '未知来源'}</span>
                  <span className="pill none">{entry.source === 'rss' ? 'RSS' : 'Folo'}</span>
                  <span className="tiny faint mono">{formatCst(entry.publishedAt)}</span>
                </div>
                <h3 className="radar-title">
                  {entry.url ? (
                    <a href={entry.url} target="_blank" rel="noreferrer">
                      {entry.titleZh || entry.title}
                    </a>
                  ) : (
                    entry.titleZh || entry.title
                  )}
                </h3>
                {entry.titleZh && entry.titleZh !== entry.title && (
                  <p className="tiny faint" style={{ margin: '4px 0 0' }}>
                    原文：{entry.title}
                  </p>
                )}
                {(entry.descriptionZh || entry.description) && (
                  <p className="radar-desc">{entry.descriptionZh || entry.description}</p>
                )}
                <div className="radar-actions">
                  <button
                    className="btn sm primary"
                    type="button"
                    onClick={() => importEntry(entry)}
                    disabled={!!importingId}
                    title="抓原文 + 页面截图，标为二手；一手材料仍要你补"
                  >
                    {importingId === entry.id ? '抓取中…' : '抓成素材'}
                  </button>
                  <Link className="btn sm" href={intakeHref(entry)}>
                    投素材 →
                  </Link>
                  {entry.url && (
                    <a className="tiny faint" href={entry.url} target="_blank" rel="noreferrer">
                      原文 ↗
                    </a>
                  )}
                  {imported?.sourceId === entry.id && (
                    <Link className="tiny" href={`/intake#${imported.id}`} style={{ color: 'var(--accent-strong)' }}>
                      已进素材池 · 去补充判断 →
                    </Link>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}

        {entries.length > shown.length && (
          <p className="tiny faint" style={{ marginBottom: 0 }}>
            只显示最近 {shown.length} 条；Folo 全量在 <code className="mono">data/folo-radar.json</code>
            ，RSS 在 <code className="mono">data/rss-radar.json</code>。
          </p>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <h2 className="card-title">边界</h2>
          <span className="card-sub">线索 ≠ 选题</span>
        </div>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, lineHeight: 1.9, color: 'var(--ink-2)' }}>
          <li>只拉 Folo 时间线/订阅源与 RSS feed 的最新条目，不自动标已读、不自动入库。</li>
          <li>标题/摘要默认用本机 kimi/minimax 翻成中文；产品名、仓库名、数字、URL 保留原文，原文标题仍显示。</li>
          <li>「抓成素材」只抓原文和页面首屏截图，标成二手；「我真跑过」的截图/判断仍要你补。</li>
          <li>每条都要过「一手材料」门：没有你自己的截图/账单/报错，就还是线索。</li>
          <li>默认只显示新条目；去重状态在 <code className="mono">data/folo-state.json</code> 与 <code className="mono">data/rss-state.json</code>，不会无限长。</li>
        </ul>
      </section>
    </div>
  );
}

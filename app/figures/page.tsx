import { scanFigures } from '@/lib/images';

export const dynamic = 'force-dynamic';

const asset = (rel: string) => `/api/asset?p=${encodeURIComponent(rel)}`;

export default function FiguresPage() {
  const groups = scanFigures();
  const total = groups.reduce((n, g) => n + g.images.length, 0);
  const coverGroup = groups.find((g) => g.dir.includes('V3')) ?? groups[0];
  const cover = coverGroup?.images.find((i) => /cover/i.test(i.file) && /wide/i.test(i.file)) ??
    coverGroup?.images.find((i) => /cover/i.test(i.file));

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <div className="eyebrow">配图 · 封面 · 裁切</div>
          <h1 className="page-title">配图与封面工坊</h1>
          <p className="page-sub">
            {groups.length} 套图 · {total} 张。缩略图直接读 01-内容库，原图可点开。
          </p>
        </div>
        <span className="pill ok">V3 已上线</span>
      </header>

      {cover && (
        <section className="card">
          <div className="card-head">
            <h2 className="card-title">封面双裁切预览 <span className="idx">2.35:1 / 1:1</span></h2>
            <a className="card-sub" href={asset(cover.rel)} target="_blank" rel="noreferrer">打开原图 ↗</a>
          </div>
          <div className="crop-row">
            <div className="crop-col">
              <div
                className="crop wide"
                style={{ backgroundImage: `url(${asset(cover.rel)})` }}
                title="列表页 2.35:1"
              />
              <div className="crop-label">列表页 2.35:1</div>
            </div>
            <div className="crop-col">
              <div
                className="crop square"
                style={{ backgroundImage: `url(${asset(cover.rel)})` }}
                title="分享卡 1:1"
              />
              <div className="crop-label">分享卡 1:1</div>
            </div>
            <div className="crop-meta">
              <dl className="kv">
                <dt>文件</dt><dd className="mono tiny">{cover.rel}</dd>
                <dt>尺寸</dt><dd className="mono">{cover.width ?? '—'} × {cover.height ?? '—'}</dd>
                <dt>体积</dt><dd className="mono">{Math.round(cover.bytes / 1024)} KB</dd>
                <dt>判定</dt><dd><span className="pill ok">双裁切不丢字</span></dd>
              </dl>
            </div>
          </div>
        </section>
      )}

      {groups.map((g) => (
        <section key={g.dir} className="card section-gap">
          <div className="card-head">
            <h2 className="card-title">{g.dir} <span className="idx">{g.images.length} 张</span></h2>
            <span className="card-sub">{g.dir.includes('V3') ? '当前版本 · HTML 源可改' : '历史版本 · 文件保留'}</span>
          </div>
          <div className="gallery">
            {g.images.map((img) => (
              <figure key={img.file} className="fig-card">
                <a href={asset(img.rel)} target="_blank" rel="noreferrer" className="thumb">
                  <img src={asset(img.rel)} alt={img.file} loading="lazy" />
                </a>
                <figcaption>
                  <div className="fig-name">{img.file}</div>
                  <div className="tiny faint mono">
                    {img.width ?? '—'}×{img.height ?? '—'} · {Math.round(img.bytes / 1024)}KB
                  </div>
                </figcaption>
              </figure>
            ))}
          </div>
        </section>
      ))}

      {!groups.length && <div className="card"><div className="empty">稿件/素材 下还没有配图目录。</div></div>}

      <p className="tiny faint" style={{ marginTop: 14 }}>
        V3 源文件在 <span className="mono">03-生产工具/figures/a1-v3/</span>：改 HTML → 跑{' '}
        <span className="mono">node render.mjs</span> → 自动输出到 稿件/素材/A1配图V3。
      </p>
    </div>
  );
}

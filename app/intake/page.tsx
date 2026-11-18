import Link from 'next/link';
import IntakeForm from '@/components/IntakeForm';
import IntakePatchForm from '@/components/IntakePatchForm';
import PasscodeGate from '@/components/PasscodeGate';
import { listIntake } from '@/lib/intake';

export const dynamic = 'force-dynamic';

export default async function IntakePage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; title?: string; url?: string; feed?: string }>;
}) {
  const sp = await searchParams;
  const entries = listIntake(20);
  const fromClue = sp.from === 'folo' || sp.from === 'rss';
  const clueLabel = sp.from === 'rss' ? 'RSS' : 'Folo';
  const initialText = fromClue
    ? [
        `【${clueLabel} 线索】${(sp.title ?? '').trim() || '(无标题)'}`,
        sp.url ? `链接：${sp.url}` : '',
        sp.feed ? `来源：${sp.feed}` : '',
        '',
        '我为什么想写（补一句，别只贴链接）：',
        '',
        '我的实跑/截图（可选，贴在下面）：',
      ].join('\n')
    : '';

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <div className="eyebrow">素材 · 公开来源 / 实跑 / 判断</div>
          <h1 className="page-title">投素材</h1>
          <p className="page-sub">
            公开资料、你的实跑记录、一句判断，都可以投。按 2026-11-14 规则，公开来源即可立项；
            一手材料是加分项，不是门槛。
          </p>
        </div>
        <span className="pill ok">本机 / 局域网</span>
      </header>

      <PasscodeGate />
      {!fromClue && (
        <div className="hero-note">
          不想自己找素材？去 <Link href="/radar" style={{ textDecoration: 'underline' }}>雷达</Link>{' '}
          点「抓成素材」——系统抓原文 + 页面截图，标成公开来源，可直接进研究。
        </div>
      )}
      {fromClue && (
        <div className="hero-note">
          从 {clueLabel} 线索投素材：标题/链接已预填。可补一句「我为什么想写」；公开来源即可立项，
          你的实跑/判断是加分项。
        </div>
      )}
      <IntakeForm key={initialText} initialText={initialText} />

      <section className="card">
        <div className="card-head">
          <h2 className="card-title">最近投的</h2>
          <span className="card-sub">共 {entries.length} 条 · 存在 09-编辑部/素材池</span>
        </div>

        {entries.length === 0 && (
          <div className="empty">还没有素材。今天遇到的坑、账单、报错、对话，随手丢进来。</div>
        )}

        {entries.map((e) => {
          const isClue = e.source === 'folo' || e.source === 'rss';
          return (
          <div key={e.id} id={e.id} style={{ padding: '14px 0', borderBottom: '1px dashed var(--line)' }}>
            <div className="tiny faint mono">
              {new Date(e.at).toLocaleString('zh-CN', { hour12: false })} · {e.id}
              {e.source === 'rss' ? ' · RSS' : e.source === 'folo' ? ' · Folo' : ''}
            </div>
            {(isClue || e.firstHand === false) && (
              <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                {isClue && <span className="pill warn">公开来源</span>}
                {e.firstHand === false && <span className="pill none">可补实跑</span>}
                {e.firstHand === true && <span className="pill ok">已补实跑</span>}
              </div>
            )}
            {isClue && (e.links?.length || e.sourceUrl) && (
              <>
                <div className="intake-links">
                  {(e.links?.length
                    ? e.links
                    : [{ url: e.sourceUrl ?? '', label: '原文' }]
                  ).map((link, index) => (
                    <a
                      key={link.url}
                      className={`btn sm${index === 0 ? ' primary' : ''}`}
                      href={link.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {index === 0
                        ? /^https?:\/\/(www\.)?(x|twitter)\.com/i.test(link.url)
                          ? '打开推文去截图'
                          : '打开原文去截图'
                        : link.label}
                      {' ↗'}
                    </a>
                  ))}
                </div>
                <p className="tiny faint" style={{ margin: '6px 0 0' }}>
                  想补实跑的话，截完图回到下面「补充」上传；X 需要你已登录的浏览器才能截。
                </p>
              </>
            )}
            {isClue && (
              <IntakePatchForm id={e.id} firstHand={Boolean(e.firstHand)} />
            )}
            {isClue && e.files.length > 0 && (
              <div style={{ marginTop: 10 }}>
                {e.files.map((f) => {
                  const src = '/api/intake?d=' + encodeURIComponent(e.id) + '&f=' + encodeURIComponent(f.name);
                  return (
                    <a key={f.name} href={src} target="_blank" rel="noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img className="intake-thumb" src={src} alt={f.name} />
                    </a>
                  );
                })}
                <div className="tiny faint" style={{ marginTop: 6 }}>
                  系统抓的页面首屏 · 公开资料，不是「真跑过」证据
                </div>
              </div>
            )}
            <p className="md-p" style={{ whiteSpace: 'pre-wrap', marginTop: 6 }}>{e.text}</p>
            {e.files.length > 0 && !isClue && (
              <div className="gallery" style={{ marginTop: 10 }}>
                {e.files.map((f) => {
                  const src = '/api/intake?d=' + encodeURIComponent(e.id) + '&f=' + encodeURIComponent(f.name);
                  return (
                    <a key={f.name} href={src} target="_blank" rel="noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={src}
                        alt={f.name}
                        style={{ width: '100%', borderRadius: 10, border: '1px solid var(--line)', display: 'block' }}
                      />
                    </a>
                  );
                })}
              </div>
            )}
          </div>
          );
        })}
      </section>
    </div>
  );
}

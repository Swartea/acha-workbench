import RadarConsole from '@/components/RadarConsole';
import PasscodeGate from '@/components/PasscodeGate';
import { readFoloRadar } from '@/lib/folo';
import { readRadarAll } from '@/lib/radar';
import { getRssStatus } from '@/lib/rss';

export const dynamic = 'force-dynamic';

export default function RadarPage() {
  const radar = readFoloRadar();

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <div className="eyebrow">雷达 · 外部线索</div>
          <h1 className="page-title">资料源雷达</h1>
          <p className="page-sub">
            Folo 订阅流 + RSS feed（Hacker News / arXiv，更多在 rss-feeds.json）拉成候选；点「抓成素材」自动抓原文 +
            页面截图。它只解决“料从哪来”，不是选题——一手材料仍要你补。
          </p>
        </div>
        <span className="pill none">只读 · 不标已读</span>
      </header>

      <PasscodeGate />
      <RadarConsole
        initialRadar={radar}
        initialEntries={readRadarAll()}
        initialRssStatus={getRssStatus()}
      />

      <section className="card section-gap">
        <div className="card-head">
          <h2 className="card-title">这条链路怎么走</h2>
          <span className="card-sub">对应流程图 02 之前</span>
        </div>
        <div className="cmd">{`Folo 时间线 / RSS feed
  → /radar 拉取（只读，JSON，多源合并）
  → 点「抓成素材」预填 /intake
  → /autopilot 自主选题研究写稿`}</div>
        <p className="tiny faint" style={{ marginBottom: 0 }}>
          拉取会写 <code className="mono">01-内容库/雷达日志 - Folo|RSS - YYYY-MM-DD.md</code>，
          首页的雷达计数会跟着变；不会改选题库。
        </p>
      </section>
    </div>
  );
}

import AutopilotConsole from '@/components/AutopilotConsole';
import PasscodeGate from '@/components/PasscodeGate';
import { listAutopilotRuns } from '@/lib/db';
import { latestAutopilotDetail } from '@/lib/editorial/autopilot';

export const dynamic = 'force-dynamic';

export default function AutopilotPage() {
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <div className="eyebrow">自主写稿 · AI 闭环</div>
          <h1 className="page-title">自主写稿</h1>
          <p className="page-sub">
            选题 → 研究 → 判断 → 写稿 → 检查 → 返工 → 封面 → 待发布稿。全程不用你参与，发表仍由你手点。
          </p>
        </div>
        <span className="pill ok">AI 闭环 · 不自动发表</span>
      </header>
      <PasscodeGate />
      <AutopilotConsole initialRuns={listAutopilotRuns(10)} initialDetail={latestAutopilotDetail()} />
    </div>
  );
}

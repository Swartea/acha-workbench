import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import ScanButton from '@/components/ScanButton';
import { COMPLIANCE } from '@/lib/constants';
import { getChecklist } from '@/lib/db';
import { PUSH_DIR } from '@/lib/paths';
import { envStatus } from '@/lib/publish';
import { scanWorkspace } from '@/lib/workspace';
import path from 'node:path';

export const dynamic = 'force-dynamic';

const LAUNCHD_LABEL = 'com.acha.workbench';

function autostartStatus(): { installed: boolean; loaded: boolean; plist: string } {
  const plist = path.join(os.homedir(), 'Library', 'LaunchAgents', `${LAUNCHD_LABEL}.plist`);
  const installed = fs.existsSync(plist);
  let loaded = false;
  if (installed) {
    try {
      execFileSync('launchctl', ['print', `gui/${process.getuid?.() ?? 501}/${LAUNCHD_LABEL}`], {
        stdio: 'ignore',
        timeout: 3000,
      });
      loaded = true;
    } catch {
      loaded = false;
    }
  }
  return { installed, loaded, plist };
}

function lanAddress(): string {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return '127.0.0.1';
}

export default function SettingsPage() {
  const env = envStatus();
  const s = scanWorkspace();
  const checklist = getChecklist();
  const envOk = env.exists && env.ok && env.mode === '600';
  const auto = autostartStatus();

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <div className="eyebrow">系统 · 凭据 / 网络 / 数据</div>
          <h1 className="page-title">设置</h1>
          <p className="page-sub">凭据只显示状态，不显示明文；工作台不存储、不传输 AppSecret。</p>
        </div>
        <span className={`pill ${envOk ? 'ok' : 'warn'}`}>{envOk ? '凭据就绪' : '凭据未就绪'}</span>
      </header>

      <div className="grid2even">
        <section className="card">
          <div className="card-head">
            <h2 className="card-title">凭据状态</h2>
            <span className={`pill ${envOk ? 'ok' : env.exists ? 'warn' : 'bad'}`}>
              {envOk ? '就绪' : env.exists ? '待补' : '不存在'}
            </span>
          </div>
          <dl className="kv">
            <dt>路径</dt><dd className="mono small">{path.join('02-发布工具/wechat-draft', '.env')}</dd>
            <dt>存在</dt><dd>{env.exists ? '是' : '否'}</dd>
            <dt>权限</dt><dd className="mono">{env.mode || '—'}</dd>
            <dt>APP_ID</dt><dd>{env.hasId ? '已填' : '未填'}</dd>
            <dt>APP_SECRET</dt><dd>{env.hasSecret ? '已填' : '未填'}</dd>
            <dt>账号三件</dt><dd>{checklist.filter((c) => c.done).length}/3 已勾</dd>
          </dl>
          <div className="hr" />
          <div className="tiny faint" style={{ marginBottom: 6 }}>一次性配置</div>
          <div className="cmd">cd &quot;{PUSH_DIR}&quot;
cp .env.example .env
chmod 600 .env
# 编辑 .env：WECHAT_APP_ID / WECHAT_APP_SECRET</div>
          <p className="tiny faint" style={{ marginBottom: 0 }}>
            公网 IP 不进仓库；.env 已在 .gitignore 中。给工作台读到的权限是 600。
          </p>
        </section>

        <section className="card">
          <div className="card-head">
            <h2 className="card-title">访问与网络</h2>
            <span className="card-sub">本机 + 局域网</span>
          </div>
          <dl className="kv">
            <dt>本机</dt><dd className="mono">http://127.0.0.1:8787</dd>
            <dt>局域网</dt><dd className="mono">http://{lanAddress()}:8787</dd>
            <dt>端口</dt><dd className="mono">8787</dd>
            <dt>自启</dt>
            <dd>
              {auto.loaded ? (
                <span className="pill ok">launchd 已接管</span>
              ) : auto.installed ? (
                <span className="pill warn">plist 已装 · 未加载</span>
              ) : (
                <span className="pill bad">未安装</span>
              )}
              <span className="mono tiny faint"> {LAUNCHD_LABEL}</span>
            </dd>
          </dl>
          {!auto.loaded && (
            <p className="tiny faint" style={{ marginTop: 6, marginBottom: 0 }}>
              {auto.installed
                ? 'plist 已就位但 launchd 没接管（当前是会话进程）。在普通 Terminal 跑一次：launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.acha.workbench.plist'
                : '还没有开机自启。需要的话我可以生成 plist 并给你一条安装命令。'}
            </p>
          )}
          <div className="hr" />
          <div className="tiny faint" style={{ marginBottom: 6 }}>服务命令</div>
          <div className="cmd">cd &quot;{path.resolve(process.cwd())}&quot;
npm run build && npm run start</div>
          <p className="tiny faint" style={{ marginBottom: 0 }}>
            局域网内任何设备可直接打开；请勿在公共网络暴露。手机端已按 860px 断点适配。
          </p>
        </section>
      </div>

      <section className="card section-gap">
        <div className="card-head">
          <h2 className="card-title">数据与索引 <span className="idx">{s.stats.topicCount} 选题 · {s.stats.packageCount} 包 · {s.stats.manuscriptCount} 稿件</span></h2>
          <ScanButton />
        </div>
        <dl className="kv">
          <dt>内容源</dt><dd className="mono small">01-内容库（只读索引，不写内容）</dd>
          <dt>状态库</dt><dd className="mono small">06-工作台/data/workbench.db（SQLite）</dd>
          <dt>扫描时间</dt><dd className="mono small">{new Date(s.scannedAt).toLocaleString('zh-CN', { hour12: false })}</dd>
          <dt>雷达 / 周报</dt><dd>{s.stats.radarCount} / {s.stats.weeklyCount}</dd>
          <dt>Skill 储备</dt><dd>{s.stats.skillCount ?? '—'}</dd>
        </dl>
        <p className="tiny faint" style={{ marginBottom: 0, marginTop: 10 }}>
          内容文件仍是唯一源（Obsidian + GitHub 远端不断链）；状态库只存勾选、机器轮次、发布留档。
          写完文件后点「刷新索引」即可。
        </p>
      </section>

      <section className="card section-gap">
        <div className="card-head">
          <h2 className="card-title">合规边界</h2>
          <span className="card-sub">硬红线，不做开关</span>
        </div>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, lineHeight: 1.9, color: 'var(--ink-2)' }}>
          {COMPLIANCE.map((c) => <li key={c}>{c}</li>)}
        </ul>
      </section>

    </div>
  );
}

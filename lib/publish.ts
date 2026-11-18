import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, PREVIEW_DIR, PREFLIGHT_SCRIPT, PUSH_DIR, TOOLS, WS_ROOT } from './paths';
import { isUnder } from './guard';

export interface EnvStatus {
  exists: boolean;
  mode: string;
  hasId: boolean;
  hasSecret: boolean;
  ok: boolean;
  path: string;
}

export function envStatus(): EnvStatus {
  const p = path.join(PUSH_DIR, '.env');
  const base: EnvStatus = {
    exists: false,
    mode: '',
    hasId: false,
    hasSecret: false,
    ok: false,
    path: p,
  };
  if (!fs.existsSync(p)) return base;
  const st = fs.statSync(p);
  const mode = (st.mode & 0o777).toString(8);
  const txt = fs.readFileSync(p, 'utf8');
  const read = (key: string) => {
    const m = txt.match(new RegExp(`^\\s*${key}\\s*=\\s*(\\S+)`, 'm'));
    const v = m?.[1]?.trim() ?? '';
    // 模板占位值不算已填
    if (!v || v === 'wx_your_app_id' || v === 'your_app_secret') return '';
    return v;
  };
  const hasId = !!read('WECHAT_APP_ID');
  const hasSecret = !!read('WECHAT_APP_SECRET');
  return { ...base, exists: true, mode, hasId, hasSecret, ok: hasId && hasSecret };
}

function runNode(args: string[], cwd: string) {
  const r = spawnSync(process.execPath, args, {
    cwd,
    encoding: 'utf8',
    timeout: 180_000,
    env: process.env,
  });
  const output = [r.stdout, r.stderr].filter(Boolean).join('\n').trim();
  return {
    ok: r.status === 0,
    status: r.status,
    output: output.slice(-9000) || `（无输出，退出码 ${r.status}）`,
  };
}

export function latestDryRunHtml(): string | null {
  const tmp = path.join(PUSH_DIR, '.tmp');
  if (!fs.existsSync(tmp)) return null;
  const dirs = fs
    .readdirSync(tmp, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const p = path.join(tmp, d.name);
      return { p, t: fs.statSync(p).mtimeMs };
    })
    .sort((a, b) => b.t - a.t);
  for (const d of dirs) {
    const h = path.join(d.p, 'preview.html');
    if (fs.existsSync(h)) return h;
  }
  return null;
}

export const PREVIEW_OUT = path.join(PREVIEW_DIR, 'latest.html');

export function runStep(step: string, md: string) {
  if (!isUnder(WS_ROOT, md)) {
    return { ok: false, status: 1, output: '稿件路径不在工作区内，已拒绝。' };
  }
  if (!fs.existsSync(md)) {
    return { ok: false, status: 1, output: `稿件不存在：${md}` };
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });

  switch (step) {
    case 'dryrun':
      return runNode(
        ['draft.mjs', '-f', md, '--body-only', '--author', '阿茶 AI 实验室', '--dry-run'],
        PUSH_DIR,
      );
    case 'preflight': {
      const html = latestDryRunHtml();
      const args = [
        PREFLIGHT_SCRIPT,
        '--md',
        md,
      ];
      if (html) args.push('--html', html);
      return runNode(args, PUSH_DIR);
    }
    case 'preview': {
      const html = latestDryRunHtml();
      if (!html) {
        return { ok: false, status: 1, output: '没有找到干跑产物，请先执行「干跑」。' };
      }
      fs.mkdirSync(PREVIEW_DIR, { recursive: true });
      const r = runNode(
        [
          path.join(TOOLS, 'preview', 'make_wechat_preview.mjs'),
          '--html',
          html,
          '--out',
          PREVIEW_OUT,
          '--md',
          md,
        ],
        PUSH_DIR,
      );
      return { ...r, detail: { out: PREVIEW_OUT } };
    }
    case 'push':
      return runNode(
        ['draft.mjs', '-f', md, '--body-only', '--author', '阿茶 AI 实验室'],
        PUSH_DIR,
      );
    default:
      return { ok: false, status: 1, output: `未知步骤：${step}` };
  }
}

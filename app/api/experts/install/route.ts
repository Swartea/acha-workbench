import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { isLoopbackRequest, loopbackDenied } from '@/lib/loopback';
import { apiKeyEnvName, modelAvailable, runInstall, type ModelKey } from '@/lib/experts/runtime';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * 模型一键安装 / 体检。
 *
 * 命令表全部字面量（安全扫描口径：无变量拼接进 spawn 参数）。
 * 四个模型里只有 glm / deepseek 可能需要装二进制（claude 载体，npm 可装）；
 * kimi 是官方原生安装脚本、minimax 由 agent-orchestrator-runtime 管理，
 * 缺二进制时只给指引不代跑。
 */
const INSTALL_COMMANDS: Partial<Record<ModelKey, { cmd: string; args: string[] }>> = {
  glm: { cmd: 'npm', args: ['install', '-g', '@anthropic-ai/claude-code'] },
  deepseek: { cmd: 'npm', args: ['install', '-g', '@anthropic-ai/claude-code'] },
};

const MANUAL_HINT: Record<ModelKey, string> = {
  glm: 'GLM 复用 claude CLI + 智谱 Anthropic 兼容端点；二进制缺失时用 npm install -g @anthropic-ai/claude-code 安装。',
  kimi: 'kimi 是官方原生二进制（~/.kimi-code/bin），按 Kimi CLI 官方安装脚本装；装完无需重启即可被探测到。',
  minimax: 'mcode 由 agent-orchestrator-runtime 管理（~/.local/share/agent-orchestrator-runtime），随本机环境安装。',
  deepseek: 'DeepSeek 复用 claude CLI + DeepSeek Anthropic 兼容端点；二进制缺失时用 npm install -g @anthropic-ai/claude-code 安装。',
};

function keyEnvOf(model: ModelKey): string | null {
  return apiKeyEnvName(model);
}

async function POST(req: Request) {
  const denied = requireAuth(req);
  if (denied) return denied;
  if (!isLoopbackRequest(req)) return loopbackDenied();

  const body = (await req.json().catch(() => ({}))) as { model?: string };
  const model = body.model;
  if (model !== 'glm' && model !== 'kimi' && model !== 'minimax' && model !== 'deepseek') {
    return NextResponse.json({ ok: false, error: 'model 不合法' }, { status: 400 });
  }

  const keyEnv = keyEnvOf(model);
  const keyOk = keyEnv ? Boolean((process.env[keyEnv] ?? '').trim()) : true;
  const binOk = modelAvailable(model);

  if (binOk) {
    return NextResponse.json({
      ok: true,
      already: true,
      binOk,
      keyOk,
      keyEnv,
      hint: keyOk
        ? '二进制与 Key 都就绪，可以直接跑任务。'
        : `二进制已就绪，但缺 ${keyEnv}：把 Key 写进 06-工作台/.env.local 后重启工作台。`,
    });
  }

  const spec = INSTALL_COMMANDS[model];
  if (!spec) {
    return NextResponse.json({
      ok: false,
      binOk,
      keyOk,
      keyEnv,
      hint: MANUAL_HINT[model],
    });
  }

  const result = await runInstall(spec.cmd, spec.args);
  const binOkAfter = modelAvailable(model);
  return NextResponse.json({
    ok: binOkAfter,
    already: false,
    binOk: binOkAfter,
    keyOk,
    keyEnv,
    output: result.output,
    hint: binOkAfter
      ? '安装完成，模型通道已可用。'
      : `安装命令没有成功（exit / 超时），手动跑：${spec.cmd} ${spec.args.join(' ')}`,
  });
}

export { POST };

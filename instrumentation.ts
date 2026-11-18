/**
 * Next.js 服务端启动钩子：Hermes 管家的后台守护轮询。
 *
 * 没有它，代批（approval choice=session）与僵死收口只在有人打开
 * /hermes 页或派新活时才发生——派活人关掉页面后，管家会卡在
 * waiting_for_approval 直到 900s 审批窗口超时停摆。这里以 60s
 * 周期调用 healStaleRuns（lib/hermes.ts 既有逻辑：待审批代批、
 * Gateway 重启丢 run 自动续跑一次、超时收口），不引入新架构。
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const g = globalThis as { __hermesPoller?: NodeJS.Timeout };
  if (g.__hermesPoller) return; // dev 热重载防重复注册
  const { healStaleRuns } = await import('./lib/hermes');
  g.__hermesPoller = setInterval(() => {
    healStaleRuns().catch(() => {
      /* 单轮失败不影响服务，下一轮重试 */
    });
  }, 60_000);
}

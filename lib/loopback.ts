import { isLoopbackHost } from './auth';

export { isLoopbackHost };

/**
 * 本机回环判定：仅信任 Host 为 127.0.0.1 / localhost / [::1] 的请求。
 * 用于保护会触发模型调用或草稿操作的接口——即使服务绑到 0.0.0.0，
 * 局域网直连（Host 为局域网 IP）也会被拒。
 */
export function isLoopbackRequest(req: Request): boolean {
  return isLoopbackHost(req.headers.get('host'));
}

export function loopbackDenied(): Response {
  return Response.json(
    { ok: false, error: '该接口仅限本机（127.0.0.1）调用。' },
    { status: 403 },
  );
}

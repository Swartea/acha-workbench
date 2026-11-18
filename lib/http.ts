/**
 * 共享 HTTP 抓取（从 editorial/research.ts 搬出）：fetchText / fetchJson。
 * 只做公开资料抓取；超时 20s，UA 标明工作台身份。
 */

const UA = 'acha-ai-lab-workbench/0.1 (+https://github.com/Swartea/acha-ai-lab-workbench)';

export async function fetchText(url: string, max = 30000): Promise<string> {
  const res = await fetch(url, {
    headers: { 'user-agent': UA },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  return text.length > max ? text.slice(0, max) : text;
}

export async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: {
      accept: 'application/vnd.github+json, application/json',
      'user-agent': UA,
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

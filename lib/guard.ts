import path from 'node:path';

/**
 * 统一路径守卫。
 *
 * 规则：path.resolve 之后，target 必须等于 root，或以 root + path.sep 开头。
 * 禁止只用 startsWith(root) 的前缀判断——那会让同级同前缀目录
 * （如 root=/x/稿件、target=/x/稿件X/a.png）被误判为在 root 内。
 */

/** root 的绝对路径（去掉尾部分隔符，'/' 保持为 '/'）。 */
function rootAbs(root: string): string {
  return path.resolve(root);
}

/** root 下的路径前缀：root 本身或 root + sep 开头的路径都算在 root 内。 */
function underPrefix(root: string): string {
  const abs = rootAbs(root);
  return abs.endsWith(path.sep) ? abs : abs + path.sep;
}

/**
 * target 是否落在 root 内。
 * root 与 target 都按 path.resolve 归一，target 视为绝对/相对 cwd 的路径。
 */
export function isUnder(root: string, target: string): boolean {
  const abs = path.resolve(target);
  if (abs === rootAbs(root)) return true;
  return abs.startsWith(underPrefix(root));
}

/**
 * 把 segs 拼到 root 下并返回绝对路径；越界则抛 Error('路径越界')。
 */
export function assertUnder(root: string, ...segs: string[]): string {
  const abs = path.resolve(rootAbs(root), ...segs);
  if (!isUnder(root, abs)) throw new Error('路径越界');
  return abs;
}

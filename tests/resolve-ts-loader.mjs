import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '..');

export async function resolve(specifier, context, nextResolve) {
  // Next.js 的 @/ 别名：测试里也要能解析，否则 lib 之间互相 import 会断。
  if (specifier.startsWith('@/')) {
    const target = path.join(ROOT, specifier.slice(2));
    for (const candidate of [target + '.ts', target + '.tsx', path.join(target, 'index.ts')]) {
      try {
        return await nextResolve(pathToFileURL(candidate).href, context);
      } catch {
        /* 试下一个 */
      }
    }
    return nextResolve(pathToFileURL(target).href, context);
  }
  const bareRelative = (specifier.startsWith('./') || specifier.startsWith('../'))
    && !/\.[cm]?[jt]sx?$|\.mjs$|\.json$/i.test(specifier);
  if (bareRelative) {
    try {
      return await nextResolve(specifier + '.ts', context);
    } catch {
      return nextResolve(specifier, context);
    }
  }
  return nextResolve(specifier, context);
}

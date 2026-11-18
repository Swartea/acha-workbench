/**
 * db 门面（原 1083 行上帝文件已按业务域拆到 lib/db/ 目录）。
 *
 * 连接/迁移在 lib/db/open.ts；checklist、settings、运行台账、标题、复盘、
 * 发布登记各自一个文件。调用方照旧 `from './db'` / `@/lib/db`。
 *
 * 注意：这个门面文件必须保留——Node ESM 不支持目录导入（Next 的打包器支持，
 * 但 node --test 的 TS 加载器不支持），测试要靠本文件解析 `./db`。
 */
export * from './db/open';
export * from './db/checklist';
export * from './db/settings';
export * from './db/runs';
export * from './db/titles-db';
export * from './db/reviews';
export * from './db/publications';
export * from './db/autopilot-db';
export * from './db/hermes-db';
export * from './db/drafts-db';

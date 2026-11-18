import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFoloIntakeText,
  dateKey,
  extractLinks,
  htmlToText,
  markSeen,
  mergeRadarEntries,
  normalizeFoloEntry,
  parseEnvelope,
  parseFoloTranslations,
  renderRadarMarkdown,
  selectNewEntries,
  type FoloEntry,
  type StoredFoloEntry,
} from '../lib/folo-core.ts';

const raw = {
  entries: {
    id: 'entry-1',
    title: '一个标题',
    url: 'https://example.com/a',
    description: '<p>Hello <strong>world</strong> &amp; more</p>',
    publishedAt: '2026-11-09T01:00:00.000Z',
  },
  feeds: { title: 'Example Feed' },
  read: false,
};

test('normalizeFoloEntry 把 EntryWithFeed 压扁并去 HTML', () => {
  const entry = normalizeFoloEntry(raw);
  assert.ok(entry);
  assert.equal(entry.id, 'entry-1');
  assert.equal(entry.title, '一个标题');
  assert.equal(entry.url, 'https://example.com/a');
  assert.equal(entry.feed, 'Example Feed');
  assert.equal(entry.description, 'Hello world & more');
  assert.equal(entry.publishedAt, '2026-11-09T01:00:00.000Z');
  assert.equal(entry.read, false);
});

test('normalizeFoloEntry 缺 id 丢弃，缺标题用摘要兜底', () => {
  assert.equal(normalizeFoloEntry({ entries: { title: 'no id' } }), null);
  const entry = normalizeFoloEntry({
    entries: { id: 'e2', description: '只有摘要' },
  });
  assert.ok(entry);
  assert.equal(entry.title, '只有摘要');
});

test('parseEnvelope 能从混入日志的输出里抠出 JSON', () => {
  const envelope = parseEnvelope('warn: something\n{"ok":true,"data":{"a":1},"error":null}\n');
  assert.ok(envelope);
  assert.equal(envelope.ok, true);
  assert.deepEqual(envelope.data, { a: 1 });
  assert.equal(parseEnvelope('not json'), null);
});

test('selectNewEntries 只保留本地没见过的 id', () => {
  const entries = [
    { ...raw.entries, id: 'a' },
    { ...raw.entries, id: 'b' },
  ].map((e) => normalizeFoloEntry(e) as FoloEntry);
  const fresh = selectNewEntries(entries, { a: '2026-11-01T00:00:00.000Z' });
  assert.deepEqual(fresh.map((e) => e.id), ['b']);
});

test('markSeen 记录并按上限裁剪', () => {
  const entries = [
    { id: 'a' },
    { id: 'b' },
    { id: 'c' },
  ].map((e) => normalizeFoloEntry({ ...raw.entries, ...e }) as FoloEntry);
  const seen = markSeen({}, entries, '2026-11-09T00:00:00.000Z', 2);
  assert.equal(Object.keys(seen).length, 2);
  assert.ok(seen.a || seen.b || seen.c);
});

test('mergeRadarEntries 同 id 覆盖、按发布时间倒序', () => {
  const base = {
    ...(normalizeFoloEntry(raw) as FoloEntry),
    pulledAt: '2026-11-01T00:00:00.000Z',
  } as StoredFoloEntry;
  const newer = {
    ...base,
    title: '新标题',
    publishedAt: '2026-11-10T00:00:00.000Z',
    pulledAt: '2026-11-09T00:00:00.000Z',
  } as StoredFoloEntry;
  const other = {
    ...base,
    id: 'entry-2',
    publishedAt: '2026-11-08T00:00:00.000Z',
  } as StoredFoloEntry;
  const merged = mergeRadarEntries([base, other], [newer]);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].id, 'entry-1');
  assert.equal(merged[0].title, '新标题');
  assert.equal(merged[1].id, 'entry-2');
});

test('renderRadarMarkdown 带未过三问、链接和空态', () => {
  const entry = {
    ...(normalizeFoloEntry(raw) as FoloEntry),
    pulledAt: '2026-11-09T00:00:00.000Z',
  } as StoredFoloEntry;
  const md = renderRadarMarkdown([entry], '2026-11-09');
  assert.match(md, /# 雷达日志 · Folo · 2026-11-09/);
  assert.match(md, /## 1\. 一个标题/);
  assert.match(md, /- 链接：https:\/\/example\.com\/a/);
  assert.match(md, /未过三问/);

  const empty = renderRadarMarkdown([], '2026-11-09');
  assert.match(empty, /今天没有新的未读条目/);
});

test('dateKey 用上海时区而不是 UTC', () => {
  // 2026-11-08T18:00:00Z = 2026-11-09 02:00 CST
  assert.equal(dateKey(new Date('2026-11-08T18:00:00.000Z')), '2026-11-09');
  assert.equal(dateKey('2026-11-08T18:00:00.000Z'), '2026-11-09');
  assert.equal(dateKey('not-a-date'), '');
});


test('parseFoloTranslations 解析代码块和对象包裹', () => {
  const direct = parseFoloTranslations(
    '```json\n[{"id":"a","title_zh":"甲","description_zh":"乙"}]\n```',
  );
  assert.equal(direct.get('a')?.titleZh, '甲');
  assert.equal(direct.get('a')?.descriptionZh, '乙');

  const wrapped = parseFoloTranslations(
    '{"items":[{"id":"b","titleZh":"丙","descriptionZh":"丁"}]}',
  );
  assert.equal(wrapped.get('b')?.titleZh, '丙');
  assert.equal(parseFoloTranslations('not json').size, 0);
});

test('renderRadarMarkdown 用中文标题并保留原文', () => {
  const entry = {
    ...(normalizeFoloEntry(raw) as FoloEntry),
    pulledAt: '2026-11-09T00:00:00.000Z',
    titleZh: '中文标题',
    descriptionZh: '中文摘要',
  } as StoredFoloEntry;
  const md = renderRadarMarkdown([entry], '2026-11-09');
  assert.match(md, /## 1\. 中文标题/);
  assert.match(md, /- 原文：一个标题/);
  assert.match(md, /- 摘要：中文摘要/);
});


test('htmlToText 保留段落并去标签', () => {
  const text = htmlToText('<h2>标题</h2><p>第一段</p><p>第二段 &amp; more</p>');
  assert.match(text, /标题/);
  assert.match(text, /第一段\n第二段 & more/);
});

test('buildFoloIntakeText 标成公开资料并留可选补充清单', () => {
  const entry = normalizeFoloEntry(raw) as FoloEntry;
  const text = buildFoloIntakeText(entry, '<p>Article body</p>');
  assert.match(text, /【Folo 线索 · 公开资料】/);
  assert.match(text, /你的实跑 \/ 判断/);
  assert.match(text, /https:\/\/example\.com\/a/);
  assert.match(text, /Article body/);
  assert.match(text, /公开来源也能立项/);
});


test('extractLinks 去图片、去重、保留正文外链', () => {
  const links = extractLinks(
    'see https://www.anthropic.com/research/components-of-agent-memory and https://x.com/a, again https://www.anthropic.com/research/components-of-agent-memory and https://a.com/x.png',
  );
  assert.deepEqual(links, [
    'https://www.anthropic.com/research/components-of-agent-memory',
    'https://x.com/a',
  ]);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertFetchableFeedUrl, isLocalHost, parseFeed, toRadarEntries } from '../lib/rss-core.ts';

const RSS2 = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:atom="http://www.w3.org/2005/Atom">
<channel><title>Hacker News: Best</title><link>https://news.ycombinator.com/best</link>
<atom:link href="https://hnrss.org/best?points=100" rel="self" type="application/rss+xml"></atom:link>
<item><title><![CDATA[微软 365 宕机 &amp; 连带事故]]></title><description><![CDATA[
<p>Article URL: <a href="https://example.com/a">https://example.com/a</a></p>
<p>Points: 319</p>
]]></description><pubDate>Sun, 15 Nov 2026 18:36:10 +0000</pubDate><link>https://example.com/a</link><dc:creator>someone</dc:creator><comments>https://news.ycombinator.com/item?id=50509411</comments><guid isPermaLink="false">https://news.ycombinator.com/item?id=50509411</guid></item>
<item><title>无 guid 也无 CDATA 的条目</title><pubDate>invalid-date</pubDate><link>https://example.com/b</link></item>
</channel></rss>`;

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>示例 Atom</title>
  <entry>
    <title>Atom 条目标题</title>
    <link rel="alternate" href="https://example.org/post/1"/>
    <id>urn:uuid:aaaa-bbbb</id>
    <updated>2026-11-14T09:30:00Z</updated>
    <summary>一段 &lt;b&gt;加粗&lt;/b&gt; 摘要</summary>
  </entry>
</feed>`;

test('parseFeed 解析 RSS 2.0：CDATA 标题、实体解码、guid 命名空间化', () => {
  const items = parseFeed(RSS2, { id: 'hn-best', name: 'Hacker News 热门' });
  assert.equal(items.length, 2);

  assert.equal(items[0].title, '微软 365 宕机 & 连带事故');
  assert.equal(items[0].url, 'https://example.com/a');
  assert.equal(items[0].id, 'hn-best:https://news.ycombinator.com/item?id=50509411');
  assert.equal(items[0].publishedAt, new Date('Sun, 15 Nov 2026 18:36:10 +0000').toISOString());
  assert.ok(items[0].description.includes('Points: 319'));

  // 无 guid：回落 link；坏日期回落 epoch
  assert.equal(items[1].id, 'hn-best:https://example.com/b');
  assert.equal(items[1].publishedAt, new Date(0).toISOString());
});

test('parseFeed 解析 Atom：href 取链接、summary 兜底描述', () => {
  const items = parseFeed(ATOM, { id: 'demo-atom', name: '示例 Atom' });
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'Atom 条目标题');
  assert.equal(items[0].url, 'https://example.org/post/1');
  assert.equal(items[0].id, 'demo-atom:urn:uuid:aaaa-bbbb');
  assert.ok(items[0].description.includes('加粗'));
  assert.ok(!items[0].description.includes('<b>'));
});

test('parseFeed 空频道（arXiv 周日）返回空数组不报错', () => {
  const empty = '<rss version="2.0"><channel><title>cs.AI</title><link>http://rss.arxiv.org/rss/cs.AI</link></channel></rss>';
  assert.deepEqual(parseFeed(empty, { id: 'arxiv-cs-ai', name: 'arXiv cs.AI' }), []);
});

test('parseFeed 的 atom:link 不会被当成条目链接', () => {
  const items = parseFeed(RSS2, { id: 'hn-best', name: 'HN' });
  assert.equal(items[0].url, 'https://example.com/a');
});

test('toRadarEntries 转 StoredFoloEntry 形状：source=rss、feed 名、pulledAt', () => {
  const items = parseFeed(RSS2, { id: 'hn-best', name: 'Hacker News 热门' });
  const pulledAt = '2026-11-15T18:00:00.000Z';
  const entries = toRadarEntries(items, { id: 'hn-best', name: 'Hacker News 热门' }, pulledAt);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].source, 'rss');
  assert.equal(entries[0].feed, 'Hacker News 热门');
  assert.equal(entries[0].pulledAt, pulledAt);
  assert.equal(entries[0].read, false);
  assert.ok(entries[0].id.startsWith('hn-best:'));
  // 描述剥 HTML 后不带标签
  assert.ok(!entries[0].description.includes('<p>'));
});

test('isLocalHost 认全环回/内网/链路本地，公网不误伤', () => {
  for (const h of ['localhost', 'bot.localhost', 'nas.local', '127.0.0.1', '10.1.2.3', '172.16.0.9', '172.31.255.1', '192.168.1.4', '169.254.10.2', '::1', 'fd00::1', 'fe80::1']) {
    assert.ok(isLocalHost(h), h);
  }
  for (const h of ['hnrss.org', 'rss.arxiv.org', '172.32.0.1', '192.169.1.1', 'example.com']) {
    assert.ok(!isLocalHost(h), h);
  }
});

test('assertFetchableFeedUrl：内网需显式 local 标，公网放行，协议收紧', () => {
  assert.throws(() => assertFetchableFeedUrl('http://localhost:1200/github/trending', false), /local.*true/);
  assert.throws(() => assertFetchableFeedUrl('http://192.168.1.9/feed', false), /local.*true/);
  assert.throws(() => assertFetchableFeedUrl('file:///etc/passwd', true), /协议不允许/);
  assert.throws(() => assertFetchableFeedUrl('ftp://example.com/feed', false), /协议不允许/);
  assert.ok(assertFetchableFeedUrl('http://localhost:1200/github/trending', true) instanceof URL);
  assert.ok(assertFetchableFeedUrl('https://hnrss.org/best', false) instanceof URL);
});

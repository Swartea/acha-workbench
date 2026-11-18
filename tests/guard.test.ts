import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { assertUnder, isUnder } from '../lib/guard.ts';

const ROOT = path.resolve('/x/稿件');

test('根内文件通过', () => {
  const target = path.resolve(ROOT, 'A1/正文.md');
  assert.equal(isUnder(ROOT, target), true);
  assert.equal(assertUnder(ROOT, 'A1', '正文.md'), target);
});

test('根目录本身通过', () => {
  assert.equal(isUnder(ROOT, ROOT), true);
  assert.equal(assertUnder(ROOT), path.resolve(ROOT));
});

test('根下直接子文件通过', () => {
  assert.equal(isUnder(ROOT, path.resolve(ROOT, 'a.png')), true);
  assert.equal(assertUnder(ROOT, 'a.png'), path.resolve(ROOT, 'a.png'));
});

test('同级同前缀目录必须拒绝', () => {
  const sibling = path.resolve('/x/稿件X/a.png');
  assert.equal(isUnder(ROOT, sibling), false);
  assert.throws(() => assertUnder(ROOT, '..', '稿件X', 'a.png'), /路径越界/);
});

test('含 .. 的穿越必须拒绝', () => {
  // 解析后落到 root 外
  assert.equal(isUnder(ROOT, path.resolve(ROOT, '../稿件2/a.md')), false);
  assert.equal(isUnder(ROOT, path.resolve(ROOT, 'a/../../稿件2/b.md')), false);
  assert.throws(() => assertUnder(ROOT, '..', '稿件2', 'a.md'), /路径越界/);
  assert.throws(() => assertUnder(ROOT, 'a', '..', '..', '稿件2', 'b.md'), /路径越界/);
});

test('含 .. 但仍落在 root 内则放行', () => {
  // 'a/../b' 归一后仍在 root 内，不是穿越
  assert.equal(isUnder(ROOT, path.resolve(ROOT, 'a/../b.md')), true);
  assert.equal(assertUnder(ROOT, 'a', '..', 'b.md'), path.resolve(ROOT, 'b.md'));
});

test('越界时错误文案为「路径越界」', () => {
  assert.throws(
    () => assertUnder(ROOT, '../escape.md'),
    (err: unknown) => err instanceof Error && err.message === '路径越界',
  );
});

test('root 归一：尾部分隔符与相对路径按 resolve 处理', () => {
  const rootWithSep = ROOT + path.sep;
  assert.equal(isUnder(rootWithSep, path.resolve(ROOT, 'a.md')), true);
  assert.equal(isUnder(rootWithSep, path.resolve('/x/稿件X/a.md')), false);
});

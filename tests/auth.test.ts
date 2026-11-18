import test from 'node:test';
import assert from 'node:assert/strict';
import { expectedCookie, isAuthed, isLoopbackHost, requireAuth } from '../lib/auth.ts';

const req = (host: string, cookie?: string) =>
  new Request('http://x/api', { headers: cookie ? { host, cookie } : { host } });

test('expectedCookie 稳定且为 64 位 hex', () => {
  process.env.WORKBENCH_PASSCODE = 'abc123';
  const a = expectedCookie();
  assert.equal(a, expectedCookie());
  assert.match(a, /^[0-9a-f]{64}$/);
});

test('不同口令得到不同 cookie', () => {
  process.env.WORKBENCH_PASSCODE = 'abc123';
  const a = expectedCookie();
  process.env.WORKBENCH_PASSCODE = 'abc124';
  assert.notEqual(a, expectedCookie());
});

test('空口令：非本机拒绝，本机放行', () => {
  delete process.env.WORKBENCH_PASSCODE;
  assert.equal(expectedCookie(), '');
  assert.equal(isAuthed(req('192.168.1.5:8787')), false);
  assert.equal(isAuthed(req('127.0.0.1:8787')), true);
});

test('cookie 正确放行、错误拒绝', () => {
  process.env.WORKBENCH_PASSCODE = 'abc123';
  const good = expectedCookie();
  assert.equal(isAuthed(req('192.168.1.5:8787', AUTH(good))), true);
  assert.equal(isAuthed(req('192.168.1.5:8787', AUTH('0'.repeat(64)))), false);
  assert.equal(isAuthed(req('192.168.1.5:8787', AUTH('short'))), false);
  assert.equal(isAuthed(req('192.168.1.5:8787')), false);
});

function AUTH(v: string) {
  return 'wb_auth=' + v;
}

test('loopback host 判定', () => {
  assert.equal(isLoopbackHost('127.0.0.1:8787'), true);
  assert.equal(isLoopbackHost('localhost:8787'), true);
  assert.equal(isLoopbackHost('[::1]:8787'), true);
  assert.equal(isLoopbackHost('192.168.1.5:8787'), false);
  assert.equal(isLoopbackHost(null), false);
});

test('requireAuth 对非本机未授权返回 401', () => {
  process.env.WORKBENCH_PASSCODE = 'abc123';
  const denied = requireAuth(req('10.0.0.2:8787'));
  assert.ok(denied);
  assert.equal(denied?.status, 401);
  assert.equal(requireAuth(req('127.0.0.1:8787')), null);
});

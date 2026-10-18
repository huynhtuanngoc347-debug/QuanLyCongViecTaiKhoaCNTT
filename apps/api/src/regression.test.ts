/**
 * Test hồi quy cho các lỗi trong QA_AUDIT_REPORT.md (Phase 2).
 * Chỉ kiểm thử logic thuần, không cần CSDL; kiểm thử qua HTTP nằm ở tools/regression.mjs.
 */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { LoginThrottle } from './auth/login-throttle';
import { securityHeaders } from './common/security-headers';
import { clampLimit, isTaskScope } from './common/query-params';
import { isRevoked, isSessionId, newSessionId, revokeSession } from './auth/session-revocation';
import type { SqlRunner } from './db/db.service';

const clock = () => { let t = 1_000_000; return { now: () => t, advance: (ms: number) => { t += ms; } }; };
const opts = { windowMs: 5 * 60 * 1000, perAccount: 10, perIp: 50 };

test('BUG-P1-01: đăng nhập ĐÚNG không bao giờ bị tính vào giới hạn (cả khoa chung một IP)', () => {
  const c = clock(); const th = new LoginThrottle(opts, c.now);
  for (let i = 0; i < 200; i++) {
    const who = `nguoi${i}@huit.edu.vn`;
    assert.equal(th.isBlocked('10.0.0.1', who), false, `lượt ${i} bị chặn dù chưa nhập sai`);
    th.recordSuccess('10.0.0.1', who);
  }
});

test('BUG-P1-01: 10 lần sai cùng tài khoản thì khóa tài khoản đó, tài khoản khác cùng IP vẫn đăng nhập được', () => {
  const c = clock(); const th = new LoginThrottle(opts, c.now);
  for (let i = 0; i < 10; i++) { assert.equal(th.isBlocked('10.0.0.1', 'a@x.vn'), false); th.recordFailure('10.0.0.1', 'a@x.vn'); }
  assert.equal(th.isBlocked('10.0.0.1', 'a@x.vn'), true);
  assert.equal(th.isBlocked('10.0.0.1', 'A@X.VN '), true, 'không phân biệt hoa thường / khoảng trắng');
  assert.equal(th.isBlocked('10.0.0.1', 'b@x.vn'), false);
  assert.throws(() => th.assertAllowed('10.0.0.1', 'a@x.vn'), (e: Error & { status?: number; getStatus?: () => number }) => (e.getStatus?.() ?? e.status) === 429);
});

test('BUG-P1-01: hết cửa sổ 5 phút thì mở khóa; nhập đúng xóa bộ đếm của tài khoản', () => {
  const c = clock(); const th = new LoginThrottle(opts, c.now);
  for (let i = 0; i < 10; i++) th.recordFailure('ip', 'a@x.vn');
  assert.equal(th.isBlocked('ip', 'a@x.vn'), true);
  c.advance(5 * 60 * 1000);
  assert.equal(th.isBlocked('ip', 'a@x.vn'), false);
  for (let i = 0; i < 9; i++) th.recordFailure('ip', 'a@x.vn');
  th.recordSuccess('ip', 'a@x.vn');
  th.recordFailure('ip', 'a@x.vn');
  assert.equal(th.isBlocked('ip', 'a@x.vn'), false, 'sau khi nhập đúng, đếm lại từ đầu');
});

test('BUG-P1-01: vẫn chặn dò mật khẩu hàng loạt — 50 lần sai từ một IP (nhiều tài khoản) thì khóa IP', () => {
  const c = clock(); const th = new LoginThrottle(opts, c.now);
  for (let i = 0; i < 50; i++) th.recordFailure('1.2.3.4', `u${i}@x.vn`);
  assert.equal(th.isBlocked('1.2.3.4', 'moi@x.vn'), true);
  assert.equal(th.isBlocked('5.6.7.8', 'moi@x.vn'), false, 'IP khác không bị ảnh hưởng');
});

test('BUG-P2-02: có header chống nhúng trang (clickjacking)', () => {
  const set: Record<string, string> = {};
  securityHeaders({ path: '/' } as never, { setHeader: (k: string, v: string) => { set[k.toLowerCase()] = v; } } as never, () => undefined);
  assert.equal(set['x-frame-options'], 'DENY');
  assert.match(set['content-security-policy'] ?? '', /frame-ancestors 'none'/);
  assert.equal(set['x-content-type-options'], 'nosniff');
});

test('BUG-P3-02: chỉ nhận phạm vi danh sách hợp lệ', () => {
  for (const s of ['assigned', 'created', 'all', 'review']) assert.equal(isTaskScope(s), true);
  for (const s of ['hacker', "all' OR 1=1--", '', 'ALL']) assert.equal(isTaskScope(s), false);
});

test('BUG-P3-05: limit âm / không phải số dùng giá trị mặc định thay vì 1', () => {
  assert.equal(clampLimit('-5', 200, 1000), 200);
  assert.equal(clampLimit('abc', 200, 1000), 200);
  assert.equal(clampLimit(undefined, 200, 1000), 200);
  assert.equal(clampLimit('0', 200, 1000), 200);
  assert.equal(clampLimit('50', 200, 1000), 50);
  assert.equal(clampLimit('99999', 200, 1000), 1000);
});

test('NEW-P3-01: mã phiên ngẫu nhiên 32 ký tự hex; giá trị lạ không được dùng để truy vấn', async () => {
  const a = newSessionId(), b = newSessionId();
  assert.ok(isSessionId(a) && isSessionId(b) && a !== b);
  for (const bad of [undefined, null, '', 'abc', a.toUpperCase(), a + '0', "' OR 1=1--", 123]) assert.equal(isSessionId(bad), false, String(bad));
  const calls: unknown[] = [];
  const fake = { scalar: async (_t: string, p: unknown) => { calls.push(p); return 1; } } as unknown as SqlRunner;
  assert.equal(await isRevoked(fake, undefined), false);
  assert.equal(await isRevoked(fake, 'khong-hop-le'), false);
  assert.equal(await revokeSession(fake, 'khong-hop-le', 1, 60), false);
  assert.equal(calls.length, 0, 'không gọi CSDL với mã phiên không hợp lệ');
  assert.equal(await isRevoked(fake, a), true);
  assert.equal(await revokeSession(fake, a, 7, 604800), true);
  assert.deepEqual(calls, [{ sid: a }, { sid: a, userId: 7, ttl: 604800 }]);
});

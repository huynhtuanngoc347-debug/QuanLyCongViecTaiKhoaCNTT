import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { fingerprint, generateTemporaryPassword, hashPassword, validateNewPassword, verifyPassword } from './auth/password-hasher';
import { SqlRunner } from './db/db.service';
import { initials, normalize, unitInitials, collapseSpaces } from './common/text';
import { addMonths, localDate, localText, parseVnDate } from './common/vn-time';
import { unitTypeToDb, unitTypeLabel } from './common/mapping';
import { hashResetCode, newResetCode, sameHash } from './auth/password-reset';

test('băm mật khẩu kiểu ASP.NET Identity V3 và kiểm tra lại được', async () => {
  const hash = await hashPassword('Demo@CNTT2026!');
  assert.equal(Buffer.from(hash, 'base64')[0], 0x01);
  assert.equal(await verifyPassword(hash, 'Demo@CNTT2026!'), 'success');
  assert.equal(await verifyPassword(hash, 'sai'), 'failed');
  assert.equal(await verifyPassword('khong-phai-base64', 'x'), 'failed');
  assert.equal(fingerprint(hash).length, 16);
});

test('mật khẩu tạm đủ loại ký tự; quy tắc mật khẩu mới', () => {
  const p = generateTemporaryPassword();
  assert.equal(p.length, 12);
  assert.match(p, /[A-Z]/); assert.match(p, /[a-z]/); assert.match(p, /[2-9]/); assert.match(p, /[@#$%&*!?]/);
  assert.equal(validateNewPassword('abc'), 'Mật khẩu cần từ 8 đến 128 ký tự.');
  assert.equal(validateNewPassword('abcdefgh'), 'Mật khẩu cần có cả chữ và số.');
  assert.equal(validateNewPassword('matkhau123'), null);
});

test('tham số mảng "IN @ds" được mở rộng như Dapper', () => {
  const runner = new SqlRunner({} as never) as unknown as { prepare: (t: string, p: object) => { text: string } };
  // prepare tạo sql.Request trên nguồn giả; chỉ kiểm tra câu lệnh sau khi mở rộng.
  try {
    const { text } = runner.prepare('SELECT 1 WHERE a IN @ids AND b NOT IN @keep AND c IN @idsX', { ids: [1, 2, 2], keep: [], idsX: [5] });
    assert.equal(text, 'SELECT 1 WHERE a IN (@ids_0, @ids_1) AND b NOT IN (SELECT NULL WHERE 1 = 0) AND c IN (@idsX_0)');
  } catch (e) {
    assert.fail(String(e));
  }
});

test('chuỗi tiếng Việt', () => {
  assert.equal(normalize('  Đề Cương Học Máy '), 'de cuong hoc may');
  assert.equal(initials('Nguyễn Văn Lễ'), 'VL');
  assert.equal(unitInitials('Bộ môn Khoa học dữ liệu'), 'KL');
  assert.equal(collapseSpaces('  a   b  '), 'a b');
  assert.equal(unitTypeToDb('bo mon'), 'BoMon');
  assert.equal(unitTypeToDb('Trung  tâm'), 'Trung tâm');
  assert.equal(unitTypeLabel('HoiDong'), 'Hội đồng');
});

test('giờ Việt Nam: ngày nhập hiểu theo UTC+7', () => {
  assert.equal(parseVnDate('2026-10-05', false)!.toISOString(), '2026-10-04T17:00:00.000Z');
  assert.equal(parseVnDate('2026-10-05', true)!.toISOString(), '2026-10-05T16:59:59.000Z');
  assert.equal(parseVnDate('2026-02-30', true), null);
  assert.equal(localDate(new Date('2026-10-04T18:00:00Z')), '2026-10-05');
  assert.equal(localText(new Date('2026-10-04T18:00:00Z')), '05/10/2026');
  assert.equal(addMonths(new Date('2026-08-31T00:00:00Z'), 6).toISOString().slice(0, 10), '2027-02-28');
});

test('mã quên mật khẩu: 6 chữ số, HMAC gắn với người dùng, so khớp không phân biệt hoa/thường', () => {
  for (let i = 0; i < 50; i++) assert.match(newResetCode(), /^\d{6}$/);
  const h = hashResetCode(7, '012345');
  assert.equal(h.length, 64);
  assert.ok(sameHash(h.toUpperCase(), h));
  assert.ok(!sameHash(h, hashResetCode(8, '012345')));
  assert.ok(!sameHash(h, hashResetCode(7, '012346')));
  assert.ok(!sameHash('ngan', h));
});

// Kiểm thử giao diện React với máy chủ giả lập: 4 vai trò, mọi trang và các thao tác chính.
// Chạy: node tools/mock-api.mjs & node tools/e2e.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_PATH || 'playwright');

const BASE = process.env.BASE || 'http://localhost:5199/';
const SHOTS = process.env.SHOTS || '/tmp/shots';
const PASS = 'Demo@CNTT2026!';
const failures = [];
let checks = 0;
const ok = (cond, msg) => { checks++; if (!cond) failures.push(msg); };

async function run() {
  const browser = await chromium.launch();
  const errorsOf = (page, tag) => {
    page.on('pageerror', (e) => failures.push(`[${tag}] pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error' && !/401|403|404|409|Failed to load resource/.test(m.text())) failures.push(`[${tag}] console: ${m.text()}`); });
  };
  async function login(email, tag, width = 1440) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh' });
    const page = await ctx.newPage();
    errorsOf(page, tag);
    await page.goto(BASE);
    await page.fill('#email', email);
    await page.fill('#password', PASS);
    await page.click('button[type=submit]');
    await page.waitForSelector('#page-title');
    return page;
  }
  const go = async (page, hash) => { await page.goto(BASE + '#' + hash); await page.waitForTimeout(350); };
  const title = (page) => page.locator('#page-title').first().textContent();
  const closeAlert = async (page) => {
    await page.waitForSelector('dialog.task-dialog[open]', { timeout: 2500 }).catch(() => {});
    if (await page.locator('dialog.task-dialog[open]').count()) await page.getByRole('button', { name: 'Để sau' }).click();
  };

  // ---- Đăng nhập sai ----
  {
    const ctx = await browser.newContext(); const page = await ctx.newPage(); errorsOf(page, 'login');
    await page.goto(BASE);
    await page.click('button[type=submit]');
    ok(await page.locator('#email-error').isVisible(), 'Đăng nhập trống phải báo lỗi email');
    await page.fill('#email', 'hand@huit.edu.vn'); await page.fill('#password', 'sai');
    await page.click('button[type=submit]');
    await page.waitForSelector('#form-error:not([hidden])');
    ok((await page.locator('#form-error').textContent()).includes('không đúng'), 'Sai mật khẩu phải báo lỗi chung');
    await ctx.close();
  }

  // ---- Giảng viên ----
  {
    const page = await login('hand@huit.edu.vn', 'giang-vien');
    await page.waitForSelector('dialog.task-dialog[open]', { timeout: 3000 }).catch(() => {});
    ok(await page.locator('dialog.task-dialog[open]').count() === 1, 'Giảng viên: phải hiện pop-up quá hạn/sắp đến hạn sau đăng nhập');
    await page.screenshot({ path: `${SHOTS}/gv-alert.png` });
    await closeAlert(page);
    ok(page.url().endsWith('#/ca-nhan'), 'Giảng viên vào Trang cá nhân');
    await page.waitForSelector('.me-card');
    ok(await page.locator('.gv-layout').count() === 1, 'Trang cá nhân có bố cục 2 cột');
    ok((await page.locator('#me-title').textContent()) === 'Kết quả của tôi', 'Có thẻ Kết quả của tôi');
    ok(await page.locator('.me-unit').count() === 2, 'Thẻ Đơn vị và ban: 2 đơn vị');
    ok((await page.locator('.group-card h3').allTextContents()).includes('Đang thực hiện'), 'Có nhóm Đang thực hiện');
    await page.screenshot({ path: `${SHOTS}/gv-ca-nhan.png`, fullPage: true });
    await page.getByRole('radio', { name: 'Năm học' }).click();
    await page.waitForTimeout(300);
    ok((await page.locator('.me-head p').first().textContent()).includes('Năm học'), 'Đổi kỳ sang Năm học');
    // Menu: không có Tổ chức, có Thống kê của tôi
    ok(await page.locator('.sidebar a[href="#/to-chuc"]').count() === 0, 'Giảng viên không thấy Cơ cấu tổ chức');
    ok(await page.locator('.sidebar a[href="#/thong-ke-ca-nhan"]').count() === 1, 'Giảng viên thấy Thống kê của tôi');
    // Gõ đường dẫn không có quyền → về trang chính
    await go(page, '/chuc-vu');
    ok(page.url().endsWith('#/ca-nhan'), 'Giảng viên vào /chuc-vu bị đưa về trang chính');
    // Danh sách: bảng, kanban, lịch
    await go(page, '/cong-viec');
    await page.waitForSelector('.task-table');
    ok(await page.locator('.task-table tbody tr').count() >= 3, 'Danh sách Tôi được giao có việc');
    await go(page, '/cong-viec?view=kanban'); ok(await page.locator('.kanban-col').count() === 4, 'Kanban 4 cột');
    await go(page, '/cong-viec?view=calendar'); ok(await page.locator('.cal-day').count() >= 28, 'Lịch tháng');
    await page.screenshot({ path: `${SHOTS}/gv-lich.png` });
    // Tìm kiếm
    await go(page, '/cong-viec');
    await page.fill('#task-search', 'hoc may');
    await page.waitForTimeout(500);
    ok(await page.locator('.task-table tbody tr').count() === 1, 'Tìm không dấu "hoc may" ra 1 việc');
    // Chi tiết + cập nhật tiến độ
    await go(page, '/cong-viec/chi-tiet?id=101');
    await page.waitForSelector('.assign-card');
    await page.getByRole('button', { name: 'Cập nhật tiến độ' }).click();
    await page.waitForSelector('#progress-form');
    await page.click('#progress-form button[type=submit]');
    ok(await page.locator('#note-error').isVisible(), 'Tiến độ: bắt buộc ghi chú');
    await page.fill('#note', 'Xong chương 5');
    await page.getByRole('button', { name: '+10%' }).click();
    await page.click('#progress-form button[type=submit]');
    await page.waitForFunction(() => document.getElementById('toast')?.textContent?.includes('tiến độ'), null, { timeout: 5000 }).catch(() => {});
    const progressToast = await page.locator('#toast').textContent();
    ok(progressToast.includes('67%'), 'Cập nhật tiến độ 67% — thực tế: ' + progressToast);
    // Nộp kết quả
    await page.getByRole('button', { name: 'Nộp kết quả' }).click();
    await page.fill('#content', 'Đề cương hoàn chỉnh');
    await page.setInputFiles('#files', { name: 'de-cuong.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') });
    await page.click('#submit-form button[type=submit]');
    await page.waitForTimeout(500);
    ok((await page.locator('#toast').textContent()).includes('Đã nộp kết quả'), 'Nộp kết quả kèm tệp');
    // Xin gia hạn ở việc quá hạn đã có yêu cầu chờ → không có nút; việc 102 đã có yêu cầu chờ duyệt
    await go(page, '/cong-viec/chi-tiet?id=102');
    await page.waitForSelector('.assign-card');
    ok(await page.getByRole('button', { name: 'Xin gia hạn' }).count() === 0, 'Đã có yêu cầu chờ thì không xin thêm');
    // Các tab
    for (const tab of ['overview', 'result', 'discuss', 'history']) {
      await go(page, `/cong-viec/chi-tiet?id=101&tab=${tab}`);
      ok(await page.locator('.tab-body').count() === 1, `Tab ${tab} hiển thị`);
    }
    await go(page, '/cong-viec/chi-tiet?id=101&tab=discuss');
    await page.fill('#comment-content', 'Em đã cập nhật');
    await page.click('#comment-form button[type=submit]');
    await page.waitForTimeout(500);
    ok(await page.locator('.comment').count() === 2, 'Gửi bình luận');
    await go(page, '/thong-ke-ca-nhan'); await page.waitForSelector('.kpi-grid');
    ok((await title(page)) === 'Thống kê của tôi', 'Thống kê của tôi');
    await go(page, '/thong-bao'); ok((await title(page)) === 'Thông báo', 'Trang thông báo');
    await page.click('#bell-menu summary'); await page.waitForTimeout(200);
    ok(await page.locator('#bell-dropdown .noti').count() >= 1, 'Chuông có thông báo');
    await go(page, '/doi-mat-khau');
    await page.fill('#currentPassword', 'sai'); await page.fill('#newPassword', 'abc'); await page.fill('#confirmPassword', 'x');
    await page.click('#password-form button[type=submit]');
    ok(await page.locator('#newPassword-error').isVisible(), 'Đổi mật khẩu: kiểm tra mật khẩu mới');
    // Điện thoại: menu trượt
    await page.setViewportSize({ width: 390, height: 844 });
    await go(page, '/ca-nhan');
    await page.screenshot({ path: `${SHOTS}/gv-mobile.png`, fullPage: true });
    await page.click('.mobile-menu'); ok(await page.locator('.sidebar.open').count() === 1, 'Mở menu trên điện thoại');
    // Đăng xuất
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.click('.user-menu summary'); await page.getByRole('button', { name: 'Đăng xuất' }).click();
    await page.waitForSelector('#login-form'); ok(true, 'Đăng xuất');
    await page.context().close();
  }

  // ---- Trưởng bộ môn: duyệt kết quả, duyệt gia hạn, tiếp nhận việc của đơn vị ----
  {
    const page = await login('baopt@huit.edu.vn', 'truong-bo-mon');
    await closeAlert(page);
    ok(page.url().endsWith('#/ca-nhan'), 'Trưởng bộ môn vào Trang cá nhân (đã gộp Trang bộ môn)');
    ok(await page.locator('.stat-grid').count() === 1 && await page.getByRole('radio', { name: 'Việc tôi quản lý' }).count() === 1, 'Trang cá nhân có phần Việc tôi quản lý');
    await page.screenshot({ path: `${SHOTS}/tbm-portal.png`, fullPage: true });
    await go(page, '/cho-duyet'); await page.waitForSelector('.task-table');
    ok(await page.locator('.task-table tbody tr').count() >= 1, 'Chờ tôi duyệt có việc');
    await go(page, '/cong-viec/chi-tiet?id=104&tab=result');
    await page.getByRole('button', { name: 'Đánh giá' }).first().click();
    await page.getByText('Cần bổ sung', { exact: true }).click();
    await page.click('#evaluate-form button[type=submit]');
    ok(await page.locator('#comment-error').isVisible(), 'Cần bổ sung phải có nhận xét');
    await page.getByText('Đạt', { exact: true }).first().click();
    await page.click('#evaluate-form button[type=submit]');
    await page.waitForTimeout(500);
    ok((await page.locator('#toast').textContent()).includes('Đạt'), 'Duyệt Đạt');
    // Tiếp nhận việc giao cho cả bộ môn và phân công lại
    await go(page, '/cong-viec/chi-tiet?id=103&tab=assign');
    await page.getByRole('button', { name: 'Phân công lại' }).click();
    await page.waitForSelector('#delegate-form');
    await page.check('#delegate-form input[name=member][value="4"]');
    await page.click('#delegate-form button[type=submit]');
    await page.waitForTimeout(500);
    ok((await page.locator('#toast').textContent()).includes('Đã tiếp nhận và giao'), 'Phân công lại cho thành viên');
    // Tạo công việc
    await go(page, '/cong-viec/tao');
    await page.click('#task-form button[value=create]');
    ok(await page.locator('#title-error').isVisible(), 'Tạo việc: bắt buộc tiêu đề');
    await page.fill('#title', 'Rà soát đề thi');
    await page.selectOption('#categoryId', '1');
    const due = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
    await page.fill('#due', due);
    await page.click('#task-form button[value=create]');
    await page.waitForSelector('.assign-card, .empty');
    ok(page.url().includes('tab=assign'), 'Tạo xong chuyển sang tab Phân công');
    await page.getByRole('button', { name: '+ Giao việc' }).first().click();
    await page.waitForSelector('#assign-form');
    await page.click('#assign-form button[type=submit]');
    ok(await page.locator('#personIds-error').isVisible(), 'Giao việc: chọn người nhận');
    await page.check('#assign-form input[name=personIds][value="4"]');
    await page.click('#assign-form button[type=submit]');
    await page.waitForTimeout(500);
    ok((await page.locator('#toast').textContent()).includes('Đã giao việc cho 1 người'), 'Giao việc cho 1 người');
    await page.screenshot({ path: `${SHOTS}/tbm-detail.png`, fullPage: true });
    await go(page, '/thong-ke'); await page.waitForSelector('.donut');
    ok(await page.locator('.kpi-grid.five .kpi').count() === 5, 'Thống kê đơn vị 5 KPI');
    await page.screenshot({ path: `${SHOTS}/tbm-thong-ke.png`, fullPage: true });
    await go(page, '/mau-cong-viec'); ok((await title(page)) === 'Mẫu công việc', 'Mẫu công việc');
    await go(page, '/to-chuc'); ok((await title(page)) === 'Cơ cấu tổ chức', 'Trưởng bộ môn thấy Cơ cấu tổ chức (quản lý thành viên)');
    await go(page, '/them-thanh-vien?unit=2'); ok((await title(page)) === 'Thêm thành viên', 'Thêm thành viên');
    await page.context().close();
  }

  // ---- Trưởng khoa: duyệt gia hạn ----
  {
    const page = await login('vunh@huit.edu.vn', 'truong-khoa');
    await closeAlert(page);
    ok(page.url().endsWith('#/ca-nhan'), 'Trưởng khoa vào Trang cá nhân (đã gộp Trang Trưởng khoa)');
    await go(page, '/cong-viec/chi-tiet?id=102&tab=assign');
    await page.getByRole('button', { name: 'Duyệt gia hạn' }).click();
    await page.getByText('Từ chối', { exact: true }).click();
    await page.click('#decide-form button[type=submit]');
    ok(await page.locator('#comment-error').isVisible(), 'Từ chối gia hạn phải có lý do');
    await page.getByText('Đồng ý', { exact: true }).click();
    await page.click('#decide-form button[type=submit]');
    await page.waitForTimeout(500);
    ok((await page.locator('#toast').textContent()).includes('Đã duyệt gia hạn'), 'Duyệt gia hạn');
    await go(page, '/cong-viec/chi-tiet?id=103');
    await page.getByRole('button', { name: 'Tạm dừng' }).click();
    await page.click('#reason-form button[type=submit]');
    await page.waitForTimeout(400);
    ok((await page.locator('#toast').textContent()).includes('tạm dừng'), 'Tạm dừng công việc');
    await go(page, '/cong-viec?scope=all'); ok(await page.locator('.task-table tbody tr').count() >= 4, 'Tất cả trong phạm vi');
    await page.context().close();
  }

  // ---- Quản trị ----
  {
    const page = await login('admin.demo@example.invalid', 'quan-tri');
    ok(page.url().endsWith('#/admin'), 'Quản trị vào Trang quản trị');
    for (const [hash, t] of [['/to-chuc', 'Cơ cấu tổ chức'], ['/nhan-su', 'Nhân sự'], ['/chuc-vu', 'Chức vụ và quyền'], ['/the-loai', 'Thể loại công việc'], ['/nhat-ky', 'Nhật ký hệ thống'], ['/them-don-vi', 'Thêm đơn vị'], ['/them-nhan-su', 'Thêm nhân sự']]) {
      await go(page, hash); await page.waitForTimeout(200);
      ok((await title(page)) === t, `Quản trị: ${t}`);
    }
    await go(page, '/them-don-vi');
    await page.selectOption('#parentId', '__new');
    ok(await page.locator('#new-parent-box').isVisible(), 'Chọn tạo đơn vị cha mới hiện ô nhập');
    await page.click('#unit-form button[type=submit]');
    ok(await page.locator('#form-error li').count() >= 3, 'Thêm đơn vị: tóm tắt lỗi');
    await page.fill('#name', 'Ban Truyền thông');
    await page.click('.sidebar a[href="#/to-chuc"]');
    await page.waitForTimeout(300);
    ok(await page.locator('dialog#confirm-dialog[open]').count() === 1, 'Rời biểu mẫu đang sửa phải hỏi lại');
    await page.click('#confirm-yes');
    await page.waitForTimeout(300);
    await go(page, '/chuc-vu?role=3');
    await page.check('input[name=createTask]');
    await page.click('#permissions-form button[type=submit]');
    await page.waitForTimeout(400);
    ok((await page.locator('#toast').textContent()).includes('Đã lưu quyền'), 'Lưu quyền chức vụ');
    await go(page, '/ho-so?id=5');
    await page.getByRole('button', { name: 'Xóa tài khoản' }).click(); await page.click('#confirm-yes');
    await page.waitForSelector('#secret-dialog[open]');
    ok((await page.locator('#secret-message').textContent()).includes('lịch sử'), 'Xóa tài khoản có lịch sử bị từ chối (409)');
    await page.click('#secret-close');
    await go(page, '/the-loai');
    await page.getByRole('button', { name: '+ Thêm thể loại' }).click();
    await page.fill('#name', 'Hành chính'); await page.click('#category-form button[type=submit]');
    await page.waitForTimeout(400);
    ok(await page.getByText('Hành chính').count() >= 1, 'Thêm thể loại');
    await go(page, '/cong-viec'); ok((await page.locator('.page-header p').textContent()).includes('chỉ đọc'), 'Quản trị xem công việc chỉ đọc');
    await page.screenshot({ path: `${SHOTS}/admin-cong-viec.png` });
    await page.context().close();
  }

  await browser.close();
  console.log(`Kiểm tra: ${checks}, lỗi: ${failures.length}`);
  failures.forEach((f) => console.log(' ✗ ' + f));
  process.exit(failures.length ? 1 : 0);
}
run().catch((e) => { console.error(e); process.exit(2); });

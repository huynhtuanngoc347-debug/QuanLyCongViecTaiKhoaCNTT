# Báo cáo kiểm thử — Phase 1: Rà soát toàn bộ & phát hiện lỗi

**Hệ thống:** Quản lý công việc · Khoa Công nghệ Thông tin (NestJS 11 + SQL Server, React web, React app di động `/m/`)
**Ngày kiểm thử:** 17/10/2026 · **Người thực hiện:** QA (Claude)
**Nguyên tắc tuân thủ:** không sửa mã nguồn, không xóa dữ liệu, không chạy lệnh SQL phá hủy. Mọi lệnh ghi khi dò quyền đều gửi **dữ liệu cố tình sai** để không thể lưu vào CSDL.

---

## 1. Tóm tắt

| Mức | Đã xác nhận | Nghi vấn |
|---|---|---|
| P0 — Chặn hệ thống / mất dữ liệu | 0 | 0 |
| P1 — Nghiêm trọng | 2 | 0 |
| P2 — Quan trọng | 3 | 1 |
| P3 — Nhỏ | 8 | 5 |

> **Cập nhật Phase 2 (17/10/2026):** 10/13 lỗi đã xác nhận được sửa và **kiểm lại thành công**; BUG-P2-03 **đóng — đúng nghiệp vụ** (chủ dự án xác nhận giảng viên được xem SĐT đồng nghiệp); BUG-P1-02 **tạm giữ nguyên theo yêu cầu chủ dự án** (chưa thao tác GitHub); 1 lỗi hoãn có lý do (BUG-P3-04). Chi tiết ở **mục 10**.
>
> **Phase 3 (17/10/2026):** 327 kiểm tra — **325 PASS, 2 FAIL** (cả 2 là lỗi có từ trước, không phải hồi quy: NEW-P3-01 đăng xuất không thu hồi refresh token; BUG-P3-09 = SUS-04). Không có hồi quy; CSDL thật nguyên vẹn. Khuyến nghị: chấp nhận bản sửa, **chưa phát hành cho người dùng thật** cho tới khi xử lý BUG-P1-02. Chi tiết ở **mục 11**.
>
> **Sửa lỗi đợt 2 (17/10/2026):** NEW-P3-01 (đăng xuất thu hồi phiên), BUG-P3-09 (nút Back), OBS-01 (h1) — **đã sửa và kiểm lại PASS**, không hồi quy (smoke 98/98, regression 24/24, luồng ghi 42/42, thu hồi phiên 7/7, quét giao diện 140/140, 0 cảnh báo console). CSDL thật chỉ được **thêm** bảng `PhienDaThuHoi`. Còn mở: BUG-P1-02, BUG-P3-04. Chi tiết ở **mục 12**.

**Kết luận nhanh**
- Phân quyền lõi chắc chắn: chưa đăng nhập → 401; giảng viên không đọc được công việc, bình luận, lịch sử, tệp ngoài phạm vi (404); mọi thao tác quản trị đều bị chặn (403).
- Không có lỗi JavaScript nào trên 39 lượt mở trang (4 vai trò × 2 khổ màn hình + app di động).
- Hai lỗi P1 cần xử lý trước khi dùng thật: **chặn đăng nhập theo IP đếm cả lần đăng nhập đúng** (cả khoa dùng chung IP sẽ bị khóa) và **repo GitHub công khai chứa dữ liệu nhân sự + mật khẩu chung**.

---

## 2. Phạm vi, môi trường, giới hạn

| Mục | Chi tiết |
|---|---|
| Máy chủ | `npm start` → NestJS tại `http://localhost:5080` (phục vụ web `/` và app di động `/m/`), SQL Server 2022 Developer qua ODBC Driver 17, đăng nhập Windows |
| Dữ liệu | Dữ liệu mẫu trong CSDL `QLCongViecKhoaCNTT` (55 người dùng, 11 đơn vị, 23 công việc) |
| Tài khoản thử | `admin.demo@example.invalid` (quản trị), `vunh@huit.edu.vn` (trưởng khoa), `baopt@huit.edu.vn` (trưởng bộ môn), `hand@huit.edu.vn` (giảng viên), `trangntt@huit.edu.vn` (giảng viên có việc đang làm) |
| Trình duyệt | Microsoft Edge (Chromium) chế độ headless qua CDP; khổ 1366×860 và 390×844 (giả lập điện thoại) |
| Công cụ | `npm run typecheck`, `npm test`, `npm run smoke` (chỉ đọc), script dò quyền `qa-evidence/probe.mjs`, script quét giao diện `qa-evidence/ui-sweep.mjs` |

**Giới hạn (đã nêu rõ, không suy đoán kết quả):**
- Không chạy các luồng **ghi dữ liệu thành công** trên CSDL thật (tạo/giao/nhận/nộp/duyệt/xóa…) vì quy tắc "không thay đổi dữ liệu"; chỉ thử luồng bị từ chối. Xem mục 7.
- `tools/e2e.mjs` cần Playwright — **chưa cài**, không chạy được.
- Chỉ thử trên Chromium (Edge); chưa thử Firefox/Safari và điện thoại thật.
- Khung trình duyệt nhúng của môi trường làm việc có lúc **tạm dừng vẽ trang** (requestAnimationFrame không chạy) → mọi phép đo giao diện được làm lại bằng Edge headless, không dùng kết quả từ khung nhúng.
- Lúc quét song song 4 vai trò, máy còn ít RAM (SQL Server chậm) — một trường hợp "đang tải mãi" không tái hiện được khi chạy lại (ghi ở mục 7).

---

## 3. Bản đồ tính năng

### 3.1 Vai trò
| Vai trò | Quyền chính (theo chức vụ trong đơn vị) | Trang mặc định |
|---|---|---|
| Quản trị hệ thống | Tổ chức, nhân sự, chức vụ & quyền, thể loại, mẫu, nhật ký; xem toàn bộ công việc (chỉ đọc) | `/admin` |
| Trưởng khoa / Trưởng bộ môn | Tạo, giao, duyệt kết quả, duyệt gia hạn/xin thôi, thống kê đơn vị, thêm thành viên | `/ca-nhan` (góc nhìn "Việc tôi quản lý") |
| Giảng viên / thành viên | Nhận/từ chối việc, cập nhật tiến độ, nộp kết quả, xin gia hạn/xin thôi, bình luận, thống kê cá nhân | `/ca-nhan` |

### 3.2 Trang web (`apps/web`, hash router)
`/admin` · `/ca-nhan` (+`?view=cua-toi`) · `/cong-viec` (Bảng/Kanban/Lịch, phạm vi assigned/created/all) · `/cho-duyet` · `/cong-viec/chi-tiet?id=&tab=overview|assign|result|discuss|history` · `/cong-viec/tao` · `/cong-viec/sua` · `/thong-ke` (+tìm nhân sự) · `/thong-ke-ca-nhan` (+`?person=`) · `/thong-bao` · `/to-chuc` · `/nhan-su` · `/ho-so?id=` · `/them-nhan-su` · `/sua-nhan-su` · `/them-don-vi` · `/them-thanh-vien` · `/chuc-vu` · `/the-loai` · `/mau-cong-viec` · `/nhat-ky` · `/doi-mat-khau` · trang 404. Dưới 720px: giao diện điện thoại, ẩn các trang quản trị (thông báo "Chức năng dùng trên máy tính").

### 3.3 App di động (`apps/mobile`, `/m/`)
Đăng nhập · Trang chủ · Công việc (Được giao / Tôi đã giao / Tất cả / Cần tôi duyệt + bộ lọc) · Chi tiết (tiếp nhận/từ chối, tiến độ, nộp kết quả, đánh giá, duyệt gia hạn/xin thôi, nhắc việc, thảo luận + tệp) · Cập nhật tiến độ · Nộp kết quả · Tạo công việc + giao người · Thông báo · Cá nhân (đổi mật khẩu, chế độ tối, đăng xuất).

### 3.4 API (54 route)
- **Xác thực** `api/auth`: login, refresh, logout, me, doi-mat-khau (cookie httpOnly `khoa_at` 15 phút + `khoa_rt` 7 ngày, SameSite=Strict; app di động có thể dùng Bearer).
- **Tổ chức** `api`: to-chuc, don-vi (GET/POST), don-vi/:id(/thanh-vien), nhan-su(/:id), chuc-vu, chuc-vu/:id/quyen (PUT), thanh-vien (POST).
- **Nhân sự** `api/nhan-su`: POST, PUT :id, cap-lai-mat-khau, trang-thai, DELETE :id; `api/trang/:key`.
- **Công việc** `api`: cong-viec (list/detail/create/update/trang-thai/phan-cong/binh-luan/lich-su/lua-chon-giao-viec), phan-cong/:id (tiep-nhan, tu-choi, phan-cong-lai, tien-do, ket-qua [multipart], gia-han, huy, nhac, xin-tu-choi), ket-qua/:id/danh-gia, gia-han/:id/duyet, xin-tu-choi/:id/duyet, tep/:id (+`?xem=1`), the-loai, mau-cong-viec (CRUD), thong-bao (+da-doc), canh-bao-han, thong-ke/don-vi, thong-ke/ca-nhan, nhat-ky, he-thong/chay-nhac-han.

### 3.5 Thao tác CSDL & luồng nghiệp vụ chính
- Ghi trong giao dịch (`db.tx`) kèm `SESSION_CONTEXT`, khóa `UPDLOCK, HOLDLOCK`; ghi `NhatKyHeThong` cho thao tác quản trị; `LichSuCongViec` chỉ ghi thêm.
- **Luồng công việc:** Tạo (nháp/chính thức) → Giao (cá nhân/đơn vị, chủ trì/phối hợp, hạn riêng) → Tiếp nhận / Từ chối → Cập nhật tiến độ → Nộp kết quả (≤10 tệp × 20 MB) → Đánh giá Đạt / Cần bổ sung / Không đạt → tự đóng Hoàn thành khi mọi phân công Đạt. Nhánh phụ: xin gia hạn → duyệt; xin thôi (sau khi nhận) → duyệt; tạm dừng/tiếp tục/hủy; việc phụ thuộc; lặp lại theo học kỳ/năm học; nhắc hạn mỗi giờ.
- **Tổ chức:** một khoa gốc duy nhất; tạo đơn vị con / đơn vị cha mới; thành viên theo khoảng ngày, đơn vị chính; quyền theo chức vụ.

---

## 4. Kết quả kiểm thử tự động

| Bộ kiểm thử | Kết quả | Ghi chú |
|---|---|---|
| `npm run typecheck` (shared, api, web, mobile) | **Đạt** — 0 lỗi | |
| `npm test` (unit, API) | **5/5 đạt** | Chỉ 5 bài: băm mật khẩu, quy tắc mật khẩu, tham số IN, chuỗi tiếng Việt, múi giờ — **không có test cho luồng nghiệp vụ** |
| `npm run smoke` (CSDL thật, chỉ đọc) | **98/98 đạt** | 4 vai trò × các GET chính + 404 + đăng xuất |
| `tools/e2e.mjs` | **Không chạy được** | Thiếu Playwright |
| Dò quyền & đầu vào (`probe.mjs`) | 55 ca; chi tiết ở mục 5 & 6 | `qa-evidence/probe-quyen-va-dau-vao.txt` |
| Quét giao diện (`ui-sweep.mjs`) | 39 lượt trang × 2 khổ; **0 lỗi JS**, 0 request lỗi ngoài dự kiến | `qa-evidence/qa-*.txt` |

---

## 5. Danh sách kiểm thử (checklist)

Ký hiệu: ✅ Đạt · ❌ Lỗi (xem mã lỗi) · ⚠️ Đạt nhưng có nghi vấn · ⏭️ Chưa chạy (lý do ở mục 7)

### 5.1 Xác thực & phiên
| # | Ca kiểm thử | KQ |
|---|---|---|
| A1 | Đăng nhập đúng cho 5 tài khoản | ✅ |
| A2 | Đăng nhập body rỗng → 400 có lỗi theo ô | ✅ |
| A3 | Đăng nhập JSON hỏng → 400 | ✅ |
| A4 | 12 lần sai liên tiếp → 429 | ✅ |
| A5 | Đăng nhập **đúng** sau vài lần đăng nhập hợp lệ khác cùng IP | ❌ BUG-P1-01 |
| A6 | Thân yêu cầu 3 MB → 413/400 | ❌ BUG-P3-01 (500) |
| A7 | Cookie httpOnly, SameSite=Strict, `khoa_rt` chỉ gửi tới `/api/auth` | ✅ |
| A8 | Đăng xuất → 204, cookie bị xóa | ✅ (smoke) |
| A9 | Token hết hạn 15 phút → tự refresh | ⏭️ |
| A10 | Đổi mật khẩu thành công / đăng xuất phiên khác | ⏭️ |

### 5.2 Phân quyền (API)
| # | Ca kiểm thử | KQ |
|---|---|---|
| B1 | Chưa đăng nhập gọi 5 API → 401 | ✅ |
| B2 | Giảng viên xem chi tiết/bình luận/lịch sử công việc ngoài phạm vi (16, 13, 11) → 404 | ✅ |
| B3 | Giảng viên tải tệp của công việc ngoài phạm vi (tệp 3, 4, 10, 21) → 404 | ✅ |
| B4 | Giảng viên xem nhật ký hệ thống → 403 | ✅ |
| B5 | Giảng viên vào `/api/trang/admin` → 403 | ✅ |
| B6 | Giảng viên tạo đơn vị / nhân sự / sửa / xóa nhân sự → 403 | ✅ |
| B7 | Giảng viên sửa / đổi trạng thái / giao việc trên công việc ngoài quyền → 403 | ✅ |
| B8 | Giảng viên xin gia hạn phân công của người khác → 403 | ✅ |
| B9 | Giảng viên xem thống kê cá nhân của trưởng khoa (`personId=33`) → 403 | ✅ |
| B10 | Giảng viên xem thống kê đơn vị ngoài phạm vi (`unitId=1`) → 403 | ✅ |
| B11 | Giảng viên xem thống kê cá nhân đồng nghiệp cùng bộ môn | ⚠️ SUS-02 |
| B12 | Giảng viên đọc toàn bộ danh bạ nhân sự `/api/nhan-su`, hồ sơ người khác | ❌ BUG-P2-03 |
| B13 | Giảng viên lấy danh sách người để giao việc trên công việc ngoài quyền | ❌ BUG-P3-03 (200 rỗng) |
| B14 | Lệnh ghi sai dữ liệu + không có quyền (tiến độ, đánh giá, hủy, xin thôi, bình luận, thể loại, thành viên, quyền chức vụ, trạng thái nhân sự) | ⚠️ BUG-P3-04 (trả 400 trước 403; quyền vẫn được kiểm — xác nhận qua mã ở `progress()`) |
| B15 | CORS từ origin lạ → không có `Access-Control-Allow-Origin` | ✅ |

### 5.3 Kiểm tra đầu vào (API)
| # | Ca kiểm thử | KQ |
|---|---|---|
| D1 | `GET /api/cong-viec/abc` → 400 | ✅ |
| D2 | `GET /api/cong-viec/999999` → 404 | ✅ |
| D3 | `scope=hacker` / `scope=all' OR 1=1--` → 400 | ❌ BUG-P3-02 (200 rỗng; không có SQL injection — tham số hóa) |
| D4 | `thong-bao?limit=100000` → giới hạn | ✅ |
| D5 | `nhat-ky?limit=-5` | ❌ BUG-P3-05 |
| D6 | Thống kê `from > to`, ngày sai, kỳ > 10 năm → 400 có thông báo | ✅ |
| D7 | `tep/999999`, `tep/-1` → 404 | ✅ |
| D8 | Tạo đơn vị gốc / loại "Khoa" / cha mới không thuộc khoa → 400 | ✅ (kiểm ở phiên trước, dữ liệu sai cố ý) |
| D9 | Đuôi tệp, kích thước tệp, tệp rỗng khi nộp kết quả | ✅ qua mã (`validateFiles`), ⏭️ thực tế |

### 5.4 Giao diện web (Edge 1366px & 390px)
| # | Ca kiểm thử | KQ |
|---|---|---|
| U1 | 14 trang quản trị mở được, không lỗi JS / request lỗi | ✅ |
| U2 | 17 trang trưởng khoa (cả Kanban, Lịch, 5 tab chi tiết, tạo, sửa) | ✅ |
| U3 | 7 trang trưởng bộ môn | ✅ |
| U4 | Giảng viên mở `/admin`, `/nhan-su`, `/ho-so?id=33` → chuyển về Trang cá nhân | ✅ |
| U5 | Giảng viên mở công việc ngoài quyền → thông báo "Không tìm thấy" | ✅ |
| U6 | Trang không tồn tại → "Không tìm thấy trang" | ✅ |
| U7 | Khổ 390px: không tràn ngang | ❌ BUG-P2-01 (trang chi tiết) |
| U8 | Khổ 390px: trang quản trị hiện "Chức năng dùng trên máy tính" | ✅ |
| U9 | Hiệu ứng xuất hiện không để khối nội dung bị ẩn (13 trang, cuộn hết) | ✅ |
| U10 | Đổi kỳ thống kê giữ từ khóa tìm nhân sự | ❌ BUG-P3-06 |
| U11 | Cảnh báo "rời biểu mẫu chưa lưu" khi dùng nút Back / sửa URL | ⚠️ SUS-04 |
| U12 | Hộp cảnh báo hạn: tắt nhắc hôm nay + "Để sau" | ✅ |

### 5.5 App di động `/m/` (390px)
| # | Ca kiểm thử | KQ |
|---|---|---|
| M1 | 12 màn của giảng viên + 5 màn của trưởng khoa, không lỗi JS | ✅ |
| M2 | Công việc ngoài quyền → trang lỗi | ⚠️ BUG-P3-07 (tiêu đề "Chưa thể tải dữ liệu" cho trường hợp 404) |
| M3 | Trang không tồn tại có tiêu đề `h1` | ❌ BUG-P3-08 |
| M4 | Giao nhiều người khi tạo việc là một thao tác nguyên vẹn | ⚠️ SUS-05 |

### 5.6 Bảo mật & cấu hình
| # | Ca kiểm thử | KQ |
|---|---|---|
| S1 | `X-Content-Type-Options: nosniff`, `Referrer-Policy`, API `Cache-Control: no-store` | ✅ |
| S2 | Chống clickjacking (`X-Frame-Options` / CSP `frame-ancestors`) | ❌ BUG-P2-02 |
| S3 | `.env`, `.env.bak`, `env-windows.txt` không có trong git | ✅ |
| S4 | Repo GitHub không lộ dữ liệu cá nhân / mật khẩu | ❌ BUG-P1-02 |
| S5 | Xem tệp trực tiếp có CSP `sandbox` | ✅ |

---

## 6. Lỗi đã xác nhận

### BUG-P1-01 — Chặn đăng nhập đếm cả lần đăng nhập ĐÚNG, theo IP dùng chung
- **Mức:** P1 · **Thành phần:** `apps/api/src/auth/auth.guard.ts` `checkLoginRate()` (gọi ở `auth.controller.ts` dòng 66 và 148)
- **Mô tả:** Mỗi lần gọi `/api/auth/login` (và `/doi-mat-khau`) đều tăng bộ đếm theo **IP**, kể cả đăng nhập thành công hoặc lỗi nhập liệu; quá 10 lần/5 phút → 429 cho mọi tài khoản cùng IP. Ở trường, cả khoa thường ra Internet qua một IP (NAT) → sau ~10 lượt đăng nhập đầu giờ, người thứ 11 trở đi bị khóa 5 phút dù nhập đúng. Thông báo "Đăng nhập **sai** quá nhiều lần" gây hiểu nhầm.
- **Tái hiện:**
  1. Từ cùng một máy, đăng nhập đúng lần lượt bằng 4–5 tài khoản mẫu, rồi gửi vài yêu cầu đăng nhập thiếu trường.
  2. Đăng nhập đúng `hand@huit.edu.vn` / mật khẩu mẫu.
- **Mong đợi:** 200 — chỉ lần **sai** mới bị đếm, và nên đếm theo tài khoản + IP.
- **Thực tế:** `429 {"message":"Đăng nhập sai quá nhiều lần. Vui lòng thử lại sau 5 phút."}` với mật khẩu đúng (đã xảy ra 2 lần trong buổi kiểm thử).
- **Bằng chứng:** `qa-evidence/probe-quyen-va-dau-vao.txt` (dòng "POST login email 5000 ký tự → 429" ngay sau 5 lượt đăng nhập hợp lệ); lần chạy `probe2.mjs`: `login 429` với mật khẩu đúng; mã nguồn: `entry.count++` không phân biệt thành công/thất bại, khóa theo `ip ?? 'unknown'`.

### BUG-P1-02 — Repo GitHub công khai chứa dữ liệu nhân sự thật và mật khẩu chung
- **Mức:** P1 (bảo mật / dữ liệu cá nhân) · **Thành phần:** repo `huynhtuanngoc347-debug/QuanLyCongViecTaiKhoaCNTT`, `README.md`
- **Mô tả:** Repo truy cập được không cần đăng nhập. README liệt kê email tài khoản quản trị/trưởng khoa/trưởng bộ môn/giảng viên và **mật khẩu chung** `Demo@CNTT2026!`; mã/tài liệu chứa họ tên, email cán bộ. Nếu hệ thống chạy với dữ liệu mẫu ở nơi truy cập được, bất kỳ ai cũng đăng nhập được với quyền quản trị.
- **Tái hiện:** mở `https://github.com/huynhtuanngoc347-debug/QuanLyCongViecTaiKhoaCNTT` ở cửa sổ ẩn danh → đọc README mục "Tài khoản thử".
- **Mong đợi:** repo riêng tư, hoặc không có thông tin đăng nhập/dữ liệu cá nhân.
- **Thực tế:** HTTP 200 cho người chưa đăng nhập (kiểm tra lúc lập báo cáo).
- **Bằng chứng:** `curl https://github.com/…/QuanLyCongViecTaiKhoaCNTT` → 200; `README.md` dòng 68–69 (bản trên GitHub: dòng 61–62).

### BUG-P2-01 — Trang chi tiết công việc tràn ngang trên điện thoại (≤ 720px)
- **Mức:** P2 · **Thành phần:** web `/cong-viec/chi-tiet` (ô "Hạn hoàn thành" trong `.kv-grid`, `mobile.css`)
- **Tái hiện:** giảng viên `hand`, khổ 390px, mở `#/cong-viec/chi-tiet?id=1` (việc đã hoàn thành).
- **Mong đợi:** chữ "Đã hoàn thành 14/09/2026" xuống dòng trong ô; không cuộn ngang.
- **Thực tế:** chữ tràn khỏi ô, bị cắt "…14/09/20"; trang có thể cuộn ngang (`scrollWidth > 390`).
- **Bằng chứng:** `qa-evidence/BUG-P2-01_tran-chu-chi-tiet-390px.jpg`; `qa-evidence/qa-hand.txt` (dòng `390 /cong-viec/chi-tiet?id=1 … OVERFLOW`).

### BUG-P2-02 — Thiếu chống clickjacking
- **Mức:** P2 · **Thành phần:** `apps/api/src/main.ts` (middleware header)
- **Tái hiện:** `GET /` và đọc header phản hồi.
- **Mong đợi:** `X-Frame-Options: DENY` hoặc `Content-Security-Policy: frame-ancestors 'none'`.
- **Thực tế:** cả hai đều không có → trang đăng nhập/quản trị có thể bị nhúng vào iframe của trang khác.
- **Bằng chứng:** `HEADERS /: content-security-policy=null | x-frame-options=null …` trong `probe-quyen-va-dau-vao.txt`.

### BUG-P2-03 — API trả toàn bộ danh bạ nhân sự cho mọi người đã đăng nhập (giao diện thì ẩn)
- **Mức:** P2 (dữ liệu cá nhân; cần xác nhận nghiệp vụ) · **Thành phần:** `organization.controller.ts` `GET nhan-su`, `GET nhan-su/:id` (không kiểm quyền)
- **Tái hiện:** đăng nhập `hand` (giảng viên, không có quyền quản lý) → `GET /api/nhan-su`, `GET /api/nhan-su/33`.
- **Mong đợi:** thống nhất với giao diện (`/nhan-su`, `/ho-so?id=` chỉ cho người có phạm vi quản lý) — 403, hoặc trả bản rút gọn không có SĐT/mã nhân sự.
- **Thực tế:** 200 với đủ 55 hồ sơ (email, mã nhân sự, học vị, số điện thoại, trạng thái) và hồ sơ trưởng khoa kèm đơn vị/chức vụ.
- **Bằng chứng:** `probe-quyen-va-dau-vao.txt` dòng `hand GET /api/nhan-su/33 … got 200` và `hand GET /api/nhan-su … got 200`; giao diện chuyển `hand` khỏi `/nhan-su` và `/ho-so?id=33` (`qa-hand.txt`).

### BUG-P3-01 — Thân JSON quá lớn trả 500 thay vì 413/400
- **Thành phần:** `main.ts` (`useBodyParser('json', { limit: '2mb' })`) + bộ lọc lỗi `app.module.ts` (lỗi `PayloadTooLargeError` của body-parser không phải `HttpException`).
- **Tái hiện:** `POST /api/auth/login` với mật khẩu 3 MB. **Mong đợi:** 413/400 "Dữ liệu quá lớn". **Thực tế:** `500 Máy chủ gặp lỗi`.

### BUG-P3-02 — Tham số `scope` không hợp lệ vẫn trả 200
- **Tái hiện:** `GET /api/cong-viec?scope=hacker` (hoặc `scope=all' OR 1=1--`). **Mong đợi:** 400. **Thực tế:** 200, `items: []`. (Không có SQL injection — truy vấn tham số hóa.)

### BUG-P3-03 — `lua-chon-giao-viec` không báo không có quyền
- **Tái hiện:** `hand` → `GET /api/cong-viec/lua-chon-giao-viec?taskId=16` (công việc ngoài phạm vi). **Mong đợi:** 403/404. **Thực tế:** 200 `{"people":[],"units":[]}`.

### BUG-P3-04 — Kiểm tra dữ liệu chạy trước kiểm tra quyền
- **Mô tả:** nhiều lệnh ghi trả 400 kèm lỗi theo ô cho người không có quyền (tiến độ, đánh giá, hủy/xin thôi phân công, bình luận, thể loại, thành viên, quyền chức vụ, trạng thái nhân sự). Quyền **vẫn được kiểm** khi dữ liệu hợp lệ (đọc mã `task.commands.ts` `progress()`: `isAssignee` → 403), nên không lọt quyền; chỉ lộ cấu trúc ô nhập và không nhất quán.
- **Tái hiện:** `hand` → `POST /api/phan-cong/15/tien-do {percent:999}`. **Mong đợi:** 403. **Thực tế:** 400 với lỗi `percent`, `note`.

### BUG-P3-05 — `nhat-ky?limit=-5` trả 1 dòng
- **Mong đợi:** 400 hoặc dùng mặc định 200. **Thực tế:** kẹp về 1 (`Math.max(1, …)`), người dùng không biết.

### BUG-P3-06 — Đổi kỳ thống kê làm mất từ khóa tìm nhân sự
- **Thành phần:** `Stats.tsx` `PeriodBar` chỉ giữ `{unit, cat}`; tham số `q`, `sort` của bảng "Theo nhân sự" bị bỏ.
- **Tái hiện:** `/thong-ke?q=trang` → bấm "Năm học". **Mong đợi:** vẫn lọc "trang". **Thực tế:** danh sách đầy đủ. (Xác nhận qua mã nguồn; đã ghi chú khi bàn giao tính năng.)

### BUG-P3-07 — App di động: công việc không có quyền hiện "Chưa thể tải dữ liệu"
- **Tái hiện:** `/m/#/tasks/16` bằng giảng viên. **Mong đợi:** tiêu đề "Không tìm thấy công việc" (giống bản web). **Thực tế:** tiêu đề chung "Chưa thể tải dữ liệu" + biểu tượng lỗi kết nối, dễ hiểu nhầm là mất mạng.
- **Bằng chứng:** `qa-evidence/mobile-loi-404.png` (ảnh giữa).

### BUG-P3-08 — App di động: trang 404 không có tiêu đề `h1`
- **Tái hiện:** `/m/#/khong-co`. **Thực tế:** tiêu đề dùng `h2`, trang không có `h1` (ảnh hưởng trình đọc màn hình). **Bằng chứng:** `qa-m-trang.txt` (`h1=""`).

---

## 7. Nghi vấn (chưa đủ bằng chứng là lỗi) & ca chưa thực hiện

### 7.1 Nghi vấn
| Mã | Mức dự kiến | Mô tả | Cần làm để xác nhận |
|---|---|---|---|
| SUS-01 | P2 | Tải tệp nộp kết quả lên đĩa **trước** khi kiểm quyền (multer chạy trước `submit()`); người đã đăng nhập có thể đẩy tới 10×20 MB mỗi request vào phân công bất kỳ — tệp bị xóa sau đó nhưng vẫn tốn băng thông/đĩa. | Thử tải tệp lớn vào phân công không thuộc mình trên môi trường thử |
| SUS-02 | Nghiệp vụ | Giảng viên `hand` xem được thống kê cá nhân của đồng nghiệp cùng bộ môn (`personId=8` → 200) vì chức vụ "Giảng viên" đang có quyền tạo việc ở bộ môn. | Xác nhận với khoa: giảng viên có được xem số liệu của đồng nghiệp không |
| SUS-03 | P3 | Tệp tải về (không xem trực tiếp) dùng `Content-Type` do trình duyệt gửi lúc tải lên (`LoaiTep`); đã có `attachment` + `nosniff` nên rủi ro thấp. | Rà khi cứng hóa bảo mật |
| SUS-04 | P3 | Console cảnh báo React Router: *"You are trying to use a blocker on a POP navigation … This will fail silently in production"* ở các trang có cảnh báo "chưa lưu" (`useDirtyGuard`). Có thể nút Back / sửa URL bỏ qua cảnh báo mất dữ liệu đang nhập. | Nhập dở biểu mẫu rồi bấm Back của trình duyệt |
| SUS-05 | P3 | App di động "Tạo và chọn người thực hiện" gửi 2 lệnh giao riêng (chủ trì, phối hợp); nếu lệnh thứ hai lỗi thì chỉ giao được một phần. | Giả lập lỗi lệnh thứ hai trên môi trường thử |

### 7.2 Không tái hiện được
- Tab **Lịch sử** của `#/cong-viec/chi-tiet?id=7` hiện "đang tải" lúc quét song song 4 vai trò; chạy lại 2 lần riêng lẻ: tải xong 5 dòng trong ~250 ms, `/api/cong-viec/7/lich-su` → 200. Nghi do SQL Server chậm khi máy thiếu RAM (đã gặp `Query timeout expired` ở các buổi trước) — **không coi là lỗi mã nguồn**, nhưng nên có màn hình thử lại khi truy vấn quá hạn.

### 7.3 Ca CHƯA thực hiện (và lý do)
| Ca | Lý do |
|---|---|
| Toàn bộ luồng ghi thành công: tạo/sửa/nháp/công khai việc, giao, tiếp nhận, từ chối, tiến độ, nộp kết quả có tệp, đánh giá, gia hạn, xin thôi, tạm dừng/hủy, bình luận có tệp, đánh dấu đã đọc | Quy tắc Phase 1: không thay đổi dữ liệu |
| CRUD nhân sự (thêm, sửa, khóa, cấp lại mật khẩu, xóa), thêm đơn vị/thành viên thành công, lưu quyền chức vụ, CRUD thể loại & mẫu | Như trên |
| Đổi mật khẩu, đăng xuất các phiên khác, refresh token sau 15 phút, hết hạn 7 ngày | Như trên / cần chờ thời gian thật |
| Tác vụ nhắc hạn `POST /api/he-thong/chay-nhac-han`, sinh việc lặp lại | Ghi thông báo vào CSDL |
| `tools/e2e.mjs` + `tools/mock-api.mjs` | Chưa cài Playwright |
| Firefox, Safari, điện thoại thật, trình đọc màn hình, chế độ tối app di động | Không có trong môi trường |
| Tải trọng / hiệu năng nhiều người dùng | Ngoài phạm vi Phase 1 |

**Đề xuất cho Phase 2:** dựng bản sao CSDL thử (hoặc giao dịch ROLLBACK) để chạy các luồng ghi; cài Playwright để chạy `tools/e2e.mjs`; bổ sung test tích hợp cho luồng công việc (hiện chỉ có 5 unit test).

---

## 8. Thứ tự xử lý đề xuất (chờ phê duyệt — chưa sửa gì)
1. **BUG-P1-01** chặn đăng nhập (chỉ đếm lần sai, theo tài khoản + IP).
2. **BUG-P1-02** chuyển repo sang riêng tư, bỏ mật khẩu khỏi README, cân nhắc đổi mật khẩu mẫu.
3. **BUG-P2-02** thêm `X-Frame-Options`/CSP; **BUG-P2-03** giới hạn API nhân sự theo quyền; **BUG-P2-01** tràn chữ trên điện thoại.
4. Các lỗi P3 và nghi vấn SUS-04, SUS-01.

---

## 9. Trạng thái mã nguồn lúc kiểm thử
- Commit cuối trên GitHub: `6fdc9a2`. Thư mục làm việc có **thay đổi chưa commit** (combobox, chuyển động, chữ đậm, cảnh báo hạn, quy tắc một khoa, tìm nhân sự, sửa lịch sử) — kiểm thử chạy trên bản build từ thư mục làm việc này.
- Không có tệp mã nguồn nào bị sửa trong Phase 1. Tệp mới: `QA_AUDIT_REPORT.md` và thư mục `qa-evidence/` (ảnh, nhật ký, script kiểm thử chỉ đọc).

---

## 10. Phase 2 — Trạng thái sửa lỗi

Nguyên tắc: xác minh nguyên nhân gốc trước khi sửa, sửa tối thiểu, không đổi kiến trúc/giao diện/nghiệp vụ, không nới lỏng bảo mật, không chạm dữ liệu thật. "Đã sửa" chỉ dùng khi **kiểm lại thành công**.

### 10.1 Bảng trạng thái

| Mã | Mức | Nguyên nhân gốc (đã xác minh) | Trạng thái | Kiểm lại |
|---|---|---|---|---|
| BUG-P1-01 | P1 | `checkLoginRate()` tăng bộ đếm cho **mọi** yêu cầu đăng nhập/đổi mật khẩu theo IP, kể cả thành công | ✅ **Đã sửa** | Unit 4 ca + HTTP: 12 lượt đăng nhập đúng liên tiếp đều 200; 10 lần sai → 401, lần 11 → 429; tài khoản khác cùng IP vẫn 200 |
| BUG-P1-02 | P1 | Repo GitHub để Public; README ghi mật khẩu chung | ⏸️ **Tạm giữ nguyên** — chủ dự án yêu cầu chưa thao tác GitHub (17/10/2026) | Rủi ro vẫn còn; xem 10.3 |
| BUG-P2-01 | P2 | Ô thông tin chuyển 2 cột trên điện thoại (`mobile.css`) nhưng chữ hạn dùng lớp `.due` có `white-space:nowrap` | ✅ **Đã sửa** | Edge 390px: `scrollWidth 390 = innerWidth`, 0 ô tràn; ảnh `qa-evidence/FIX-P2-01_sau-khi-sua-390px.jpg` |
| BUG-P2-02 | P2 | Middleware header không đặt `X-Frame-Options` / CSP `frame-ancestors` | ✅ **Đã sửa** | Unit + HTTP: `/`, `/m/`, `/api/health` đều có `X-Frame-Options: DENY`, `CSP: frame-ancestors 'none'`; quét 24 lượt trang không lỗi |
| BUG-P2-03 | P2 | `GET /api/nhan-su(/:id)`, `GET /api/to-chuc` trả hồ sơ (email, SĐT, mã nhân sự) cho mọi người đã đăng nhập | ✔️ **Đóng — đúng nghiệp vụ** (chủ dự án xác nhận 17/10/2026: giảng viên được xem SĐT đồng nghiệp) | Không sửa mã. Ghi chú: giao diện vẫn ẩn trang Nhân sự/Hồ sơ người khác với giảng viên — chỉ là phạm vi màn hình, không phải bảo mật |
| BUG-P3-01 | P3 | Lỗi `entity.too.large` của body-parser không phải `HttpException` → bộ lọc trả 500 | ✅ **Đã sửa** | HTTP: thân 3 MB → 413 "Dữ liệu gửi lên quá lớn (tối đa 2 MB)."; JSON hỏng vẫn 400 |
| BUG-P3-02 | P3 | `GET cong-viec` không kiểm `scope` | ✅ **Đã sửa** | Unit + HTTP: `scope=hacker`, `scope=all' OR 1=1--` → 400; 4 phạm vi hợp lệ và không truyền scope → 200 |
| BUG-P3-03 | P3 | `lua-chon-giao-viec?taskId=` không kiểm người gọi có xem được công việc | ✅ **Đã sửa** | HTTP: giảng viên + công việc ngoài phạm vi → 404; không tồn tại → 404; quản trị → 200; không truyền taskId (dùng khi tạo việc) → 200 |
| BUG-P3-04 | P3 | Nhiều lệnh ghi kiểm dữ liệu trước rồi mới kiểm quyền | ⏭️ **Hoãn** | Quyền vẫn được kiểm (không lọt quyền); sửa phải đảo thứ tự trong ~10 lệnh ghi → rủi ro thay đổi hành vi lớn hơn lợi ích. Đề xuất làm cùng đợt viết test tích hợp cho luồng ghi |
| BUG-P3-05 | P3 | `Math.max(1, toInt(limit) ?? 200)` kẹp số âm về 1 | ✅ **Đã sửa** | Unit 6 ca + HTTP: `limit=-5` → 200 dòng (mặc định); `limit=2` → 2 dòng |
| BUG-P3-06 | P3 | `PeriodBar` chỉ giữ `unit`, `cat` khi tạo đường dẫn đổi kỳ | ✅ **Đã sửa** | Edge: `/thong-ke?q=trang&sort=overdue` → bấm "Năm học" → `?q=trang&sort=overdue&period=year`, ô tìm vẫn "trang" |
| BUG-P3-07 | P3 | App di động hiển thị mọi lỗi tải là "Chưa thể tải dữ liệu" | ✅ **Đã sửa** | Edge: `/m/#/tasks/16` và `/tasks/16/update` → "Không tìm thấy công việc" + nút "Về danh sách công việc"; công việc có quyền vẫn mở bình thường |
| BUG-P3-08 | P3 | `StateView` luôn dùng `h2` | ✅ **Đã sửa** | Edge: `/m/#/khong-co-trang` có `h1` "Không tìm thấy trang" |

Các mục nghi vấn (SUS-01 … SUS-05) **chưa sửa** vì chưa được xác nhận là lỗi.

### 10.2 Tệp đã thay đổi và lý do

| Tệp | Thay đổi | Lỗi |
|---|---|---|
| `apps/api/src/auth/login-throttle.ts` (mới) | Bộ chặn dò mật khẩu: chỉ đếm lần sai, theo IP + tài khoản (10/5 phút) và theo IP (50/5 phút); đúng thì xóa bộ đếm tài khoản; đồng hồ tiêm được để test | P1-01 |
| `apps/api/src/auth/auth.controller.ts` | Đăng nhập: kiểm khóa sau khi kiểm dữ liệu, ghi nhận sai/đúng; đổi mật khẩu: đếm theo người dùng khi nhập sai mật khẩu hiện tại | P1-01 |
| `apps/api/src/auth/auth.guard.ts` | Gỡ `checkLoginRate()` cũ | P1-01 |
| `apps/api/src/common/security-headers.ts` (mới) | Middleware header: nosniff, Referrer-Policy, `X-Frame-Options: DENY`, `CSP: frame-ancestors 'none'`, no-store cho API | P2-02 |
| `apps/api/src/main.ts` | Dùng middleware trên thay cho hàm nội tuyến | P2-02 |
| `apps/api/src/app.module.ts` | Bộ lọc lỗi: `entity.too.large` → 413, `entity.parse.failed` → 400 | P3-01 |
| `apps/api/src/common/query-params.ts` (mới) | `isTaskScope()`, `clampLimit()` | P3-02, P3-05 |
| `apps/api/src/tasks/tasks.controller.ts` | Kiểm `scope`; `lua-chon-giao-viec` trả 404 khi không xem được công việc; `nhat-ky` dùng `clampLimit` | P3-02, P3-03, P3-05 |
| `apps/api/src/regression.test.ts` (mới) | 7 test hồi quy (logic thuần, không cần CSDL) | P1-01, P2-02, P3-02, P3-05 |
| `apps/api/package.json` | `npm test` chạy thêm `regression.test.js` | — |
| `tools/regression.mjs` (mới), `package.json` gốc | `npm run regression`: 24 kiểm thử HTTP chỉ đọc trên máy chủ thật | P1-01, P2-02, P3-01/02/03/05 |
| `apps/web/src/mobile.css` | `.kv .due, .kv dd` được xuống dòng trên điện thoại | P2-01 |
| `apps/web/src/tasks/Stats.tsx` | `PeriodBar` giữ `q`, `sort` khi đổi kỳ | P3-06 |
| `apps/mobile/src/ui.tsx` | `StateView` nhận `heading="h1"`; thêm `LoadError` phân biệt 404/403 với lỗi tải | P3-07, P3-08 |
| `apps/mobile/src/screens/TaskDetail.tsx`, `TaskActions.tsx` | Dùng `LoadError` | P3-07 |
| `apps/mobile/src/App.tsx` | Trang 404 dùng `heading="h1"` | P3-08 |
| `qa-evidence/` | Ảnh sau khi sửa, `ui-retest.mjs` | — |

### 10.3 Quyết định của chủ dự án

- **17/10/2026:** "Tạm thời chưa đụng gì tới GitHub" → BUG-P1-02 giữ nguyên, **rủi ro vẫn còn** cho tới khi repo chuyển Private và đổi mật khẩu mẫu. Không commit, không push các thay đổi Phase 2.
- **17/10/2026:** "Giảng viên được xem số điện thoại của đồng nghiệp" → BUG-P2-03 đóng, không phải lỗi.

Nội dung đã nêu khi xin quyết định (giữ để tham khảo):

- **BUG-P1-02 — repo công khai + mật khẩu chung.** Việc sửa thật sự nằm ngoài mã nguồn: (1) chuyển repo sang **Private** trên GitHub (Settings → Danger Zone); (2) mật khẩu đã nằm trong lịch sử git nên nên **đổi mật khẩu các tài khoản mẫu** — việc này sửa dữ liệu trong CSDL nên cần bạn đồng ý; (3) bỏ mật khẩu khỏi README sẽ làm `npm run smoke` / `regression` / hướng dẫn chạy demo mất giá trị mặc định → cần bạn chọn cách cấp mật khẩu cho nhóm (biến môi trường `SMOKE_PASSWORD`, tệp không commit…).
- **BUG-P2-03 — danh bạ nhân sự.** `/api/to-chuc` được mọi trang dùng (tên người, avatar, ô chọn người) và cũng trả email/SĐT/mã nhân sự của 55 người. Chặn hẳn `/api/nhan-su` không giải quyết được, còn ẩn bớt trường ở `/api/to-chuc` thay đổi dữ liệu mà nhiều màn hình dùng. Cần bạn quyết định: giảng viên có được xem email/SĐT đồng nghiệp không? Nếu không, phương án đề xuất: chỉ trả `phone`, `employeeCode` cho quản trị / người có phạm vi quản lý / chính chủ, giữ nguyên tên và email.

### 10.4 Kết quả chạy lại toàn bộ (sau khi sửa, máy chủ đã khởi động lại với bản build mới)

| Bộ kiểm thử | Trước | Sau |
|---|---|---|
| `npm run typecheck` | 0 lỗi | **0 lỗi** |
| `npm test` (unit) | 5/5 | **12/12** (thêm 7 hồi quy) |
| `npm run smoke` (chỉ đọc) | 98/98 | **98/98** |
| `npm run regression` (mới, chỉ đọc) | — | **24/24** |
| Kiểm lại giao diện (`qa-evidence/ui-retest.mjs`) | — | **6/6**, 0 lỗi JS |
| Quét giao diện trưởng khoa (12 trang × 2 khổ) | — | 0 lỗi JS, 0 tràn ngang; chỉ còn cảnh báo cũ SUS-04 |


---

## 11. Phase 3 — Kiểm thử hồi quy và xác nhận cuối (17/10/2026)

### 11.1 Môi trường và cách bảo vệ dữ liệu
- Bản build đang chạy **mới hơn** mọi tệp mã nguồn đã sửa (dist API 02:29:57, web 02:30:13, mobile 02:30:28; tệp nguồn sửa cuối 02:28:58).
- Luồng ghi được chạy trên **bản sao CSDL** `QLCongViecKhoaCNTT_QA` (sao lưu `COPY_ONLY` → khôi phục sang tên mới), qua một API thứ hai ở cổng **5090** (thư mục tệp tải lên riêng ở thư mục tạm, tắt tác vụ nhắc hạn tự động). Các script ghi tự từ chối chạy nếu trỏ vào cổng 5080.
- `smoke`/`regression` cũng chạy trên 5090 vì đăng nhập có ghi nhật ký vào CSDL.
- **CSDL thật không bị thay đổi:** chụp `COUNT_BIG(*)` + `CHECKSUM_AGG(BINARY_CHECKSUM(*))` của toàn bộ 20 bảng trước và sau Phase 3 → **trùng khớp 100%**; 0 công việc/nhân sự `[THỬ-P3]` trong CSDL thật.
- Không thao tác GitHub (theo yêu cầu chủ dự án). Bản sao CSDL `QLCongViecKhoaCNTT_QA` **vẫn còn** để đối chiếu — có thể xóa khi chủ dự án đồng ý.

### 11.2 Kết quả theo bộ kiểm thử

| # | Bộ kiểm thử | Số kiểm tra | PASS | FAIL | Bằng chứng |
|---|---|---|---|---|---|
| 1 | `npm run typecheck` (shared, api, web, mobile) | 1 | 1 | 0 | mã thoát 0 |
| 2 | `npm test` — unit + hồi quy | 12 | 12 | 0 | `# pass 12 # fail 0` |
| 3 | `npm run smoke` (4 vai trò, chỉ đọc) | 98 | 98 | 0 | `qa-evidence/phase3/smoke.txt` |
| 4 | `npm run regression` (các lỗi Phase 2) | 24 | 24 | 0 | `phase3/regression.txt` |
| 5 | Luồng ghi đầu-cuối trên bản sao (`phase3/workflow.mjs`) | 42 | 41 | **1** | `phase3/workflow-run2.txt` |
| 6 | Bổ sung: chặn đổi mật khẩu, SUS-01 (`extra.mjs`) | 2 | 2 | 0 | `phase3/extra.txt` |
| 7 | Tác vụ nhắc hạn (`reminder.mjs`) | 1 | 1 | 0 | `phase3/reminder.txt` |
| 8 | Kiểm lại giao diện các lỗi đã sửa (Edge headless) | 6 | 6 | 0 | `phase3/ui-retest.txt`, ảnh `P3-retest-*.jpg` |
| 9 | Quét giao diện 6 vai trò/ứng dụng × 2 khổ (1366/390) | 138 lượt trang | 138 | 0 | `phase3/sweep-*.txt` |
| 10 | SUS-04 — nút Back khi biểu mẫu còn dở | 2 | 1 | **1** | `phase3/sus04.txt` |
| 11 | Toàn vẹn CSDL thật | 1 | 1 | 0 | so sánh checksum 20 bảng |
| | **Tổng** | **327** | **325** | **2** | |

Ghi chú trung thực:
- Lần chạy đầu của `workflow.mjs` có 4 FAIL; 3 trong số đó do **script đọc sai vị trí `id`** trong phản hồi (`{unit:{id}}`, `{person:{id}}`), không phải lỗi ứng dụng — đã sửa script và chạy lại (`workflow-run1.txt` giữ nguyên để đối chiếu). FAIL còn lại là NEW-P3-01.
- Lần quét giao diện đầu bị Git Bash đổi tham số `/admin` thành `C:/Program Files/Git/admin` → **kết quả bị loại bỏ**, chạy lại với `MSYS_NO_PATHCONV=1`; chỉ kết quả lần 2 được tính.
- SUS-01 lần đầu dùng tệp `.bin` → 400 (lỗi loại tệp, đúng hiện tượng BUG-P3-04); chạy lại với tệp `.pdf` hợp lệ để kiểm đúng ý đồ.
- Quét giao diện: 0 lỗi JS, 0 `console.error`, 0 request lỗi mạng, 0 tràn ngang, 0 trang treo "đang tải". Có 8 phản hồi `404 /api/cong-viec/16` — **đúng thiết kế** (người không có quyền mở công việc 16; giao diện báo "Không tìm thấy công việc hoặc bạn không có quyền xem"). Có 7 cảnh báo React Router thuộc SUS-04.
- Nhật ký máy chủ 5080 và 5090: 0 dòng `ERROR`/`WARN` trong suốt Phase 3.

### 11.3 Chi tiết luồng ghi đã kiểm (trên bản sao) — tất cả PASS trừ NEW-P3-01
- **Xác thực:** me / refresh / logout 204 + xóa cookie; cookie `HttpOnly; SameSite=Strict`; sai mật khẩu 401 không cấp cookie; đổi mật khẩu (sai hiện tại 400, mật khẩu yếu 400, đúng 204, mật khẩu cũ 401, mới 200); tài khoản bị khóa không đăng nhập được kể cả đúng mật khẩu.
- **Nhân sự CRUD:** thêm (201 + mật khẩu tạm), trùng email khác hoa/thường 400, sửa và đọc lại, khóa/mở, cấp lại mật khẩu, xóa người mới (204 → đọc lại 404), xóa người đã có dữ liệu công việc 409; giảng viên thêm nhân sự 403.
- **Tổ chức:** tạo đơn vị loại "Khoa" thứ hai → 400 (quy tắc một khoa); tạo nhóm con 201; thêm thành viên 201, trùng 400; giảng viên thêm thành viên 403.
- **Danh mục:** thể loại thêm/sửa/ngừng; mẫu công việc thêm/sửa/xóa; giảng viên thêm thể loại 403.
- **Kiểm dữ liệu công việc:** hạn đã qua, tiêu đề rỗng, hạn trước ngày bắt đầu, ngày 30/02, tiêu đề 251 ký tự, ưu tiên 9 → 400 đúng trường; giảng viên tạo việc cho đơn vị Khoa → 400 `unitId`.
- **Nghiệp vụ chính:** tạo → giao chủ trì + phối hợp (trùng 400, hạn riêng muộn hơn hạn chung 400, người nhận chỉ thấy việc sau khi được giao) → thông báo → nhận việc (nhận lại 409, nhận hộ 403, cập nhật tiến độ trước khi nhận 409) → tiến độ (thiếu ghi chú/150% → 400; 50% lưu) → bình luận có tệp (tải về đúng nội dung, `attachment`; người ngoài 404) → gia hạn (hạn đã qua 400, xin trùng 409, tự duyệt 403, duyệt lại 409, hạn mới được áp dụng) → nộp có tệp → "cần bổ sung" (thiếu nhận xét 400) → nộp lần 2 → "đạt" → phân công hoàn thành; nộp hộ 403, tự đánh giá 403 → xin thôi (thiếu lý do 400, từ chối không lý do 400, đồng ý → kết thúc) → đóng công việc → sửa việc đã xong 409.
- **Bản nháp:** giao trên nháp 409; công khai khi thiếu thể loại/hạn 400; sửa + công khai; tạm dừng; giao khi tạm dừng 409; tiếp tục; hủy thiếu lý do 400; hủy → trạng thái 6.
- **Thông báo:** đánh dấu một/tất cả (unread 4 → 0); đánh dấu thông báo của người khác → `updated: 0`.
- **Lưu CSDL (đọc trực tiếp bằng SQL trên bản sao):** công việc 31 `TrangThai=4`, tiến độ 100; phân công 33: 2 lần nộp (`TrangThaiNop` 2 → 1), 3 cập nhật tiến độ, hạn 07/11/2026 (đã gia hạn); phân công 34 trạng thái 5 (xin thôi được duyệt); 1 bình luận; 1 yêu cầu gia hạn trạng thái 1.
- **Hồi quy sửa lỗi cũ:** lịch sử công việc không còn lặp tên người thao tác (0/23 dòng).

### 11.4 Trạng thái cuối của từng lỗi

| Mã | Trạng thái cuối | Bằng chứng Phase 3 |
|---|---|---|
| BUG-P1-01 | ✅ Đã sửa — kiểm lại PASS | Unit 4 ca; regression: 12 đăng nhập đúng liên tiếp 200, 10 sai → 401, lần 11 → 429, tài khoản khác cùng IP 200; đổi mật khẩu: 10 sai → 400, lần 11 → 429, đúng khi đang khóa vẫn 429, người khác không bị ảnh hưởng |
| BUG-P1-02 | ⛔ **Chưa xử lý** — chủ dự án hoãn (không thao tác GitHub) | BLOCKED (ngoài mã nguồn) |
| BUG-P2-01 | ✅ Đã sửa — PASS | 390px: `scrollWidth 390 = innerWidth`, 0 ô tràn; 138 lượt quét 0 tràn ngang |
| BUG-P2-02 | ✅ Đã sửa — PASS | `/`, `/m/`, `/api/health` có `X-Frame-Options: DENY` + `frame-ancestors 'none'` |
| BUG-P2-03 | ✔️ Đóng — đúng nghiệp vụ | Quyết định chủ dự án |
| BUG-P3-01 | ✅ Đã sửa — PASS | Thân 3 MB → 413; JSON hỏng → 400 |
| BUG-P3-02 | ✅ Đã sửa — PASS | `scope` lạ → 400; 4 phạm vi hợp lệ + không truyền → 200 |
| BUG-P3-03 | ✅ Đã sửa — PASS | Ngoài phạm vi 404, không tồn tại 404, quản trị 200, không taskId 200 |
| BUG-P3-04 | ⏭️ Hoãn — **vẫn tái hiện** | Giảng viên nộp tệp `.bin` vào phân công của người khác → 400 (lỗi loại tệp) thay vì 403; tệp hợp lệ → 403. Không lọt quyền |
| BUG-P3-05 | ✅ Đã sửa — PASS | `limit=-5` → mặc định; `limit=2` → 2 dòng |
| BUG-P3-06 | ✅ Đã sửa — PASS | Đổi kỳ giữ `q=trang&sort=overdue` |
| BUG-P3-07 | ✅ Đã sửa — PASS | `/m/#/tasks/16`, `/tasks/16/update` → "Không tìm thấy công việc" |
| BUG-P3-08 | ✅ Đã sửa — PASS | `/m/` 404 có `h1` |

**Nghi vấn Phase 1:**

| Mã | Kết luận Phase 3 |
|---|---|
| SUS-01 | **Không phải lỗi bảo mật** — nộp tệp 5 MB vào phân công người khác → 403, **0 tệp còn lại trên đĩa**. Vẫn tốn băng thông cho phần đã gửi (tối đa 10×20 MB/request) — rủi ro thấp |
| SUS-02 | Liên quan quyết định BUG-P2-03; cần chủ dự án xác nhận riêng cho **thống kê** cá nhân của đồng nghiệp |
| SUS-03 | NOT RUN (rủi ro thấp, đã có `attachment` + `nosniff`) |
| SUS-04 | **Xác nhận một phần → BUG-P3-09.** Vào biểu mẫu bằng nút trong ứng dụng rồi bấm Back → hộp thoại "Rời khỏi biểu mẫu?" hiện, ở lại trang (PASS). Gõ địa chỉ `#/cong-viec/tao` vào thanh địa chỉ, nhập dở rồi bấm Back → **rời trang không cảnh báo, mất dữ liệu đang nhập** (FAIL) |
| SUS-05 | NOT RUN — cần giả lập lỗi lệnh giao thứ hai |

### 11.5 Phát hiện mới (có từ trước, **không phải hồi quy** — Phase 2 không sửa các phần này)

| Mã | Mức | Mô tả | Tái hiện |
|---|---|---|---|
| NEW-P3-01 | P2 | **Đăng xuất không thu hồi refresh token.** `logout` chỉ xóa cookie và ghi nhật ký; refresh token là JWT không lưu phía máy chủ, nên token lấy được trước khi đăng xuất vẫn đổi được phiên mới trong tối đa 7 ngày (chỉ mất hiệu lực khi đổi mật khẩu hoặc khóa tài khoản). Cookie là `HttpOnly` nên phải bị lộ token theo cách khác mới khai thác được | Đăng nhập → lưu `khoa_rt` → `POST /api/auth/logout` (204) → `POST /api/auth/refresh` với `khoa_rt` cũ → **200** (`workflow-run2.txt`) |
| BUG-P3-09 (= SUS-04) | P3 | Cảnh báo "chưa lưu" không chặn nút Back khi mục lịch sử trước không do router tạo | `phase3/sus04.txt` |
| OBS-01 | P3 (khả năng truy cập) | Trang web "Không tìm thấy công việc" không có `h1` (đã như vậy ở Phase 1) | `sweep-hand.txt`, `/cong-viec/chi-tiet?id=16` |

### 11.6 Hồi quy do Phase 2 gây ra
**Không phát hiện hồi quy nào.** Các bộ kiểm thử có sẵn (typecheck, unit, smoke, quét giao diện 6 vai trò) giữ nguyên kết quả hoặc tốt hơn; 42 kiểm tra luồng ghi bao phủ các khu vực bị sửa (đăng nhập, đổi mật khẩu, danh sách công việc, lựa chọn giao việc, nhật ký, thống kê, app di động) đều đạt, trừ NEW-P3-01 nằm ở `logout` — hàm không bị Phase 2 thay đổi.

### 11.7 Chưa kiểm được (NOT RUN / BLOCKED / một phần)

| Hạng mục | Trạng thái | Lý do |
|---|---|---|
| `tools/e2e.mjs` + `tools/mock-api.mjs` (Playwright) | NOT RUN | Chưa cài Playwright; cài cần tải gói/trình duyệt từ Internet — chưa xin phép. Thay bằng quét Edge headless |
| Sinh thông báo nhắc hạn / sinh việc lặp lại | **Một phần** | Endpoint chạy được (200, giảng viên 403) nhưng trả `reminders: 0, drafts: 0` — bản sao không có dữ liệu thỏa điều kiện nên logic sinh nhắc **chưa được kích hoạt** |
| Access token hết hạn sau 15 phút, refresh token sau 7 ngày | NOT RUN | Cần chờ thời gian thật hoặc đổi cấu hình TTL |
| SUS-03, SUS-05 | NOT RUN | Xem 11.4 |
| Firefox, Safari, điện thoại thật, trình đọc màn hình | NOT RUN | Không có trong môi trường (chỉ Edge/Chromium) |
| Tải trọng / đồng thời nhiều người dùng | NOT RUN | Ngoài phạm vi |
| BUG-P1-02 | BLOCKED | Chủ dự án yêu cầu chưa thao tác GitHub |

### 11.8 Rủi ro còn lại và đề xuất
1. **BUG-P1-02 (P1, mở):** repo công khai + mật khẩu demo dùng chung trong README và lịch sử git. Trước khi đưa cho người dùng thật: chuyển repo sang Private, **đổi mật khẩu mọi tài khoản mẫu**, bỏ mật khẩu khỏi README (dùng `SMOKE_PASSWORD`).
2. **NEW-P3-01 (P2):** thêm thu hồi phía máy chủ khi đăng xuất (ví dụ lưu phiên bản phiên / `jti` trong CSDL và kiểm khi refresh). Cần thay đổi cấu trúc dữ liệu → làm khi được phê duyệt.
3. **BUG-P3-09, BUG-P3-04, OBS-01 (P3):** sửa trong đợt cải thiện tiếp theo.
4. Bổ sung kiểm thử tự động: chuyển `qa-evidence/phase3/workflow.mjs` vào `tools/` làm bộ tích hợp chạy trên CSDL thử; cài Playwright để chạy `e2e.mjs`.
5. Thay đổi Phase 2 **chưa được commit** — cần commit khi chủ dự án cho phép thao tác git/GitHub.

### 11.9 Khuyến nghị phát hành
- **Bản sửa lỗi Phase 2: ĐẠT để chấp nhận** — 10/10 lỗi đã sửa đều kiểm lại PASS, không có hồi quy, 325/327 kiểm tra PASS (2 FAIL là lỗi có từ trước), CSDL thật nguyên vẹn, 0 lỗi máy chủ/JS.
- **Phát hành cho người dùng thật: CHƯA NÊN (có điều kiện)** — còn **BUG-P1-02 (P1)** chưa xử lý; nên xử lý cùng **NEW-P3-01 (P2)**. Dùng nội bộ / demo trên máy cục bộ: chấp nhận được.


---

## 12. Sửa lỗi đợt 2 (sau Phase 3) — 17/10/2026

Phạm vi do chủ dự án chọn: **NEW-P3-01** (phương án thêm bảng CSDL), **BUG-P3-09**, **OBS-01**. Không xử lý BUG-P3-04 (hoãn), BUG-P1-02 (không thao tác GitHub).

### 12.1 Bảng trạng thái

| Mã | Nguyên nhân gốc | Cách sửa | Trạng thái | Kiểm lại |
|---|---|---|---|---|
| NEW-P3-01 | Token không có định danh phiên; `logout` chỉ xóa cookie | Mỗi lần đăng nhập sinh **mã phiên** (`sid`, 32 hex) gắn vào access + refresh token; refresh / đổi mật khẩu giữ nguyên mã. Đăng xuất ghi mã vào bảng mới `dbo.PhienDaThuHoi` (hạn = lúc thu hồi + 7 ngày; dòng hết hạn tự dọn). Guard (gộp vào câu truy vấn sẵn có) và `refresh` từ chối mọi token của phiên đã thu hồi. Chưa có bảng → hành vi cũ | ✅ **Đã sửa** | Bản sao: `revoke.mjs` 7/7 PASS; `workflow.mjs` NEW-P3-01 → PASS (refresh sau logout **401**) |
| BUG-P3-09 (SUS-04) | Mục lịch sử tạo do người dùng gõ địa chỉ không có `history.state.idx` → React Router không tính được bước lùi, `useBlocker` không chặn được | `historyIndex.ts`: lắng nghe `popstate` **trước** router, đóng dấu `idx = chỉ số trang trước + 1`; theo dõi chỉ số sau mỗi điều hướng của router | ✅ **Đã sửa** | `sus04-back.mjs`: 2/2 PASS, lặp 3 lần đều PASS. **Đối chứng:** cùng script trên bản build bỏ dòng `installHistoryIndex()` → ca gõ địa chỉ **FAIL** (rời trang, không hỏi) — chứng minh bản sửa là nguyên nhân PASS |
| OBS-01 | `Failed` luôn dùng `h2`, kể cả khi thay cho cả trang | Thêm tùy chọn `page` → `h1#page-title`; dùng ở trang chi tiết và trang tạo/sửa công việc | ✅ **Đã sửa** | Quét: `/cong-viec/chi-tiet?id=16` và `/cong-viec/sua?id=16` có `h1="Không tìm thấy"`; 0 trang thiếu h1 trên 140 lượt |

### 12.2 Tệp thay đổi

| Tệp | Thay đổi |
|---|---|
| `sql/05_ThuHoiPhien.sql` (mới) | Tạo `dbo.PhienDaThuHoi` (chạy lại được, chỉ thêm bảng) |
| `apps/api/src/auth/session-revocation.ts` (mới) | `newSessionId`, `isSessionId`, `isRevoked`, `revokeSession`, đoạn SQL kiểm thu hồi |
| `apps/api/src/auth/auth.guard.ts` | `TokenPayload.sid`, `AuthUser.sid`; guard từ chối phiên đã thu hồi |
| `apps/api/src/auth/auth.controller.ts` | Cấp `sid`; `refresh` kiểm thu hồi; `logout` thu hồi phiên (access token + refresh token của chính người đó, web và app di động) |
| `apps/api/src/regression.test.ts` | +1 test (định dạng mã phiên, không truy vấn CSDL với mã sai) |
| `apps/web/src/historyIndex.ts` (mới), `apps/web/src/main.tsx` | Sửa BUG-P3-09 |
| `apps/web/src/tasks/TaskDetail.tsx`, `TaskForm.tsx` | `Failed page` → h1 |
| `README.md` | Thêm bước chạy `sql/05_ThuHoiPhien.sql` |
| `qa-evidence/phase3/revoke.mjs`, `round2/` | Script và kết quả kiểm thử đợt 2 |

### 12.3 Thay đổi CSDL thật
- Chạy `sql/05_ThuHoiPhien.sql` trên **bản sao** trước (2 lần — lần 2 bỏ qua đúng), rồi trên **CSDL thật**.
- So checksum 20 bảng trước/sau trên CSDL thật: **mọi bảng cũ giữ nguyên**, chỉ thêm `PhienDaThuHoi` (0 dòng).
- Máy chủ 5080 đã khởi động lại với bản build mới (`/api/health`, `/`, `/m/` → 200, `X-Frame-Options: DENY`). Không chạy kịch bản đăng nhập/đăng xuất trên CSDL thật (tránh ghi dữ liệu); hành vi đã được kiểm trên bản sao cùng mã nguồn và cùng cấu trúc bảng.
- Lưu ý: token cấp **trước** lần triển khai này không có `sid` nên vẫn hợp lệ tới khi hết hạn (tối đa 7 ngày) — đăng xuất các phiên đó chỉ xóa cookie như cũ.

### 12.4 Kiểm thử hồi quy sau khi sửa (bản sao, bản build mới)

| Bộ kiểm thử | Kết quả | Bằng chứng |
|---|---|---|
| `npm run typecheck` | PASS (mã thoát 0) | — |
| `npm test` | **13/13** | — |
| `npm run build` | PASS | — |
| `npm run smoke` | **98/98** | `phase3/round2/smoke.txt` |
| `npm run regression` | **24/24** | `round2/regression.txt` |
| Luồng ghi `workflow.mjs` | **42/42** (trước: 41/42) | `round2/workflow.txt` |
| Thu hồi phiên `revoke.mjs` | **7/7** | `phase3/revoke.txt` |
| Bổ sung `extra.mjs` / nhắc hạn | **2/2**, **1/1** | `round2/extra.txt`, `round2/reminder.txt` |
| Kiểm lại giao diện lỗi cũ `ui-retest` | **6/6** | `round2/ui-retest.txt` |
| Nút Back `sus04-back.mjs` | **2/2** (×3 lần); đối chứng không sửa: 1/2 | `round2/sus04*.txt` |
| Quét giao diện 6 vai trò × 2 khổ | **140/140** lượt: 0 lỗi JS, 0 console.error, **0 cảnh báo** (trước: 7 cảnh báo React Router), 0 tràn ngang, 0 trang thiếu h1 | `round2/sweep-*.txt` |

Ghi chú trung thực: lần chạy đầu của `sus04-back.mjs` sau khi sửa báo FAIL ở ca 2 do **lỗi cô lập của script** (ca 1 để biểu mẫu còn dở, regex bấm nút không khớp "Tiếp tục chỉnh sửa", nên điều hướng đầu ca 2 bị chính cảnh báo chặn lại). Đã sửa script (mỗi ca bắt đầu từ `about:blank`) và chạy **đối chứng** trên bản không sửa để chắc chắn kết quả không phụ thuộc vào việc sửa script.

### 12.5 Còn mở sau đợt 2
- **BUG-P1-02 (P1):** chờ chủ dự án (GitHub + đổi mật khẩu mẫu).
- **BUG-P3-04 (P3):** hoãn.
- SUS-03, SUS-05; e2e Playwright; logic sinh nhắc hạn với dữ liệu thật; trình duyệt ngoài Chromium — **chưa kiểm** (xem 11.7).
- Thay đổi chưa được commit (không thao tác git/GitHub theo yêu cầu).

### 12.6 Khuyến nghị
Đợt 2: **ĐẠT** — 3/3 lỗi trong phạm vi đã sửa và kiểm lại PASS, không có hồi quy, cảnh báo console giảm về 0. Phát hành cho người dùng thật vẫn **phụ thuộc BUG-P1-02**.

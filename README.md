# Khoa CNTT — Quản lý công việc (React + NestJS + SQL Server)

Hệ thống quản lý tổ chức và công việc của Khoa CNTT, viết hoàn toàn bằng TypeScript:
backend NestJS (Node.js), giao diện React, CSDL SQL Server. Một lệnh `npm start` chạy cả API lẫn giao diện ở cổng 5080.

Phân hệ chính: cơ cấu tổ chức, nhân sự, chức vụ và quyền; công việc (tạo, giao, tiếp nhận/từ chối/xin từ chối,
cập nhật tiến độ, nộp kết quả, duyệt Đạt/Cần bổ sung/Không đạt, gia hạn, mẫu và việc lặp lại); thống kê đơn vị
và cá nhân; thông báo, nhắc hạn; nhật ký hệ thống. Trang theo vai trò: **Trang quản trị** (quản trị hệ thống) và
**Trang cá nhân** (mọi thành viên; người có quyền quản lý thấy thêm góc nhìn "Việc tôi quản lý").

```
khoa-cntt/
  apps/api         NestJS 11 (Express) + TypeScript, thư viện mssql, SQL viết tay
  apps/web         React 19 + TypeScript, Vite, React Router (hash), TanStack Query
  apps/mobile      App di động cũ (React 19 + Tailwind CSS 4) — không còn phục vụ; điện thoại dùng bản web
  packages/shared  Kiểu dữ liệu (DTO) dùng chung cho API, web và app React Native sau này
  sql/             Script bổ sung CSDL (02, 03, 04)
  tools/           smoke.mjs (kiểm tra với CSDL thật), mock-api.mjs + e2e.mjs (kiểm thử giao diện)
```

## 1. Yêu cầu

- Node.js 20 trở lên (https://nodejs.org, bản LTS).
- SQL Server 2019+ đã có CSDL `QLCongViecKhoaCNTT`. Nếu chưa, chạy lần lượt trong SSMS:
  `KhoaCNTT_chinhlan1.sql` → `DuLieuMau_KhoaCNTT.sql` → `sql/02_MoRong_LoaiDonVi.sql` → `sql/03_PhanHeCongViec.sql`
  → `sql/04_XinTuChoi.sql` (xin từ chối việc đã tiếp nhận; chưa chạy thì nút "Xin từ chối" không hiện, phần khác vẫn chạy)
  → `sql/05_ThuHoiPhien.sql` (đăng xuất thu hồi phiên phía máy chủ; chưa chạy thì đăng xuất chỉ xóa cookie như cũ).
  Các script 02–04 chạy lại nhiều lần vẫn an toàn và không xóa dữ liệu.

## 2. Cài đặt (lần đầu)

```powershell
cd khoa-cntt
npm install
copy apps\api\.env.example apps\api\.env
```

Mở `apps/api/.env`, điền kết nối SQL Server và `JWT_SECRET` (chuỗi ngẫu nhiên ≥ 32 ký tự):

- **Tài khoản SQL (khuyên dùng):** `DB_USER=sa`, `DB_PASSWORD=...`. Cần bật chế độ đăng nhập
  "SQL Server and Windows Authentication" và bật TCP/IP (SQL Server Configuration Manager → Protocols → TCP/IP → Enabled, rồi khởi động lại dịch vụ).
  SQL Express: thêm `DB_INSTANCE=SQLEXPRESS` và bật dịch vụ SQL Server Browser (hoặc ghi `DB_PORT`).
- **Đăng nhập Windows:** `DB_DRIVER=msnodesqlv8` và `DB_CONNECTION_STRING=...` (mẫu trong `.env.example`); cần ODBC Driver 17/18 for SQL Server.

## 3. Chạy

Bản chạy thật (một cổng, API phục vụ luôn giao diện):

```powershell
npm run build
npm start
```

Mở http://localhost:5080 (dùng chung cho máy tính và điện thoại) — kiểm tra kết nối: http://localhost:5080/api/health (phải có `"taskModule": true`).

Khi phát triển (tự nạp lại khi sửa mã), mở 2 cửa sổ:

```powershell
npm run dev:api     # API ở cổng 5080
npm run dev:web     # giao diện ở http://localhost:5173 (chuyển tiếp /api sang 5080)
npm run dev:mobile  # (cũ) app di động riêng, không còn dùng — điện thoại dùng bản web
```

**Trên điện thoại** dùng chính bản web (`http://<IP máy chủ>:5080`, có thể "Thêm vào màn hình chính"): giao diện tự
chuyển sang khổ điện thoại (thanh trên: thông báo + tài khoản; thanh dưới: Trang chủ, Công việc, Tạo, Chờ duyệt/Lịch,
Thống kê), cùng chức năng với bản máy tính — giao việc, tiếp nhận, tiến độ, nộp và duyệt kết quả, gia hạn, thảo luận.
Điện thoại dành cho người giao việc và người nhận việc; tài khoản chỉ có vai trò quản trị phải dùng máy tính.
Đường dẫn cũ `/m/...` của app di động trước đây tự chuyển sang trang tương ứng của bản web.

Tài khoản thử (dữ liệu mẫu, mật khẩu chung `Demo@CNTT2026!`): `admin.demo@example.invalid` (quản trị),
`vunh@huit.edu.vn` (trưởng khoa), `baopt@huit.edu.vn` (trưởng bộ môn), `hand@huit.edu.vn` (giảng viên).
Mật khẩu lưu dạng băm PBKDF2 (định dạng ASP.NET Identity V3, tương thích dữ liệu mẫu).

## 4. Kiểm tra

```powershell
npm test            # kiểm thử đơn vị API (băm mật khẩu, tham số SQL, giờ Việt Nam…)
npm run smoke       # khi API đang chạy: đăng nhập 4 tài khoản mẫu, gọi mọi API đọc, báo đạt/lỗi
```

Nếu `npm run smoke` báo lỗi, gửi toàn bộ nội dung in ra (và lỗi trong cửa sổ chạy API) để sửa.

## 5. Đăng nhập và bảo mật

- JWT: access token 15 phút + refresh token 7 ngày. Web nhận token qua cookie httpOnly, SameSite=Strict
  (giao diện tự gọi `/api/auth/refresh` khi hết hạn). App di động gửi header `X-Client: mobile` khi đăng nhập
  để nhận token trong thân phản hồi, rồi dùng `Authorization: Bearer <accessToken>` và `POST /api/auth/refresh` với `{ refreshToken }`.
- Mỗi yêu cầu kiểm tra lại trong CSDL: tài khoản bị khóa hoặc đổi/cấp lại mật khẩu thì phiên cũ hết hiệu lực ngay.
- Đăng nhập/đổi mật khẩu giới hạn 10 lần / 5 phút / IP.
- Lỗi trả `{ message }`; lỗi nhập liệu trả `400 { message, errors: { tenTruong: "thông báo" } }` để giao diện hiện cạnh từng ô.

## 6. API

Mọi API (trừ đăng nhập và `/api/health`) cần đăng nhập. Quyền kiểm tra lại ở máy chủ cho từng thao tác.

**Đăng nhập, trang theo vai trò**

| Phương thức | Đường dẫn | Chức năng |
|---|---|---|
| POST | `/api/auth/login`, `/api/auth/logout`, `/api/auth/refresh` | Đăng nhập, đăng xuất, làm mới phiên |
| GET | `/api/auth/me` | Người dùng hiện tại, quyền, trang được vào |
| POST | `/api/auth/doi-mat-khau` | Tự đổi mật khẩu |
| GET | `/api/trang/{admin\|ca-nhan}` | Kiểm tra quyền vào trang (403 nếu không có vai trò) |
| GET | `/api/health` | Kiểm tra kết nối CSDL (`taskModule: true` khi đã chạy script 03) |

**Tổ chức, nhân sự** (web chỉ dùng `/api/to-chuc`; các API đọc chi tiết dành cho app di động/tích hợp)

| Phương thức | Đường dẫn | Chức năng |
|---|---|---|
| GET | `/api/to-chuc` | Toàn bộ đơn vị, người dùng, chức vụ, thành viên |
| GET | `/api/don-vi`, `/api/don-vi/{id}`, `/api/don-vi/{id}/thanh-vien` | Đơn vị, thành viên đơn vị |
| POST | `/api/don-vi` | Thêm đơn vị (có thể tạo đơn vị cha mới cùng lúc) — quản trị |
| GET | `/api/nhan-su?q=&donVi=&trangThai=`, `/api/nhan-su/{id}` | Danh sách, hồ sơ nhân sự |
| POST / PUT / DELETE | `/api/nhan-su`, `/api/nhan-su/{id}` | Thêm (trả mật khẩu tạm), sửa, xóa tài khoản chưa có lịch sử — quản trị |
| POST | `/api/nhan-su/{id}/cap-lai-mat-khau` | Cấp lại mật khẩu tạm — quản trị |
| PUT | `/api/nhan-su/{id}/trang-thai` | Khóa / mở khóa tài khoản — quản trị |
| GET / PUT | `/api/chuc-vu`, `/api/chuc-vu/{id}/quyen` | Chức vụ và quyền (sửa: quản trị) |
| POST | `/api/thanh-vien` | Thêm thành viên vào đơn vị |

**Công việc**

| Phương thức | Đường dẫn | Chức năng |
|---|---|---|
| GET | `/api/cong-viec?scope=assigned\|created\|all\|review` | Danh sách theo nhóm |
| GET | `/api/cong-viec/{id}`, `.../binh-luan`, `.../lich-su` | Chi tiết, thảo luận, lịch sử |
| GET | `/api/cong-viec/lua-chon-giao-viec?taskId=` | Người/đơn vị có thể giao việc |
| POST / PUT | `/api/cong-viec`, `/api/cong-viec/{id}` | Tạo (nháp/chính thức), sửa |
| POST | `/api/cong-viec/{id}/trang-thai` | `publish`, `pause`, `resume`, `cancel`, `complete` |
| POST | `/api/cong-viec/{id}/phan-cong`, `.../binh-luan` | Giao việc, bình luận |
| POST | `/api/phan-cong/{id}/tiep-nhan`, `.../tu-choi` | Tiếp nhận / từ chối (khi chưa tiếp nhận) |
| POST | `/api/phan-cong/{id}/xin-tu-choi`, `/api/xin-tu-choi/{id}/duyet` | Xin từ chối sau khi đã nhận / duyệt (cần script 04) |
| POST | `/api/phan-cong/{id}/phan-cong-lai`, `.../tien-do`, `.../ket-qua` | Trưởng đơn vị phân công lại, cập nhật tiến độ, nộp kết quả (kèm tệp) |
| POST | `/api/phan-cong/{id}/gia-han`, `/api/gia-han/{id}/duyet` | Xin / duyệt gia hạn (tối đa 2 lần được duyệt) |
| POST | `/api/phan-cong/{id}/huy`, `.../nhac` | Hủy phân công, nhắc việc |
| POST | `/api/ket-qua/{id}/danh-gia` | Đánh giá Đạt / Cần bổ sung / Không đạt; Đạt phân công cuối thì công việc tự Hoàn thành |
| GET | `/api/tep/{id}` | Tải tệp đính kèm (kiểm tra quyền xem) |

**Danh mục, thống kê, thông báo, hệ thống**

| Phương thức | Đường dẫn | Chức năng |
|---|---|---|
| GET / POST / PUT | `/api/the-loai`, `/api/the-loai/{id}` | Thể loại công việc (sửa: quản trị) |
| GET / POST / PUT / DELETE | `/api/mau-cong-viec`, `/api/mau-cong-viec/{id}` | Mẫu công việc; xóa mẫu giữ nguyên công việc đã tạo từ mẫu |
| GET | `/api/thong-ke/don-vi?from=&to=&unitId=&categoryId=`, `/api/thong-ke/ca-nhan?from=&to=` | Thống kê đơn vị, cá nhân |
| GET / POST | `/api/thong-bao`, `/api/thong-bao/{id}/da-doc`, `/api/thong-bao/da-doc-tat-ca` | Thông báo |
| GET | `/api/canh-bao-han` | Việc quá hạn / sắp đến hạn (hộp nhắc sau đăng nhập) |
| GET | `/api/nhat-ky?limit=&q=` | Nhật ký hệ thống — quản trị |
| POST | `/api/he-thong/chay-nhac-han` | Chạy ngay tác vụ nhắc hạn — quản trị |

Tác vụ nền mỗi giờ: nhắc hạn (SapDenHan/QuaHan) và tạo bản nháp cho mẫu lặp lại.

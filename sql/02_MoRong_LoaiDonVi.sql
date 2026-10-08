/*
MỞ RỘNG LOẠI ĐƠN VỊ: cho phép nhập loại mới (ví dụ "Trung tâm", "Phòng thí nghiệm").
Chạy SAU: KhoaCNTT_chinhlan1.sql và DuLieuMau_KhoaCNTT.sql.

Bản gốc giới hạn LoaiDonVi trong 5 mã (Khoa, BoMon, Ban, Nhom, HoiDong) bằng CK_DV_Loai.
Script thay ràng buộc đó bằng: không rỗng (API tự cắt khoảng trắng thừa).
Dữ liệu cũ giữ nguyên; 5 mã cũ vẫn được API hiển thị thành Khoa / Bộ môn / Ban / Nhóm / Hội đồng.
Loại mới được lưu đúng chữ người dùng nhập (tối đa 30 ký tự theo cột NVARCHAR(30)).
Không xóa dữ liệu; chạy lại nhiều lần vẫn an toàn.

Mã đơn vị: dùng luôn MaDonVi (IDENTITY), KHÔNG cần script 01_BoSung_KyHieuDonVi.sql.
Nếu đã chạy script 01 trước đây, cột KyHieu được giữ nguyên nhưng API không còn dùng.
*/
USE QLCongViecKhoaCNTT;
GO
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
SET NOCOUNT ON;
GO

BEGIN TRANSACTION;

IF EXISTS (SELECT 1 FROM sys.check_constraints
           WHERE name = N'CK_DV_Loai' AND parent_object_id = OBJECT_ID(N'dbo.DonVi')
             AND definition LIKE N'%BoMon%')
    ALTER TABLE dbo.DonVi DROP CONSTRAINT CK_DV_Loai;

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints
               WHERE name = N'CK_DV_Loai' AND parent_object_id = OBJECT_ID(N'dbo.DonVi'))
    ALTER TABLE dbo.DonVi WITH CHECK ADD CONSTRAINT CK_DV_Loai CHECK (
        LEN(LTRIM(RTRIM(LoaiDonVi))) > 0
    );

COMMIT TRANSACTION;
GO

SELECT name, definition FROM sys.check_constraints
WHERE parent_object_id = OBJECT_ID(N'dbo.DonVi') ORDER BY name;

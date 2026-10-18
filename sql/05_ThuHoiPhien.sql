/*
05_ThuHoiPhien.sql — THU HỒI PHIÊN ĐĂNG NHẬP KHI ĐĂNG XUẤT
Chạy SAU 04_XinTuChoi.sql. Chạy được nhiều lần: đã có thì bỏ qua. Chỉ TẠO bảng mới, không sửa/xóa dữ liệu cũ.

Mỗi lần đăng nhập sinh một mã phiên (MaPhien) gắn vào access token và refresh token; refresh giữ nguyên mã phiên.
Đăng xuất ghi mã phiên vào bảng này → mọi token của phiên đó (kể cả refresh token đã bị lộ) bị từ chối.
  HetHan: thời điểm token cuối cùng của phiên chắc chắn hết hạn (lúc thu hồi + thời hạn refresh token);
  sau thời điểm này dòng không còn tác dụng và được API tự dọn khi có lượt đăng xuất mới.
Chưa chạy script này: hệ thống vẫn hoạt động như cũ (đăng xuất chỉ xóa cookie).
*/
USE QLCongViecKhoaCNTT;
GO
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET NUMERIC_ROUNDABORT OFF;
SET XACT_ABORT ON;
SET NOCOUNT ON;
GO

IF OBJECT_ID(N'dbo.PhienDaThuHoi', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.PhienDaThuHoi (
        MaPhien CHAR(32) NOT NULL PRIMARY KEY,
        MaNguoiDung INT NOT NULL,
        NgayThuHoi DATETIME2(0) NOT NULL DEFAULT SYSUTCDATETIME(),
        HetHan DATETIME2(0) NOT NULL,

        CONSTRAINT FK_PTH_NguoiDung FOREIGN KEY (MaNguoiDung) REFERENCES dbo.NguoiDung(MaNguoiDung),
        CONSTRAINT CK_PTH_MaPhien CHECK (LEN(MaPhien) = 32),
        CONSTRAINT CK_PTH_HetHan CHECK (HetHan > NgayThuHoi)
    );
    CREATE INDEX IX_PTH_HetHan ON dbo.PhienDaThuHoi(HetHan);
    PRINT N'Đã tạo dbo.PhienDaThuHoi';
END;
GO
PRINT N'05_ThuHoiPhien.sql: hoàn tất.';
GO

/*
06_DatLaiMatKhau.sql — QUÊN MẬT KHẨU: MÃ XÁC THỰC GỬI QUA EMAIL
Chạy SAU 05_ThuHoiPhien.sql. Chạy được nhiều lần: đã có thì bỏ qua. Chỉ TẠO bảng mới, không sửa/xóa dữ liệu cũ.

Mỗi yêu cầu "Quên mật khẩu" tạo một mã 6 chữ số gửi về email; bảng chỉ lưu HMAC của mã (không lưu mã gốc).
  HetHan: mã hết hiệu lực sau 10 phút. SoLanThu: số lần nhập sai (quá 5 lần thì mã bị hủy).
  DaDung: mã đã dùng, bị thay bởi mã mới hoặc bị hủy.
Chưa chạy script này: trang đăng nhập báo chức năng quên mật khẩu chưa được bật.
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

IF OBJECT_ID(N'dbo.MaDatLaiMatKhau', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.MaDatLaiMatKhau (
        MaYeuCau INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        MaNguoiDung INT NOT NULL,
        MaBam CHAR(64) NOT NULL,
        NgayTao DATETIME2(0) NOT NULL DEFAULT SYSUTCDATETIME(),
        HetHan DATETIME2(0) NOT NULL,
        SoLanThu TINYINT NOT NULL DEFAULT 0,
        DaDung BIT NOT NULL DEFAULT 0,
        DiaChiIP NVARCHAR(45) NULL,

        CONSTRAINT FK_MDLMK_NguoiDung FOREIGN KEY (MaNguoiDung) REFERENCES dbo.NguoiDung(MaNguoiDung),
        CONSTRAINT CK_MDLMK_MaBam CHECK (LEN(MaBam) = 64),
        CONSTRAINT CK_MDLMK_HetHan CHECK (HetHan > NgayTao)
    );
    CREATE INDEX IX_MDLMK_NguoiDung ON dbo.MaDatLaiMatKhau(MaNguoiDung, NgayTao DESC);
    PRINT N'Đã tạo dbo.MaDatLaiMatKhau';
END;
GO
PRINT N'06_DatLaiMatKhau.sql: hoàn tất.';

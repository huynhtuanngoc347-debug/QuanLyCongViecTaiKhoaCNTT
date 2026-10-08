/*
04_XinTuChoi.sql — XIN TỪ CHỐI VIỆC SAU KHI ĐÃ TIẾP NHẬN
Chạy SAU 03_PhanHeCongViec.sql. Chạy được nhiều lần: đã có thì bỏ qua. Không xóa dữ liệu.

Chưa tiếp nhận: người nhận từ chối ngay (PhanCong.TrangThaiPhanCong = 5), không cần bảng này.
Đã tiếp nhận / đang làm: người nhận gửi yêu cầu kèm lý do; người giao (hoặc người có quyền giao việc ở đơn vị quản lý) duyệt.
  dbo.YeuCauTuChoi.TrangThai: 0 Chờ duyệt, 1 Đồng ý (phân công chuyển sang Từ chối), 2 Không đồng ý (tiếp tục làm).
  Mỗi phân công có tối đa 1 yêu cầu đang chờ.
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

IF OBJECT_ID(N'dbo.YeuCauTuChoi', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.YeuCauTuChoi (
        MaYeuCau INT IDENTITY(1,1) PRIMARY KEY,
        MaPhanCong INT NOT NULL,
        MaNguoiYeuCau INT NOT NULL,
        LyDo NVARCHAR(1000) NOT NULL,
        TrangThai TINYINT NOT NULL DEFAULT 0,
        MaNguoiDuyet INT NULL,
        NhanXet NVARCHAR(1000) NULL,
        NgayTao DATETIME2(0) NOT NULL DEFAULT SYSUTCDATETIME(),
        NgayDuyet DATETIME2(0) NULL,

        CONSTRAINT FK_TC_PC FOREIGN KEY (MaPhanCong) REFERENCES dbo.PhanCong(MaPhanCong),
        CONSTRAINT FK_TC_NguoiYeuCau FOREIGN KEY (MaNguoiYeuCau) REFERENCES dbo.NguoiDung(MaNguoiDung),
        CONSTRAINT FK_TC_NguoiDuyet FOREIGN KEY (MaNguoiDuyet) REFERENCES dbo.NguoiDung(MaNguoiDung),
        CONSTRAINT CK_TC_TrangThai CHECK (TrangThai BETWEEN 0 AND 2),
        CONSTRAINT CK_TC_LyDo CHECK (LEN(LTRIM(RTRIM(LyDo))) > 0),
        -- Đang chờ: chưa có người duyệt. Đã xử lý: có người, ngày duyệt; không đồng ý phải có nhận xét.
        CONSTRAINT CK_TC_Duyet CHECK (
            (TrangThai = 0 AND MaNguoiDuyet IS NULL AND NgayDuyet IS NULL)
            OR (TrangThai = 1 AND MaNguoiDuyet IS NOT NULL AND NgayDuyet IS NOT NULL)
            OR (TrangThai = 2 AND MaNguoiDuyet IS NOT NULL AND NgayDuyet IS NOT NULL
                AND NhanXet IS NOT NULL AND LEN(LTRIM(RTRIM(NhanXet))) > 0)
        )
    );
    CREATE INDEX IX_TC_PhanCong ON dbo.YeuCauTuChoi(MaPhanCong, NgayTao DESC);
    CREATE UNIQUE INDEX UX_TC_DangCho ON dbo.YeuCauTuChoi(MaPhanCong) WHERE TrangThai = 0;
    PRINT N'Đã tạo dbo.YeuCauTuChoi';
END;
GO
PRINT N'04_XinTuChoi.sql: hoàn tất.';
GO

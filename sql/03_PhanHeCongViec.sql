/*
03_PhanHeCongViec.sql — BỔ SUNG CHO PHÂN HỆ CÔNG VIỆC
Chạy SAU KhoaCNTT_chinhlan1.sql, DuLieuMau_KhoaCNTT.sql và 02_MoRong_LoaiDonVi.sql.
Chạy được nhiều lần: mỗi phần tự kiểm tra, đã có thì bỏ qua. Không xóa dữ liệu.

Thêm:
  1. PhanCong.VaiTro           : 1 Chủ trì, 2 Phối hợp (NULL = không ghi).
  2. dbo.YeuCauGiaHan          : xin gia hạn / duyệt gia hạn cho từng phân công.
                                 TrangThai: 0 Chờ duyệt, 1 Đồng ý, 2 Đồng ý hạn khác, 3 Từ chối.
                                 Mỗi phân công có tối đa 1 yêu cầu đang chờ; API giới hạn 2 lần được duyệt.
  3. dbo.MauCongViec           : mẫu công việc và lặp lại theo học kỳ / năm học.
                                 ChuKyLap: 0 Không lặp, 1 Mỗi học kỳ (6 tháng), 2 Mỗi năm học (12 tháng).
                                 Đến NgayTaoLanToi, hệ thống tạo bản NHÁP và nhắc người tạo mẫu xác nhận.
  4. CongViec.MaMauCongViec    : công việc được tạo từ mẫu nào (NULL nếu tạo tay).
  5. ThongBao.LoaiThongBao     : thêm GiaHan, TiepNhan, LapLai.
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

-- 1. Vai trò trong phân công
IF COL_LENGTH(N'dbo.PhanCong', N'VaiTro') IS NULL
BEGIN
    ALTER TABLE dbo.PhanCong ADD VaiTro TINYINT NULL;
    PRINT N'Đã thêm PhanCong.VaiTro';
END;
GO
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_PC_VaiTro')
    ALTER TABLE dbo.PhanCong ADD CONSTRAINT CK_PC_VaiTro CHECK (VaiTro IS NULL OR VaiTro IN (1, 2));
GO

-- 2. Yêu cầu gia hạn
IF OBJECT_ID(N'dbo.YeuCauGiaHan', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.YeuCauGiaHan (
        MaYeuCau INT IDENTITY(1,1) PRIMARY KEY,
        MaPhanCong INT NOT NULL,
        MaNguoiYeuCau INT NOT NULL,
        HanCu DATETIME2(0) NOT NULL,
        HanDeXuat DATETIME2(0) NOT NULL,
        LyDo NVARCHAR(1000) NOT NULL,
        TrangThai TINYINT NOT NULL DEFAULT 0,
        MaNguoiDuyet INT NULL,
        HanDuocDuyet DATETIME2(0) NULL,
        NhanXet NVARCHAR(1000) NULL,
        NgayTao DATETIME2(0) NOT NULL DEFAULT SYSUTCDATETIME(),
        NgayDuyet DATETIME2(0) NULL,

        CONSTRAINT FK_GH_PC FOREIGN KEY (MaPhanCong) REFERENCES dbo.PhanCong(MaPhanCong),
        CONSTRAINT FK_GH_NguoiYeuCau FOREIGN KEY (MaNguoiYeuCau) REFERENCES dbo.NguoiDung(MaNguoiDung),
        CONSTRAINT FK_GH_NguoiDuyet FOREIGN KEY (MaNguoiDuyet) REFERENCES dbo.NguoiDung(MaNguoiDung),
        CONSTRAINT CK_GH_TrangThai CHECK (TrangThai BETWEEN 0 AND 3),
        CONSTRAINT CK_GH_LyDo CHECK (LEN(LTRIM(RTRIM(LyDo))) > 0),
        CONSTRAINT CK_GH_HanDeXuat CHECK (HanDeXuat > HanCu),
        -- Đang chờ: chưa có người duyệt. Đã duyệt: có người, ngày duyệt; đồng ý phải có hạn mới.
        CONSTRAINT CK_GH_Duyet CHECK (
            (TrangThai = 0 AND MaNguoiDuyet IS NULL AND NgayDuyet IS NULL AND HanDuocDuyet IS NULL)
            OR (TrangThai IN (1, 2) AND MaNguoiDuyet IS NOT NULL AND NgayDuyet IS NOT NULL
                AND HanDuocDuyet IS NOT NULL AND HanDuocDuyet > HanCu)
            OR (TrangThai = 3 AND MaNguoiDuyet IS NOT NULL AND NgayDuyet IS NOT NULL
                AND HanDuocDuyet IS NULL AND NhanXet IS NOT NULL AND LEN(LTRIM(RTRIM(NhanXet))) > 0)
        )
    );
    CREATE INDEX IX_GH_PhanCong ON dbo.YeuCauGiaHan(MaPhanCong, NgayTao DESC);
    CREATE UNIQUE INDEX UX_GH_DangCho ON dbo.YeuCauGiaHan(MaPhanCong) WHERE TrangThai = 0;
    PRINT N'Đã tạo dbo.YeuCauGiaHan';
END;
GO

-- 3. Mẫu công việc
IF OBJECT_ID(N'dbo.MauCongViec', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.MauCongViec (
        MaMau INT IDENTITY(1,1) PRIMARY KEY,
        TenMau NVARCHAR(150) NOT NULL,
        TieuDe NVARCHAR(250) NOT NULL,
        MoTa NVARCHAR(MAX) NULL,
        TieuChiHoanThanh NVARCHAR(MAX) NULL,
        MaTheLoai INT NULL,
        MucDoUuTien TINYINT NOT NULL DEFAULT 2,
        MaDonViQuanLy INT NOT NULL,
        SoNgayThucHien INT NOT NULL DEFAULT 14,
        ChuKyLap TINYINT NOT NULL DEFAULT 0,
        NgayTaoLanToi DATE NULL,
        SoLanDaDung INT NOT NULL DEFAULT 0,
        MaNguoiTao INT NOT NULL,
        TrangThai BIT NOT NULL DEFAULT 1,
        NgayTao DATETIME2(0) NOT NULL DEFAULT SYSUTCDATETIME(),

        CONSTRAINT FK_MAU_TheLoai FOREIGN KEY (MaTheLoai) REFERENCES dbo.TheLoaiCongViec(MaTheLoai),
        CONSTRAINT FK_MAU_DonVi FOREIGN KEY (MaDonViQuanLy) REFERENCES dbo.DonVi(MaDonVi),
        CONSTRAINT FK_MAU_NguoiTao FOREIGN KEY (MaNguoiTao) REFERENCES dbo.NguoiDung(MaNguoiDung),
        CONSTRAINT CK_MAU_Ten CHECK (LEN(LTRIM(RTRIM(TenMau))) > 0),
        CONSTRAINT CK_MAU_TieuDe CHECK (LEN(LTRIM(RTRIM(TieuDe))) > 0),
        CONSTRAINT CK_MAU_UuTien CHECK (MucDoUuTien BETWEEN 1 AND 4),
        CONSTRAINT CK_MAU_SoNgay CHECK (SoNgayThucHien BETWEEN 1 AND 365),
        CONSTRAINT CK_MAU_ChuKy CHECK (ChuKyLap BETWEEN 0 AND 2),
        CONSTRAINT CK_MAU_LapLai CHECK (ChuKyLap = 0 OR NgayTaoLanToi IS NOT NULL),
        CONSTRAINT CK_MAU_SoLan CHECK (SoLanDaDung >= 0)
    );
    CREATE INDEX IX_MAU_LapLai ON dbo.MauCongViec(TrangThai, ChuKyLap, NgayTaoLanToi);
    PRINT N'Đã tạo dbo.MauCongViec';
END;
GO

-- 4. Công việc tạo từ mẫu
IF COL_LENGTH(N'dbo.CongViec', N'MaMauCongViec') IS NULL
BEGIN
    ALTER TABLE dbo.CongViec ADD MaMauCongViec INT NULL;
    PRINT N'Đã thêm CongViec.MaMauCongViec';
END;
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_CV_Mau')
    ALTER TABLE dbo.CongViec ADD CONSTRAINT FK_CV_Mau FOREIGN KEY (MaMauCongViec) REFERENCES dbo.MauCongViec(MaMau);
GO

-- 5. Thêm loại thông báo
IF EXISTS (SELECT 1 FROM sys.check_constraints
           WHERE name = N'CK_TB_Loai' AND parent_object_id = OBJECT_ID(N'dbo.ThongBao')
             AND definition NOT LIKE N'%GiaHan%')
BEGIN
    ALTER TABLE dbo.ThongBao DROP CONSTRAINT CK_TB_Loai;
    ALTER TABLE dbo.ThongBao ADD CONSTRAINT CK_TB_Loai CHECK (
        LoaiThongBao IN (
            N'GiaoViec', N'BinhLuan', N'KetQua',
            N'SapDenHan', N'QuaHan',
            N'ChamTienDo', N'HeThong',
            N'GiaHan', N'TiepNhan', N'LapLai'
        ));
    PRINT N'Đã mở rộng CK_TB_Loai';
END;
GO

-- Chỉ mục phục vụ chống tạo trùng nhắc hạn trong ngày và danh sách thông báo.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_TB_CongViec_Loai' AND object_id = OBJECT_ID(N'dbo.ThongBao'))
    CREATE INDEX IX_TB_CongViec_Loai ON dbo.ThongBao(MaCongViec, MaNguoiNhan, LoaiThongBao, NgayTao DESC);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_PC_NguoiGiao' AND object_id = OBJECT_ID(N'dbo.PhanCong'))
    CREATE INDEX IX_PC_NguoiGiao ON dbo.PhanCong(MaNguoiGiao, TrangThaiPhanCong) INCLUDE (MaCongViec, HanHoanThanh);
GO

PRINT N'03_PhanHeCongViec.sql: hoàn tất.';
GO

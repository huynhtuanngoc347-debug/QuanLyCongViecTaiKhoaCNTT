-- CẢNH BÁO: XÓA TOÀN BỘ công việc hiện có. Sao lưu CSDL trước khi chạy.
-- Tạo lại bộ dữ liệu công việc mẫu: xóa TOÀN BỘ công việc cũ (và mọi dữ liệu con), tạo 26 việc mới phủ đủ kịch bản.
-- Ngày giờ tính theo hôm nay (giờ Việt Nam), nên chạy lúc nào cũng ra dữ liệu "đang diễn ra".
-- Chạy: sqlcmd -S localhost -E -d <CSDL> -f 65001 -b -i seed-demo-tasks.sql
SET NOCOUNT ON;
SET XACT_ABORT ON;
SET QUOTED_IDENTIFIER ON; -- sqlcmd mặc định OFF; bảng có chỉ mục lọc cần ON
SET ANSI_NULLS ON;
BEGIN TRANSACTION;

EXEC sys.sp_set_session_context @key = N'MaNguoiDung', @value = 33;

-------------------------------------------------------------------------------- 1. Xóa dữ liệu cũ
DELETE dbo.DanhGia;
DELETE dbo.TepDinhKem;
DELETE dbo.KetQuaCongViec;
DELETE dbo.CapNhatTienDo;
DELETE dbo.YeuCauGiaHan;
DELETE dbo.YeuCauTuChoi;
DELETE dbo.PhanCong;
UPDATE dbo.BinhLuan SET MaBinhLuanCha = NULL WHERE MaBinhLuanCha IS NOT NULL;
DELETE dbo.BinhLuan;
DELETE dbo.PhuThuocCongViec;
UPDATE dbo.CongViec SET MaCongViecCha = NULL WHERE MaCongViecCha IS NOT NULL;
DELETE dbo.LichSuCongViec;
DELETE dbo.ThongBao WHERE MaCongViec IS NOT NULL;
DELETE dbo.CongViec;

-- Mã mới bắt đầu lại từ 1. Bảng chưa từng có dòng (last_value NULL) thì bỏ qua: RESEED 0 ở đó sẽ cấp mã 0.
DECLARE @tbl SYSNAME, @sql NVARCHAR(400);
DECLARE c CURSOR LOCAL FAST_FORWARD FOR
  SELECT N'dbo.' + OBJECT_NAME(object_id) FROM sys.identity_columns
  WHERE last_value IS NOT NULL AND OBJECT_NAME(object_id) IN (N'CongViec', N'PhanCong', N'CapNhatTienDo', N'KetQuaCongViec', N'DanhGia',
    N'YeuCauGiaHan', N'YeuCauTuChoi', N'BinhLuan', N'LichSuCongViec', N'TepDinhKem', N'PhuThuocCongViec');
OPEN c; FETCH NEXT FROM c INTO @tbl;
WHILE @@FETCH_STATUS = 0
BEGIN
  SET @sql = N'DBCC CHECKIDENT (''' + @tbl + N''', RESEED, 0) WITH NO_INFOMSGS;'; EXEC (@sql);
  FETCH NEXT FROM c INTO @tbl;
END;
CLOSE c; DEALLOCATE c;

-------------------------------------------------------------------------------- 2. Mốc thời gian
-- @L0 = 00:00 hôm nay giờ Việt Nam, tính ra UTC. Sự kiện (d, h) = ngày d so với hôm nay, lúc h giờ (giờ Việt Nam).
-- Hạn (d) = 23:59:59 ngày d giờ Việt Nam, giống parseVnDate(..., true) của API.
DECLARE @L0 DATETIME2 = DATEADD(HOUR, -7, CAST(CAST(DATEADD(HOUR, 7, SYSUTCDATETIME()) AS DATE) AS DATETIME2));

-------------------------------------------------------------------------------- 3. Kịch bản
-- k, tiêu đề, mô tả, tiêu chí, thể loại, đơn vị, người tạo, ưu tiên, trạng thái, tạo (d,h), bắt đầu d, hạn d, hoàn thành (d,h), việc cha
DECLARE @T TABLE (k INT PRIMARY KEY, TieuDe NVARCHAR(250), MoTa NVARCHAR(MAX), TieuChi NVARCHAR(MAX), TheLoai INT, DonVi INT, NguoiTao INT,
  UuTien TINYINT, TrangThai TINYINT, cD INT, cH DECIMAL(4,2), sD INT, dueD INT, doneD INT, doneH DECIMAL(4,2), Cha INT);
INSERT @T VALUES
(1, N'Rà soát đề cương chi tiết học phần Khai phá dữ liệu',
    N'Cập nhật đề cương chi tiết theo chuẩn đầu ra chương trình đào tạo ngành Khoa học dữ liệu áp dụng từ năm học 2026–2027.',
    N'Đề cương đúng mẫu của Trường, có ma trận chuẩn đầu ra – bài đánh giá, danh mục tài liệu cập nhật trong 5 năm gần đây.',
    1, 2, 1, 2, 4, -80, 9, -80, -50, -52, 15, NULL),
(2, N'Xây dựng bộ dữ liệu thực hành cho học phần Học máy',
    N'Chuẩn bị 5 bộ dữ liệu thực tế (giáo dục, bán lẻ, y tế, giao thông, tài chính) dùng cho các bài thực hành.',
    N'Mỗi bộ dữ liệu đã làm sạch, có từ điển dữ liệu và một bài mẫu chạy được trên máy phòng thực hành.',
    1, 2, 1, 3, 4, -72, 10, -72, -42, -34, 10, NULL),
(3, N'Biên soạn bài giảng điện tử học phần Trực quan hóa dữ liệu',
    N'Biên soạn bài giảng điện tử 8 chương, đưa lên hệ thống học trực tuyến của Trường.',
    N'Đủ 8 chương, mỗi chương có slide, video ngắn và bài tập cuối chương.',
    1, 2, 1, 2, 2, -21, 9, -20, 25, NULL, NULL, NULL),
(4, N'Chấm phản biện đề cương khóa luận tốt nghiệp đợt 1',
    N'Chấm phản biện 12 đề cương khóa luận tốt nghiệp ngành Khoa học dữ liệu, đợt 1 năm học 2026–2027.',
    N'Có bảng điểm và nhận xét cho từng đề cương theo mẫu phiếu phản biện.',
    1, 2, 1, 3, 3, -24, 8, -24, 4, NULL, NULL, NULL),
(5, N'Báo cáo tổng kết hoạt động nghiên cứu khoa học sinh viên năm học 2025–2026',
    N'Tổng hợp số đề tài, kinh phí, kết quả và giải thưởng nghiên cứu khoa học sinh viên của bộ môn.',
    N'Báo cáo theo mẫu của Phòng Khoa học Công nghệ, có bảng tổng hợp kinh phí và danh sách đề tài đạt giải.',
    2, 2, 1, 2, 2, -30, 9, -30, 3, NULL, NULL, NULL),
(6, N'Cập nhật ngân hàng câu hỏi trắc nghiệm học phần Cơ sở dữ liệu',
    N'Bổ sung câu hỏi mới và loại bỏ câu hỏi trùng, phục vụ kỳ kiểm tra giữa kỳ.',
    N'Tối thiểu 300 câu, phân bố đủ 6 chương, có đáp án và mức độ khó.',
    1, 2, 1, 3, 2, -36, 14, -36, -4, NULL, NULL, NULL),
(7, N'Chuẩn bị tài liệu hướng dẫn đồ án chuyên ngành Khoa học dữ liệu',
    N'Soạn tài liệu hướng dẫn thực hiện đồ án chuyên ngành: quy trình, mẫu báo cáo, tiêu chí chấm và danh sách đề tài mẫu.',
    N'Tài liệu được bộ môn thông qua, có ít nhất 15 đề tài mẫu.',
    1, 2, 1, 2, 2, -18, 10, -18, 2, NULL, NULL, NULL),
(8, N'Đề xuất đề tài nghiên cứu khoa học cấp Trường năm 2027',
    N'Mỗi giảng viên đề xuất ít nhất một đề tài nghiên cứu khoa học cấp Trường năm 2027 theo hướng nghiên cứu của bộ môn.',
    N'Phiếu đề xuất đúng mẫu, có tính cấp thiết, mục tiêu, sản phẩm dự kiến và dự toán sơ bộ.',
    2, 2, 1, 2, 1, -2, 9, -2, 28, NULL, NULL, NULL),
(9, N'Kế hoạch tổ chức seminar chuyên đề Dữ liệu lớn tháng 12',
    N'Bản nháp: dự kiến mời 2 báo cáo viên từ doanh nghiệp, tổ chức tại hội trường khoa. Chưa chốt ngày và kinh phí.',
    NULL, NULL, 2, 1, 2, 0, -1, 16, NULL, NULL, NULL, NULL, NULL),
(10, N'Rà soát chuẩn đầu ra chương trình Hệ thống thông tin quản lý',
    N'Rà soát, đối sánh chuẩn đầu ra với chương trình của 3 trường đại học trong nước và yêu cầu của doanh nghiệp.',
    N'Báo cáo đối sánh và đề xuất điều chỉnh chuẩn đầu ra được bộ môn thông qua.',
    1, 3, 13, 3, 2, -15, 9, -15, 20, NULL, NULL, NULL),
(11, N'Tổ chức buổi báo cáo chuyên đề Chuyển đổi số trong doanh nghiệp',
    N'Mời chuyên gia doanh nghiệp báo cáo chuyên đề cho sinh viên năm 3 và năm 4 ngành Hệ thống thông tin quản lý.',
    N'Tổ chức đúng kế hoạch, có biên bản, danh sách sinh viên tham dự và hình ảnh.',
    3, 3, 13, 2, 4, -62, 9, -62, -30, -31, 16, NULL),
(12, N'Khảo sát nhu cầu tuyển dụng của doanh nghiệp đối tác',
    N'Khảo sát nhu cầu tuyển dụng và kỹ năng cần thiết của sinh viên ngành Hệ thống thông tin quản lý tại các doanh nghiệp đối tác.',
    N'Tối thiểu 30 phiếu khảo sát hợp lệ và báo cáo phân tích kết quả.',
    4, 3, 13, 2, 5, -40, 10, -40, 10, NULL, NULL, NULL),
(13, N'Hoàn thiện giáo trình Phân tích thiết kế hệ thống',
    N'Hoàn thiện bản thảo giáo trình nội bộ học phần Phân tích thiết kế hệ thống, gửi Hội đồng khoa học và đào tạo thẩm định.',
    N'Bản thảo đủ 7 chương, có bài tập tình huống, trình bày đúng quy định giáo trình của Trường.',
    1, 3, 13, 3, 2, -50, 9, -50, 15, NULL, NULL, NULL),
(14, N'Chuẩn bị đề thi kết thúc học phần Kiểm thử phần mềm',
    N'Biên soạn 2 đề thi tự luận và đáp án cho học phần Kiểm thử phần mềm.',
    N'Đề thi đúng cấu trúc, không trùng quá 20% với đề các năm trước, có đáp án và thang điểm.',
    1, 4, 22, 4, 4, -46, 9, -46, -20, -22, 9, NULL),
(15, N'Hướng dẫn sinh viên tham gia kỳ thi Olympic Tin học sinh viên',
    N'Tuyển chọn và bồi dưỡng đội tuyển sinh viên tham gia kỳ thi Olympic Tin học sinh viên toàn quốc.',
    N'Chọn được đội tuyển 6 sinh viên, hoàn thành 10 buổi bồi dưỡng, nộp hồ sơ dự thi đúng hạn.',
    1, 4, 22, 2, 2, -12, 9, -12, 40, NULL, NULL, NULL),
(16, N'Tổ chức lớp bồi dưỡng lập trình di động cho sinh viên năm nhất',
    N'Mở lớp ngoại khóa lập trình di động 6 buổi cho sinh viên năm nhất.',
    N'Lớp có tối thiểu 30 sinh viên đăng ký, đủ 6 buổi học.',
    1, 4, 22, 1, 6, -28, 10, -28, 5, NULL, NULL, NULL),
(17, N'Biên dịch tài liệu tham khảo học phần Kiến trúc phần mềm',
    N'Biên dịch 3 chương tài liệu tham khảo tiếng Anh sang tiếng Việt cho sinh viên học phần Kiến trúc phần mềm.',
    N'Bản dịch đúng thuật ngữ chuyên ngành, được một giảng viên khác đọc duyệt.',
    1, 4, 22, 2, 2, -10, 9, -10, 18, NULL, NULL, NULL),
(18, N'Rà soát cấu hình phòng thực hành mạng máy tính',
    N'Kiểm tra, cài đặt lại thiết bị và phần mềm mô phỏng tại phòng thực hành mạng B.405 và B.406.',
    N'100% máy và thiết bị chuyển mạch hoạt động, có biên bản bàn giao cho bộ môn.',
    1, 5, 33, 4, 2, -30, 8, -30, -8, NULL, NULL, NULL),
(19, N'Cập nhật kịch bản thực hành An toàn thông tin',
    N'Cập nhật các bài thực hành tấn công – phòng thủ theo các lỗ hổng phổ biến năm 2026.',
    N'Tối thiểu 8 kịch bản thực hành mới, chạy được trên máy ảo của phòng thực hành.',
    1, 5, 33, 2, 4, -66, 9, -66, -35, -37, 10, NULL),
(20, N'Viết bài báo hội thảo quốc gia về phát hiện xâm nhập mạng',
    N'Viết và gửi bài báo về mô hình phát hiện xâm nhập mạng dùng học sâu tới hội thảo quốc gia năm 2026.',
    N'Bài báo đúng định dạng của hội thảo, đã gửi qua hệ thống nộp bài.',
    2, 5, 33, 3, 3, -40, 9, -40, 7, NULL, NULL, NULL),
(21, N'Xây dựng học liệu số học phần Thương mại điện tử',
    N'Xây dựng học liệu số (video bài giảng, câu hỏi tự kiểm tra) cho học phần Thương mại điện tử.',
    N'Tối thiểu 12 video bài giảng và 120 câu hỏi tự kiểm tra trên hệ thống học trực tuyến.',
    1, 6, 47, 3, 2, -14, 9, -14, 2, NULL, NULL, NULL),
(22, N'Chuẩn bị gian hàng tư vấn tại Ngày hội tư vấn tuyển sinh 2027',
    N'Chuẩn bị tài liệu, ấn phẩm và người trực gian hàng tư vấn ngành Công nghệ số.',
    N'Có tờ rơi, video giới thiệu ngành và lịch trực đủ 2 ngày.',
    4, 6, 47, 2, 2, -3, 14, -3, 20, NULL, NULL, NULL),
(23, N'Chuẩn bị hồ sơ tự đánh giá chương trình đào tạo ngành Khoa học dữ liệu',
    N'Chuẩn bị hồ sơ tự đánh giá phục vụ kiểm định chương trình đào tạo ngành Khoa học dữ liệu năm 2027.',
    N'Báo cáo tự đánh giá và bộ minh chứng đủ các tiêu chuẩn, được Hội đồng khoa học và đào tạo thông qua.',
    1, 1, 33, 4, 2, -45, 9, -45, 60, NULL, NULL, NULL),
(24, N'Tổng hợp minh chứng tiêu chuẩn Đội ngũ giảng viên',
    N'Tổng hợp lý lịch khoa học, minh chứng bồi dưỡng chuyên môn và khối lượng giảng dạy của giảng viên bộ môn.',
    N'Minh chứng sắp xếp theo mã tiêu chí, có danh mục tra cứu.',
    1, 2, 1, 3, 2, -40, 9, -40, 30, NULL, NULL, 23),
(25, N'Thẩm định đề cương đề tài nghiên cứu cấp khoa đợt 2',
    N'Thẩm định 9 đề cương đề tài nghiên cứu cấp khoa đợt 2 năm học 2026–2027.',
    N'Có phiếu thẩm định của từng thành viên và biên bản họp hội đồng.',
    2, 11, 33, 3, 2, -9, 9, -9, 9, NULL, NULL, NULL),
(26, N'Tổng hợp lịch coi thi giữa kỳ của giảng viên toàn khoa',
    N'Tổng hợp lịch coi thi giữa kỳ của giảng viên các bộ môn, gửi Phòng Khảo thí.',
    N'Lịch coi thi không trùng lịch giảng dạy, gửi đúng hạn.',
    1, 7, 2, 3, 4, -20, 9, -20, -6, -7, 11, NULL);

-- Phân công: ak, việc, người giao, đơn vị giao, người nhận, đơn vị nhận, lời nhắn, trạng thái, giao (d,h), hạn d, tiếp nhận (d,h), hoàn thành (d,h), vai trò
DECLARE @A TABLE (ak INT PRIMARY KEY, k INT, Giao INT, DvGiao INT, Nhan INT, DvNhan INT, Nhan_ NVARCHAR(1000), TrangThai TINYINT,
  gD INT, gH DECIMAL(4,2), dueD INT, aD INT, aH DECIMAL(4,2), fD INT, fH DECIMAL(4,2), VaiTro TINYINT);
INSERT @A VALUES
(1, 1, 1, 2, 3, NULL, N'Chị chủ trì, phối hợp thầy Hùng phần tài liệu tham khảo.', 4, -80, 9.5, -50, -79, 8, -52, 15, 1),
(2, 1, 1, 2, 4, NULL, NULL, 4, -80, 9.5, -50, -79, 10, -52, 14.5, 2),
(3, 2, 1, 2, 6, NULL, N'Ưu tiên dữ liệu có nguồn công khai, ghi rõ giấy phép sử dụng.', 4, -72, 10.5, -42, -71, 9, -34, 10, 1),
(4, 3, 1, 2, 3, NULL, NULL, 2, -21, 9.5, 25, -20, 9, NULL, NULL, 1),
(5, 3, 1, 2, 8, NULL, N'Cô Trang làm chương 6–8.', 2, -21, 9.5, 25, -19, 14, NULL, NULL, 2),
(6, 4, 1, 2, 7, NULL, NULL, 3, -24, 8.5, 4, -23, 9, NULL, NULL, NULL),
(7, 5, 1, 2, 3, NULL, N'Số liệu lấy từ Phòng Khoa học Công nghệ và các nhóm hướng dẫn.', 2, -30, 9.5, 3, -29, 10, NULL, NULL, 1),
(8, 6, 1, 2, 9, NULL, NULL, 2, -36, 14.5, -4, -35, 8, NULL, NULL, NULL),
(9, 7, 1, 2, 11, NULL, NULL, 2, -18, 10.5, 2, -17, 9, NULL, NULL, 1),
(10, 8, 1, 2, 3, NULL, N'Gửi phiếu đề xuất trước hạn để bộ môn họp xét chọn.', 0, -2, 9.5, 28, NULL, NULL, NULL, NULL, NULL),
(11, 8, 1, 2, 10, NULL, N'Gửi phiếu đề xuất trước hạn để bộ môn họp xét chọn.', 0, -2, 9.5, 28, NULL, NULL, NULL, NULL, NULL),
(12, 10, 13, 3, 14, NULL, NULL, 2, -15, 9.5, 20, -14, 8.5, NULL, NULL, 1),
(13, 10, 13, 3, 15, NULL, N'Cô Định phụ trách phần khảo sát doanh nghiệp.', 1, -15, 9.5, 20, -14, 10, NULL, NULL, 2),
(14, 11, 13, 3, 18, NULL, NULL, 4, -62, 9.5, -30, -61, 9, -31, 16, 1),
(15, 12, 13, 3, 19, NULL, NULL, 2, -40, 10.5, 10, -39, 9, NULL, NULL, NULL),
(16, 13, 13, 3, 20, NULL, NULL, 2, -50, 9.5, 15, -49, 8, NULL, NULL, 1),
(17, 14, 22, 4, 25, NULL, NULL, 4, -46, 9.5, -20, -46, 15, -22, 9, NULL),
(18, 15, 22, 4, 26, NULL, N'Thầy Danh chủ trì, lên lịch bồi dưỡng hằng tuần.', 2, -12, 9.5, 40, -11, 9, NULL, NULL, 1),
(19, 15, 22, 4, 27, NULL, NULL, 1, -12, 9.5, 40, -10, 10, NULL, NULL, 2),
(20, 15, 22, 4, 32, NULL, N'Bổ sung thầy Tuấn Anh phụ trách phần thuật toán.', 0, -5, 15, 40, NULL, NULL, NULL, NULL, 2),
(21, 16, 22, 4, 28, NULL, NULL, 6, -28, 10.5, 5, -27, 9, NULL, NULL, NULL),
(22, 17, 22, 4, 29, NULL, NULL, 5, -10, 9.5, 18, NULL, NULL, NULL, NULL, NULL),
(23, 17, 22, 4, 30, NULL, NULL, 2, -8, 9, 18, -8, 15, NULL, NULL, 1),
(24, 18, 33, 5, 35, NULL, N'Thầy Hoàng chủ trì phòng B.405, thầy Khiêm phòng B.406.', 2, -30, 8.5, -8, -29, 8, NULL, NULL, 1),
(25, 18, 33, 5, 36, NULL, NULL, 1, -30, 8.5, -8, -28, 9, NULL, NULL, 2),
(26, 19, 33, 5, 37, NULL, NULL, 4, -66, 9.5, -35, -65, 9, -37, 10, NULL),
(27, 20, 33, 5, 38, NULL, NULL, 3, -40, 9.5, 7, -39, 9, NULL, NULL, 1),
(28, 20, 33, 5, 39, NULL, N'Thầy Tùng phụ trách phần thực nghiệm.', 4, -40, 9.5, 7, -39, 10, -5, 9, 2),
(29, 21, 47, 6, 48, NULL, NULL, 2, -14, 9.5, 2, -13, 8, NULL, NULL, NULL),
(30, 22, 47, 6, 50, NULL, NULL, 1, -3, 14.5, 20, -2, 9, NULL, NULL, 1),
(31, 22, 47, 6, 51, NULL, NULL, 0, -3, 14.5, 20, NULL, NULL, NULL, NULL, 2),
(32, 23, 33, 1, NULL, 2, N'Bộ môn Khoa học dữ liệu chủ trì viết báo cáo tự đánh giá.', 2, -45, 9.5, 60, -44, 9, NULL, NULL, 1),
(33, 23, 33, 1, NULL, 3, N'Phối hợp cung cấp minh chứng tiêu chuẩn Cơ sở vật chất.', 0, -6, 9, 60, NULL, NULL, NULL, NULL, 2),
(34, 23, 1, 2, 3, NULL, N'Chị Hà viết phần mở đầu và tiêu chuẩn 1–3.', 2, -44, 10, 50, -43, 9, NULL, NULL, 1),
(35, 24, 1, 2, 4, NULL, NULL, 2, -40, 9.5, 30, -39, 9, NULL, NULL, NULL),
(36, 25, 33, 11, 34, NULL, N'Thầy Thịnh tổng hợp phiếu và soạn biên bản.', 2, -9, 9.5, 9, -9, 15, NULL, NULL, 1),
(37, 25, 33, 11, 45, NULL, NULL, 0, -9, 9.5, 9, NULL, NULL, NULL, NULL, 2),
(38, 26, 2, 7, 54, NULL, NULL, 4, -20, 9.5, -6, -20, 14, -7, 11, NULL);

-- Báo cáo tiến độ: phân công, %, nội dung, (d,h)
DECLARE @U TABLE (n INT IDENTITY PRIMARY KEY, ak INT, Pct DECIMAL(5,2), ND NVARCHAR(2000), d INT, h DECIMAL(4,2));
INSERT @U (ak, Pct, ND, d, h) VALUES
(1, 40, N'Đã đối chiếu chương 1–3 với chuẩn đầu ra mới.', -70, 16),
(1, 80, N'Hoàn thành ma trận chuẩn đầu ra – bài đánh giá, đang sửa phần phương pháp giảng dạy.', -60, 15),
(1, 100, N'Hoàn chỉnh đề cương, chờ nộp.', -54, 9),
(2, 50, N'Đã lọc danh mục tài liệu, thay 6 tài liệu cũ hơn 5 năm.', -65, 10),
(2, 100, N'Hoàn thành danh mục tài liệu tham khảo.', -55, 8.5),
(3, 30, N'Thu thập xong 2 bộ dữ liệu giáo dục và bán lẻ.', -62, 16),
(3, 70, N'Làm sạch 4/5 bộ dữ liệu, đang viết từ điển dữ liệu.', -50, 15),
(3, 100, N'Đủ 5 bộ dữ liệu và bài mẫu.', -44, 15.5),
(3, 100, N'Đã làm sạch lại bộ dữ liệu y tế và bổ sung từ điển dữ liệu theo góp ý.', -36, 14),
(4, 20, N'Xong chương 1–2: slide và bài tập.', -14, 16),
(4, 45, N'Xong chương 3, đang quay video chương 4.', -4, 10),
(5, 30, N'Hoàn thành slide chương 6.', -6, 15),
(6, 60, N'Đã chấm 7/12 đề cương.', -12, 16),
(6, 100, N'Chấm xong 12 đề cương.', -3, 9),
(7, 50, N'Đã tổng hợp danh sách đề tài và kinh phí.', -20, 15),
(7, 100, N'Hoàn thành báo cáo.', -8, 16),
(7, 85, N'Đang bổ sung bảng kinh phí và danh sách đề tài đạt giải theo góp ý.', -4, 9),
(8, 25, N'Rà soát xong chương 1–2, loại 18 câu trùng.', -25, 15),
(8, 60, N'Bổ sung câu hỏi chương 3–4.', -9, 16),
(9, 30, N'Hoàn thành phần quy trình và mẫu báo cáo.', -10, 9),
(9, 50, N'Đang lấy ý kiến doanh nghiệp về đề tài mẫu.', -3, 15),
(12, 20, N'Đã thu thập chương trình đào tạo của 3 trường để đối sánh.', -7, 10),
(14, 50, N'Đã liên hệ được báo cáo viên, chốt ngày tổ chức.', -45, 9),
(14, 100, N'Đã tổ chức xong buổi báo cáo.', -33, 17),
(15, 30, N'Đã gửi phiếu khảo sát tới 12 doanh nghiệp, nhận về 9 phiếu.', -20, 15),
(16, 30, N'Hoàn thành bản thảo chương 1–2.', -35, 16),
(16, 55, N'Hoàn thành chương 3–4, đang viết chương 5.', -15, 10),
(16, 70, N'Xong chương 5, bắt đầu soạn bài tập tình huống.', -3, 16),
(17, 50, N'Hoàn thành đề 1 và đáp án.', -35, 15),
(17, 100, N'Hoàn thành 2 đề và đáp án.', -27, 9),
(17, 100, N'Biên soạn lại đề 1 theo nhận xét.', -24, 9),
(18, 25, N'Đã tuyển chọn 6 sinh viên, tổ chức 2 buổi bồi dưỡng.', -3, 16),
(21, 10, N'Đã mở đăng ký, có 14 sinh viên đăng ký.', -20, 9),
(23, 15, N'Đã dịch xong mục lục và thuật ngữ chương 1.', -2, 16),
(24, 20, N'Phòng B.405: kiểm tra xong 20/40 máy.', -20, 16),
(24, 40, N'Phòng B.405 còn 3 thiết bị chuyển mạch hỏng, đã đề xuất thay.', -11, 15),
(26, 40, N'Đã viết lại 4 kịch bản thực hành.', -55, 16),
(26, 100, N'Hoàn thành 9 kịch bản, chạy thử trên máy ảo.', -39, 15),
(27, 40, N'Hoàn thành phần tổng quan và phương pháp.', -25, 16),
(27, 80, N'Có kết quả thực nghiệm, đang viết phần thảo luận.', -12, 15),
(27, 100, N'Hoàn thành bản thảo, đã gửi bài.', -4, 16),
(28, 100, N'Hoàn thành thực nghiệm và bảng kết quả.', -7, 15),
(29, 40, N'Quay xong 5 video bài giảng.', -8, 16),
(29, 80, N'Xong 10 video và 100 câu hỏi tự kiểm tra.', -2, 15),
(34, 35, N'Viết xong phần mở đầu và tiêu chuẩn 1.', -5, 16),
(35, 50, N'Đã tổng hợp lý lịch khoa học của 12 giảng viên.', -7, 15),
(36, 40, N'Đã nhận 4/9 phiếu thẩm định.', -2, 10),
(38, 60, N'Đã nhận lịch của 4/6 bộ môn.', -12, 16),
(38, 100, N'Hoàn thành lịch coi thi toàn khoa.', -8, 9);

-- Kết quả: rk, phân công, lần nộp, trạng thái nộp, nội dung, (d,h)
DECLARE @R TABLE (rk INT PRIMARY KEY, ak INT, LanNop INT, TrangThai TINYINT, ND NVARCHAR(MAX), d INT, h DECIMAL(4,2));
INSERT @R VALUES
(1, 1, 1, 1, N'Đề cương chi tiết đã cập nhật theo chuẩn đầu ra mới, bổ sung ma trận chuẩn đầu ra – bài đánh giá.', -54, 10),
(2, 2, 1, 1, N'Danh mục 14 tài liệu tham khảo, trong đó 9 tài liệu xuất bản từ 2022.', -55, 9),
(3, 3, 1, 2, N'Nộp 5 bộ dữ liệu kèm bài mẫu cho từng bộ.', -44, 16),
(4, 3, 2, 1, N'Đã làm sạch lại bộ dữ liệu y tế, bổ sung từ điển dữ liệu cho cả 5 bộ.', -36, 15),
(5, 6, 1, 0, N'Đã chấm 12 đề cương: 10 đề cương đạt, 2 đề cương cần chỉnh sửa. Bảng điểm và nhận xét theo mẫu phiếu phản biện.', -2, 10),
(6, 7, 1, 2, N'Báo cáo tổng kết: 18 đề tài, 4 đề tài đạt giải cấp Trường.', -7, 15),
(7, 14, 1, 1, N'Đã tổ chức buổi báo cáo với 126 sinh viên tham dự; có biên bản và danh sách điểm danh.', -32, 10),
(8, 17, 1, 3, N'Nộp 2 đề thi và đáp án.', -26, 15),
(9, 17, 2, 1, N'Nộp lại 2 đề thi, đề 1 đã biên soạn mới hoàn toàn.', -23, 14),
(10, 26, 1, 1, N'9 kịch bản thực hành mới, kèm hướng dẫn cài máy ảo.', -38, 9),
(11, 27, 1, 0, N'Bài báo đã gửi hội thảo, mã bài nộp NC-2026-118.', -3, 16),
(12, 28, 1, 1, N'Bảng kết quả thực nghiệm trên 3 bộ dữ liệu chuẩn.', -6, 10),
(13, 38, 1, 1, N'Lịch coi thi giữa kỳ của 58 giảng viên, đã đối chiếu với lịch giảng dạy.', -8, 10);

-- Đánh giá: kết quả, người đánh giá, quyết định, nhận xét, (d,h)
DECLARE @E TABLE (rk INT PRIMARY KEY, NguoiDG INT, QD TINYINT, NX NVARCHAR(4000), d INT, h DECIMAL(4,2));
INSERT @E VALUES
(1, 1, 1, N'Đạt. Bộ môn gửi Phòng Đào tạo.', -52, 15),
(2, 1, 1, NULL, -52, 14.5),
(3, 1, 2, N'Bộ dữ liệu y tế còn nhiều giá trị thiếu; cần làm sạch và bổ sung từ điển dữ liệu cho cả 5 bộ.', -43, 9),
(4, 1, 1, N'Đạt, dùng được cho các lớp năm nay.', -34, 10),
(6, 1, 2, N'Thiếu bảng tổng hợp kinh phí và danh sách đề tài đạt giải; bổ sung theo mẫu của Phòng Khoa học Công nghệ.', -6, 9),
(7, 13, 1, N'Tổ chức tốt, sinh viên phản hồi tích cực.', -31, 16),
(8, 22, 3, N'Đề 1 trùng khoảng 40% câu hỏi với đề năm trước. Biên soạn đề mới.', -25, 9),
(9, 22, 1, NULL, -22, 9),
(10, 33, 1, N'Đạt. Đưa vào các lớp thực hành từ tuần sau.', -37, 10),
(12, 33, 1, NULL, -5, 9),
(13, 2, 1, NULL, -7, 11);

-- Xin gia hạn: phân công, hạn cũ d, hạn đề xuất d, lý do, trạng thái, người duyệt, hạn được duyệt d, nhận xét, tạo (d,h), duyệt (d,h)
DECLARE @X TABLE (n INT IDENTITY PRIMARY KEY, ak INT, HanCu INT, DeXuat INT, LyDo NVARCHAR(1000), TrangThai TINYINT, Duyet INT, DuocDuyet INT,
  NX NVARCHAR(1000), d INT, h DECIMAL(4,2), dd INT, dh DECIMAL(4,2));
INSERT @X (ak, HanCu, DeXuat, LyDo, TrangThai, Duyet, DuocDuyet, NX, d, h, dd, dh) VALUES
(8, -4, 6, N'Đang coi thi và chấm bài các lớp buổi tối, xin thêm 10 ngày để hoàn thành chương 5–6.', 3, 1, NULL,
    N'Ngân hàng câu hỏi cần có trước kỳ kiểm tra giữa kỳ nên không lùi hạn. Ưu tiên hoàn thành chương 1–4 trước.', -6, 10, -5, 9),
(9, 2, 12, N'Cần thêm thời gian lấy ý kiến doanh nghiệp về danh sách đề tài mẫu.', 0, NULL, NULL, NULL, -1, 10, NULL, NULL),
(16, -5, 15, N'Hội đồng yêu cầu bổ sung chương bài tập tình huống, cần thêm 20 ngày.', 1, 13, 15,
    N'Đồng ý. Gửi bản thảo chương 5 cho bộ môn đọc trước.', -9, 15, -8, 9);

-- Xin từ chối (chưa tiếp nhận hoặc đã nhận), người giao duyệt: phân công, lý do, trạng thái (0 chờ, 1 đồng ý, 2 không đồng ý), người duyệt, nhận xét, gửi (d,h), duyệt (d,h)
DECLARE @Y TABLE (ak INT PRIMARY KEY, LyDo NVARCHAR(1000), TrangThai TINYINT, Duyet INT, NX NVARCHAR(1000), d INT, h DECIMAL(4,2), dd INT, dh DECIMAL(4,2));
INSERT @Y VALUES
(13, N'Tôi được cử đi tập huấn kiểm định chất lượng đến hết tháng 11, không đảm bảo thời gian thực hiện.', 0, NULL, NULL, -2, 14, NULL, NULL),
(22, N'Đang hướng dẫn 8 nhóm đồ án tốt nghiệp, không đủ thời gian biên dịch trong tháng này.', 1, 22, N'Đồng ý, bộ môn giao cho cô Mộng Thùy.', -10, 15, -8, 8.5),
(31, N'Hai ngày diễn ra ngày hội tôi đã có lịch đi tư vấn tuyển sinh tại các trường trung học phổ thông.', 0, NULL, NULL, -1, 9, NULL, NULL);

-- Bình luận: ck, việc, người viết, trả lời ck, nội dung, (d,h)
DECLARE @C TABLE (ck INT PRIMARY KEY, k INT, NguoiViet INT, Cha INT, ND NVARCHAR(4000), d INT, h DECIMAL(4,2));
INSERT @C VALUES
(1, 1, 4, NULL, N'Em đã gửi danh mục tài liệu mới vào thư mục chung của bộ môn.', -75, 10),
(2, 1, 1, 1, N'Cảm ơn thầy, chị Hà đưa vào đề cương giúp nhé.', -75, 14),
(3, 3, 3, NULL, N'Chương 4 nên dùng Power BI hay Tableau thì phù hợp hơn ạ?', -10, 9),
(4, 3, 1, 3, N'Dùng Power BI cho đồng bộ với phần mềm cài ở phòng máy.', -10, 15),
(5, 3, 8, NULL, N'Em gửi khung slide chương 6 để cả nhóm dùng chung định dạng.', -3, 10),
(6, 5, 3, NULL, N'Em sẽ nộp lại trước hạn, đang chờ Phòng Khoa học Công nghệ gửi số liệu kinh phí.', -4, 10),
(7, 6, 1, NULL, N'Thầy Thọ cập nhật tiến độ giúp, việc đã quá hạn.', -2, 9),
(8, 13, 20, NULL, N'Em gửi mục lục chi tiết chương 6–7 để bộ môn góp ý.', -5, 10),
(9, 18, 33, NULL, N'Phòng B.405 cần xong trước tuần sau để kịp lịch thực hành. Các thầy cập nhật tiến độ giúp.', -3, 9),
(10, 18, 35, 9, N'Đang chờ thiết bị chuyển mạch thay thế, dự kiến thứ Sáu có.', -2, 10),
(11, 20, 39, NULL, N'Kết quả thực nghiệm đã có trong thư mục chung, anh Tốt kiểm tra giúp.', -7, 16),
(12, 23, 33, NULL, N'Bộ môn Hệ thống thông tin tiếp nhận phần minh chứng cơ sở vật chất giúp khoa.', -6, 9.5),
(13, 25, 34, NULL, N'Kính gửi các thầy cô trong hội đồng: hạn gửi phiếu thẩm định là cuối tuần sau.', -2, 11);

-------------------------------------------------------------------------------- 4. Ghi vào CSDL
DECLARE @mt TABLE (k INT PRIMARY KEY, id INT);
DECLARE @ma TABLE (ak INT PRIMARY KEY, id INT);
DECLARE @mr TABLE (rk INT PRIMARY KEY, id INT);
DECLARE @mc TABLE (ck INT PRIMARY KEY, id INT);

MERGE dbo.CongViec AS cv USING @T AS s ON 1 = 0
WHEN NOT MATCHED THEN INSERT (TieuDe, MoTa, TieuChiHoanThanh, NgayBatDau, HanHoanThanh, TrangThai, MucDoUuTien, PhanTramTienDo, NgayTao, NgayHoanThanh, MaNguoiTao, MaDonViQuanLy, MaTheLoai)
VALUES (s.TieuDe, s.MoTa, s.TieuChi,
  CASE WHEN s.sD IS NULL THEN NULL ELSE DATEADD(DAY, s.sD, @L0) END,
  CASE WHEN s.dueD IS NULL THEN NULL ELSE DATEADD(SECOND, -1, DATEADD(DAY, s.dueD + 1, @L0)) END,
  s.TrangThai, s.UuTien, CASE WHEN s.TrangThai = 4 THEN 100 ELSE 0 END,
  DATEADD(MINUTE, CAST(s.cH * 60 AS INT), DATEADD(DAY, s.cD, @L0)),
  CASE WHEN s.doneD IS NULL THEN NULL ELSE DATEADD(MINUTE, CAST(s.doneH * 60 AS INT), DATEADD(DAY, s.doneD, @L0)) END,
  s.NguoiTao, s.DonVi, s.TheLoai)
OUTPUT s.k, inserted.MaCongViec INTO @mt;

UPDATE cv SET MaCongViecCha = p.id
FROM dbo.CongViec cv JOIN @mt c ON c.id = cv.MaCongViec JOIN @T s ON s.k = c.k JOIN @mt p ON p.k = s.Cha;

MERGE dbo.PhanCong AS pc USING (SELECT a.*, t.id AS TaskId FROM @A a JOIN @mt t ON t.k = a.k) AS s ON 1 = 0
WHEN NOT MATCHED THEN INSERT (MaCongViec, MaNguoiGiao, MaDonViGiao, MaNguoiNhan, MaDonViNhan, NoiDungGiao, TrangThaiPhanCong, NgayGiao, HanHoanThanh, NgayTiepNhan, NgayHoanThanh, VaiTro)
VALUES (s.TaskId, s.Giao, s.DvGiao, s.Nhan, s.DvNhan, s.Nhan_, s.TrangThai,
  DATEADD(MINUTE, CAST(s.gH * 60 AS INT), DATEADD(DAY, s.gD, @L0)),
  DATEADD(SECOND, -1, DATEADD(DAY, s.dueD + 1, @L0)),
  CASE WHEN s.aD IS NULL THEN NULL ELSE DATEADD(MINUTE, CAST(s.aH * 60 AS INT), DATEADD(DAY, s.aD, @L0)) END,
  CASE WHEN s.fD IS NULL THEN NULL ELSE DATEADD(MINUTE, CAST(s.fH * 60 AS INT), DATEADD(DAY, s.fD, @L0)) END,
  s.VaiTro)
OUTPUT s.ak, inserted.MaPhanCong INTO @ma;

INSERT dbo.CapNhatTienDo (MaPhanCong, MaNguoiCapNhat, PhanTramTienDo, NoiDungThucHien, NgayCapNhat)
SELECT m.id, a.Nhan, u.Pct, u.ND, DATEADD(MINUTE, CAST(u.h * 60 AS INT), DATEADD(DAY, u.d, @L0))
FROM @U u JOIN @A a ON a.ak = u.ak JOIN @ma m ON m.ak = u.ak ORDER BY u.n;

MERGE dbo.KetQuaCongViec AS kq USING (SELECT r.*, m.id AS AsgId, a.Nhan FROM @R r JOIN @A a ON a.ak = r.ak JOIN @ma m ON m.ak = r.ak) AS s ON 1 = 0
WHEN NOT MATCHED THEN INSERT (MaPhanCong, MaNguoiNop, LanNop, NoiDungKetQua, TrangThaiNop, NgayNop)
VALUES (s.AsgId, s.Nhan, s.LanNop, s.ND, s.TrangThai, DATEADD(MINUTE, CAST(s.h * 60 AS INT), DATEADD(DAY, s.d, @L0)))
OUTPUT s.rk, inserted.MaKetQua INTO @mr;

INSERT dbo.DanhGia (MaKetQua, MaNguoiDanhGia, QuyetDinh, NhanXet, NgayDanhGia)
SELECT m.id, e.NguoiDG, e.QD, e.NX, DATEADD(MINUTE, CAST(e.h * 60 AS INT), DATEADD(DAY, e.d, @L0))
FROM @E e JOIN @mr m ON m.rk = e.rk;

INSERT dbo.YeuCauGiaHan (MaPhanCong, MaNguoiYeuCau, HanCu, HanDeXuat, LyDo, TrangThai, MaNguoiDuyet, HanDuocDuyet, NhanXet, NgayTao, NgayDuyet)
SELECT m.id, a.Nhan,
  DATEADD(SECOND, -1, DATEADD(DAY, x.HanCu + 1, @L0)), DATEADD(SECOND, -1, DATEADD(DAY, x.DeXuat + 1, @L0)), x.LyDo, x.TrangThai, x.Duyet,
  CASE WHEN x.DuocDuyet IS NULL THEN NULL ELSE DATEADD(SECOND, -1, DATEADD(DAY, x.DuocDuyet + 1, @L0)) END, x.NX,
  DATEADD(MINUTE, CAST(x.h * 60 AS INT), DATEADD(DAY, x.d, @L0)),
  CASE WHEN x.dd IS NULL THEN NULL ELSE DATEADD(MINUTE, CAST(x.dh * 60 AS INT), DATEADD(DAY, x.dd, @L0)) END
FROM @X x JOIN @A a ON a.ak = x.ak JOIN @ma m ON m.ak = x.ak ORDER BY x.n;

INSERT dbo.YeuCauTuChoi (MaPhanCong, MaNguoiYeuCau, LyDo, TrangThai, MaNguoiDuyet, NhanXet, NgayTao, NgayDuyet)
SELECT m.id, a.Nhan, y.LyDo, y.TrangThai, y.Duyet, y.NX, DATEADD(MINUTE, CAST(y.h * 60 AS INT), DATEADD(DAY, y.d, @L0)),
  CASE WHEN y.dd IS NULL THEN NULL ELSE DATEADD(MINUTE, CAST(y.dh * 60 AS INT), DATEADD(DAY, y.dd, @L0)) END
FROM @Y y JOIN @A a ON a.ak = y.ak JOIN @ma m ON m.ak = y.ak;

-- Bình luận gốc trước, trả lời sau (cần mã bình luận cha).
MERGE dbo.BinhLuan AS bl USING (SELECT c.*, t.id AS TaskId FROM @C c JOIN @mt t ON t.k = c.k WHERE c.Cha IS NULL) AS s ON 1 = 0
WHEN NOT MATCHED THEN INSERT (MaCongViec, MaNguoiViet, NoiDung, NgayTao)
VALUES (s.TaskId, s.NguoiViet, s.ND, DATEADD(MINUTE, CAST(s.h * 60 AS INT), DATEADD(DAY, s.d, @L0)))
OUTPUT s.ck, inserted.MaBinhLuan INTO @mc;
MERGE dbo.BinhLuan AS bl USING (SELECT c.*, t.id AS TaskId, p.id AS ParentId FROM @C c JOIN @mt t ON t.k = c.k JOIN @mc p ON p.ck = c.Cha) AS s ON 1 = 0
WHEN NOT MATCHED THEN INSERT (MaCongViec, MaNguoiViet, MaBinhLuanCha, NoiDung, NgayTao)
VALUES (s.TaskId, s.NguoiViet, s.ParentId, s.ND, DATEADD(MINUTE, CAST(s.h * 60 AS INT), DATEADD(DAY, s.d, @L0)))
OUTPUT s.ck, inserted.MaBinhLuan INTO @mc;

-- Tiến độ tổng = trung bình báo cáo gần nhất của các phân công còn hiệu lực (như syncTask của API).
UPDATE cv SET PhanTramTienDo = CASE WHEN x.Avg >= 100 AND x.NotDone > 0 THEN 99 ELSE x.Avg END
FROM dbo.CongViec cv
CROSS APPLY (
  SELECT CONVERT(DECIMAL(5,2), ROUND(AVG(CONVERT(DECIMAL(9,4), v.Pct)), 2)) AS Avg, SUM(CASE WHEN v.TrangThaiPhanCong <> 4 THEN 1 ELSE 0 END) AS NotDone
  FROM (
    SELECT p.TrangThaiPhanCong,
      CASE WHEN p.TrangThaiPhanCong = 4 THEN 100 ELSE ISNULL((SELECT TOP (1) td.PhanTramTienDo FROM dbo.CapNhatTienDo td WHERE td.MaPhanCong = p.MaPhanCong ORDER BY td.NgayCapNhat DESC), 0) END AS Pct
    FROM dbo.PhanCong p
    WHERE p.MaCongViec = cv.MaCongViec
      AND (p.TrangThaiPhanCong NOT IN (5, 6) OR NOT EXISTS (SELECT 1 FROM dbo.PhanCong q WHERE q.MaCongViec = cv.MaCongViec AND q.TrangThaiPhanCong NOT IN (5, 6)))
  ) v
) x
WHERE cv.TrangThai NOT IN (0, 4) AND x.Avg IS NOT NULL;

-------------------------------------------------------------------------------- 5. Lịch sử (thay dòng trigger ghi lúc chạy script bằng mốc thời gian thật của kịch bản)
DELETE dbo.LichSuCongViec;

DECLARE @H TABLE (MaCongViec INT, Nguoi INT, Loai NVARCHAR(50), MoTa NVARCHAR(1000), Truong NVARCHAR(100), Cu NVARCHAR(MAX), Moi NVARCHAR(MAX), TG DATETIME2);

INSERT @H SELECT MaCongViec, MaNguoiTao, N'TaoCongViec', N'Tạo công việc', NULL, NULL, NULL, NgayTao FROM dbo.CongViec;

INSERT @H SELECT p.MaCongViec, p.MaNguoiGiao, N'GiaoViec',
  N'Giao cho ' + COALESCE(nn.HoTen, dn.TenDonVi) + CASE p.VaiTro WHEN 1 THEN N' (chủ trì)' WHEN 2 THEN N' (phối hợp)' ELSE N'' END
    + N', hạn ' + FORMAT(DATEADD(HOUR, 7, p.HanHoanThanh), 'dd/MM/yyyy'), NULL, NULL, NULL, p.NgayGiao
FROM dbo.PhanCong p LEFT JOIN dbo.NguoiDung nn ON nn.MaNguoiDung = p.MaNguoiNhan LEFT JOIN dbo.DonVi dn ON dn.MaDonVi = p.MaDonViNhan;

-- Đơn vị nhận việc: trưởng đơn vị (người giao các phân công con) tiếp nhận.
INSERT @H SELECT p.MaCongViec, COALESCE(p.MaNguoiNhan, lead.MaNguoiGiao), N'TiepNhan',
  COALESCE(nn.HoTen + N' tiếp nhận', ln.HoTen + N' tiếp nhận cho ' + dn.TenDonVi), NULL, NULL, NULL, p.NgayTiepNhan
FROM dbo.PhanCong p
LEFT JOIN dbo.NguoiDung nn ON nn.MaNguoiDung = p.MaNguoiNhan
LEFT JOIN dbo.DonVi dn ON dn.MaDonVi = p.MaDonViNhan
OUTER APPLY (SELECT TOP (1) c.MaNguoiGiao FROM dbo.PhanCong c WHERE c.MaCongViec = p.MaCongViec AND c.MaDonViGiao = p.MaDonViNhan) lead
LEFT JOIN dbo.NguoiDung ln ON ln.MaNguoiDung = lead.MaNguoiGiao
WHERE p.NgayTiepNhan IS NOT NULL;


INSERT @H SELECT p.MaCongViec, td.MaNguoiCapNhat, N'CapNhatTienDo', nn.HoTen + N' cập nhật tiến độ: ' + td.NoiDungThucHien, N'PhanTramTienDo',
  FORMAT(ISNULL(LAG(td.PhanTramTienDo) OVER (PARTITION BY td.MaPhanCong ORDER BY td.NgayCapNhat), 0), '0.##'), FORMAT(td.PhanTramTienDo, '0.##'), td.NgayCapNhat
FROM dbo.CapNhatTienDo td JOIN dbo.PhanCong p ON p.MaPhanCong = td.MaPhanCong JOIN dbo.NguoiDung nn ON nn.MaNguoiDung = td.MaNguoiCapNhat;

INSERT @H SELECT p.MaCongViec, kq.MaNguoiNop, N'NopKetQua', nn.HoTen + N' nộp kết quả lần ' + CONVERT(NVARCHAR(10), kq.LanNop), NULL, NULL, NULL, kq.NgayNop
FROM dbo.KetQuaCongViec kq JOIN dbo.PhanCong p ON p.MaPhanCong = kq.MaPhanCong JOIN dbo.NguoiDung nn ON nn.MaNguoiDung = kq.MaNguoiNop;

INSERT @H SELECT p.MaCongViec, dg.MaNguoiDanhGia, N'DuyetKetQua',
  ng.HoTen + N' đánh giá lần nộp ' + CONVERT(NVARCHAR(10), kq.LanNop) + N' của ' + nn.HoTen + N': '
    + CASE dg.QuyetDinh WHEN 1 THEN N'Đạt' WHEN 2 THEN N'Cần bổ sung' ELSE N'Không đạt' END,
  N'TrangThaiNop', N'0', CONVERT(NVARCHAR(10), dg.QuyetDinh), dg.NgayDanhGia
FROM dbo.DanhGia dg JOIN dbo.KetQuaCongViec kq ON kq.MaKetQua = dg.MaKetQua JOIN dbo.PhanCong p ON p.MaPhanCong = kq.MaPhanCong
JOIN dbo.NguoiDung ng ON ng.MaNguoiDung = dg.MaNguoiDanhGia JOIN dbo.NguoiDung nn ON nn.MaNguoiDung = kq.MaNguoiNop;

INSERT @H SELECT p.MaCongViec, y.MaNguoiYeuCau, N'XinGiaHan',
  nn.HoTen + N' xin gia hạn từ ' + FORMAT(DATEADD(HOUR, 7, y.HanCu), 'dd/MM/yyyy') + N' đến ' + FORMAT(DATEADD(HOUR, 7, y.HanDeXuat), 'dd/MM/yyyy') + N'. Lý do: ' + y.LyDo,
  NULL, NULL, NULL, y.NgayTao
FROM dbo.YeuCauGiaHan y JOIN dbo.PhanCong p ON p.MaPhanCong = y.MaPhanCong JOIN dbo.NguoiDung nn ON nn.MaNguoiDung = y.MaNguoiYeuCau;

INSERT @H SELECT p.MaCongViec, y.MaNguoiDuyet, N'DuyetGiaHan',
  nd.HoTen + CASE y.TrangThai WHEN 1 THEN N' đồng ý' WHEN 2 THEN N' đồng ý với hạn khác' ELSE N' từ chối' END + N' gia hạn cho ' + nn.HoTen
    + CASE WHEN y.HanDuocDuyet IS NULL THEN N'' ELSE N': hạn mới ' + FORMAT(DATEADD(HOUR, 7, y.HanDuocDuyet), 'dd/MM/yyyy') END,
  N'HanHoanThanh', FORMAT(DATEADD(HOUR, 7, y.HanCu), 'dd/MM/yyyy'),
  CASE WHEN y.HanDuocDuyet IS NULL THEN NULL ELSE FORMAT(DATEADD(HOUR, 7, y.HanDuocDuyet), 'dd/MM/yyyy') END, y.NgayDuyet
FROM dbo.YeuCauGiaHan y JOIN dbo.PhanCong p ON p.MaPhanCong = y.MaPhanCong
JOIN dbo.NguoiDung nn ON nn.MaNguoiDung = y.MaNguoiYeuCau JOIN dbo.NguoiDung nd ON nd.MaNguoiDung = y.MaNguoiDuyet
WHERE y.TrangThai <> 0;

INSERT @H SELECT p.MaCongViec, y.MaNguoiYeuCau, N'XinTuChoi',
  nn.HoTen + CASE WHEN (p.NgayTiepNhan IS NULL OR p.NgayTiepNhan > y.NgayTao) THEN N' xin từ chối nhận việc' ELSE N' xin từ chối việc đã nhận' END + N'. Lý do: ' + y.LyDo, NULL, NULL, NULL, y.NgayTao
FROM dbo.YeuCauTuChoi y JOIN dbo.PhanCong p ON p.MaPhanCong = y.MaPhanCong JOIN dbo.NguoiDung nn ON nn.MaNguoiDung = y.MaNguoiYeuCau;
INSERT @H SELECT p.MaCongViec, y.MaNguoiDuyet, N'DuyetTuChoi',
  nd.HoTen + CASE y.TrangThai WHEN 1 THEN N' đồng ý' ELSE N' không đồng ý' END + N' cho ' + nn.HoTen
    + CASE WHEN (p.NgayTiepNhan IS NULL OR p.NgayTiepNhan > y.NgayTao) THEN N' từ chối nhận việc' ELSE N' từ chối việc' END + COALESCE(N'. ' + y.NhanXet, N''), NULL, NULL, NULL, y.NgayDuyet
FROM dbo.YeuCauTuChoi y JOIN dbo.PhanCong p ON p.MaPhanCong = y.MaPhanCong
JOIN dbo.NguoiDung nn ON nn.MaNguoiDung = y.MaNguoiYeuCau JOIN dbo.NguoiDung nd ON nd.MaNguoiDung = y.MaNguoiDuyet
WHERE y.TrangThai <> 0;

INSERT @H SELECT b.MaCongViec, b.MaNguoiViet, N'BinhLuan', nn.HoTen + CASE WHEN b.MaBinhLuanCha IS NULL THEN N' bình luận' ELSE N' trả lời bình luận' END,
  NULL, NULL, NULL, b.NgayTao
FROM dbo.BinhLuan b JOIN dbo.NguoiDung nn ON nn.MaNguoiDung = b.MaNguoiViet;

-- Đóng Hoàn thành: tự đóng khi duyệt Đạt phân công cuối (trigger ghi Chờ duyệt → Hoàn thành).
INSERT @H SELECT MaCongViec, MaNguoiTao, N'DoiTrangThai', N'Thay đổi TrangThai', N'TrangThai', N'3', N'4', NgayHoanThanh
FROM dbo.CongViec WHERE TrangThai = 4;

-- Tạm dừng (việc 12) và hủy (việc 16): ghi chú lý do + đổi trạng thái.
DECLARE @t12 INT = (SELECT id FROM @mt WHERE k = 12), @t16 INT = (SELECT id FROM @mt WHERE k = 16);
INSERT @H VALUES
(@t12, 13, N'GhiChu', N'Tạm dừng: chờ Phòng Quan hệ doanh nghiệp gửi danh sách doanh nghiệp đối tác năm 2027.', NULL, NULL, NULL, DATEADD(MINUTE, 9 * 60, DATEADD(DAY, -10, @L0))),
(@t12, 13, N'DoiTrangThai', N'Thay đổi TrangThai', N'TrangThai', N'2', N'5', DATEADD(MINUTE, 9 * 60, DATEADD(DAY, -10, @L0))),
(@t16, 22, N'GhiChu', N'Hủy: Trường tổ chức lớp chung cấp Trường, khoa không mở lớp riêng.', NULL, NULL, NULL, DATEADD(MINUTE, 10 * 60, DATEADD(DAY, -14, @L0))),
(@t16, 22, N'HuyPhanCong', N'Hủy phân công của Mạnh Thiên Lý', NULL, NULL, NULL, DATEADD(MINUTE, 10 * 60, DATEADD(DAY, -14, @L0))),
(@t16, 22, N'DoiTrangThai', N'Thay đổi TrangThai', N'TrangThai', N'2', N'6', DATEADD(MINUTE, 10 * 60, DATEADD(DAY, -14, @L0)));

INSERT dbo.LichSuCongViec (MaCongViec, MaNguoiThucHien, LoaiHanhDong, MoTa, TruongThayDoi, GiaTriCu, GiaTriMoi, ThoiGian)
SELECT MaCongViec, Nguoi, Loai, MoTa, Truong, Cu, Moi, TG FROM @H ORDER BY TG;

-------------------------------------------------------------------------------- 6. Thông báo (đã đọc nếu cũ hơn 2 ngày hoặc đã xử lý)
DECLARE @N TABLE (Nhan INT, MaCongViec INT, Loai NVARCHAR(30), MucDo TINYINT, TieuDe NVARCHAR(250), ND NVARCHAR(MAX), CanXuLy BIT, TG DATETIME2, XuLy DATETIME2);

-- Giao việc cho cá nhân; xử lý khi tiếp nhận / từ chối.
INSERT @N SELECT p.MaNguoiNhan, p.MaCongViec, N'GiaoViec', 0, N'Việc mới: ' + cv.TieuDe,
  ng.HoTen + COALESCE(N' (' + dg.TenDonVi + N')', N'') + N' giao, hạn ' + FORMAT(DATEADD(HOUR, 7, p.HanHoanThanh), 'dd/MM/yyyy') + N'.' + COALESCE(N' Lời nhắn: ' + p.NoiDungGiao, N''),
  1, p.NgayGiao, COALESCE(p.NgayTiepNhan, (SELECT MIN(y.NgayTao) FROM dbo.YeuCauTuChoi y WHERE y.MaPhanCong = p.MaPhanCong))
FROM dbo.PhanCong p JOIN dbo.CongViec cv ON cv.MaCongViec = p.MaCongViec JOIN dbo.NguoiDung ng ON ng.MaNguoiDung = p.MaNguoiGiao
LEFT JOIN dbo.DonVi dg ON dg.MaDonVi = p.MaDonViGiao AND p.MaDonViGiao <> cv.MaDonViQuanLy
WHERE p.MaNguoiNhan IS NOT NULL;

-- Giao việc cho đơn vị: gửi trưởng đơn vị.
INSERT @N SELECT CASE p.MaDonViNhan WHEN 2 THEN 1 WHEN 3 THEN 13 END, p.MaCongViec, N'GiaoViec', 0, N'Đơn vị được giao việc: ' + cv.TieuDe,
  ng.HoTen + N' giao cho ' + dn.TenDonVi + N', hạn ' + FORMAT(DATEADD(HOUR, 7, p.HanHoanThanh), 'dd/MM/yyyy') + N'.' + COALESCE(N' Lời nhắn: ' + p.NoiDungGiao, N''),
  1, p.NgayGiao, p.NgayTiepNhan
FROM dbo.PhanCong p JOIN dbo.CongViec cv ON cv.MaCongViec = p.MaCongViec JOIN dbo.NguoiDung ng ON ng.MaNguoiDung = p.MaNguoiGiao JOIN dbo.DonVi dn ON dn.MaDonVi = p.MaDonViNhan
WHERE p.MaDonViNhan IS NOT NULL;

-- Tiếp nhận / từ chối nhận việc: báo người giao.
INSERT @N SELECT p.MaNguoiGiao, p.MaCongViec, N'TiepNhan', 0, N'Đã tiếp nhận: ' + cv.TieuDe, nn.HoTen + N' đã tiếp nhận việc.', 0, p.NgayTiepNhan, NULL
FROM dbo.PhanCong p JOIN dbo.CongViec cv ON cv.MaCongViec = p.MaCongViec JOIN dbo.NguoiDung nn ON nn.MaNguoiDung = p.MaNguoiNhan
WHERE p.NgayTiepNhan IS NOT NULL;

-- Nộp kết quả: báo người giao, xử lý khi đánh giá.
INSERT @N SELECT p.MaNguoiGiao, p.MaCongViec, N'KetQua', 0, N'Kết quả chờ duyệt: ' + cv.TieuDe, nn.HoTen + N' nộp kết quả lần ' + CONVERT(NVARCHAR(10), kq.LanNop) + N'.',
  1, kq.NgayNop, dg.NgayDanhGia
FROM dbo.KetQuaCongViec kq JOIN dbo.PhanCong p ON p.MaPhanCong = kq.MaPhanCong JOIN dbo.CongViec cv ON cv.MaCongViec = p.MaCongViec
JOIN dbo.NguoiDung nn ON nn.MaNguoiDung = kq.MaNguoiNop LEFT JOIN dbo.DanhGia dg ON dg.MaKetQua = kq.MaKetQua;

-- Đánh giá: báo người nộp; Cần bổ sung / Không đạt cần xử lý (xong khi nộp lại).
INSERT @N SELECT kq.MaNguoiNop, p.MaCongViec, N'KetQua', CASE WHEN dg.QuyetDinh = 1 THEN 0 ELSE 1 END,
  N'Kết quả ' + CASE dg.QuyetDinh WHEN 1 THEN N'Đạt' WHEN 2 THEN N'Cần bổ sung' ELSE N'Không đạt' END + N': ' + cv.TieuDe,
  COALESCE(ng.HoTen + N': ' + dg.NhanXet, ng.HoTen + N' đã duyệt kết quả.'),
  CASE WHEN dg.QuyetDinh = 1 THEN 0 ELSE 1 END, dg.NgayDanhGia,
  CASE WHEN dg.QuyetDinh = 1 THEN NULL ELSE (SELECT MIN(k2.NgayNop) FROM dbo.KetQuaCongViec k2 WHERE k2.MaPhanCong = kq.MaPhanCong AND k2.LanNop > kq.LanNop) END
FROM dbo.DanhGia dg JOIN dbo.KetQuaCongViec kq ON kq.MaKetQua = dg.MaKetQua JOIN dbo.PhanCong p ON p.MaPhanCong = kq.MaPhanCong
JOIN dbo.CongViec cv ON cv.MaCongViec = p.MaCongViec JOIN dbo.NguoiDung ng ON ng.MaNguoiDung = dg.MaNguoiDanhGia;

-- Xin gia hạn: báo người giao (xử lý khi duyệt); kết quả duyệt: báo người xin.
INSERT @N SELECT p.MaNguoiGiao, p.MaCongViec, N'GiaHan', 1, N'Xin gia hạn: ' + cv.TieuDe,
  nn.HoTen + N' xin gia hạn đến ' + FORMAT(DATEADD(HOUR, 7, y.HanDeXuat), 'dd/MM/yyyy') + N'. Lý do: ' + y.LyDo, 1, y.NgayTao, y.NgayDuyet
FROM dbo.YeuCauGiaHan y JOIN dbo.PhanCong p ON p.MaPhanCong = y.MaPhanCong JOIN dbo.CongViec cv ON cv.MaCongViec = p.MaCongViec JOIN dbo.NguoiDung nn ON nn.MaNguoiDung = y.MaNguoiYeuCau;
INSERT @N SELECT y.MaNguoiYeuCau, p.MaCongViec, N'GiaHan', CASE WHEN y.TrangThai = 3 THEN 1 ELSE 0 END,
  N'Gia hạn ' + CASE y.TrangThai WHEN 1 THEN N'đồng ý' WHEN 2 THEN N'đồng ý với hạn khác' ELSE N'từ chối' END + N': ' + cv.TieuDe,
  CASE WHEN y.HanDuocDuyet IS NULL THEN y.NhanXet ELSE N'Hạn mới: ' + FORMAT(DATEADD(HOUR, 7, y.HanDuocDuyet), 'dd/MM/yyyy') + N'.' + COALESCE(N' ' + y.NhanXet, N'') END,
  0, y.NgayDuyet, NULL
FROM dbo.YeuCauGiaHan y JOIN dbo.PhanCong p ON p.MaPhanCong = y.MaPhanCong JOIN dbo.CongViec cv ON cv.MaCongViec = p.MaCongViec
WHERE y.TrangThai <> 0;

-- Xin từ chối: báo người giao (cần xử lý, xong khi duyệt); kết quả duyệt: báo người xin.
INSERT @N SELECT p.MaNguoiGiao, p.MaCongViec, N'TiepNhan', 1,
  CASE WHEN (p.NgayTiepNhan IS NULL OR p.NgayTiepNhan > y.NgayTao) THEN N'Xin từ chối nhận việc: ' ELSE N'Xin từ chối việc: ' END + cv.TieuDe, nn.HoTen + N': ' + y.LyDo, 1, y.NgayTao, y.NgayDuyet
FROM dbo.YeuCauTuChoi y JOIN dbo.PhanCong p ON p.MaPhanCong = y.MaPhanCong JOIN dbo.CongViec cv ON cv.MaCongViec = p.MaCongViec JOIN dbo.NguoiDung nn ON nn.MaNguoiDung = y.MaNguoiYeuCau;
INSERT @N SELECT y.MaNguoiYeuCau, p.MaCongViec, N'TiepNhan', CASE WHEN y.TrangThai = 1 THEN 0 ELSE 1 END,
  CASE WHEN y.TrangThai = 2 THEN N'Không đồng ý từ chối: ' WHEN (p.NgayTiepNhan IS NULL OR p.NgayTiepNhan > y.NgayTao) THEN N'Đã đồng ý cho từ chối nhận việc: ' ELSE N'Đã đồng ý cho thôi nhận việc: ' END + cv.TieuDe,
  COALESCE(y.NhanXet, N'Bạn không còn phụ trách phân công này.'), 0, y.NgayDuyet, NULL
FROM dbo.YeuCauTuChoi y JOIN dbo.PhanCong p ON p.MaPhanCong = y.MaPhanCong JOIN dbo.CongViec cv ON cv.MaCongViec = p.MaCongViec
WHERE y.TrangThai <> 0;

-- Bình luận: báo người tạo việc và người nhận việc (trừ người viết).
INSERT @N SELECT DISTINCT r.Nguoi, b.MaCongViec, N'BinhLuan', 0, N'Bình luận mới: ' + cv.TieuDe, nn.HoTen + N': ' + b.NoiDung, 0, b.NgayTao, NULL
FROM dbo.BinhLuan b JOIN dbo.CongViec cv ON cv.MaCongViec = b.MaCongViec JOIN dbo.NguoiDung nn ON nn.MaNguoiDung = b.MaNguoiViet
CROSS APPLY (SELECT cv.MaNguoiTao AS Nguoi UNION SELECT p.MaNguoiNhan FROM dbo.PhanCong p WHERE p.MaCongViec = b.MaCongViec AND p.MaNguoiNhan IS NOT NULL AND p.TrangThaiPhanCong NOT IN (5, 6)) r
WHERE r.Nguoi <> b.MaNguoiViet;

-- Hoàn thành / tạm dừng / hủy: báo người nhận việc.
INSERT @N SELECT p.MaNguoiNhan, cv.MaCongViec, N'HeThong', 0, N'Hoàn thành: ' + cv.TieuDe, N'Mọi kết quả đã được duyệt Đạt; công việc đã hoàn thành.', 0, cv.NgayHoanThanh, NULL
FROM dbo.CongViec cv JOIN dbo.PhanCong p ON p.MaCongViec = cv.MaCongViec WHERE cv.TrangThai = 4 AND p.MaNguoiNhan IS NOT NULL;
INSERT @N SELECT p.MaNguoiNhan, cv.MaCongViec, N'HeThong', 0, N'Tạm dừng: ' + cv.TieuDe, N'Lý do: chờ Phòng Quan hệ doanh nghiệp gửi danh sách doanh nghiệp đối tác năm 2027.', 0,
  DATEADD(MINUTE, 9 * 60, DATEADD(DAY, -10, @L0)), NULL
FROM dbo.CongViec cv JOIN dbo.PhanCong p ON p.MaCongViec = cv.MaCongViec WHERE cv.MaCongViec = @t12;
INSERT @N SELECT p.MaNguoiNhan, cv.MaCongViec, N'HeThong', 1, N'Đã hủy: ' + cv.TieuDe, N'Lý do: Trường tổ chức lớp chung cấp Trường, khoa không mở lớp riêng.', 0,
  DATEADD(MINUTE, 10 * 60, DATEADD(DAY, -14, @L0)), NULL
FROM dbo.CongViec cv JOIN dbo.PhanCong p ON p.MaCongViec = cv.MaCongViec WHERE cv.MaCongViec = @t16;

DECLARE @now DATETIME2 = SYSUTCDATETIME();
INSERT dbo.ThongBao (MaNguoiNhan, MaCongViec, LoaiThongBao, MucDo, TieuDe, NoiDung, DaDoc, NgayTao, NgayDoc, CanXuLy, NgayXuLy)
SELECT Nhan, MaCongViec, Loai, MucDo, LEFT(TieuDe, 250), ND,
  CASE WHEN XuLy IS NOT NULL OR TG < DATEADD(DAY, -2, @now) THEN 1 ELSE 0 END, TG,
  CASE WHEN XuLy IS NOT NULL THEN XuLy WHEN TG < DATEADD(DAY, -2, @now) THEN DATEADD(HOUR, 2, TG) END,
  CanXuLy, XuLy
FROM @N ORDER BY TG;

-------------------------------------------------------------------------------- 7. Tóm tắt
SELECT cv.TrangThai, COUNT(*) AS SoViec FROM dbo.CongViec cv GROUP BY cv.TrangThai ORDER BY cv.TrangThai;
SELECT (SELECT COUNT(*) FROM dbo.PhanCong) PhanCong, (SELECT COUNT(*) FROM dbo.CapNhatTienDo) TienDo, (SELECT COUNT(*) FROM dbo.KetQuaCongViec) KetQua,
  (SELECT COUNT(*) FROM dbo.DanhGia) DanhGia, (SELECT COUNT(*) FROM dbo.YeuCauGiaHan) GiaHan, (SELECT COUNT(*) FROM dbo.YeuCauTuChoi) TuChoi,
  (SELECT COUNT(*) FROM dbo.BinhLuan) BinhLuan, (SELECT COUNT(*) FROM dbo.LichSuCongViec) LichSu, (SELECT COUNT(*) FROM dbo.ThongBao WHERE MaCongViec IS NOT NULL) ThongBao;

COMMIT TRANSACTION;

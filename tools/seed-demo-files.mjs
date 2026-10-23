// Tạo tệp mẫu (.docx, .xlsx, .pdf có nội dung thật) và đính kèm vào các lần nộp kết quả của dữ liệu mẫu (tools/seed-demo-tasks.sql).
// Không cần Office: .docx/.xlsx ghi thẳng định dạng Office Open XML, .pdf in từ Microsoft Edge (chế độ không giao diện).
// Chạy SAU seed-demo-tasks.sql:  node tools/seed-demo-files.mjs [--db QLCongViecKhoaCNTT] [--uploads apps/api/App_Data/uploads]
// Chạy lại được: tệp kết quả cũ bị gỡ khỏi CSDL và xóa khỏi thư mục tải lên sau khi ghi CSDL thành công.
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import zlib from 'node:zlib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };
const DB = arg('--db', 'QLCongViecKhoaCNTT');
const UPLOADS = path.resolve(arg('--uploads', path.join(root, 'apps/api/App_Data/uploads')));
const EDGE = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const ORG = 'Khoa Công nghệ Thông tin – Trường Đại học Công Thương Thành phố Hồ Chí Minh';

// Mỗi tệp gắn với một lần nộp: tiêu đề việc + email người nộp + lần nộp.
const FILES = [
  { task: 'Rà soát đề cương chi tiết học phần Khai phá dữ liệu', email: 'hand@huit.edu.vn', attempt: 1, name: 'Đề cương chi tiết học phần Khai phá dữ liệu.docx',
    title: 'ĐỀ CƯƠNG CHI TIẾT HỌC PHẦN KHAI PHÁ DỮ LIỆU',
    paras: ['Ngành: Khoa học dữ liệu. Số tín chỉ: 3 (2 lý thuyết, 1 thực hành). Áp dụng từ năm học 2026–2027.',
      'Mục tiêu: sinh viên hiểu quy trình khai phá dữ liệu, vận dụng được các kỹ thuật tiền xử lý, luật kết hợp, phân lớp và phân cụm trên dữ liệu thực tế.',
      'Đánh giá: chuyên cần 10%, bài tập nhóm 30%, thi kết thúc học phần 60% (tự luận, 90 phút).'],
    table: [['Chương', 'Nội dung', 'Số tiết', 'Chuẩn đầu ra'], ['1', 'Tổng quan về khai phá dữ liệu', '3', 'Chuẩn đầu ra 1'], ['2', 'Tiền xử lý dữ liệu', '6', 'Chuẩn đầu ra 1, 2'],
      ['3', 'Luật kết hợp', '6', 'Chuẩn đầu ra 2'], ['4', 'Phân lớp dữ liệu', '9', 'Chuẩn đầu ra 2, 3'], ['5', 'Phân cụm dữ liệu', '6', 'Chuẩn đầu ra 3']] },
  { task: 'Rà soát đề cương chi tiết học phần Khai phá dữ liệu', email: 'hand@huit.edu.vn', attempt: 1, name: 'Ma trận chuẩn đầu ra – bài đánh giá.xlsx',
    title: 'MA TRẬN CHUẨN ĐẦU RA – BÀI ĐÁNH GIÁ, HỌC PHẦN KHAI PHÁ DỮ LIỆU',
    table: [['Bài đánh giá', 'Tỷ trọng', 'Chuẩn đầu ra 1', 'Chuẩn đầu ra 2', 'Chuẩn đầu ra 3'], ['Chuyên cần', '10%', 'x', '', ''],
      ['Bài tập nhóm 1 – tiền xử lý', '10%', 'x', 'x', ''], ['Bài tập nhóm 2 – phân lớp', '20%', '', 'x', 'x'], ['Thi kết thúc học phần', '60%', 'x', 'x', 'x']] },
  { task: 'Rà soát đề cương chi tiết học phần Khai phá dữ liệu', email: 'hungtv@huit.edu.vn', attempt: 1, name: 'Danh mục tài liệu tham khảo.xlsx',
    title: 'DANH MỤC TÀI LIỆU THAM KHẢO – KHAI PHÁ DỮ LIỆU',
    table: [['STT', 'Tên tài liệu', 'Tác giả', 'Năm', 'Loại'], ['1', 'Data Mining: Concepts and Techniques, 4th ed.', 'Han, Pei, Tong', '2022', 'Giáo trình chính'],
      ['2', 'Introduction to Data Mining, 2nd ed.', 'Tan, Steinbach, Karpatne, Kumar', '2019', 'Tham khảo'],
      ['3', 'Data Mining: Practical Machine Learning Tools and Techniques, 4th ed.', 'Witten, Frank, Hall, Pal', '2017', 'Tham khảo'],
      ['4', 'Python for Data Analysis, 3rd ed.', 'McKinney', '2022', 'Thực hành']] },
  { task: 'Xây dựng bộ dữ liệu thực hành cho học phần Học máy', email: 'maiphantn@huit.edu.vn', attempt: 1, name: 'Mô tả 5 bộ dữ liệu thực hành – lần 1.xlsx',
    title: 'MÔ TẢ BỘ DỮ LIỆU THỰC HÀNH HỌC MÁY (LẦN NỘP 1)',
    table: [['Bộ dữ liệu', 'Lĩnh vực', 'Số dòng', 'Số cột', 'Tỷ lệ thiếu', 'Bài toán'], ['Kết quả học tập sinh viên', 'Giáo dục', '12.480', '18', '0,4%', 'Phân lớp'],
      ['Giao dịch cửa hàng bán lẻ', 'Bán lẻ', '54.210', '9', '1,2%', 'Luật kết hợp'], ['Chỉ số khám sức khỏe', 'Y tế', '7.930', '22', '14,8%', 'Hồi quy'],
      ['Lưu lượng giao thông', 'Giao thông', '26.304', '7', '2,1%', 'Dự báo chuỗi thời gian'], ['Hồ sơ vay tiêu dùng', 'Tài chính', '10.000', '15', '0,9%', 'Phân lớp']] },
  { task: 'Xây dựng bộ dữ liệu thực hành cho học phần Học máy', email: 'maiphantn@huit.edu.vn', attempt: 2, name: 'Từ điển dữ liệu 5 bộ dữ liệu.xlsx',
    title: 'TỪ ĐIỂN DỮ LIỆU – BỘ DỮ LIỆU CHỈ SỐ KHÁM SỨC KHỎE (ĐÃ LÀM SẠCH)',
    table: [['Cột', 'Kiểu', 'Đơn vị', 'Mô tả', 'Tỷ lệ thiếu'], ['tuoi', 'Số nguyên', 'năm', 'Tuổi người khám', '0%'], ['gioi_tinh', 'Phân loại', '', 'Nam / Nữ', '0%'],
      ['chieu_cao', 'Số thực', 'cm', 'Chiều cao', '0%'], ['can_nang', 'Số thực', 'kg', 'Cân nặng', '0%'],
      ['huyet_ap_tam_thu', 'Số nguyên', 'mmHg', 'Huyết áp tâm thu', '0,3%'], ['duong_huyet', 'Số thực', 'mmol/L', 'Đường huyết lúc đói', '0,5%']] },
  { task: 'Xây dựng bộ dữ liệu thực hành cho học phần Học máy', email: 'maiphantn@huit.edu.vn', attempt: 2, name: 'Hướng dẫn sử dụng bộ dữ liệu thực hành.pdf',
    title: 'HƯỚNG DẪN SỬ DỤNG BỘ DỮ LIỆU THỰC HÀNH HỌC MÁY',
    paras: ['Bộ dữ liệu gồm 5 tệp CSV mã hóa UTF-8, đặt trong thư mục chung của bộ môn. Mỗi tệp có từ điển dữ liệu đi kèm.',
      'Bộ dữ liệu chỉ số khám sức khỏe đã được làm sạch lại theo góp ý: loại 412 dòng trùng, điền giá trị thiếu bằng trung vị theo nhóm tuổi và giới tính.',
      'Mỗi bộ dữ liệu có một sổ Jupyter mẫu chạy được trên máy phòng thực hành (Python 3.11, scikit-learn 1.5).'] },
  { task: 'Chấm phản biện đề cương khóa luận tốt nghiệp đợt 1', email: 'nghiadnt@huit.edu.vn', attempt: 1, name: 'Bảng điểm phản biện đề cương đợt 1.xlsx',
    title: 'BẢNG ĐIỂM PHẢN BIỆN ĐỀ CƯƠNG KHÓA LUẬN TỐT NGHIỆP – ĐỢT 1',
    table: [['STT', 'Mã đề cương', 'Tên đề tài', 'Điểm', 'Kết luận'], ['1', 'KL-01', 'Dự báo kết quả học tập bằng học máy', '8,0', 'Đạt'],
      ['2', 'KL-02', 'Phát hiện gian lận giao dịch thẻ', '7,5', 'Đạt'], ['3', 'KL-03', 'Hệ khuyến nghị sách cho thư viện', '6,0', 'Cần chỉnh sửa'],
      ['4', 'KL-04', 'Phân tích cảm xúc bình luận sản phẩm', '8,5', 'Đạt'], ['5', 'KL-05', 'Phân cụm khách hàng bán lẻ', '5,5', 'Cần chỉnh sửa'],
      ['6', 'KL-06', 'Nhận dạng biển số xe', '7,0', 'Đạt']] },
  { task: 'Chấm phản biện đề cương khóa luận tốt nghiệp đợt 1', email: 'nghiadnt@huit.edu.vn', attempt: 1, name: 'Nhận xét phản biện đề cương đợt 1.pdf',
    title: 'NHẬN XÉT PHẢN BIỆN ĐỀ CƯƠNG KHÓA LUẬN TỐT NGHIỆP – ĐỢT 1',
    paras: ['Đã chấm 12 đề cương: 10 đề cương đạt, 2 đề cương cần chỉnh sửa (KL-03, KL-05).',
      'KL-03: mục tiêu chưa đo lường được; cần nêu rõ chỉ số đánh giá hệ khuyến nghị và nguồn dữ liệu mượn trả sách.',
      'KL-05: phần tổng quan còn sơ sài, cần bổ sung ít nhất 5 công trình liên quan và mô tả quy trình tiền xử lý dữ liệu.'] },
  { task: 'Báo cáo tổng kết hoạt động nghiên cứu khoa học sinh viên năm học 2025–2026', email: 'hand@huit.edu.vn', attempt: 1,
    name: 'Báo cáo tổng kết nghiên cứu khoa học sinh viên 2025–2026.docx',
    title: 'BÁO CÁO TỔNG KẾT HOẠT ĐỘNG NGHIÊN CỨU KHOA HỌC SINH VIÊN NĂM HỌC 2025–2026',
    paras: ['Bộ môn Khoa học dữ liệu có 18 đề tài nghiên cứu khoa học sinh viên với 52 sinh viên tham gia, 11 giảng viên hướng dẫn.',
      'Kết quả: 16 đề tài nghiệm thu đạt, 2 đề tài gia hạn sang năm học 2026–2027; 4 đề tài đạt giải cấp Trường.',
      'Phương hướng năm học 2026–2027: tăng số đề tài gắn với dữ liệu doanh nghiệp đối tác, tổ chức seminar định kỳ hằng tháng.'],
    table: [['Chỉ tiêu', 'Năm học 2024–2025', 'Năm học 2025–2026'], ['Số đề tài', '14', '18'], ['Số sinh viên tham gia', '41', '52'], ['Đề tài đạt giải cấp Trường', '2', '4']] },
  { task: 'Tổ chức buổi báo cáo chuyên đề Chuyển đổi số trong doanh nghiệp', email: 'mandt@huit.edu.vn', attempt: 1, name: 'Biên bản buổi báo cáo chuyên đề.pdf',
    title: 'BIÊN BẢN BUỔI BÁO CÁO CHUYÊN ĐỀ CHUYỂN ĐỔI SỐ TRONG DOANH NGHIỆP',
    paras: ['Thời gian: 8 giờ 00, tại hội trường khoa. Chủ trì: Bộ môn Hệ thống thông tin.',
      'Báo cáo viên: đại diện bộ phận chuyển đổi số của hai doanh nghiệp đối tác. Số sinh viên tham dự: 126.',
      'Nội dung: lộ trình chuyển đổi số, hệ thống quản trị nguồn lực doanh nghiệp, phân tích dữ liệu bán hàng; phần hỏi đáp 30 phút.',
      'Buổi báo cáo kết thúc lúc 11 giờ 00. Sinh viên đánh giá mức độ hài lòng trung bình 4,6/5.'] },
  { task: 'Tổ chức buổi báo cáo chuyên đề Chuyển đổi số trong doanh nghiệp', email: 'mandt@huit.edu.vn', attempt: 1, name: 'Danh sách sinh viên tham dự.xlsx',
    title: 'DANH SÁCH SINH VIÊN THAM DỰ (TRÍCH)',
    table: [['STT', 'Mã sinh viên', 'Họ và tên', 'Lớp'], ['1', '2001230145', 'Nguyễn Minh Anh', '14DHTTQL01'], ['2', '2001230287', 'Trần Quốc Bảo', '14DHTTQL01'],
      ['3', '2001230311', 'Lê Thị Cẩm Tú', '14DHTTQL02'], ['4', '2001220098', 'Phạm Gia Huy', '13DHTTQL01'], ['5', '2001220176', 'Võ Ngọc Hân', '13DHTTQL02']] },
  { task: 'Chuẩn bị đề thi kết thúc học phần Kiểm thử phần mềm', email: 'chaudm@huit.edu.vn', attempt: 1, name: 'Đề thi Kiểm thử phần mềm – lần 1.pdf',
    title: 'ĐỀ THI KẾT THÚC HỌC PHẦN KIỂM THỬ PHẦN MỀM (BẢN NỘP LẦN 1)',
    paras: ['Thời gian làm bài: 90 phút. Sinh viên không được sử dụng tài liệu.', 'Câu 1 (3 điểm): Phân biệt kiểm thử hộp đen và kiểm thử hộp trắng, cho ví dụ.',
      'Câu 2 (4 điểm): Thiết kế ca kiểm thử bằng phân vùng tương đương cho chức năng đăng nhập.', 'Câu 3 (3 điểm): Tính độ phủ nhánh cho đoạn mã cho trước.'] },
  { task: 'Chuẩn bị đề thi kết thúc học phần Kiểm thử phần mềm', email: 'chaudm@huit.edu.vn', attempt: 2, name: 'Đề thi và đáp án Kiểm thử phần mềm – lần 2.pdf',
    title: 'ĐỀ THI VÀ ĐÁP ÁN KIỂM THỬ PHẦN MỀM (BẢN NỘP LẦN 2)',
    paras: ['Đề 1 đã được biên soạn mới hoàn toàn theo nhận xét; mức trùng với đề các năm trước dưới 10%.',
      'Câu 1 (3 điểm): Lập kế hoạch kiểm thử cho ứng dụng đặt vé trực tuyến.', 'Câu 2 (4 điểm): Thiết kế ca kiểm thử bằng bảng quyết định cho chính sách giảm giá.',
      'Câu 3 (3 điểm): Viết kịch bản kiểm thử tự động cho chức năng tìm kiếm.', 'Đáp án và thang điểm chi tiết ở phần cuối, tổng 10 điểm.'] },
  { task: 'Cập nhật kịch bản thực hành An toàn thông tin', email: 'thaonth@huit.edu.vn', attempt: 1, name: 'Kịch bản thực hành An toàn thông tin.pdf',
    title: 'KỊCH BẢN THỰC HÀNH AN TOÀN THÔNG TIN', paras: ['Gồm 9 kịch bản thực hành, chạy trên máy ảo của phòng thực hành.'],
    table: [['STT', 'Kịch bản', 'Thời lượng'], ['1', 'Tấn công chèn mã truy vấn cơ sở dữ liệu và cách phòng chống', '3 tiết'],
      ['2', 'Tấn công chèn mã kịch bản trên trang web', '3 tiết'], ['3', 'Dò quét cổng và dịch vụ', '2 tiết'], ['4', 'Cấu hình tường lửa', '3 tiết'],
      ['5', 'Phân tích mã độc cơ bản', '3 tiết']] },
  { task: 'Viết bài báo hội thảo quốc gia về phát hiện xâm nhập mạng', email: 'tottd@huit.edu.vn', attempt: 1, name: 'Bài báo phát hiện xâm nhập mạng.pdf',
    title: 'MÔ HÌNH PHÁT HIỆN XÂM NHẬP MẠNG DỰA TRÊN HỌC SÂU',
    paras: ['Tóm tắt: Bài báo đề xuất mô hình phát hiện xâm nhập mạng kết hợp mạng tích chập một chiều và bộ nhớ dài ngắn hạn, thử nghiệm trên ba bộ dữ liệu chuẩn.',
      'Kết quả cho thấy mô hình đạt độ chính xác trung bình 98,2%, tỷ lệ cảnh báo sai 1,1%, tốt hơn các phương pháp so sánh.', 'Từ khóa: phát hiện xâm nhập, học sâu, an ninh mạng.'] },
  { task: 'Viết bài báo hội thảo quốc gia về phát hiện xâm nhập mạng', email: 'tungnv@huit.edu.vn', attempt: 1, name: 'Kết quả thực nghiệm.xlsx',
    title: 'KẾT QUẢ THỰC NGHIỆM PHÁT HIỆN XÂM NHẬP',
    table: [['Bộ dữ liệu', 'Mô hình', 'Độ chính xác', 'Độ nhạy', 'Cảnh báo sai'], ['Bộ dữ liệu 1', 'Đề xuất', '98,6%', '97,9%', '0,9%'],
      ['Bộ dữ liệu 1', 'Rừng ngẫu nhiên', '96,1%', '94,8%', '2,3%'], ['Bộ dữ liệu 2', 'Đề xuất', '97,8%', '96,5%', '1,3%'],
      ['Bộ dữ liệu 2', 'Rừng ngẫu nhiên', '95,4%', '93,0%', '2,9%'], ['Bộ dữ liệu 3', 'Đề xuất', '98,1%', '97,2%', '1,1%']] },
  { task: 'Tổng hợp lịch coi thi giữa kỳ của giảng viên toàn khoa', email: 'mailq@huit.edu.vn', attempt: 1, name: 'Lịch coi thi giữa kỳ toàn khoa.xlsx',
    title: 'LỊCH COI THI GIỮA KỲ – KHOA CÔNG NGHỆ THÔNG TIN (TRÍCH)',
    table: [['Ngày', 'Ca', 'Phòng', 'Học phần', 'Cán bộ coi thi 1', 'Cán bộ coi thi 2'], ['Thứ Hai', '1', 'B.301', 'Cơ sở dữ liệu', 'Ngô Dương Hà', 'Trần Văn Thọ'],
      ['Thứ Hai', '2', 'B.302', 'Lập trình hướng đối tượng', 'Đào Minh Châu', 'Bùi Công Danh'], ['Thứ Ba', '1', 'B.405', 'Mạng máy tính', 'Đinh Huy Hoàng', 'Phạm Tuấn Khiêm'],
      ['Thứ Ba', '3', 'B.303', 'Phân tích thiết kế hệ thống', 'Trần Thị Vân Anh', 'Nguyễn Thị Định'], ['Thứ Tư', '2', 'B.304', 'Thương mại điện tử', 'Huỳnh Thái Học', 'Lê Trần Minh Đạt']] },
];

const MIME = {
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pdf': 'application/pdf',
};
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

const DOS_STAMP = (((2026 - 1980) << 9 | 10 << 5 | 22) << 16) >>> 0; // ngày 22/10/2026 theo định dạng ngày giờ của ZIP
/** Tệp ZIP (định dạng chứa của .docx/.xlsx): mỗi mục nén deflate, có thư mục trung tâm. */
function zip(entries) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, text] of Object.entries(entries)) {
    const raw = Buffer.from(text, 'utf8'), data = zlib.deflateRawSync(raw), fname = Buffer.from(name, 'utf8'), crc = zlib.crc32(raw);
    const head = (sig, size) => { const b = Buffer.alloc(size); b.writeUInt32LE(sig, 0); return b; };
    const l = head(0x04034b50, 30);
    l.writeUInt16LE(20, 4); l.writeUInt16LE(0x0800, 6); l.writeUInt16LE(8, 8); l.writeUInt32LE(DOS_STAMP, 10);
    l.writeUInt32LE(crc, 14); l.writeUInt32LE(data.length, 18); l.writeUInt32LE(raw.length, 22); l.writeUInt16LE(fname.length, 26);
    const c = head(0x02014b50, 46);
    c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(8, 10); c.writeUInt32LE(DOS_STAMP, 12);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(raw.length, 24); c.writeUInt16LE(fname.length, 28); c.writeUInt32LE(offset, 42);
    locals.push(l, fname, data); centrals.push(c, fname);
    offset += 30 + fname.length + data.length;
  }
  const dir = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(centrals.length / 2, 8); end.writeUInt16LE(centrals.length / 2, 10);
  end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

function docx(f) {
  const run = (text, { bold = false, italic = false, size = 26 } = {}) =>
    `<w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/>${bold ? '<w:b/>' : ''}${italic ? '<w:i/>' : ''}<w:sz w:val="${size}"/></w:rPr><w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
  const para = (text, opts = {}, align = 'both') => `<w:p><w:pPr><w:jc w:val="${align}"/><w:spacing w:after="120" w:line="300" w:lineRule="auto"/></w:pPr>${run(text, opts)}</w:p>`;
  const cell = (text, bold) => `<w:tc><w:p><w:pPr><w:spacing w:after="0"/></w:pPr>${run(text, { bold, size: 24 })}</w:p></w:tc>`;
  const border = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((s) => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="808080"/>`).join('');
  const table = f.table
    ? `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>${border}</w:tblBorders><w:tblCellMar><w:left w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr>`
      + f.table.map((row, i) => `<w:tr>${row.map((v) => cell(v, i === 0)).join('')}</w:tr>`).join('') + '</w:tbl><w:p/>'
    : '';
  const body = para(ORG, { italic: true, size: 22 }, 'left') + para(f.title, { bold: true, size: 28 }, 'center') + (f.paras ?? []).map((p) => para(p)).join('') + table;
  return zip({
    '[Content_Types].xml': `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    '_rels/.rels': `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    'word/document.xml': `${XML}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1701" w:header="709" w:footer="709" w:gutter="0"/></w:sectPr></w:body></w:document>`,
  });
}

function xlsx(f) {
  const col = (i) => String.fromCharCode(65 + i);
  const cell = (r, c, v, s) => `<c r="${col(c)}${r}" t="inlineStr" s="${s}"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
  const rows = [`<row r="1">${cell(1, 0, f.title, 1)}</row>`, `<row r="2">${cell(2, 0, ORG, 2)}</row>`,
    ...f.table.map((row, i) => `<row r="${i + 4}">${row.map((v, c) => cell(i + 4, c, v, i === 0 ? 3 : 4)).join('')}</row>`)];
  const widths = f.table[0].map((_, c) => Math.min(60, Math.max(...f.table.map((r) => String(r[c]).length)) + 3));
  return zip({
    '[Content_Types].xml': `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    '_rels/.rels': `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': `${XML}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Trang 1" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    'xl/styles.xml': `${XML}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
      + '<fonts count="4"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="13"/><name val="Calibri"/></font><font><i/><sz val="10"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
      + '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDAE6F2"/></patternFill></fill></fills>'
      + '<borders count="2"><border/><border><left style="thin"><color rgb="FF808080"/></left><right style="thin"><color rgb="FF808080"/></right><top style="thin"><color rgb="FF808080"/></top><bottom style="thin"><color rgb="FF808080"/></bottom></border></borders>'
      + '<cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="5"><xf/><xf fontId="1" applyFont="1"/><xf fontId="2" applyFont="1"/>'
      + '<xf fontId="3" fillId="2" borderId="1" applyFont="1" applyFill="1" applyBorder="1"/><xf borderId="1" applyBorder="1"><alignment wrapText="1" vertical="top"/></xf></cellXfs></styleSheet>',
    'xl/worksheets/sheet1.xml': `${XML}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${rows.join('')}</sheetData></worksheet>`,
  });
}

/** PDF: trang HTML in bằng Edge không giao diện (hiển thị đúng tiếng Việt, không cần Office). */
function pdf(f, out, work) {
  const html = `<!doctype html><meta charset="utf-8"><style>
    body{font:13pt/1.5 "Times New Roman",serif;margin:0} .org{font-style:italic;font-size:11pt;color:#444}
    h1{font-size:14pt;text-align:center;margin:18pt 0} p{text-align:justify;margin:0 0 8pt}
    table{border-collapse:collapse;width:100%;margin-top:8pt;font-size:12pt} th,td{border:1px solid #808080;padding:4pt 6pt;text-align:left;vertical-align:top} th{background:#dae6f2}
    @page{size:A4;margin:20mm 20mm 20mm 30mm}</style>
    <p class="org">${esc(ORG)}</p><h1>${esc(f.title)}</h1>${(f.paras ?? []).map((p) => `<p>${esc(p)}</p>`).join('')}
    ${f.table ? `<table><tr>${f.table[0].map((h) => `<th>${esc(h)}</th>`).join('')}</tr>${f.table.slice(1).map((r) => `<tr>${r.map((v) => `<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</table>` : ''}`;
  const page = path.join(work, 'page.html');
  writeFileSync(page, html);
  const r = spawnSync(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', `--user-data-dir=${path.join(work, 'edge')}`, '--no-pdf-header-footer', `--print-to-pdf=${out}`, pathToFileURL(page).href], { timeout: 60_000 });
  if (!existsSync(out)) throw new Error(`Edge không in được PDF cho "${f.name}" (mã ${r.status}).`);
}

const q = (s) => `N'${String(s).replace(/'/g, "''")}'`;
if (FILES.some((f) => f.name.endsWith('.pdf')) && !EDGE) throw new Error('Không tìm thấy Microsoft Edge để tạo tệp PDF.');
mkdirSync(UPLOADS, { recursive: true });
const work = mkdtempSync(path.join(tmpdir(), 'seed-files-'));
const created = [];
const sql = ['SET NOCOUNT ON; SET XACT_ABORT ON; SET QUOTED_IDENTIFIER ON; BEGIN TRANSACTION;',
  // Tệp kết quả cũ: in tên trên đĩa để xóa sau khi giao dịch thành công.
  "SELECT 'OLD:' + SUBSTRING(DuongDan, 8, 200) FROM dbo.TepDinhKem WHERE MaKetQua IS NOT NULL AND DuongDan LIKE 'upload:%';",
  'DELETE dbo.TepDinhKem WHERE MaKetQua IS NOT NULL;'];
try {
  for (const f of FILES) {
    const ext = path.extname(f.name).toLowerCase();
    const stored = randomUUID().replace(/-/g, '') + ext;
    const out = path.join(UPLOADS, stored);
    if (ext === '.pdf') pdf(f, out, work); else writeFileSync(out, ext === '.docx' ? docx(f) : xlsx(f));
    created.push(out);
    const size = statSync(out).size;
    console.log(`  ${f.name} (${size.toLocaleString('vi-VN')} byte)`);
    sql.push(`INSERT dbo.TepDinhKem (MaKetQua, MaNguoiTaiLen, TenTep, DuongDan, LoaiTep, KichThuoc, NgayTaiLen)
SELECT kq.MaKetQua, kq.MaNguoiNop, ${q(f.name)}, N'upload:${stored}', N'${MIME[ext]}', ${size}, kq.NgayNop
FROM dbo.KetQuaCongViec kq JOIN dbo.PhanCong p ON p.MaPhanCong = kq.MaPhanCong JOIN dbo.CongViec cv ON cv.MaCongViec = p.MaCongViec
JOIN dbo.NguoiDung n ON n.MaNguoiDung = kq.MaNguoiNop
WHERE cv.TieuDe = ${q(f.task)} AND n.Email = ${q(f.email)} AND kq.LanNop = ${f.attempt};
IF @@ROWCOUNT <> 1 THROW 51000, ${q('Không tìm thấy lần nộp cho tệp ' + f.name)}, 1;`);
  }
  // Lịch sử "nộp kết quả lần n" ghi kèm số tệp như API.
  sql.push(`UPDATE ls SET MoTa = LEFT(ls.MoTa, CHARINDEX(N' nộp kết quả lần ', ls.MoTa) + 16 + LEN(CONVERT(NVARCHAR(10), kq.LanNop))) + N' (' + CONVERT(NVARCHAR(10), f.SoTep) + N' tệp)'
FROM dbo.LichSuCongViec ls
JOIN dbo.PhanCong p ON p.MaCongViec = ls.MaCongViec
JOIN dbo.KetQuaCongViec kq ON kq.MaPhanCong = p.MaPhanCong AND kq.MaNguoiNop = ls.MaNguoiThucHien AND kq.NgayNop = ls.ThoiGian
CROSS APPLY (SELECT COUNT(*) AS SoTep FROM dbo.TepDinhKem t WHERE t.MaKetQua = kq.MaKetQua) f
WHERE ls.LoaiHanhDong = N'NopKetQua' AND f.SoTep > 0;`,
  'COMMIT TRANSACTION;', "SELECT 'COUNT:' + CONVERT(VARCHAR(10), COUNT(*)) FROM dbo.TepDinhKem WHERE MaKetQua IS NOT NULL;");
  const sqlFile = path.join(work, 'files.sql');
  writeFileSync(sqlFile, '\uFEFF' + sql.join('\n'));
  const r = spawnSync('sqlcmd', ['-S', 'localhost', '-E', '-d', DB, '-f', '65001', '-b', '-W', '-h', '-1', '-i', sqlFile], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`sqlcmd lỗi (${r.status}), CSDL không đổi:\n${r.stdout}${r.stderr}`);
  for (const line of r.stdout.split(/\r?\n/).map((s) => s.trim())) {
    if (line.startsWith('OLD:')) { const old = path.join(UPLOADS, path.basename(line.slice(4))); if (existsSync(old)) unlinkSync(old); }
    else if (line.startsWith('COUNT:')) console.log(`Đã đính kèm. Số tệp kết quả trong CSDL ${DB}: ${line.slice(6)}`);
  }
} catch (e) {
  for (const f of created) if (existsSync(f)) unlinkSync(f); // CSDL không đổi thì bỏ luôn tệp vừa tạo
  throw e;
} finally {
  rmSync(work, { recursive: true, force: true });
}

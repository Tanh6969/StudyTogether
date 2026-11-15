import type { WordEntry } from './engine/engine';

type Raw = Array<[string, 1 | 2 | 3]>;

const make = (raw: Raw): WordEntry[] => raw.map(([word, difficulty]) => ({ word, difficulty }));

export interface WordPackInfo {
  id: string;
  label: string;
  hint: string;
}

export const PACK_INFO: WordPackInfo[] = [
  { id: 'sinhvien', label: 'Đời sinh viên', hint: 'Deadline, trà sữa, ký túc xá…' },
  { id: 'dungcu', label: 'Đồ dùng học tập', hint: 'Dễ vẽ, hợp nhóm mới.' },
  { id: 'monhoc', label: 'Môn học', hint: 'Khái niệm vẽ được trong các môn học.' },
  { id: 'thanhngu', label: 'Thành ngữ', hint: 'Khó và rất vui.' },
];

export const WORD_PACKS: Record<string, WordEntry[]> = {
  sinhvien: make([
    ['deadline', 2], ['trà sữa', 1], ['ký túc xá', 2], ['ngủ gật', 1], ['thẻ sinh viên', 1], ['mì tôm', 1],
    ['xe máy', 1], ['quán cà phê', 1], ['giảng đường', 2], ['thư viện', 1], ['balo', 1], ['laptop', 1],
    ['sạc dự phòng', 2], ['wifi', 1], ['điểm danh', 2], ['thi lại', 2], ['học bổng', 2], ['đồ án', 2],
    ['bảo vệ tốt nghiệp', 3], ['thức khuya', 2], ['cà phê sữa', 1], ['xe buýt', 1], ['chợ sinh viên', 2],
    ['bài tập nhóm', 3], ['slide thuyết trình', 3], ['bàn học', 1], ['đèn bàn', 1], ['tai nghe', 1],
    ['ổ bánh mì', 1], ['trọ', 1], ['hết tiền', 2], ['cúp học', 3], ['nộp bài muộn', 3], ['mất ngủ', 2],
    ['áo khoác', 1], ['ô che mưa', 1], ['xếp hàng căng tin', 3], ['tờ rơi', 2], ['câu lạc bộ', 3], ['tình nguyện', 3],
  ]),
  dungcu: make([
    ['bút chì', 1], ['bút bi', 1], ['thước kẻ', 1], ['compa', 1], ['tẩy', 1], ['bút xóa', 1], ['máy tính cầm tay', 2],
    ['sổ tay', 1], ['cặp sách', 1], ['kéo', 1], ['hồ dán', 1], ['bảng đen', 1], ['phấn', 1], ['kính lúp', 1],
    ['êke', 2], ['thước đo độ', 2], ['bút highlight', 2], ['giấy nhớ', 1], ['kẹp giấy', 1], ['ghim bấm', 2],
    ['hộp bút', 1], ['bút màu', 1], ['gọt bút chì', 2], ['bìa hồ sơ', 2], ['đồng hồ báo thức', 1],
    ['kính cận', 1], ['sách giáo khoa', 2], ['từ điển', 1], ['quả địa cầu', 2], ['kính hiển vi', 3],
  ]),
  monhoc: make([
    ['quang hợp', 3], ['tam giác vuông', 2], ['hình tròn', 1], ['mạch điện', 2], ['pin', 1], ['nam châm', 1],
    ['núi lửa', 2], ['chu trình nước', 3], ['hệ mặt trời', 2], ['trái đất', 1], ['mặt trăng', 1], ['bản đồ', 1],
    ['tế bào', 2], ['xương sống', 2], ['trái tim', 1], ['phổi', 1], ['nguyên tử', 3], ['bảng tuần hoàn', 3],
    ['ống nghiệm', 1], ['lăng kính', 2], ['cầu vồng', 1], ['con lắc', 2], ['đòn bẩy', 2], ['ròng rọc', 3],
    ['hình lập phương', 2], ['đồ thị hàm số', 3], ['trục tọa độ', 3], ['phân số', 2], ['lưu đồ', 2], ['cơ sở dữ liệu', 3],
    ['mạng máy tính', 3], ['vòng lặp', 3], ['cây nhị phân', 3], ['trang web', 1], ['bàn phím', 1], ['chuột máy tính', 1],
  ]),
  thanhngu: make([
    ['nước đổ đầu vịt', 3], ['chuột sa chĩnh gạo', 3], ['ếch ngồi đáy giếng', 3], ['đàn gảy tai trâu', 3],
    ['cưỡi ngựa xem hoa', 3], ['lá lành đùm lá rách', 3], ['mèo mù vớ cá rán', 3], ['rút dây động rừng', 3],
    ['cá chép hóa rồng', 3], ['ăn cháo đá bát', 3], ['hổ phụ sinh hổ tử', 3], ['gà đẻ trứng vàng', 2],
    ['có công mài sắt', 3], ['thuyền ngược gió', 2], ['trăng tròn', 1], ['một cây làm chẳng nên non', 3],
    ['ngựa quen đường cũ', 3], ['chó cắn áo rách', 3], ['mưa như trút nước', 2], ['nhanh như sóc', 2],
  ]),
};

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
  { id: 'lienquan', label: 'Liên Quân', hint: 'Tướng, đường, mục tiêu và chiến thuật trong game.' },
  { id: 'hust', label: 'HUST (ĐH Bách khoa Hà Nội)', hint: 'Giảng đường, môn học và đời sống Bách khoa.' },
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
  lienquan: make([
    ['trụ', 1], ['lính', 1], ['bùa xanh', 1], ['rồng', 1], ['xạ thủ', 1],
    ['đấu sĩ', 1], ['pháp sư', 1], ['trợ thủ', 1], ['sát thủ', 1], ['đỡ đòn', 1], ['tốc biến', 2],
    ['trừng trị', 2], ['đường giữa', 2], ['đường Caesar', 2], ['quái rừng', 2], ['gank', 2],
    ['đẩy trụ', 2], ['phá nhà chính', 2], ['núp bụi', 2], ['hồi máu', 1],
     ['cướp bùa', 3], 
    ['Caesar', 3], ['rồng ánh sáng', 2], ['Triệu Vân', 2], ['Valhein', 2], ['Krixi', 2],
    ['Veera', 2], ['Yorn', 2], ["Tel'Annas", 3], ['Violet', 2], ['Capheny', 3], ['Elsu', 2],
    ['Hayate', 2], ['Laville', 2], ['Lindis', 3], ['Fennik', 2], ['Celica', 2], ['Moren', 3],
    ['Butterfly', 2], ['Nakroth', 2], ['Murad', 2], ['Quillen', 3], ['Paine', 2], ['Kriknak', 3],
    ['Zill', 2], ['Zephys', 2], ['Ngộ Không', 2], ['Airi', 2], ['Florentino', 3], ['Yena', 2],
    ['Omen', 2], ['Veres', 2], ['Allain', 2], ['Yan', 2], ['Tachi', 3], ['Bright', 2],
    ['Tulen', 2], ['Natalya', 2], ['Liliana', 3], ['Raz', 2], ['Zata', 2], ['Yue', 2],
    ['Kahlii', 3], ['Ignis', 2], ['Jinna', 3], ['Lorion', 3], ['Iggy', 2], ['Aleister', 3],
    ['Maloch', 2], ['Lữ Bố', 2], ['Taara', 2], ['Thane', 2], ['Baldum', 2], ['Grakk', 2],
    ['Zip', 2], ['Aya', 2], ['Annette', 2], ['Alice', 2], ['Xeniel', 3], ['Arum', 2],
    ['Mina', 2], ['Gildur', 2], ['Chaugnar', 3], ['Toro', 2],
  ]),
  hust: make([
    ['Tagashira', 3], ['Job Fair', 2], ['HEDSPI', 3],
    ['tiếng Nhật', 1], ['kanji', 2], ['JLPT', 2], ['đuổi học', 2],
    ['JLPT N3', 2], ['từ vựng tiếng Nhật', 2], ['ngữ pháp tiếng Nhật', 2], 
    ['kaiwa', 3], ['trượt môn', 3], ['sensei', 2], ['senpai', 2], ['kouhai', 2],
    ['anh Ma Thắng', 3], ['thực tập', 3], ['thực tập', 2],
    ['doanh nghiệp Nhật', 3], ['kỹ sư cầu nối', 3], ['sun', 2],
    ['workshop', 2], ['thuyết trình', 2], ['đồ án tốt nghiệp', 3], 
    ['du học Nhật Bản', 2],
    ['giảng đường d9', 2], ['học lại', 1], ['kimono', 1], ['sushi', 1], ['onigiri', 1],
    ['sắn', 2], ['Tokyo', 1], ['Osaka', 1], ['Bách khoa Hà Nội', 1],
  ]),
};

/**
 * Tài khoản mẫu để cả nhóm test nhanh từ trang đăng nhập.
 *
 * - Chế độ thật: được tạo bởi backend/scripts/seed_demo.py (giữ đồng bộ email + mật khẩu ở đó).
 * - Chế độ mock: cùng email có sẵn trong mocks/seed.ts, mật khẩu là MOCK_PASSWORD.
 *
 * Ẩn các nút này bằng VITE_SHOW_DEMO_ACCOUNTS=false (ví dụ khi deploy thật).
 */
import { MOCK_PASSWORD } from '../mocks/config';

export interface DemoAccount {
  email: string;
  name: string;
  /** Mô tả ngắn để người test biết nên chọn tài khoản nào. */
  hint: string;
}

export const DEMO_ACCOUNTS: DemoAccount[] = [
  { email: 'minhanh@study.local', name: 'Minh Anh', hint: 'Chủ nhóm IELTS & Đồ án' },
  { email: 'hoangnam@study.local', name: 'Hoàng Nam', hint: 'Chủ nhóm Giải tích, mod IELTS' },
  { email: 'thutrang@study.local', name: 'Thu Trang', hint: 'Chủ nhóm React' },
  { email: 'duchuy@study.local', name: 'Đức Huy', hint: 'Thành viên nhóm IELTS & Giải tích' },
  { email: 'lanphuong@study.local', name: 'Lan Phương', hint: 'Thành viên nhóm Giải tích & React' },
  { email: 'quocbao@study.local', name: 'Quốc Bảo', hint: 'Thành viên nhóm React' },
];

/** Same password in mock and real mode ('123456'); seed_demo.py sets it on the real accounts. */
export const DEMO_PASSWORD = MOCK_PASSWORD;

export const SHOW_DEMO_ACCOUNTS = import.meta.env.VITE_SHOW_DEMO_ACCOUNTS !== 'false';

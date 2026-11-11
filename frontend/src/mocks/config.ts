/**
 * Mock mode: frontend chạy hoàn toàn không cần backend/Supabase.
 * Bật bằng `VITE_USE_MOCK=true` trong `.env`; nếu chưa cấu hình dịch vụ nào thì tự dùng demo.
 */
const mockSetting = import.meta.env.VITE_USE_MOCK;
const hasRealServices = Boolean(
  import.meta.env.VITE_API_BASE_URL &&
    import.meta.env.VITE_SUPABASE_URL &&
    import.meta.env.VITE_SUPABASE_ANON_KEY,
);

export const USE_MOCK = mockSetting === 'true' || (mockSetting !== 'false' && !hasRealServices);

/** Độ trễ giả lập mạng (ms) để UI loading/skeleton vẫn hiện như thật. */
export const MOCK_LATENCY_MS = 150;

/** Mật khẩu chung cho mọi tài khoản mẫu (xem seed.ts). */
export const MOCK_PASSWORD = '123456';

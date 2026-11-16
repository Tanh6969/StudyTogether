# Tài liệu mã nguồn StudyTogether

Tài liệu này mô tả cấu trúc và luồng hoạt động của mã nguồn tại thời điểm rà soát. Các đường dẫn dưới đây được tính từ thư mục gốc của repository.

## 1. Tổng quan

StudyTogether là ứng dụng học nhóm trên web. Người dùng có thể tạo và tham gia nhóm, trao đổi qua kênh chat, chia sẻ tài nguyên và ghi chú, quản lý công việc, vào phòng học có cuộc gọi, bảng trắng, trình chiếu, trò chơi và nhạc chung.

| Thành phần | Công nghệ | Vai trò |
| --- | --- | --- |
| `frontend/` | React 19, TypeScript, Vite, React Router | Giao diện, trạng thái phiên đăng nhập, gọi API và nhận cập nhật realtime |
| `backend/` | FastAPI, SQLAlchemy async, Pydantic | REST API, kiểm tra quyền, xử lý nghiệp vụ và truy cập dữ liệu |
| Supabase | PostgreSQL, Auth, Storage, Realtime | Cơ sở dữ liệu, đăng nhập, lưu tệp và đồng bộ thay đổi |
| LiveKit | LiveKit client và server API | Cuộc gọi và kênh dữ liệu trong phòng học |

Luồng tổng quát: trình duyệt đăng nhập bằng Supabase Auth, gửi access token qua `Authorization: Bearer ...` đến FastAPI; backend xác minh token và thao tác với PostgreSQL. Frontend còn đăng ký Supabase Realtime để nhận thay đổi dữ liệu. Trong phòng học, backend cấp token LiveKit, sau đó trình duyệt kết nối trực tiếp đến LiveKit.

## 2. Sơ đồ thư mục

```text
StudyTogether/
├── frontend/
│   ├── src/
│   │   ├── main.tsx                 # Điểm khởi động React và các Provider
│   │   ├── routes/                  # Route và bảo vệ trang cần đăng nhập
│   │   ├── pages/                   # Trang đăng nhập, nhóm, phòng học, cài đặt
│   │   ├── components/              # UI dùng lại: chat, nhóm, thông báo, layout
│   │   ├── hooks/                   # Logic lấy dữ liệu và đăng ký realtime
│   │   ├── contexts/                # Trạng thái xác thực và thông báo
│   │   ├── lib/                     # HTTP client, API theo miền, kiểu dữ liệu
│   │   ├── activities/              # Hoạt động chung trong cuộc gọi
│   │   ├── games/chalk/             # Trò chơi Chalk
│   │   ├── music/                   # Phát và đồng bộ nhạc
│   │   └── mocks/                   # API và dữ liệu demo chạy tại trình duyệt
│   └── public/
├── backend/
│   ├── app/
│   │   ├── main.py                  # FastAPI app, CORS, health và router
│   │   ├── core/                    # Cấu hình, phân quyền, email
│   │   ├── db/                      # Engine, session, enum và base model
│   │   └── <module>/                # Router, DTO, entity, service theo chức năng
│   ├── db/migrations/               # SQL migration 001–009
│   ├── scripts/                     # Áp dụng migration và tạo dữ liệu demo
│   └── tests/                       # Unit và integration tests
└── docs/design/                     # Ghi chú thiết kế hoạt động trong cuộc gọi
```

Trong backend, một module thường có `routers/` nhận HTTP request, `dto/` định nghĩa dữ liệu vào/ra, `services/` xử lý nghiệp vụ và `entities/` ánh xạ bảng SQLAlchemy. Một số module nhỏ không cần đủ bốn lớp.

## 3. Frontend

### Khởi động và điều hướng

`frontend/src/main.tsx` bọc ứng dụng bằng `BrowserRouter`, `AuthProvider` và `NotificationProvider`. `frontend/src/routes/index.tsx` khai báo các route chính:

| Route | Màn hình |
| --- | --- |
| `/login`, `/register`, `/forgot-password`, `/update-password` | Xác thực và khôi phục mật khẩu |
| `/groups` | Danh sách và khám phá nhóm |
| `/groups/:id` | Không gian làm việc của nhóm |
| `/room/:id` | Phòng học |
| `/settings` | Cài đặt tài khoản |
| `/invitations/:secret` | Xem lời mời |

`ProtectedRoute` kiểm tra trạng thái từ `useAuth`; các trang nhóm, phòng học và cài đặt cần phiên đăng nhập. Các trang được lazy load.

### Dữ liệu và xác thực

- `frontend/src/contexts/AuthContext.tsx` quản lý Supabase session và hồ sơ người dùng. Khi hồ sơ chưa có, frontend gọi API để tạo. Nó cung cấp access token và thao tác làm mới phiên cho HTTP client.
- `frontend/src/lib/apiClient.ts` là lớp HTTP chung. Nó gắn bearer token, chuyển lỗi HTTP thành `ApiError`, thử làm mới token một lần khi nhận 401 và retry các lệnh GET gặp lỗi mạng/502/503/504. Nó cũng phát tín hiệu để hiển thị trạng thái backend khởi động chậm.
- Các file `frontend/src/lib/*.api.ts` tập hợp lời gọi API theo chức năng; các file `*.types.ts` chứa kiểu dữ liệu tương ứng.
- `frontend/src/hooks/` kết hợp API với trạng thái giao diện và các kênh realtime, ví dụ tin nhắn, thành viên phòng, ghi chú, tài nguyên, bảng trắng và trình chiếu.
- `frontend/src/lib/supabase.ts` khởi tạo Supabase client. `frontend/src/mocks/` cung cấp dữ liệu demo và lưu thay đổi vào `localStorage` khi chạy mock.

### Các khu vực chức năng

`pages/StudyGroup/StudyGroupDetail.tsx` là không gian nhóm với chat, kênh, thành viên, phòng học, tài liệu, ghi chú và bảng công việc. `pages/StudyGroup/StudyRoom.tsx` kết hợp cuộc gọi, chat, tác vụ trong phiên, bảng trắng, trình chiếu và hoạt động chung. Phần cuộc gọi nằm trong `pages/StudyGroup/meeting/`; trò chơi Chalk nằm trong `games/chalk/`; điều khiển nhạc và các adapter YouTube, SoundCloud, Spotify nằm trong `music/`.

## 4. Backend và API

`backend/app/main.py` tạo FastAPI app, cấu hình CORS, làm ấm connection pool khi khởi động, mở `/health` và đăng ký các router. Tài liệu API tự sinh khi chạy backend ở `/docs` và `/openapi.json`.

| Nhóm route | Module | Chức năng chính |
| --- | --- | --- |
| `/auth`, `/profiles` | `auth`, `profiles` | Xác minh người dùng, hồ sơ và ảnh đại diện |
| `/groups`, `/channels`, `/invitations` | `groups`, `channels`, `invitations` | Nhóm, thành viên, kênh và lời mời |
| `/conversations`, `/messages`, `/attachments` | `conversations`, `messages`, `attachments` | Hội thoại, tin nhắn, phản ứng và tệp đính kèm |
| `/study-rooms` | `study_rooms`, `meetings` | Vòng đời phòng, thành viên, điều hành, bảng trắng, trình chiếu và token LiveKit |
| `/study-rooms/{room_id}/activities`, `/music` | `activities` | Trò chơi, nhạc, hàng đợi và phân giải đường dẫn bài nhạc |
| `/resources`, `/notes` | `resources`, `notes` | Thư mục/tệp tài nguyên và ghi chú |
| `/tasks`, `/groups/{group_id}/tasks`, `/study-rooms/{room_id}/tasks` | `tasks`, `group_tasks`, `room_tasks` | Công việc cá nhân, bảng công việc nhóm và công việc trong phiên học |
| `/roadmaps`, `/groups/{group_id}/streak`, `/rewards/me` | `roadmaps`, `rewards` | Lộ trình, gợi ý AI, chuỗi hoạt động và phần thưởng |
| `/notifications` | `notifications` | Thông báo và tùy chọn thông báo |

Các đường dẫn trong bảng là nhóm route, không phải danh sách đầy đủ từng endpoint. Xem `/docs` hoặc các file trong `backend/app/*/routers/` để biết method, tham số và response cụ thể.

### Quyền truy cập

`backend/app/auth/dependencies.py` lấy bearer token và tạo `CurrentUser`. `backend/app/auth/services/auth_service.py` xác minh JWT bằng JWKS của Supabase hoặc hỏi Supabase Auth đối với token HS256 cũ. Các router dùng dependency và `backend/app/core/permissions.py` để kiểm tra quyền theo nhóm, kênh và phòng. Kết nối PostgreSQL của backend thực hiện ghi dữ liệu; các chính sách RLS trong migration cho phép trình duyệt đọc những bảng cần cho Realtime và thao tác Storage được cấp quyền.

**Lưu ý bảo mật:** `SupabaseAuthService.verify()` hiện chấp nhận token dạng `dev-token-<uuid>`. Cần gỡ hoặc khóa nhánh này bằng cấu hình trước khi triển khai API công khai.

### Tệp và cuộc gọi

Backend cấp signed URL cho tệp đính kèm, tài nguyên và asset bảng trắng; trình duyệt tải lên hoặc tải xuống qua Supabase Storage. Token họp được tạo ở `POST /study-rooms/{room_id}/meeting/token` bằng `backend/app/meetings/services/livekit_service.py`. Dữ liệu hoạt động trong cuộc gọi dùng API để lưu snapshot/hàng đợi; trạng thái trực tiếp được truyền qua LiveKit data channel.

## 5. Cơ sở dữ liệu

Entity SQLAlchemy nằm trong `backend/app/*/entities/`. SQL triển khai nằm trong `backend/db/migrations/` và phải được áp dụng theo thứ tự:

| Migration | Nội dung chính |
| --- | --- |
| `001_init_schema.sql` | Kiểu enum và các bảng nền tảng |
| `002_security_realtime_storage.sql` | Ràng buộc, trigger, RLS, Realtime, Storage |
| `003_group_tasks.sql` | Công việc nhóm |
| `004_private_study_rooms.sql` | Phòng học riêng tư |
| `005_room_tasks.sql` | Công việc trong phòng và realtime điều hành |
| `006_rewards.sql` | Mốc hoạt động và phần thưởng |
| `007_room_activities.sql` | Hoạt động trò chơi/nhạc trong phòng |
| `008_room_music.sql` | Hàng đợi nhạc chung |
| `009_increase_message_attachments_limit_to_20mb.sql` | Giới hạn tệp đính kèm tin nhắn 20 MB |

`backend/scripts/apply_migration.py` có thể áp dụng một hoặc nhiều file SQL theo số thứ tự hoặc đường dẫn. Kiểm tra lịch sử migration đã áp dụng trên database trước khi chạy lại hoặc bổ sung migration mới. `backend/app/db/session.py` tạo async session; `engine_config.py` xử lý riêng connection pool của Supabase ở cổng transaction pooler 6543.

## 6. Cài đặt và chạy cục bộ

### Chế độ demo chỉ dùng frontend

```powershell
cd frontend
npm install
npm run dev
```

Mở `http://localhost:3000`. Khi chưa cấu hình đủ `VITE_API_BASE_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, frontend tự dùng mock. Có thể đặt `VITE_USE_MOCK=true` trong `frontend/.env` để ép dùng demo. Tài khoản mẫu và cách đặt lại dữ liệu có trong `frontend/README.md`.

### Kết nối dịch vụ thật

1. Sao chép `backend/.env.example` thành `backend/.env`, điền `DATABASE_URL`, `SUPABASE_URL`, thông tin LiveKit và các khóa cần cho tính năng sử dụng. Không đưa khóa server Supabase hay LiveKit secret vào biến `VITE_*`.
2. Tạo database bằng các SQL trong `backend/db/migrations/` theo thứ tự. Có thể dùng `backend/scripts/apply_migration.py` sau khi đã cấu hình `DATABASE_URL`.
3. Trong `backend/`, tạo virtual environment, cài `requirements.txt` và chạy `python run.py`. API mặc định ở `http://localhost:8000`.
4. Sao chép `frontend/.env.example` thành `frontend/.env`, đặt `VITE_API_BASE_URL=http://localhost:8000`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, rồi chạy `npm run dev` trong `frontend/`.

Ví dụ lệnh trên Windows PowerShell:

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe run.py
```

**Cổng phát triển:** `frontend/vite.config.ts` dùng cổng **3000**, còn các origin mặc định trong `backend/app/core/config.py` và ví dụ `backend/.env.example` chủ yếu dùng **5173/5174**. `backend/app/main.py` hiện có `allow_origin_regex` cho `localhost` và `127.0.0.1` ở mọi cổng nên frontend cục bộ ở cổng 3000 vẫn được phép gọi API. Với domain triển khai thực tế, khai báo đúng origin trong `CORS_ALLOWED_ORIGINS`.

SMTP và khóa AI cho gợi ý lộ trình là tùy chọn. Khi thiếu SMTP, email lời mời được ghi ra console; khi thiếu khóa AI, endpoint gợi ý trả 503. Các biến môi trường được giải thích trong hai file `.env.example`.

## 7. Kiểm tra và điểm bắt đầu khi phát triển

```powershell
cd frontend
npm test
npm run build
npm run lint
```

```powershell
cd backend
.\.venv\Scripts\python.exe -m pytest -q --ignore=tests/integration
```

Test frontend nằm gần file triển khai với hậu tố `.test.ts`/`.test.tsx`; test backend nằm trong `backend/tests/`, còn integration test trong `backend/tests/integration/`. Các lệnh trên là cách chạy kiểm tra, không phải kết quả kiểm tra của lần soạn tài liệu này.

Khi thêm tính năng, bắt đầu từ route hoặc trang liên quan, lần theo `*.api.ts` ở frontend đến router/DTO/service/entity ở backend, rồi thêm SQL migration nếu thay đổi schema. Cập nhật đồng thời các kiểu dữ liệu hai phía và test cho hành vi thay đổi. Với phần thưởng, danh mục backend ở `backend/app/rewards/catalog.py` có bản tương ứng ở `frontend/src/lib/rewards.ts`; hai nơi cần giữ đồng bộ.

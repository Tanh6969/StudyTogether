# Cấu trúc frontend StudyTogether

> Tài liệu mô tả cấu trúc thư mục, luồng dữ liệu và các module chính của `frontend/`.
> Cập nhật: 2026-11-20 · ~207 file trong `src/` (41 file test).

## 1. Tổng quan

| Hạng mục | Công nghệ |
|---|---|
| UI | React 19 + TypeScript 6 |
| Build / dev server | Vite 8 (port **3000**), deploy Vercel (`vercel.json` rewrite mọi route về `index.html`) |
| Routing | react-router-dom 7 (lazy load từng trang) |
| Style | Chủ yếu **inline style**; Tailwind v4 mới được thêm (`@import 'tailwindcss'` trong `index.css` + plugin `@tailwindcss/vite`) — hiện mới dùng ở `Header.tsx` |
| Auth + Realtime + Storage | Supabase (`@supabase/supabase-js`) |
| API nghiệp vụ | FastAPI backend qua `lib/apiClient.ts` |
| Video call | LiveKit (`livekit-client`, `@livekit/components-react`) |
| Bảng trắng | Excalidraw (đồng bộ qua LiveKit data channel) |
| Slide PDF | `pdfjs-dist` |
| Icon | `lucide-react` |
| Test / lint | Vitest + Testing Library (jsdom) · oxlint |

### Lệnh

| Lệnh | Tác dụng |
|---|---|
| `npm run dev` | Chạy với dịch vụ thật (đọc `.env`) |
| `npm run dev:mock` | Chạy **chế độ mock** (đọc `.env.mock`): dữ liệu giả trong trình duyệt, không cần backend/Supabase/LiveKit |
| `npm run build` | lint → `tsc -b` → `vite build` |
| `npm test` | `vitest run` (trên Windows chạy từ đường dẫn ổ **`F:\`** viết hoa, nếu không Vitest báo "failed to find the runner") |
| `npm run lint` | oxlint |

### Biến môi trường

| Biến | Ý nghĩa |
|---|---|
| `VITE_API_BASE_URL` | URL backend FastAPI (local: `http://localhost:8000`) |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Supabase project (khóa public) |
| `VITE_USE_MOCK` | `true` = ép mock; không đặt = tự dùng mock nếu thiếu 1 trong 3 biến trên |
| `VITE_SHOW_DEMO_ACCOUNTS` | Hiện nút "Tài khoản test nhanh" ở trang đăng nhập |
| `VITE_PREVIEW_MODE` | `true` = khóa đăng ký/đổi mật khẩu (bản nghiệm thu) |

File: `.env` (thật, gitignore) · `.env.mock` (mock, có commit) · `.env.example` (mẫu).

## 2. Cây thư mục

```
frontend/
├── index.html, vite.config.ts, vitest.config.ts, vercel.json, .oxlintrc.json
├── tsconfig.json / tsconfig.app.json / tsconfig.node.json
├── public/                 favicon.svg, icons.svg
└── src/
    ├── main.tsx            Điểm vào: BrowserRouter → AuthProvider → NotificationProvider → AppShell
    ├── index.css           CSS toàn cục + import Tailwind
    ├── routes/             Định nghĩa route + ProtectedRoute + error boundary của phòng học
    ├── pages/              Các trang (màn hình)
    │   ├── StudyGroup/     Nhóm học, chi tiết nhóm, phòng học
    │   │   └── meeting/    Cuộc gọi video, lobby, bảng trắng, slide
    │   └── invitations/    Trang xem lời mời
    ├── components/         Component tái sử dụng, chia theo miền
    │   ├── ui/             Thư viện UI cơ bản (Avatar, Modal, Skeleton, ...)
    │   ├── layout/         Header, Layout, Footer
    │   ├── chat/           Ảnh đính kèm, reaction tin nhắn
    │   ├── groups/         Panel thành viên, cài đặt nhóm, streak
    │   ├── invitations/    Mời / tham gia bằng mã
    │   ├── notifications/  Chuông + dropdown thông báo
    │   ├── settings/       Các mục trong trang cài đặt
    │   └── common/         ColdStartOverlay (toast "server đang khởi động")
    ├── contexts/           AuthContext, NotificationContext
    ├── hooks/              Logic dữ liệu + realtime (useStudyRoom, useRoomMessages, ...)
    ├── lib/                Gọi API (*.api.ts), kiểu dữ liệu (*.types.ts), tiện ích nghiệp vụ
    ├── mocks/              Backend giả cho chế độ mock (localStorage)
    ├── activities/         Hoạt động trong cuộc gọi (game, nhạc) + message bus LiveKit
    ├── games/chalk/        Game "Phấn Trắng" (vẽ đoán chữ)
    ├── music/              Nghe nhạc chung (YouTube / SoundCloud / Spotify)
    ├── types/              Kiểu dùng chung (notification)
    ├── utils/              Avatar, âm thanh, tên hiển thị, env
    └── test/setup.ts       Cấu hình jsdom cho Vitest
```

## 3. Khởi động & routing

`main.tsx` bọc app theo thứ tự:

```
<StrictMode>
  <BrowserRouter>
    <AuthProvider>              // phiên Supabase / phiên dev (mock), profile, lệnh cấm
      <NotificationProvider>    // thông báo + realtime
        <AppShell>              // useKeepAlive() ping backend + <AppRoutes/> + <ColdStartOverlay/>
```

Route (`src/routes/index.tsx`, trang đều lazy load):

| Đường dẫn | Trang | Bảo vệ | Ghi chú |
|---|---|---|---|
| `/login` | `LoginPage` | — | Có nút tài khoản test nhanh |
| `/register` | `RegisterPage` | — | Khóa khi `VITE_PREVIEW_MODE` |
| `/forgot-password`, `/update-password` | Quên / đặt lại mật khẩu | — | Khóa khi preview |
| `/room/:id` | `StudyRoom` | ✅ | **Không** nằm trong `Layout` (toàn màn hình); bọc `ErrorBoundary` key theo id phòng |
| `/` | → chuyển tới `/groups` | ✅ | |
| `/groups` | `StudyGroups` (`StudyRooms`) | ✅ | Danh sách nhóm |
| `/groups/:id` | `StudyGroupDetail` | ✅ | Workspace của nhóm |
| `/settings` | `AccountSettingsPage` | ✅ | Khóa khi preview |
| `/invitations/:secret` | `InvitationPreviewPage` | — | |
| `*` | → `/` | | |

Các route trong `Layout` có `Header` ở trên; `ProtectedRoute` chuyển về `/login` nếu chưa đăng nhập.

## 4. Luồng dữ liệu

```
Component / Page
   │  dùng
   ▼
hooks/use*.ts ──────────────► Supabase Realtime (supabase.channel)   ← cập nhật trực tiếp
   │  gọi
   ▼
lib/*.api.ts
   │
   ▼
lib/apiClient.ts ──USE_MOCK?──► mocks/api.ts (localStorage)
   │ (thật)
   ▼
FastAPI backend (VITE_API_BASE_URL)
```

- **`lib/apiClient.ts`**: `fetch` dùng chung, tự gắn access token Supabase, tự refresh token một lần khi gặp 401, retry request GET, ném `ApiError(status, message)`, phát tín hiệu "cold start" khi request chậm hơn 2,5s (backend Render ngủ).
- **Supabase dùng trực tiếp cho**: Auth (`supabase.auth`, ~21 chỗ), Realtime (`supabase.channel`, ~38 chỗ), Storage (2 chỗ). Dữ liệu nghiệp vụ đều đi qua backend.
- **Nhóm API backend**: `/auth`, `/profiles`, `/groups`, `/channels`, `/conversations`, `/study-rooms`, `/notes`, `/resources`, `/invitations`, `/notifications`, `/moderation`, `/tasks`, `/roadmaps`, `/music`.
- **Quy ước file trong `lib/`**: `xxx.api.ts` = hàm gọi API, `xxx.types.ts` = interface khớp DTO backend.

## 5. Các miền chức năng

### 5.1 Xác thực
| File | Vai trò |
|---|---|
| `contexts/AuthContext.tsx`, `contexts/auth-context.ts` | Giữ phiên, profile, danh sách lệnh cấm; `setDevSession` cho chế độ mock |
| `hooks/useAuth.ts` | Hook đọc trạng thái đăng nhập + `currentUser` (tên, chữ tắt, màu, avatar) |
| `lib/authFlow.ts`, `lib/auth.api.ts` | Luồng đăng nhập/đăng ký, gọi `/auth/me` |
| `lib/demoAccounts.ts` | 6 tài khoản test nhanh (mật khẩu `123456`) |
| `pages/LoginPage.tsx`, `RegisterPage.tsx`, `ForgotPasswordPage.tsx`, `UpdatePasswordPage.tsx` | Các màn hình xác thực |

### 5.2 Nhóm học (`/groups`, `/groups/:id`)
| File | Vai trò |
|---|---|
| `pages/StudyGroup/StudyGroups.tsx` | Danh sách nhóm, tìm kiếm, phân trang, tạo nhóm |
| `pages/StudyGroup/StudyGroupDetail.tsx` | **File lớn nhất (~2.170 dòng)**: kênh chat, phòng học, ghi chú, tài liệu, bảng nhiệm vụ, thành viên |
| `pages/StudyGroup/TaskFlowBoard.tsx` | Bảng nhiệm vụ dạng cây của nhóm |
| `pages/StudyGroup/NotesStackPanel.tsx` | Dải ghi chú nhóm |
| `components/groups/*` | Panel thành viên, cài đặt nhóm, rời nhóm khi là chủ, streak, tab workspace |
| `hooks/useGroupNotes*.ts`, `useGroupResources.ts`, `useGroupTableRealtime.ts`, `useChannelMessagesRealtime.ts` | Dữ liệu + realtime của nhóm |

### 5.3 Phòng học & cuộc gọi (`/room/:id`)
| File | Vai trò |
|---|---|
| `pages/StudyGroup/StudyRoom.tsx` | Trang phòng (~1.200 dòng): header, chế độ Video / Bảng trắng / Game, sidebar (Nhiệm vụ · Trò chuyện · Nhạc), thanh điều khiển; **có giao diện điện thoại** (`useIsMobile`) và màn "bị ngắt khỏi phòng" |
| `pages/StudyGroup/studyRoomPage.ts` | Lazy wrapper của trang phòng |
| `hooks/useStudyRoom.ts` | Trạng thái phòng: thông tin, thành viên, phiên của mình, quyền, join/leave (an toàn theo "thế hệ" join), kiểm duyệt |
| `hooks/useRoomConnectionWatch.ts` | Theo dõi online/offline + quay lại tab → kiểm tra lại tư cách thành viên |
| `hooks/useRoomMessages.ts`, `useRoomTasks.ts`, `useRoomPresence.ts`, `useRoomModerationRealtime.ts`, `useStudyRoomMembersRealtime.ts` | Chat, nhiệm vụ buổi học, ai đang trong cuộc gọi, realtime |
| `lib/roomPermissions.ts` | Bảng quyền theo vai trò trong phòng |
| `meeting/MeetingProvider.tsx` | Lấy token LiveKit, kết nối phòng, phát hiện chuyển tab/thiết bị |
| `meeting/PreJoinLobby.tsx` | Xem trước camera/mic trước khi vào |
| `meeting/MeetingVideoGrid.tsx`, `MeetingControls.tsx` | Lưới video, nút mic/camera |
| `meeting/WhiteboardPanel.tsx` → `SyncedWhiteboard.tsx` + `hooks/useExcalidrawSync.ts` | Bảng trắng Excalidraw đồng bộ qua LiveKit |
| `meeting/PresentationViewer.tsx` + `hooks/usePresentationSync.ts` | Trình chiếu PDF |
| `meeting/WhiteboardPermissionsModal.tsx` | Phân quyền vẽ / chuyển chủ phòng |
| `lib/meeting.api.ts`, `meetingOwnerState.ts`, `hooks/useMeetingToken.ts` | Phiên media (1 tab sở hữu cuộc gọi) + token |

### 5.4 Hoạt động trong cuộc gọi
| Thư mục | Vai trò |
|---|---|
| `activities/` | `RoomActivities.tsx` (provider + nút), `ActivityTray.tsx`, `useRoomActivities.ts`, `net/useActivityBus.ts` (bus tin nhắn trên LiveKit data channel) |
| `games/chalk/` | Game "Phấn Trắng": `engine/engine.ts` (luật chơi thuần), `useChalkGame.ts` (đồng bộ mạng), `ChalkCanvas.tsx`, `ChalkGame.tsx`, `words.ts`, `sounds.ts` |
| `music/` | Nghe nhạc chung: `useMusicSync.ts` (~825 dòng), `MusicPanel`, `MusicMiniPlayer`, `PlayerDock`, `players/` (adapter YouTube / SoundCloud / Spotify) |

### 5.5 Chat
`components/chat/` (ảnh đính kèm, reaction, xem trước ảnh) · `hooks/useMessageImageAttachment.ts`, `useMessageReactionActions.ts`, `useMessageReactionsRealtime.ts` · `lib/message.api.ts`, `chatCache.ts`, `attachment.api.ts`.

### 5.6 Lời mời & thông báo
- Lời mời: `components/invitations/*`, `pages/invitations/InvitationPreviewPage.tsx`, `lib/invitation*.ts`.
- Thông báo: `contexts/notification-context.tsx`, `components/notifications/*` (chuông, dropdown, item, formatter), `lib/notification.api.ts`, `types/notification.ts`.

### 5.7 Cài đặt & phần thưởng
`pages/AccountSettingsPage.tsx`, `components/settings/*` (thông báo, phần thưởng, toggle), `lib/rewards.ts` (danh mục khung avatar / kiểu cổ vũ — phải khớp `backend/app/rewards/catalog.py`), `components/ui/FramedAvatar.tsx`, `frameArt.tsx`.

## 6. Thư viện UI (`components/ui/`)

| Component | Dùng cho |
|---|---|
| `Avatar`, `FramedAvatar`, `frameArt` | Ảnh đại diện (fallback chữ tắt), khung trang trí |
| `Modal` | Hộp thoại chung |
| `Skeleton` | Khung loading (có `PageLoadingSkeleton`) |
| `ErrorBoundary` | Chặn lỗi render không làm trắng cả app |
| `Pagination` | Phân trang "Trang X / Y" |
| `RestrictionBanner` | Thông báo khi tài khoản bị hạn chế |
| `CountBadge` | Số đếm đỏ trên icon |
| `Button`, `Dropdown`, `Hover` | Hiện **chưa được import ở đâu** |

## 7. Chế độ mock (`src/mocks/`)

| File | Vai trò |
|---|---|
| `config.ts` | Bật/tắt mock (`USE_MOCK`), mật khẩu chung `123456` |
| `seed.ts` | Dữ liệu mẫu: người dùng, nhóm, kênh, phòng, tin nhắn, ghi chú, ... |
| `db.ts` | Lưu DB giả trong `localStorage` (`window.__resetMockDb()` để reset) |
| `api.ts` | Router giả thay cho backend |
| `studyRooms.ts` | API giả trong phòng: join/leave/session/thành viên/kiểm duyệt/nhiệm vụ; token cuộc gọi cố ý báo lỗi (không có LiveKit) |
| `storage.ts` | Storage giả |

Mẹo: trong phòng ở chế độ mock, gõ `mockPassiveDisconnect()` trong console rồi chuyển tab qua lại để thấy màn "bị ngắt khỏi phòng".

## 8. Test

- 41 file `*.test.ts(x)` đặt **cạnh file được test**; cấu hình ở `vitest.config.ts` + `src/test/setup.ts` (stub `matchMedia` cho jsdom).
- Đã biết: 25 test realtime (`useGroupNotes`, `useGroupTableRealtime`, `useChannelMessagesRealtime`, `useMessageReactionsRealtime`) đang fail từ trước trên code gốc.

## 9. Ghi chú / điểm cần dọn

- **Code có thể không còn dùng**: `pages/Aim.tsx` + `pages/TaskManagementSection.tsx` (không có route), `components/layout/Footer.tsx`, `components/invitations/PendingInvitationsBell.tsx`, `components/ui/Button.tsx`, `Dropdown.tsx`, `Hover.tsx`.
- **File quá lớn nên tách**: `StudyGroupDetail.tsx` (~2.170 dòng), `StudyRoom.tsx` (~1.200), `useMusicSync.ts` (~825), `Aim.tsx` (~750), `ChalkGame.tsx` (~730).
- **Style chưa thống nhất**: phần lớn dùng inline style; Tailwind mới bật — nên chọn một hướng khi làm lại giao diện. Lưu ý Tailwind preflight reset CSS mặc định của toàn app.
- `frontend/.hallmark-tmp/` là thư mục tạm, không thuộc mã nguồn.

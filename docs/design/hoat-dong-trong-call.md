# Hoạt động nâng cao trong cuộc gọi

Bản thiết kế cho nhóm tính năng "Hoạt động" (Activities) của phòng học StudyTogether: một khay chức năng mở từ thanh điều khiển cuộc gọi, trong đó có **game giải lao nhiều người chơi "Phấn Trắng"** và **nghe nhạc chung từ link YouTube, SoundCloud, Spotify** theo cơ chế của Discord. Tài liệu đi từ ý tưởng, luật chơi, đồ họa, giao thức mạng, dữ liệu, tới lộ trình triển khai.

Trạng thái: đã triển khai bản thử ngày 2026-11-15 (xem mục 7). Ngày thiết kế: 2026-11-15.

---

## 0. Tóm tắt

| Hạng mục | Quyết định |
|---|---|
| Điểm vào | Nút **Hoạt động** (icon `Sparkles`) trên thanh điều khiển cuộc gọi, cạnh nút chia sẻ màn hình. Mở khay 2 cột các thẻ hoạt động. |
| Game | **Phấn Trắng**: vẽ và đoán trên bảng phấn, 2 đến 10 người, một ván 5 đến 8 phút. Bộ từ theo chủ đề, có bộ từ sinh từ chủ đề học của nhóm. |
| Nhạc | **Nghe chung**: hàng đợi dùng chung, mỗi máy tự phát qua player nhúng của nền tảng, đồng bộ vị trí theo đồng hồ của người điều khiển (DJ). Không đưa nhạc qua micro hay chia sẻ màn hình. |
| Truyền dữ liệu | LiveKit data channel cho sự kiện tức thời (nét vẽ, tick nhạc), REST + bảng Supabase cho trạng thái bền để người vào sau tải được, Supabase Realtime làm kênh dự phòng. Cùng mẫu với `usePresentationSync`. |
| Quyền | Ai cũng mở được khay. Mỗi phòng tối đa **một hoạt động chính** (game) và **một phiên nhạc** chạy song song. Người tạo là host của hoạt động đó. Quản lý nhóm luôn có quyền dừng. |
| Dữ liệu mới | Migration `007_room_activities.sql` (bảng `room_activities`), `008_room_music.sql` (bảng `room_music_sessions`, `room_music_queue`). |

---

## 1. Khung "Hoạt động"

### 1.1 Vì sao cần một khung chung

Cả game lẫn nhạc đều có chung bốn bài toán: ai đang chạy gì, ai được điều khiển, người vào sau lấy trạng thái ở đâu, và chuyện gì xảy ra khi host rớt mạng. Giải một lần ở lớp khung, hai tính năng chỉ còn lo logic riêng. Các hoạt động sau này (Pomodoro chung, bình chọn nhanh) cũng cắm vào khung này.

### 1.2 Điểm vào và khay hoạt động

Thanh điều khiển cuộc gọi hiện có: micro, camera, chia sẻ màn hình, giơ tay, rời phòng. Thêm nút **Hoạt động** ngay sau chia sẻ màn hình. Khi có hoạt động đang chạy, nút có chấm xanh nhấp nháy và số người đang tham gia.

```
┌──────────────────────────────────────────────────────────────┐
│  [🎤] [📷] [🖥] [✨ Hoạt động •3] [✋]            [Rời phòng]  │
└──────────────────────────────────────────────────────────────┘
                 │ bấm
                 ▼
┌───────────────── Hoạt động ─────────────────┐
│ Đang diễn ra                                 │
│ ┌──────────────────────────────────────────┐ │
│ │ 🎨 Phấn Trắng · Minh Anh làm chủ · 3/10  │ │
│ │ Vòng 2/3 · còn 00:41        [Tham gia]   │ │
│ └──────────────────────────────────────────┘ │
│                                              │
│ Bắt đầu mới                                  │
│ ┌──────────────┐ ┌──────────────┐            │
│ │ 🎨 Phấn Trắng│ │ 🎵 Nghe chung│            │
│ │ Vẽ và đoán   │ │ YouTube,     │            │
│ │ 2–10 người   │ │ SoundCloud…  │            │
│ └──────────────┘ └──────────────┘            │
│ ┌──────────────┐ ┌──────────────┐            │
│ │ 🍅 Pomodoro  │ │ 🗳 Bình chọn │  (giai đoạn│
│ │ chung        │ │ nhanh        │   sau)     │
│ └──────────────┘ └──────────────┘            │
└──────────────────────────────────────────────┘
```

Thẻ hoạt động dùng nền `#1E293B`, viền `#334155`, chữ `#E2E8F0`, giống sidebar hiện tại. Thẻ đang diễn ra có viền trái 3px màu `#38BDF8`.

### 1.3 Nơi hoạt động hiển thị

- **Game** chiếm vùng trung tâm như một chế độ thứ ba trong bộ chuyển chế độ: `Gọi Video | Bảng trắng | Giải lao`. Tab Giải lao chỉ hiện khi có game đang chạy hoặc vừa kết thúc dưới 30 giây. Video của mọi người thu thành dải thumbnail ngang phía trên bảng vẽ, cao 72px, vẫn thấy mặt nhau khi chơi.
- **Nhạc** không chiếm trung tâm. Có một **mini player** cố định ngay trên dải tab của sidebar, cao 56px, luôn thấy dù đang ở chế độ nào. Bấm vào mở tab sidebar **Nhạc** với hàng đợi đầy đủ.

### 1.4 Vòng đời một hoạt động

```
idle ──(tạo)──▶ lobby ──(host bấm bắt đầu)──▶ running ──▶ ended ──(30s)──▶ idle
                  │                              │
                  └───────(host huỷ)─────────────┴──(quản lý nhóm dừng)──▶ ended
```

- Một phòng chỉ có **một** bản ghi `room_activities` với `ended_at IS NULL` cho `kind = 'game'`. Tạo mới khi đã có sẽ trả 409 kèm bản ghi hiện tại để client nhảy thẳng vào "Tham gia".
- Nhạc là `kind = 'music'`, được phép tồn tại song song với game.
- Người tham gia được ghi vào `room_activities.participants` (JSONB mảng user_id, theo thứ tự vào). Thứ tự này dùng để **bầu host mới**.

### 1.5 Host và chuyển host

Host của hoạt động là nguồn sự thật cho trạng thái game và cho đồng hồ nhạc. Khi host rời LiveKit room (sự kiện `ParticipantDisconnected`) quá 5 giây:

1. Mọi client còn lại tính host mới = người đầu tiên trong `participants` còn đang kết nối. Ai cũng tính ra cùng một kết quả nên không cần bầu.
2. Host mới gọi `PATCH /study-rooms/{id}/activities/{aid}` đổi `host_user_id`. Backend chỉ chấp nhận nếu host cũ không còn trong `study_room_members` đang hoạt động hoặc đã quá 5 giây không có heartbeat.
3. Host mới phát `activity.host_changed` qua data channel, kèm snapshot trạng thái mới nhất mà nó có.

Host gửi heartbeat `activity.tick` mỗi 2 giây qua data channel (lossy) để các máy khác biết host còn sống mà không cần đợi LiveKit báo rớt.

### 1.6 Truyền dữ liệu

Ba tầng, mỗi tầng một nhiệm vụ:

| Tầng | Dùng cho | Đặc điểm |
|---|---|---|
| LiveKit data channel, `reliable: true`, topic `activity` | Thay đổi trạng thái: bắt đầu vòng, điểm, hàng đợi nhạc, lệnh play/pause/seek | Có thứ tự, không mất, trễ vài chục ms |
| LiveKit data channel, `reliable: false`, topic `activity-lossy` | Nét vẽ đang kéo, tick vị trí nhạc, heartbeat | Mất gói được, không chặn luồng |
| REST + bảng Supabase | Snapshot để người vào sau, reload trang, hoặc rớt mạng tải lại | Host ghi, mọi người đọc. Supabase Realtime báo đổi để client gọi lại REST |

Mỗi gói data channel là JSON `{ v: 1, kind: 'game' | 'music', type: string, from: userId, seq: number, payload }`. `seq` tăng dần theo từng người gửi để máy nhận bỏ gói cũ đến muộn, đúng vấn đề đã gặp ở phần việc cá nhân.

### 1.7 Bảng `room_activities` (migration 007)

```sql
create table room_activities (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references study_rooms(id) on delete cascade,
  kind text not null check (kind in ('game', 'music')),
  game text,                              -- 'chalk' cho Phấn Trắng, null với nhạc
  host_user_id uuid not null references profiles(id),
  status text not null default 'lobby' check (status in ('lobby', 'running', 'ended')),
  participants jsonb not null default '[]'::jsonb,
  settings jsonb not null default '{}'::jsonb,   -- số vòng, thời gian vẽ, bộ từ
  snapshot jsonb,                                -- trạng thái mới nhất do host ghi
  snapshot_at timestamptz,
  created_at timestamptz not null default now(),
  ended_at timestamptz
);
create unique index room_activities_one_live_game
  on room_activities (room_id) where kind = 'game' and ended_at is null;
create unique index room_activities_one_live_music
  on room_activities (room_id) where kind = 'music' and ended_at is null;
alter publication supabase_realtime add table room_activities;
```

RLS: đọc nếu là thành viên đang hoạt động của phòng (dùng lại helper của migration 002). Ghi chỉ qua backend bằng service role.

Endpoint:

| Method | Đường dẫn | Ai | Việc |
|---|---|---|---|
| GET | `/study-rooms/{id}/activities` | thành viên | Danh sách hoạt động đang sống |
| POST | `/study-rooms/{id}/activities` | thành viên | Tạo, 409 nếu đã có cùng kind |
| POST | `/study-rooms/{id}/activities/{aid}/join` | thành viên | Thêm vào participants |
| PATCH | `/study-rooms/{id}/activities/{aid}` | host hoạt động, hoặc quản lý nhóm | Đổi status, settings, snapshot, host |
| DELETE | `/study-rooms/{id}/activities/{aid}` | host hoạt động, hoặc quản lý nhóm | Đặt ended_at |

---

## 2. Game "Phấn Trắng"

### 2.1 Ý tưởng

Một người cầm phấn vẽ lên bảng, những người còn lại đoán xem đó là từ gì. Luật quen thuộc nên ai cũng vào được trong 10 giây, không cần hướng dẫn. Điểm khác biệt của Phấn Trắng nằm ở ba thứ:

1. **Bảng phấn thật**: toàn bộ đồ họa là bảng xanh rêu, phấn có hạt, bụi phấn bay, giấy nhớ dán điểm. Không giống bất kỳ game vẽ đoán nào đang có.
2. **Bộ từ từ chính buổi học**: ngoài các bộ từ vui, nhóm chọn được bộ "Ôn bài" sinh từ chủ đề nhóm và roadmap đang học. Giải lao mà vẫn nhớ bài.
3. **Phấn có hạn**: mỗi lượt vẽ chỉ có một thanh phấn. Vẽ hết phấn thì chỉ còn tẩy. Người vẽ phải nghĩ trước khi đặt nét, lượt chơi vì thế vừa căng vừa buồn cười.

Thời lượng mục tiêu: 3 vòng, 6 người, khoảng 7 phút. Vừa một lần giải lao.

### 2.2 Luật chơi

**Người chơi**: 2 đến 10. Dưới 2 người không bắt đầu được. Người vào giữa ván được xem và đoán ngay từ lượt tiếp theo, được cộng điểm, nhưng không vẽ cho tới vòng mới.

**Một ván** gồm N vòng (mặc định 3, host chọn 1 đến 5). Mỗi vòng, mọi người chơi lần lượt cầm phấn một lượt. Thứ tự vẽ là thứ tự tham gia, xoay vòng.

**Một lượt**:

1. *Chọn từ* (10 giây): người vẽ thấy 3 thẻ từ, mỗi thẻ ghi độ khó bằng 1 đến 3 viên phấn. Từ khó cho nhiều điểm hơn. Không chọn thì hệ thống chọn thẻ giữa.
2. *Vẽ* (mặc định 60 giây, host chọn 40 / 60 / 90): người vẽ vẽ, người khác gõ đoán vào ô đoán. Đoán đúng thì ô chuyển xanh, người đó chuyển sang chế độ xem và có thể bấm cổ vũ. Người vẽ không gõ được chữ.
3. *Lộ chữ*: ở 50% thời gian lộ một chữ cái, ở 75% lộ thêm một chữ. Từ 4 chữ cái trở xuống chỉ lộ một lần.
4. *Kết thúc lượt* khi hết giờ hoặc tất cả đã đoán đúng. Màn tổng kết lượt 5 giây: đáp án, ai đoán đúng lúc nào, điểm cộng.

**Đoán gần đúng**: nếu khoảng cách Levenshtein giữa câu đoán và đáp án bằng 1 (sau khi bỏ dấu và viết thường), chỉ người đó thấy dòng "Gần đúng rồi!" màu vàng. Câu đoán gần đúng không hiện cho người khác, tránh lộ đáp án.

**Chống lộ đáp án**: câu đoán chứa nguyên đáp án bị chặn, không gửi vào kênh đoán. Người vẽ không gửi được chữ trong lúc vẽ. Người đã đoán đúng gõ gì cũng chỉ hiện cho những người đã đoán đúng khác.

**Phấn có hạn**: mỗi lượt bắt đầu với thanh phấn 100%. Mỗi pixel nét vẽ trừ phấn theo độ dày. Thanh phấn tính để một người vẽ bình thường dùng hết khoảng 70 đến 80% trong 60 giây. Hết phấn thì nút vẽ khóa, chỉ còn tẩy và "Xóa hết" (xóa hết không hoàn phấn). Host có thể tắt luật này trong cài đặt, gọi là "Phấn vô hạn".

### 2.3 Tính điểm

Tất cả điểm là số nguyên, cộng dồn qua các vòng.

| Ai | Công thức | Ghi chú |
|---|---|---|
| Người đoán đúng | `40 + round(60 × thời_gian_còn / thời_gian_lượt)` × hệ số độ khó | Hệ số 1.0 / 1.25 / 1.5 theo 1 / 2 / 3 viên phấn |
| Thưởng đoán đầu | +15 | Chỉ người đầu tiên |
| Người vẽ | `15 × số_người_đoán_đúng`, tối đa 90 | Vẽ cho dễ đoán mới có điểm, không có ai đoán đúng thì 0 |
| Thưởng chơi tiết kiệm | +10 cho người vẽ nếu còn trên 40% phấn và có ít nhất 2 người đoán đúng | Khuyến khích nét gọn |

Hết ván: bục 1-2-3. Đồng điểm thì ai đạt điểm đó trước xếp trên.

### 2.4 Bộ từ

Mỗi bộ từ là mảng `{ word, difficulty: 1|2|3, hint?: string }`. Lưu ở `frontend/src/games/chalk/words/*.ts`, mỗi bộ 150 đến 300 từ tiếng Việt, ưu tiên danh từ vẽ được.

| Bộ | Ví dụ | Dành cho |
|---|---|---|
| Đời sinh viên | deadline, trà sữa, ký túc xá, ngủ gật, thẻ sinh viên | Mặc định |
| Đồ dùng học tập | compa, bút xóa, máy tính cầm tay, sổ tay | Dễ, hợp nhóm mới |
| Môn học | quang hợp, định luật Ohm, tam giác vuông, mạch điện | Khó hơn |
| Thành ngữ | nước đổ đầu vịt, học tài thi phận, chuột sa chĩnh gạo | Rất khó, rất vui |
| Phim và nhạc | Mắt Biếc, Em Của Ngày Hôm Qua | Vui |
| **Ôn bài** | sinh từ chủ đề nhóm | Đặc trưng của StudyTogether |

**Bộ Ôn bài** sinh ở backend qua `POST /study-rooms/{id}/games/word-pack`. Backend lấy tên nhóm, mô tả nhóm, tên các phase roadmap và các task gần đây, gọi `roadmap_ai_service` với yêu cầu trả về 40 thuật ngữ danh từ ngắn gọn có thể vẽ được, kèm độ khó. Kết quả cache trong `settings.word_pack` của hoạt động nên cả ván chỉ gọi AI một lần. Host xem trước danh sách và bỏ từ không thích trước khi bắt đầu. Nếu AI lỗi, nút Ôn bài hiện "Chưa sinh được bộ từ, thử lại" và không chặn các bộ khác.

Host chọn được nhiều bộ cùng lúc, trộn lại. Từ đã ra trong ván không ra lại.

### 2.5 Các màn hình

Thứ tự: Sảnh → Chọn từ → Vẽ → Tổng kết lượt → (lặp) → Bục vinh danh.

#### Sảnh (lobby)

```
┌─────────────────────────────── Giải lao ───────────────────────────────┐
│  [MA][HN][TT][  ][  ]  dải video 72px                                   │
├─────────────────────────────────────────────────────────────────────────┤
│ ╔═══════════════════════════════════════════════════════════════════╗  │
│ ║  (bảng xanh)                                                      ║  │
│ ║        PHẤN TRẮNG          ← chữ phấn viết tay, có bụi            ║  │
│ ║        vẽ · đoán · cười                                           ║  │
│ ║                                                                   ║  │
│ ║   Người chơi (3/10)         Cài đặt (host)                        ║  │
│ ║   📌 Minh Anh (chủ)         Số vòng     [1] [3] [5]               ║  │
│ ║   📌 Hoàng Nam              Thời gian   [40] [60] [90]            ║  │
│ ║   📌 Thu Trang              Phấn        [Có hạn] [Vô hạn]         ║  │
│ ║                             Bộ từ  ☑ Đời sinh viên ☐ Môn học      ║  │
│ ║                                    ☐ Thành ngữ ☐ Ôn bài ✨        ║  │
│ ║                                                                   ║  │
│ ║                 [  Bắt đầu  ]   (host)  /  Đang đợi chủ phòng…    ║  │
│ ╚═══════════════════════════════════════════════════════════════════╝  │
└─────────────────────────────────────────────────────────────────────────┘
```

Người chơi hiện dưới dạng giấy nhớ vàng có ghim, tên viết tay. Vào thêm người thì tờ giấy mới "dán" vào với animation xoay nhẹ 2 độ.

#### Vẽ (màn chính)

```
┌─ [MA][HN][TT][LA]  dải video ──────────────────────────────────────────┐
├────────────┬─────────────────────────────────────────┬─────────────────┤
│ BẢNG ĐIỂM  │  Vòng 2/3  ·  Minh Anh đang vẽ         ⏱ 00:41 (vòng phấn)│
│ (giấy nhớ) │  _ _ _   _ _ _                                   │ ĐOÁN   │
│ ┌────────┐ │ ╔═══════════════════════════════════════╗        │        │
│ │Minh Anh│ │ ║                                       ║        │ HN: cái│
│ │   245  │ │ ║                                       ║        │  ghế?  │
│ │ ✏ vẽ   │ │ ║          (canvas 4:3, bảng xanh)      ║        │ TT: bàn│
│ └────────┘ │ ║                                       ║        │ ✔ Lan  │
│ ┌────────┐ │ ║                                       ║        │ đoán   │
│ │Hoàng N.│ │ ║                                       ║        │ đúng!  │
│ │   190 ✔│ │ ╚═══════════════════════════════════════╝        │        │
│ └────────┘ │  phấn ▓▓▓▓▓▓▓▓░░░░ 64%                            │────────│
│ ┌────────┐ │  [○ trắng][○ vàng][○ hồng][○ xanh] [mỏng|vừa|dày]│ [gõ đoán│
│ │Thu Tr. │ │  [tẩy] [hoàn tác] [xóa hết]       (chỉ người vẽ) │  ……… ↵]│
│ │   120  │ │                                                   │        │
│ └────────┘ │                                                   │        │
└────────────┴───────────────────────────────────────────────────┴────────┘
```

- Người vẽ thấy từ ở vị trí dấu gạch, nền vàng nhạt. Người đoán thấy dấu gạch theo số chữ cái, dấu cách giữ nguyên.
- Đồng hồ là một vòng tròn phấn ở góc trên phải, bị "tẩy" dần theo chiều kim đồng hồ. Dưới 10 giây vòng chuyển đỏ hồng và rung nhẹ mỗi giây.
- Ô đoán ở sidebar phải, dùng lại vùng chat hiện có nhưng đổi sang chế độ đoán. Khi game chạy, chat thường tạm ẩn, tránh lộ đáp án qua chat.
- Khi sidebar đóng, ô đoán nổi lên thành thanh dưới canvas.

#### Tổng kết lượt (5 giây)

Bảng mờ đi, một tờ giấy A4 "rơi" xuống giữa: đáp án viết to, bên dưới danh sách ai đoán đúng kèm giây thứ mấy và điểm cộng màu xanh lá. Người vẽ hiện "+45 phấn" nếu được thưởng. Bụi phấn rơi từ mép trên.

#### Bục vinh danh

Ba bục gỗ, avatar đứng trên bục có **khung avatar** đã mở khóa (dùng `FramedAvatar` hiện có). Khi bục số 1 hiện ra, phát **âm cổ vũ** đúng kiểu `cheerStyle` của người thắng và bắn bụi phấn màu. Dưới bục: "Chơi lại" (host) và "Về học thôi" (ai cũng bấm được, chỉ rời phần mình). Sau 30 giây không ai bấm, tự đóng và quay về Gọi Video.

#### Mobile (dưới 768px)

Canvas trên cùng, chiếm toàn bề rộng, tỷ lệ 4:3. Dưới canvas là thanh công cụ vẽ cuộn ngang. Dưới nữa là bảng điểm thu gọn thành một dòng avatar có số. Ô đoán dính đáy màn hình. Dải video ẩn, thay bằng nút "Xem mặt" mở overlay.

### 2.6 Đồ họa

**Bảng màu**

| Vai trò | Mã | Dùng ở |
|---|---|---|
| Bảng | `#1F3B2D` nền, phủ texture nhiễu 4% opacity | Canvas, nền sảnh |
| Bảng tối hơn | `#17301F` | Viền trong bảng, vùng đã tẩy |
| Khung gỗ | `#8B5A2B` chính, `#6B4320` bóng, `#B07A42` highlight | Viền canvas 14px, bục |
| Phấn trắng | `#F4F1E8` | Nét mặc định, chữ chính |
| Phấn vàng | `#F2DE8A` | Nét, chữ nhấn, thanh phấn |
| Phấn hồng | `#F0B6C6` | Nét, cảnh báo nhẹ, đồng hồ dưới 10 giây |
| Phấn xanh | `#A9D3F0` | Nét, link, nút phụ |
| Giấy nhớ | `#FFE98A` nền, `#E6C95A` viền dưới | Bảng điểm, danh sách người chơi |
| Giấy trắng | `#FBF8F0` | Tờ tổng kết lượt |
| Ghim | `#D64545` | Chấm ghim giấy nhớ |
| Đúng | `#7BD88F` | Ô đoán đúng, điểm cộng |

Mọi màu nhạt trên nền bảng đạt tương phản tối thiểu 7:1. Màu trạng thái luôn đi kèm icon hoặc chữ, không chỉ dựa vào màu.

**Chữ**

- Tiêu đề, tên người, đáp án: `Patrick Hand` (Google Fonts), là chữ viết tay rõ ràng, có dấu tiếng Việt đầy đủ. Chỉ tải font này trong tab Giải lao, không ảnh hưởng phần còn lại của app.
- Nội dung chức năng (nút, số đếm, ô đoán): `Inter` như toàn app, để dễ đọc và số đều nhau.
- Chữ phấn có `text-shadow: 0 0 1px rgba(244,241,232,.35)` và lớp texture mặt chữ để trông bột.

**Nét phấn**

Vẽ bằng Canvas 2D, không dùng SVG để đủ nhanh ở 60 fps:

- Mỗi đoạn nét vẽ bằng `lineCap: round`, `lineJoin: round`, độ dày 3 / 6 / 10 px ở hệ tọa độ 800×600.
- Lên trên nét chính phủ thêm một lớp nét cùng đường đi, độ dày bằng 60%, `globalAlpha` 0.35, bị lệch ngẫu nhiên 0.4px theo mỗi điểm. Lớp này tạo cảm giác bột không đều.
- Khi vẽ, mỗi 40 ms bắn 2 đến 4 hạt bụi tại đầu phấn: kích thước 1 đến 2px, rơi 12 đến 20px trong 500 ms, mờ dần. Hạt chỉ vẽ ở máy người vẽ và các máy xem, không gửi qua mạng.
- Tẩy là hình tròn 24px xóa về màu bảng tối hơn, để lại vệt mờ 8% sáng trong 3 giây rồi tan, giống bảng thật chưa lau sạch.

**Chuyển động**

| Việc | Chuyển động | Thời lượng |
|---|---|---|
| Giấy nhớ mới | Trượt từ trên xuống 12px, xoay từ -4° về góc nghỉ ngẫu nhiên -2° đến 2° | 240 ms, ease-out |
| Lộ chữ cái | Dấu gạch lật dọc 90° rồi hiện chữ | 300 ms |
| Đoán đúng | Ô người đó nảy scale 1 → 1.08 → 1, rắc 12 hạt bụi xanh | 400 ms |
| Hết phấn | Thanh phấn nhấp nháy hồng hai lần, biểu tượng phấn gãy đôi | 600 ms |
| Tổng kết lượt | Tờ giấy rơi từ -40px với xoay 3°, kèm bóng đổ | 350 ms |
| Bục vinh danh | Ba bục trồi từ dưới lên lần lượt 3, 2, 1 cách nhau 400 ms | 1.6 s tổng |

Tôn trọng `prefers-reduced-motion`: tắt hạt bụi, rung, lật chữ, giữ fade đơn giản.

**Âm thanh**

Tất cả tổng hợp bằng Web Audio như `cheerSounds.ts`, không tải file:

- Phấn kéo: nhiễu trắng lọc band-pass 2 đến 4 kHz, âm lượng theo tốc độ kéo, chỉ phát ở máy người vẽ.
- Tick 10 giây cuối: click gỗ ngắn mỗi giây.
- Đoán đúng: hai nốt lên (C5, E5) 120 ms.
- Hết lượt: tiếng tẩy bảng ngắn (nhiễu lọc thấp 300 ms).
- Thắng ván: âm cổ vũ theo `cheerStyle` của người thắng, sẵn có.

Có nút tắt tiếng game riêng ở góc bảng, nhớ theo `localStorage`.

### 2.7 Giao thức mạng

Host là nguồn sự thật. Mọi hành động của người chơi gửi tới host dưới dạng *yêu cầu*, host xử lý rồi phát *sự kiện* cho tất cả. Riêng nét vẽ phát thẳng từ người vẽ tới tất cả để giảm trễ, host chỉ lưu lại.

**Sự kiện host phát** (reliable)

| type | payload | Khi |
|---|---|---|
| `game.state` | toàn bộ trạng thái (xem dưới) | Người mới vào, đổi host, định kỳ 10 giây |
| `game.phase` | `{ phase, roundIndex, turnIndex, drawerId, endsAt }` | Mỗi lần chuyển màn |
| `game.word_options` | `{ options: [{id, length, difficulty}] }` chỉ gửi cho người vẽ | Vào màn chọn từ |
| `game.word_set` | `{ mask: "_ _ _  _ _", difficulty }` cho người đoán; `{ word }` cho người vẽ | Sau khi chọn |
| `game.hint` | `{ index, char }` | 50%, 75% thời gian |
| `game.guess` | `{ userId, text, result: 'wrong' \| 'correct' \| 'hidden' }` | Sau khi host chấm |
| `game.close_call` | `{}` chỉ gửi cho người đoán gần đúng | Khi Levenshtein = 1 |
| `game.scores` | `{ scores: {userId: number}, turnGains: {userId: number} }` | Cuối lượt |
| `game.ended` | `{ podium: [userId, userId, userId] }` | Hết ván |

**Yêu cầu người chơi gửi** (reliable, chỉ host xử lý)

| type | payload |
|---|---|
| `game.req_join` | `{}` |
| `game.req_pick_word` | `{ optionId }` |
| `game.req_guess` | `{ text, clientTs }` |
| `game.req_settings` | `{ rounds, drawSeconds, chalkLimited, packs }` chỉ host được chấp nhận |
| `game.req_start` / `game.req_restart` / `game.req_cancel` | `{}` host |

**Nét vẽ** (từ người vẽ, tới tất cả)

| type | kênh | payload |
|---|---|---|
| `draw.move` | lossy | `{ strokeId, pts: [[x,y],[x,y]…] }` tọa độ 0..1 làm tròn 3 chữ số, gom theo lô 33 ms |
| `draw.stroke` | reliable | `{ strokeId, color, width, pts: [...] }` toàn bộ nét khi nhấc tay |
| `draw.undo` / `draw.clear` | reliable | `{ strokeId }` / `{}` |
| `draw.snapshot` | reliable | `{ strokes: [...] }` host gửi cho người vào giữa lượt |

Máy nhận vẽ `draw.move` ngay để mượt, và khi `draw.stroke` tới thì vẽ lại nét đó từ dữ liệu đầy đủ. Vì vậy mất vài gói lossy không làm sai bảng. Một nét 60 giây vẽ liên tục khoảng 25 KB, trong giới hạn data channel.

**Trạng thái host giữ**

```ts
interface ChalkGameState {
  activityId: string;
  settings: { rounds: number; drawSeconds: number; chalkLimited: boolean; packs: string[] };
  players: Array<{ userId: string; joinedAt: number; score: number }>;
  phase: 'lobby' | 'choosing' | 'drawing' | 'turn_end' | 'ended';
  roundIndex: number;
  turnIndex: number;
  drawerId: string | null;
  phaseEndsAt: number;             // epoch ms theo đồng hồ host
  currentWord: string | null;      // chỉ nằm ở host và người vẽ
  revealed: number[];              // chỉ số chữ đã lộ
  correctGuessers: Array<{ userId: string; at: number }>;
  usedWords: string[];
  strokes: Stroke[];
  chalkLeft: number;               // 0..1
}
```

Host ghi `snapshot` (bỏ `currentWord` và `strokes`) lên REST mỗi khi đổi phase. Người reload trang tải snapshot, rồi xin `game.state` và `draw.snapshot` qua data channel.

**Đồng hồ**: mọi `endsAt` là thời điểm theo đồng hồ host. Mỗi máy ước lượng lệch đồng hồ với host bằng `activity.tick` (host gửi `hostNow`, máy nhận tính `offset = hostNow - localNow`, làm mượt bằng trung bình 5 mẫu gần nhất). Đồng hồ đếm ngược hiển thị `endsAt - (localNow + offset)`. Sai số thực tế dưới 100 ms.

### 2.8 Tình huống biên

| Tình huống | Xử lý |
|---|---|
| Người vẽ rớt mạng giữa lượt | Host đợi 5 giây. Không về thì kết thúc lượt, không ai mất điểm, lượt chuyển người kế. |
| Host rớt mạng | Chuyển host theo 1.5. Host mới có đủ state nhờ `game.state` định kỳ, chỉ thiếu `currentWord`: lượt đang vẽ bị kết thúc sớm, công bố đáp án là "không rõ", ván tiếp tục. |
| Còn 1 người chơi | Game chuyển về sảnh, hiện "Đợi thêm bạn". |
| Người vào giữa lượt | Xem và đoán ngay, nhận `draw.snapshot`. Không được chọn làm người vẽ cho tới vòng kế. |
| Phòng kết thúc (quản lý bấm Kết thúc buổi) | Backend đặt `ended_at` cho mọi hoạt động của phòng. Client thấy `room.status` đổi thì đóng game. |
| Hai người cùng bấm tạo game | Backend trả 409 cho người sau kèm bản ghi hiện có, client tự chuyển sang Tham gia. |
| Chữ đoán tục tĩu | Lọc bằng danh sách từ cấm đơn giản ở client trước khi gửi, host lọc lại. Người bị chặn thấy "Câu đoán không được gửi". |
| Người vẽ vẽ chữ thay vì hình | Không chặn bằng máy. Ai cũng bấm được nút "Báo vẽ chữ" trên bảng. Quá nửa người đoán bấm thì lượt bị hủy, người vẽ nhận 0 điểm lượt đó. |

### 2.9 Khả năng tiếp cận

- Mọi nút có `aria-label`. Ô đoán là `input` có nhãn. Kết quả đoán dùng `aria-live="polite"`.
- Người đoán có thể gõ bằng bàn phím hoàn toàn. Người vẽ cần chuột hoặc chạm, đây là giới hạn của thể loại; có cài đặt "Tôi chỉ đoán" để không bao giờ bị xếp làm người vẽ.
- Đồng hồ ngoài vòng phấn còn hiện số rõ ràng.
- Màu phấn có tên bằng chữ khi rê chuột.

### 2.10 Cấu trúc code đề xuất

```
frontend/src/games/chalk/
  ChalkGame.tsx              // mount theo phase, nhận activity từ khung
  screens/Lobby.tsx, Choosing.tsx, Drawing.tsx, TurnEnd.tsx, Podium.tsx
  components/ChalkCanvas.tsx // Canvas 2D, nét phấn, hạt bụi, tẩy
  components/StickyScoreboard.tsx, ChalkTimer.tsx, GuessBox.tsx, ChalkMeter.tsx
  engine/hostEngine.ts       // reducer thuần, chạy ở host, có test
  engine/scoring.ts, engine/wordMask.ts, engine/levenshtein.ts
  net/protocol.ts            // kiểu message, seq, encode/decode
  net/useChalkNet.ts         // publishData / DataReceived, tách reliable và lossy
  words/*.ts
  sounds.ts
  theme.css                  // biến màu, font, texture
frontend/src/activities/
  ActivityTray.tsx, ActivityBanner.tsx, useRoomActivity.ts, activity.api.ts
backend/app/activities/      // router, service, dto
backend/db/migrations/007_room_activities.sql
```

`hostEngine.ts` là hàm thuần `(state, event) => state`, không chạm mạng, để viết test cho tính điểm, lộ chữ, chuyển lượt mà không cần LiveKit.

---

## 3. Nghe nhạc chung

### 3.1 Cơ chế Discord làm mẫu

Discord không truyền âm thanh nhạc qua đường thoại. Bot hoặc Activity giữ một **trạng thái phát chung**: bài nào, vị trí nào, đang phát hay dừng, và hàng đợi. Mỗi máy nhận trạng thái đó rồi **tự phát ở máy mình**. Vì thế nhạc không lẫn vào micro, không bị nén như giọng nói, ai cũng chỉnh được âm lượng riêng, và người nói chuyện vẫn nghe rõ nhau. Ta làm đúng mô hình này, chỉ khác là không có bot: người điều khiển, gọi là **DJ**, giữ đồng hồ.

Điều này cũng là lý do không dùng cách "bật nhạc rồi chia sẻ màn hình có âm thanh": cách đó nén nhạc qua kênh thoại, không chỉnh âm lượng riêng được, và người chia sẻ phải mở tab đó suốt.

### 3.2 Nguồn nhạc và giới hạn

| Nguồn | Cách phát ở máy người nghe | Điều khiển được | Giới hạn thật |
|---|---|---|---|
| YouTube | IFrame Player API, player hiện trong panel Nhạc, thu nhỏ thành thumbnail ở mini player | play, pause, seekTo, getCurrentTime, volume, playbackRate, sự kiện state | Điều khoản YouTube yêu cầu player hiển thị, không ẩn hẳn. Video bị chặn nhúng thì báo "Video này không cho phát ngoài YouTube". Quảng cáo xuất hiện ở từng máy và làm lệch tiến độ, sync sẽ kéo lại sau quảng cáo. |
| SoundCloud | Widget API trong iframe | play, pause, seekTo, getPosition, volume, sự kiện | Ổn định nhất cho sync. Một số bài tắt nhúng. |
| Spotify | Embed iFrame API | togglePlay, seek, loadUri, sự kiện playback_update | Người nghe không đăng nhập hoặc không Premium chỉ được **xem trước 30 giây**. Không có volume API. Ta hỗ trợ Spotify ở mức "đồng bộ tốt nhất có thể" và ghi rõ trong UI: "Cần tài khoản Spotify Premium đăng nhập trong trình duyệt để nghe trọn bài". |

Không dùng Spotify Web Playback SDK ở giai đoạn này vì cần OAuth từng người và Premium bắt buộc.

**Lấy thông tin bài hát** qua backend `POST /music/resolve { url }` để tránh CORS và giấu key:

- YouTube: `https://www.youtube.com/oembed?url=…&format=json` cho tiêu đề, kênh, thumbnail. Thời lượng cần YouTube Data API v3 `videos?part=contentDetails` với key server. Không có key thì để thời lượng trống, client lấy từ player khi tải.
- SoundCloud: `https://soundcloud.com/oembed?url=…&format=json`.
- Spotify: `https://open.spotify.com/oembed?url=…`.

Backend chuẩn hóa thành `{ provider, providerId, url, title, author, thumbnail, durationMs | null }`, cache 24 giờ theo URL.

### 3.3 Mô hình đồng bộ

Trạng thái phiên nhạc, do DJ giữ và ghi lên backend:

```ts
interface MusicSession {
  activityId: string;
  djUserId: string;
  queue: QueueItem[];            // id, track, addedBy, addedAt
  currentId: string | null;
  isPlaying: boolean;
  positionMs: number;            // vị trí tại thời điểm anchorAt
  anchorAt: number;              // epoch ms theo đồng hồ DJ
  loop: 'off' | 'one' | 'all';
  skipVotes: string[];           // userId đã bỏ phiếu bỏ qua bài hiện tại
}
```

Vị trí kỳ vọng ở bất kỳ máy nào: `expected = positionMs + (isPlaying ? (nowDJ - anchorAt) : 0)` với `nowDJ = localNow + offset` (offset lấy từ heartbeat như game).

**DJ phát gì**

| type | kênh | Khi |
|---|---|---|
| `music.state` | reliable | Mọi thay đổi: thêm bài, play, pause, seek, next, đổi DJ. Kèm toàn bộ `MusicSession` vì nó nhỏ. |
| `music.tick` | lossy | Mỗi 2 giây: `{ currentId, positionMs, anchorAt, isPlaying }` đọc từ player của DJ. Đây là thứ kéo mọi người về đúng chỗ sau quảng cáo hoặc buffer. |

**Người nghe làm gì với tick**

```
drift = localPlayerPosition - expected
|drift| < 400 ms    → không làm gì
400 ms … 2000 ms    → chỉnh tốc độ phát 1.05× hoặc 0.95× trong 3 giây (YouTube, SoundCloud hỗ trợ playbackRate)
> 2000 ms           → seekTo(expected)
```

Cách chỉnh tốc độ nhỏ tránh tiếng "nhảy" khó chịu khi lệch ít. Spotify không có playbackRate nên chỉ seek khi lệch trên 2 giây.

**Hàng đợi**: ai cũng thêm bài được. Thêm bài không cần DJ: client gọi `POST /study-rooms/{id}/music/queue`, backend ghi bảng, Supabase Realtime báo cho mọi người, DJ cập nhật `queue` trong state. Thứ tự theo `position` số thực để chèn giữa không phải đánh lại số.

**Chuyển DJ**: DJ hiện tại bấm "Trao DJ" cho người khác, hoặc DJ rớt mạng thì áp dụng luật 1.5. DJ mới tiếp tục từ `expected` của chính máy mình, nên nhạc không ngắt.

**Bỏ phiếu bỏ qua**: ai cũng bấm "Bỏ qua" được. Đủ trên 50% số người đang nghe (không tính người đã tắt nhạc) thì DJ chuyển bài. DJ và quản lý nhóm bỏ qua ngay không cần phiếu.

### 3.4 Autoplay và cử chỉ người dùng

Trình duyệt chặn phát âm thanh khi chưa có tương tác. Người vào phòng sau khi nhạc đã chạy sẽ thấy mini player ở trạng thái "Nhạc đang phát · bấm để nghe cùng" kèm nút ▶. Bấm nút là cử chỉ hợp lệ, player tải bài và seek tới `expected`. Người đã ở trong phòng khi DJ bấm phát thì đã có cử chỉ từ lúc vào call, nên tự phát được.

Mỗi người có nút **tắt nhạc riêng** (không ảnh hưởng người khác) và thanh âm lượng riêng, nhớ theo `localStorage`.

### 3.5 Giảm nhạc khi có người nói

Giống tùy chọn attenuation của Discord. Dùng `useSpeakingParticipants` của LiveKit: khi có người khác đang nói, hạ âm lượng player về 30% trong 150 ms; im 800 ms thì nâng lại trong 400 ms. Bật mặc định, tắt được trong panel Nhạc. Spotify không có volume API nên không áp dụng được, ghi chú trong UI.

### 3.6 Giao diện

**Mini player** (luôn hiện, trên dải tab sidebar):

```
┌──────────────────────────────────────────────┐
│ [thumb] Lofi hip hop radio…      ▶/❚❚  ⏭  🔊 │
│  48px   Lofi Girl · DJ: Hoàng Nam      ──●── │
│         ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬ 12:04 / 1:00:00
└──────────────────────────────────────────────┘
```

Thanh tiến độ mỏng 2px màu `#38BDF8`. Thumbnail xoay chậm như đĩa khi đang phát (tắt với reduced motion). Bấm vào phần tên bài mở tab Nhạc.

**Tab Nhạc** trong sidebar (thêm tab thứ ba `Việc | Chat | Nhạc`, tab Nhạc chỉ hiện khi có phiên nhạc hoặc khi vừa bấm Nghe chung từ khay):

```
┌──────────── Nhạc ────────────────────────────┐
│ ┌──────────────────────────────────────────┐ │
│ │        player nhúng (YouTube 16:9 /      │ │
│ │        SoundCloud 166px / Spotify 152px) │ │
│ └──────────────────────────────────────────┘ │
│ Lofi hip hop radio – beats to study          │
│ Lofi Girl · YouTube                          │
│ [◀◀] [▶ / ❚❚] [▶▶ Bỏ qua 2/4]  🔁  🔊 ──●──  │
│ ☑ Giảm nhạc khi có người nói                 │
│──────────────────────────────────────────────│
│ 🔗 [Dán link YouTube, SoundCloud, Spotify ↵] │
│──────────────────────────────────────────────│
│ Tiếp theo (3)                     DJ: Nam ⇄  │
│ ≡ [thumb] Chill Study Mix      Minh Anh  ✕   │
│ ≡ [thumb] Rainy Jazz           Thu Trang ✕   │
│ ≡ [thumb] Piano Focus          Hoàng Nam ✕   │
│──────────────────────────────────────────────│
│ Đã phát (5)                            ▾     │
└──────────────────────────────────────────────┘
```

- Nút play, pause, tua, bỏ qua trực tiếp chỉ bật với DJ và quản lý nhóm. Người khác thấy nút mờ với tooltip "Chỉ DJ điều khiển. Bấm Bỏ qua để bỏ phiếu."
- Kéo thả hàng đợi (≡) chỉ DJ. Xóa bài: người thêm bài đó hoặc DJ.
- Dán link: nhận cả link rút gọn `youtu.be`, link playlist YouTube (lấy tối đa 50 bài đầu qua Data API nếu có key, không có key thì chỉ lấy video đang chọn), link bài SoundCloud, link track Spotify. Khi đang resolve, dòng hiện skeleton. Lỗi hiện ngay dưới ô: "Không nhận ra link", "Video không cho nhúng".
- Thẻ Spotify có nhãn nhỏ "Xem trước 30s nếu chưa đăng nhập Premium".
- Nhấn Enter trong ô dán khi đang trống hàng đợi và chưa có bài: tự phát luôn.

**Thông báo trong chat**: khi ai thêm bài hoặc đổi bài, chat phòng hiện dòng hệ thống nhỏ "Hoàng Nam đã thêm *Rainy Jazz*", dùng lại kiểu dòng hệ thống nếu có, không thì chữ xám nghiêng.

### 3.7 Dữ liệu (migration 008)

```sql
create table room_music_sessions (
  activity_id uuid primary key references room_activities(id) on delete cascade,
  dj_user_id uuid not null references profiles(id),
  current_item_id uuid,
  is_playing boolean not null default false,
  position_ms integer not null default 0,
  anchor_at timestamptz not null default now(),
  loop_mode text not null default 'off' check (loop_mode in ('off','one','all')),
  updated_at timestamptz not null default now()
);
create table room_music_queue (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references room_activities(id) on delete cascade,
  position double precision not null,
  provider text not null check (provider in ('youtube','soundcloud','spotify')),
  provider_id text not null,
  url text not null,
  title text not null,
  author text,
  thumbnail_url text,
  duration_ms integer,
  added_by uuid not null references profiles(id),
  added_at timestamptz not null default now(),
  played_at timestamptz
);
create index on room_music_queue (activity_id, position);
alter publication supabase_realtime add table room_music_sessions, room_music_queue;
```

Endpoint:

| Method | Đường dẫn | Ai | Việc |
|---|---|---|---|
| POST | `/music/resolve` | đã đăng nhập | Trả metadata từ oEmbed, cache |
| GET | `/study-rooms/{id}/music` | thành viên | Session + queue để người vào sau tải |
| POST | `/study-rooms/{id}/music/queue` | thành viên | Thêm bài, backend resolve lại URL |
| DELETE | `/study-rooms/{id}/music/queue/{item}` | người thêm, DJ, quản lý | Xóa |
| PATCH | `/study-rooms/{id}/music/queue/{item}` | DJ | Đổi position |
| PATCH | `/study-rooms/{id}/music` | DJ, quản lý | Ghi `current_item_id`, `is_playing`, `position_ms`, `anchor_at`, `dj_user_id`, `loop_mode` |

DJ ghi PATCH khi đổi bài, play, pause, seek. Không ghi theo tick 2 giây để tránh spam database. Người reload lấy GET rồi chờ `music.tick` đầu tiên để seek chính xác.

### 3.8 Tình huống biên

| Tình huống | Xử lý |
|---|---|
| Video YouTube không cho nhúng | Player báo lỗi 101/150. DJ tự động chuyển bài kế, phát `music.state` kèm `skippedReason`, chat hiện "Bỏ qua *X*: không cho phát ngoài YouTube". |
| Quảng cáo YouTube ở một máy | Máy đó nhận tick thấy lệch lớn sau quảng cáo thì seek. Nếu máy DJ gặp quảng cáo, tick phản ánh vị trí dừng, mọi người dừng theo rồi chạy lại cùng DJ. Chấp nhận, ghi chú cho người dùng. |
| Người nghe ẩn tab | Trình duyệt vẫn phát âm thanh iframe ở tab nền. Tick vẫn đến qua data channel. |
| Hết hàng đợi | Dừng, mini player hiện "Hết nhạc · dán link để tiếp". Loop all thì quay đầu. |
| Hai người dán link cùng lúc | Hai hàng độc lập trong bảng, không xung đột. |
| DJ chuyển sang tab Giải lao chơi game | Không ảnh hưởng, player ở sidebar vẫn chạy. |
| Phòng kết thúc | Backend đặt `ended_at`, client dừng player, xóa iframe. |
| Link có timestamp `?t=90` | Resolve giữ `startMs`, khi phát bài lần đầu seek tới đó. |

### 3.9 Cấu trúc code đề xuất

```
frontend/src/music/
  MusicMiniPlayer.tsx, MusicPanel.tsx, QueueList.tsx, AddLinkBox.tsx
  players/PlayerAdapter.ts        // interface: load, play, pause, seek, getPosition, setVolume, setRate?, on(event)
  players/YouTubeAdapter.ts, SoundCloudAdapter.ts, SpotifyAdapter.ts
  sync/useMusicSync.ts            // DJ: phát state/tick; nghe: drift correction
  sync/clock.ts                   // offset với DJ, dùng chung với game
  ducking.ts                      // giảm nhạc khi có người nói
  music.api.ts
backend/app/music/                // resolve + queue + session
backend/db/migrations/008_room_music.sql
```

`PlayerAdapter` là lớp trừu tượng duy nhất mà `useMusicSync` biết. Thêm nguồn mới (Apple Music, Bandcamp) chỉ là viết adapter.

---

## 4. Các hoạt động nâng cao khác

Cắm vào cùng khung ở mục 1. Xếp theo giá trị trên công sức.

| Hoạt động | Mô tả ngắn | Công sức |
|---|---|---|
| **Pomodoro chung** | Một đồng hồ 25/5 cho cả phòng, host bấm, mọi người thấy cùng số. Hết 25 phút tự gợi ý "Giải lao bằng Phấn Trắng?" hoặc bật nhạc. Khi học, tự tắt nhạc nếu bật tùy chọn. | Nhỏ, 1 đến 2 ngày |
| **Bình chọn nhanh** | Câu hỏi và 2 đến 4 lựa chọn, kết quả hiện theo thời gian thực, 60 giây. Dùng để chốt "học tiếp hay nghỉ", "chọn chương nào". | Nhỏ |
| **Phản ứng bay** | Emoji bay lên từ thumbnail video người gửi, 3 giây, giống Meet. Dùng lossy channel. | Rất nhỏ |
| **Chế độ tập trung** | Một người bật thì video người khác mờ, chat ẩn, chỉ còn task của mình và đồng hồ. | Nhỏ |
| **Đố nhanh Ôn bài** | 10 câu trắc nghiệm sinh từ chủ đề nhóm, trả lời đua tốc độ như Kahoot. Dùng lại bộ sinh AI của Phấn Trắng. | Vừa, sau game 1 |
| **Xem chung video bài giảng** | Dùng lại toàn bộ cơ chế nhạc nhưng player YouTube chiếm trung tâm thay vì sidebar. Thực chất là một chế độ hiển thị của phiên nhạc. | Nhỏ sau khi có nhạc |

---

## 5. Lộ trình triển khai

Mỗi giai đoạn chạy được và demo được độc lập.

| Giai đoạn | Nội dung | Ước lượng |
|---|---|---|
| **A. Khung hoạt động** | Migration 007, router activities, khay hoạt động, banner "đang diễn ra", heartbeat, chuyển host, hook `useRoomActivity`. Test: hai tab, tắt tab host, host chuyển đúng. | 3 ngày |
| **B. Nhạc, YouTube + SoundCloud** | Migration 008, resolve, queue, `PlayerAdapter`, hai adapter, `useMusicSync` với tick và drift, mini player, tab Nhạc, vote skip, ducking. | 5 ngày |
| **C. Phấn Trắng, lõi** | `hostEngine` + test, canvas phấn, giao thức nét vẽ, sảnh, vẽ, tổng kết, bục. Bộ từ Đời sinh viên và Đồ dùng học tập. Phấn vô hạn trước. | 7 ngày |
| **D. Phấn Trắng, hoàn thiện** | Phấn có hạn, lộ chữ, đoán gần đúng, báo vẽ chữ, âm thanh, hạt bụi, mobile, reduced motion, thêm 3 bộ từ. | 4 ngày |
| **E. Ôn bài bằng AI** | Endpoint word-pack dùng `roadmap_ai_service`, màn xem trước bộ từ cho host, cache. | 2 ngày |
| **F. Spotify** | Adapter Embed iFrame API, nhãn giới hạn 30 giây, bỏ ducking cho Spotify. | 2 ngày |

Tổng khoảng 23 ngày công cho một người. Làm B trước C vì nhạc ít rủi ro, cho giá trị ngay, và dựng xong lớp đồng hồ dùng chung.

---

## 6. Quyết định cần chốt trước khi code

1. **Có cần YouTube Data API key không?** Có key thì lấy được thời lượng và playlist. Không có thì vẫn chạy, chỉ thiếu hai thứ đó. Đề xuất: bắt đầu không key, thêm sau.
2. **Spotify làm ở giai đoạn F hay bỏ hẳn?** Trải nghiệm 30 giây cho người không Premium dễ gây thất vọng. Đề xuất: vẫn làm nhưng nhãn rõ ràng, vì người dùng Việt Nam dùng Spotify nhiều.
3. **Phấn có hạn bật mặc định hay tắt?** Đề xuất: bật, vì đó là điểm nhận diện của game. Host tắt được.
4. **Ai được mở hoạt động: mọi thành viên hay chỉ quản lý?** Đề xuất: mọi thành viên, quản lý luôn có quyền dừng. Phòng kín và nhỏ, lạm dụng ít.
5. **Lưu lịch sử ván chơi để cộng vào streak nhóm không?** Đề xuất: giai đoạn sau. Hiện bảng `room_activities` đã giữ snapshot cuối nên có dữ liệu khi cần.

---

## 7. Bản triển khai thử (2026-11-15)

**Đã làm và đã thử trên hai trình duyệt thật cùng một phòng:**

| Phần | Vị trí code | Kiểm chứng |
|---|---|---|
| Migration 007, 008 | `backend/db/migrations/` | Đã chạy lên Supabase bằng `backend/scripts/apply_migration.py 007 008` |
| API hoạt động, hàng đợi nhạc, nhận diện link, bộ từ AI | `backend/app/activities/` | Gọi thử từng endpoint, kể cả các trường hợp bị từ chối quyền với thành viên thường |
| Khung hoạt động: khay, bus dữ liệu LiveKit, bầu host mới | `frontend/src/activities/` | Hai người cùng bấm tạo thì vào chung một hoạt động |
| Nghe chung YouTube + SoundCloud | `frontend/src/music/` | Hai máy lệch khoảng 0,13 giây với SoundCloud; YouTube tự kéo về từ 0,57 giây; tạm dừng đồng bộ |
| Phấn Trắng | `frontend/src/games/chalk/` | Sảnh, đổi cài đặt, chọn từ, vẽ, đoán sai, gần đúng, đoán đúng, tính điểm, đổi lượt, đóng game; 14 test cho engine |

**Khác với thiết kế hoặc chưa làm:**

- Ô đoán nằm trong màn hình game, không thay thế tab Trò chuyện của sidebar.
- Bố cục mobile của game (mục 2.5) chưa làm; màn hình hẹp vẫn dùng bố cục ba cột.
- Dải video thumbnail phía trên bảng vẽ chưa làm; bấm "Về video" để xem mặt nhau, game vẫn chạy.
- Mỗi bộ từ có 20 đến 40 từ, ít hơn mức 150 đến 300 trong thiết kế. Chưa có bộ "Phim và nhạc".
- Spotify đã có adapter nhưng chưa thử trên trình duyệt. Pomodoro và Bình chọn chỉ là thẻ "Sắp có".
- Kéo thả hàng đợi được thay bằng nút lên và xuống.
- Playlist YouTube chưa hỗ trợ, chỉ nhận từng video.

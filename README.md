# Bốc thăm cầu lông — 512 slot

Ứng dụng web tĩnh cho phép vận động viên nhập **Player ID**, bốc thăm ngẫu nhiên một slot trong nhánh 512 và theo dõi cây thi đấu cập nhật realtime. Dữ liệu được lưu trên **Firebase Realtime Database**, giao diện chạy hoàn toàn bằng HTML/CSS/JavaScript (không cần build).

## Cấu trúc

| Tệp | Mô tả |
| --- | --- |
| `index.html` | Giao diện lobby, nút bốc thăm và khung nhánh 512 slot |
| `style.css` | Toàn bộ giao diện, responsive tới 640 px |
| `app.js` | Firebase SDK, đăng nhập Player ID, transaction bốc thăm, listener realtime, zoom/pan |
| `database-init.json` | Dữ liệu khởi tạo: 512 slot (16 seed + 496 slot thường), 10 VĐV mẫu, cờ mở/đóng draw |
| `.nojekyll` | Tắt xử lý Jekyll khi deploy GitHub Pages |

## Cài đặt Firebase

### 1. Tạo project và Realtime Database

1. Vào [Firebase Console](https://console.firebase.google.com/) → **Add project**.
2. Chọn **Build → Realtime Database → Create Database**.
3. Chọn location gần người dùng (ví dụ `asia-southeast1`) và tạm chọn **Start in test mode**.

### 2. Import dữ liệu

Trong Realtime Database, mở menu **⋮ → Import JSON**, chọn `database-init.json`.

Sau khi import, dữ liệu gồm:

- `tournament_config/isDrawOpen`: `true` để mở bốc thăm, `false` để khóa.
- `available_slots/seed_slots`: 16 slot dành cho hạt giống.
- `available_slots/normal_slots`: 496 slot còn lại.
- `players/PLAYER_001` … `PLAYER_010`: danh sách VĐV mẫu.
- `bracket_results`: nơi ghi kết quả bốc thăm.

Hai pool không trùng nhau; mọi slot từ 1–512 xuất hiện đúng một lần.

### 3. Dán cấu hình web

Vào **Project settings → General → Your apps → Web app**, tạo app nếu chưa có, rồi thay khối `firebaseConfig` ở đầu `app.js` bằng cấu hình thật:

```js
const firebaseConfig = {
  apiKey: "...",
  authDomain: "...firebaseapp.com",
  databaseURL: "https://...-default-rtdb.firebaseio.com",
  projectId: "...",
  storageBucket: "...",
  messagingSenderId: "...",
  appId: "..."
};
```

> Firebase web config **không phải bí mật** (nó nằm trong mọi app web Firebase). Thứ bảo vệ dữ liệu là **Security Rules**, không phải việc giấu config. Tuyệt đối không commit service account key.

### 4. Security Rules

Rules mặc định của database mới thường là **locked mode** (chặn hết). Để chạy thử, có thể tạm dùng:

```json
{
  "rules": {
    ".read": true,
    ".write": true
  }
}
```

⚠️ **Chỉ dùng cho môi trường thử nghiệm nội bộ.** Với rules này, bất kỳ ai biết URL đều có thể sửa slot, player và bracket. Xem mục [Bảo mật](#bảo-mật) trước khi dùng cho giải thật.

### 5. Chạy local

Do dùng ES module và `fetch` của Firebase, hãy chạy qua HTTP thay vì mở `file://`:

```bash
python -m http.server 8080
```

Mở `http://localhost:8080`.

## Deploy GitHub Pages

Repo đã có sẵn nhánh `main`. Vào **Settings → Pages → Build and deployment**, chọn:

- **Source**: Deploy from a branch
- **Branch**: `main` / `/ (root)`

Site sẽ có dạng `https://<user>.github.io/boc-tham-cau-long/`. GitHub Pages thường mất vài phút cho lần build đầu.

## Cách vận hành

1. Organizer mở `tournament_config/isDrawOpen = true` khi bắt đầu bốc thăm.
2. VĐV nhập Player ID do BTC cấp (ví dụ `PLAYER_001`) và bấm **Draw my slot**.
3. Client dùng transaction trên `available_slots` để giành slot, transaction trên `players/<ID>` để chống bốc 2 lần, rồi ghi `bracket_results/slot_<n>`.
4. Mọi người đang mở trang thấy bracket cập nhật ngay qua listener realtime.
5. Khi hết giờ bốc thăm, đặt `isDrawOpen = false`; VĐV chưa bốc sẽ thấy thông báo draw đã đóng.

Seed player lấy slot từ `seed_slots`, player thường lấy từ `normal_slots`, nên hai nhóm không tranh slot của nhau.

## Bảo mật

Thiết kế hiện tại **không có xác thực người dùng**. Player ID chỉ là định danh, không phải mật khẩu; ai biết ID đều có thể thao tác thay VĐV đó nếu rules cho phép ghi. Transaction chỉ chống race condition, **không chống được client độc hại**.

Trước khi dùng cho giải chính thức, nên:

- Chuyển toàn bộ thao tác bốc thăm sang **Cloud Function / server dùng Admin SDK**, client chỉ đọc kết quả.
- Bật **Firebase Authentication** (anonymous hoặc tài khoản do BTC cấp) và viết rules theo `auth.uid`.
- Rules chỉ cho ghi đúng node của mình, kiểm tra kiểu dữ liệu, và không cho sửa `available_slots` trực tiếp.
- Khóa ghi sau khi draw đóng; giữ log/audit để BTC đối soát.

Repo này phù hợp cho giải nội bộ, demo hoặc BTC tin tưởng người tham gia. Không nên coi đây là hệ thống chống gian lận.

## Ghi chú kỹ thuật

- Firebase JS SDK v9.23.0 import từ CDN chính thức, không cần bundler.
- `database-init.json` dùng UTF-8, giữ nguyên tên tiếng Việt.
- Slot của player chưa bốc là `null`; Realtime Database bỏ qua giá trị `null` khi lưu, nên trường `slot` chỉ xuất hiện sau khi bốc thăm. Code kiểm tra `hasDrawn === true`, không phụ thuộc `slot`.
- `bracket_results` là một object phẳng `slot_1` … `slot_512`, giúp cập nhật từng slot mà không ghi đè cả cây.

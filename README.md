# Pulse — Real-Time Microblogging Engine

Pulse là hệ thống microblogging dùng Fastify, PostgreSQL và React. Các luồng chính gồm hybrid fan-out feed, hội thoại nhiều cấp, tương tác nguyên tử, tài khoản riêng tư, ActivityPub, SSE, DM và PWA.

## Stack

- Backend: Fastify 4, TypeScript, Prisma 5, PostgreSQL 16+
- Frontend: React 18, Vite 5, Tailwind CSS 3, Lucide
- Phiên đăng nhập: access token chỉ ở RAM; refresh token nằm trong cookie HttpOnly, SameSite Strict
- Thời gian thực: Server-Sent Events bằng ticket dùng một lần
- Kiểm thử: `node:test`, `node:assert/strict`, Playwright trên Chromium

## Thiết lập local

Yêu cầu Node.js 22+, PostgreSQL và `psql` trong `PATH`.

```bash
git clone <repository-url>
cd pulse

cd backend
npm ci
cp .env.example .env
npm run db:sync

cd ../frontend
npm ci
```

`npm run db:sync` là lệnh thiết lập database chuẩn. Lệnh chạy `prisma db push`, sau đó áp dụng `backend/prisma/sql/pkg11-search-vector.sql` để tạo full-text search tiếng Việt. Quy trình dừng ngay nếu một trong hai bước lỗi. Không thay bằng `prisma db push` khi thiết lập CI hoặc môi trường mới.

Seed dữ liệu phát triển là thao tác tùy chọn và sẽ thay đổi dữ liệu hiện có:

```bash
cd backend
npm run db:seed
```

## Chạy ứng dụng

```bash
# Terminal 1 — http://localhost:3001
cd backend
npm run dev

# Terminal 2 — http://localhost:5173
cd frontend
npm run dev
```

Các tài khoản và tiện ích demo chỉ xuất hiện trong development. Build production lấy feed, trending và phiên đăng nhập từ API thực.

Trong production, đặt `CORS_ALLOWED_ORIGINS` thành danh sách origin đầy đủ, phân cách bằng dấu phẩy, ví dụ `https://pulse.example.com`. Cấu hình này được dùng cho CORS có credentials và kiểm tra nguồn gốc của refresh/logout; origin chưa khai báo sẽ bị từ chối.

## Kiểm thử và build

```bash
# Backend
cd backend
npm run build
npm test

# Frontend unit/static checks
cd frontend
npm test
npm run build

# Browser tests ở 390 px, 768 px và 1440 px
npm run test:e2e
```

Mốc kiểm chứng gần nhất, ngày 2026-10-14:

- Backend: 460/460 pass trên database sạch được tạo bằng `db:sync`
- Frontend: 12/12 pass
- Browser: 21/21 pass trên ba viewport
- Initial JavaScript: 84,47 KB gzip, dưới ngân sách 100 KB

## Hợp đồng frontend quan trọng

- Feed trả về `{ posts, nextCursor, isLocked? }`.
- `ApiError` có `status` và `code`; lỗi mạng dùng code `NETWORK_ERROR`.
- Home, For You, Explore và hồ sơ phân trang theo cursor, loại ID trùng và hủy kết quả cũ khi đổi ngữ cảnh.
- Một phiên đăng nhập dùng một realtime transport; reconnect đóng stream cũ, xin ticket mới và backoff.
- URL chia sẻ bài viết là `/post/:id`.

## PWA và dữ liệu riêng tư

Service worker được gắn version theo mỗi build và cache app shell cùng static assets. Điều hướng offline hiển thị `/offline.html`. API, upload, realtime, nội dung riêng tư và DM luôn dùng mạng và không được đưa vào Cache API. Push handler hiện có vẫn được giữ.

## Roadmap ngoài đợt triển khai này

- OAuth Google/GitHub và SMTP password reset sau khi có credentials thật
- Kiểm thử Fediverse end-to-end với một instance ngoài
- Redis pub/sub, BullMQ và S3 khi có nhu cầu scale ngang hoặc lưu trữ object

Chi tiết kiến trúc nằm trong `SYSTEM_DESIGN.md`; trạng thái thực thi và số liệu kiểm chứng nằm trong [`docs/PROGRESS.md`](./docs/PROGRESS.md).

# AGENTS.md - QUY ƯỚC PHỐI HỢP & TIÊU CHUẨN KỸ THUẬT CHO BOT TEAM

Tài liệu này là quy ước làm việc chuẩn mực giữa các Bot chuyên trách trong dự án **Pulse Microblogging Engine**:
1. `backend-architect` (Tầng Server Fastify, Database PostgreSQL & Domain Services)
2. `frontend-specialist` (Tầng Client UI Vite React & TailwindCSS)
3. `qa-test-engineer` (Tầng Kiểm thử Tự động `node:test`)

---

## 1. NGUYÊN TẮC BẤT BIẾN CHUNG (GENERAL INVARIANTS)
1. **Source of Truth:** Mọi hành động lập trình phải tuân thủ nghiêm ngặt theo `SYSTEM_DESIGN.md` và `PLAN.md`.
2. **Phân ranh giới thư mục tuyệt đối:**
   * `backend-architect` chỉ làm việc trong `backend/src/`, `backend/prisma/`.
   * `frontend-specialist` chỉ làm việc trong `frontend/src/`, `frontend/public/`.
   * `qa-test-engineer` chỉ làm việc trong `backend/tests/` và đọc code để viết test.
3. **Môi trường & Cơ sở dữ liệu:**
   * Database PostgreSQL: `postgresql://postgres@localhost:5432/pulse_social?schema=public` (chạy trên local machine với user `postgres`).
   * Backend Port: `http://localhost:3001` (Fastify).
   * Frontend Port: `http://localhost:5173` (Vite).
4. **Kiểm thử Native Zero-Config:**
   * Chạy test bằng `node --test tests/*.test.mjs` với `node:assert/strict`.

---

## 2. QUY ƯỚC DÀNH CHO `backend-architect`
1. **Zero-Trust Client Payload:** Mọi dữ liệu gửi lên (bài viết, tương tác, follow, block) phải được validate chặt chẽ ở Controller trước khi xử lý.
2. **Intent-Driven File Naming:** Đặt tên file và class theo đúng chức năng và vai trò cụ thể:
   * Ví dụ: `PublishPostService.ts`, `ToggleLikeService.ts`, `BlockUserService.ts`, `HybridFeedTimelineService.ts`.
3. **Atomic Transactions:** Mọi thao tác làm thay đổi nhiều bảng (ví dụ: Block user, Like/Unlike cập nhật counter, Fan-out inbox) bắt buộc phải bọc trong `prisma.$transaction`.
4. **API Response Contract:** Luôn trả về định dạng JSON thống nhất:
   `{ "success": true, "data": ... }` hoặc `{ "success": false, "error": { "code": "...", "message": "..." } }`.
5. **Real-time SSE:** Cung cấp route SSE `/api/v1/realtime/stream` chuẩn HTTP Server-Sent Events với header `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`.

---

## 3. QUY ƯỚC DÀNH CHO `frontend-specialist`
1. **Design Theme:** Giao diện tối giản chuẩn phong cách Threads (hiện hành: Threads Paper White `#fafafa`, viền `#d5d5d5`, text `#000000`) và sẵn sàng mở rộng Dark/OLED/System Switcher theo lộ trình `improve.md` (PKG-02).
2. **Interactive Optimistic UI & Toast Feedback:**
   * Thao tác Like/Unlike và Repost phản hồi ngay lập tức trên giao diện (Optimistic update), nếu server lỗi thì rollback.
   * Nút bấm có trạng thái loading/disabled để chống bấm liên tiếp (double-submit).
3. **Threaded Conversation Layout:**
   * Hiển thị đường nối mạch hội thoại (vertical connecting line) giữa các bài viết cha và con giống Threads.
4. **Live Feed Indicator:**
   * Lắng nghe SSE từ server. Khi có bài viết mới đẩy vào timeline, hiển thị thanh badge trên đầu feed: *"Có bài viết mới - Nhấn để xem"* chứ không tự động giật màn hình của người dùng.

---

## 4. QUY ƯỚC DÀNH CHO `qa-test-engineer`
1. **Test Runner:** Sử dụng `node --test` và `node:assert/strict`.
2. **Phạm vi kiểm thử cốt lõi:**
   * `feed-hybrid-fanout.test.mjs`: Test đẩy bài tài khoản thường vào inbox, và merge bài celebrity khi đọc feed.
   * `concurrency-atomic-likes.test.mjs`: Test concurrency 50 parallel requests like/unlike đảm bảo `likesCount` chuẩn xác 100%.
   * `social-graph-block-invariants.test.mjs`: Test toàn bộ logic 2-way unfollow, feed cleanup, và 404/hide khi bị block.
   * `conversation-thread.test.mjs`: Test chuỗi reply 3 cấp và truy vấn thread trong 1 query.
   * `notification-aggregation.test.mjs`: Test gom nhóm thông báo nhiều like trong 24h.

# TÀI LIỆU QUẢN LÝ KHOẢNG TRỐNG & CẢI TIẾN HỆ THỐNG: PULSE (improve.md)

**Dự án:** Pulse Microblogging Engine  
**Kiến trúc sư & Chỉ huy:** Tech Lead, System Architect & Deep Researcher  
**Trạng thái:** Bản thảo đề xuất cải tiến (Proposed Improvement Specification)  
**Mục tiêu:** Nâng cấp Pulse từ Microblogging Engine MVP thành Nền tảng Mạng xã hội phân tán cấp Thương mại (Production-Grade & Consumer-Ready).

---

## 1. TỔNG QUAN HIỆN TRẠNG & ĐÁNH GIÁ KHOẢNG TRỐNG (EXECUTIVE SUMMARY)

Hệ thống Pulse hiện tại đã hoàn thiện xuất sắc các bài toán kiến trúc lõi:
- ✅ **Hybrid Fan-out Timeline:** Kết hợp Fan-out on Write và Fan-out on Read với thuật toán K-way Merge.
- ✅ **Toàn vẹn Dữ liệu & Concurrency:** PostgreSQL Atomic Updates, chống race conditions khi hàng ngàn lượt tương tác đồng thời.
- ✅ **Two-Way Social Graph & Block Invariants:** Giao dịch nguyên tử bảo vệ quyền riêng tư 2 chiều.
- ✅ **W3C ActivityPub & Fediverse Deepening:** WebFinger (RFC 7033), Dual Actor profiles, HTTP Signatures (draft-cavage-12), SSRF Guard, NodeInfo 2.1, Inbound/Outbound Federation.
- ✅ **Trust, Safety & Lifecycle:** Cửa sổ sửa bài 15 phút, audit trail `PostVersion`, ghim bài, tắt tiếng (Mute user/keyword), Content Warning (CW).
- ✅ **Algorithmic Feed & Real-Time Comms:** Bảng tin "Dành cho bạn" (Heuristic Gravity), bộ đệm đếm lượt xem ghi sau, Group DMs, Web Push VAPID (RFC 8030/8292).
- ✅ **Chất lượng kiểm thử:** 476/476 automated tests pass 100% (`node:test`).

**Tuy nhiên, xét trên góc độ sản phẩm thực tế (Consumer-Ready Social App), Pulse vẫn còn những khoảng trống lớn (Gaps)** cần được bổ sung để đạt độ hoàn thiện tương đương các nền tảng như Threads, X/Twitter hay Bluesky.

---

## 2. BẢNG MA TRẬN PHÂN LOẠI & ĐỘ ƯU TIÊN (IMPROVEMENT MATRIX)

| Mã Gói | Tên Hạng Mục Cải Tiến | Mức Độ Ưu Tiên | Phạm Vi Ảnh Hưởng | Độ Khó Kỹ Thuật |
| :--- | :--- | :---: | :--- | :---: |
| **PKG-01** | **OpenGraph Link Previews & Rich Media** | **P0 (Cực cao)** | Backend Scraper, Frontend Card, Cache | Vừa |
| **PKG-02** | **Dark / Light / System Theme Switcher** | **P0 (Cực cao)** | Frontend CSS/Tailwind, Context, LocalStorage | Thấp |
| **PKG-03** | **Trang Bookmarks Độc Lập & Post Drafts** | **P1 (Cao)** | Frontend Views, Sidebar, LocalStorage/API | Thấp - Vừa |
| **PKG-04** | **Content Moderation & Report System** | **P1 (Cao)** | Prisma Schema, Backend API, Admin Dashboard | Vừa |
| **PKG-05** | **Real-Time DM Polish (Typing & Reactions)** | **P1 (Cao)** | SSE Gateway, Prisma Schema, DmChatWindow | Vừa - Cao |
| **PKG-06** | **Production Auth (OAuth2 & Password Reset)** | **P2 (Trung bình)**| Fastify Auth, OAuth2 Providers, Mailer Service | Vừa |
| **PKG-07** | **Media Storage S3/R2 & Anti-Spam Guard** | **P2 (Trung bình)**| Media Pipeline, Redis Rate-limiting, Worker | Cao |

---

## 3. CHI TIẾT CÁC HẠNG MỤC CẦN BỔ SUNG

### 3.1. [PKG-01] OpenGraph Link Previews & Rich Media Pipeline
* **Vấn đề hiện tại:** Khi người dùng dán đường dẫn (link YouTube, báo chí, blog, GitHub repo) vào bài viết, hệ thống chỉ hiển thị dạng văn bản thuần thô, không trực quan.
* **Yêu cầu bổ sung:**
  1. **Backend Scraper Service (`FetchOpenGraphMetadataService.ts`):**
     - Trích xuất metadata OpenGraph / Twitter Cards từ URL trong nội dung: `og:title`, `og:description`, `og:image`, `og:site_name`, `theme-color`.
     - **Bảo vệ SSRF Guard:** Tái sử dụng `SsrfProtectionGuardService` để tuyệt đối chặn cào link nội bộ, loopback (127.0.0.1) hoặc AWS/GCP metadata.
     - Caching metadata trong DB hoặc RAM với TTL 24h để tránh cào lại cùng một URL nhiều lần.
  2. **Frontend Link Preview Card (`LinkPreviewCard.tsx`):**
     - Hiển thị card xem trước dạng nhúng: Ảnh thumbnail bo góc, tên miền trang web (`domain.com`), tiêu đề in đậm, mô tả ngắn gọn.
     - Hỗ trợ fallback gọn gàng khi URL không có thẻ OG.
  3. **Multi-Image Grid Support:**
     - Cho phép tải lên tối đa 4 ảnh / bài viết.
     - Layout lưới hiển thị thông minh: 1 ảnh (full width), 2 ảnh (50/50), 3 ảnh (1 to, 2 nhỏ xếp dọc), 4 ảnh (2x2 grid).

---

### 3.2. [PKG-02] Dark / Light / System Theme Switcher
* **Vấn đề hiện tại:** Hệ thống đang bị hardcode cố định giao diện `Threads Light Theme` (`#fafafa`). Người dùng lướt ban đêm hoặc thích giao diện đen tuyền (OLED Black) của Threads/X không thể chuyển đổi.
* **Yêu cầu bổ sung:**
  1. **Theme Engine (`ThemeContext.tsx`):**
     - Hỗ trợ 3 chế độ: `Light` (Giấy báo hiện tại), `Dark` (Xám đen `#121212`), `Black` (OLED `#000000`), và `System` (đồng bộ theo `prefers-color-scheme` của OS).
     - Lưu trạng thái vào `localStorage` và áp dụng class `dark` trên thẻ `<html>` không bị chớp trắng (FOUC).
  2. **Palette Token Standardization:**
     - Chuẩn hóa màu sắc qua biến CSS hoặc Tailwind semantic classes: `bg-canvas`, `bg-card`, `text-primary`, `text-secondary`, `border-divider`.
  3. **Theme Switcher Dropdown:**
     - Bổ sung nút chuyển theme nhanh trên `NavigationSidebar` và trong menu Cài đặt cá nhân.

---

### 3.3. [PKG-03] Trang Bookmarks Độc Lập & Bộ Nhớ Tạm Post Drafts
* **Vấn đề hiện tại:** 
  - Nút Bookmark và model `Bookmark` đã có trong database, nhưng chưa có trang/mục riêng trên Sidebar để người dùng xem lại kho bài đã lưu.
  - Người dùng đang gõ một bài viết dài hoặc chuỗi hội thoại mà lỡ đóng tab hoặc chuyển view sẽ mất toàn bộ nội dung.
* **Yêu cầu bổ sung:**
  1. **Trang Bookmarks Chuyên Biệt (`BookmarksView.tsx`):**
     - Bổ sung mục "Đã lưu" trực tiếp trên thanh điều hướng chính (`NavigationSidebar`).
     - Giao diện danh sách bài viết đã lưu kèm tính năng lọc nhanh theo hashtag hoặc người viết.
  2. **Hệ thống Lưu Nháp Bài Viết (Post Drafts):**
     - Tự động lưu nội dung đang soạn thảo (text, mediaUrls, poll choices, CW) vào `localStorage` sau mỗi 1 giây (Autosave).
     - Nút "Lưu bài nháp" và modal xem lại danh sách các bài nháp cũ để tiếp tục chỉnh sửa hoặc xóa.

---

### 3.4. [PKG-04] Content Moderation, Reporting & Trust System
* **Vấn đề hiện tại:** Mới chỉ có cơ chế bảo vệ cục bộ giữa 2 người (Block 2 chiều, Mute 1 chiều). Chưa có cơ chế phát hiện và xử lý nội dung độc hại, lừa đảo, spam ở cấp độ nền tảng.
* **Yêu cầu bổ sung:**
  1. **Data Model Báo Cáo Vi Phạm:**
     - Bảng `Report` trong Prisma: `id`, `reporterId`, `targetType` (POST / USER / DM_MESSAGE), `targetId`, `reason` (SPAM, HARASSMENT, HATE_SPEECH, MISINFORMATION, COPYRIGHT, OTHER), `details`, `status` (PENDING, RESOLVED, DISMISSED), `reviewedById`, `actionTaken`.
  2. **API & Workflow Kiểm Duyệt:**
     - Endpoint cho người dùng: `POST /api/v1/reports`.
     - Endpoint quản trị (Admin/Moderator): `GET /api/v1/admin/reports`, `PATCH /api/v1/admin/reports/:id/resolve`.
     - Quyền xử lý: Gỡ bài viết (`isDeleted: true`), cảnh cáo tài khoản, đình chỉ tài khoản tạm thời / vĩnh viễn (`isSuspended: true`).
  3. **Giao diện Báo Cáo & Moderation Dashboard:**
     - Nút "Báo cáo bài viết" trong menu 3 chấm (`PostFeedItem.tsx`).
     - Giao diện Admin Console (`ModerationCenterView.tsx`) dành riêng cho tài khoản có role `ADMIN` để duyệt hàng đợi báo cáo.

---

### 3.5. [PKG-05] Real-Time Direct Messaging Polish (Typing & Reactions)
* **Vấn đề hiện tại:** Group DM và 1-1 DM đã hoạt động với SSE và phân trang, nhưng giao diện chat còn thô, thiếu các tương tác vi mô quen thuộc của ứng dụng nhắn tin hiện đại.
* **Yêu cầu bổ sung:**
  1. **Chỉ Báo Đang Soạn Tin Nhắn (Typing Indicator):**
     - Khi người dùng bắt đầu gõ trong khung chat, gửi heartbeat `POST /api/v1/dm/conversations/:id/typing`.
     - Broadcast qua SSE event `dm.typing`: `{ conversationId, userId, username }`.
     - Giao diện client hiển thị bong bóng animation ba chấm: *"Alice đang soạn tin..."* và tự biến mất sau 3 giây không có thao tác.
  2. **Thả Cảm Xúc Tin Nhắn (Message Emoji Reactions):**
     - Bảng `DmReaction` / `GroupDmReaction`: `messageId`, `userId`, `emoji` (👍, ❤️, 😂, 😮, 😢, 🔥).
     - Cho phép click icon cảm xúc trên từng bong bóng tin nhắn, cập nhật tức thì (Optimistic UI).
  3. **Đính Kèm Ảnh Trong Khung Chat:**
     - Tích hợp nút chọn ảnh và dán ảnh trực tiếp từ clipboard vào khung nhập tin nhắn DM.

---

### 3.6. [PKG-06] Production Authentication & Account Management
* **Vấn đề hiện tại:** Vẫn đang phụ thuộc song song vào `Demo User Switcher` và JWT cơ bản. Chưa có luồng lấy lại mật khẩu và chưa hỗ trợ đăng nhập mạng xã hội.
* **Yêu cầu bổ sung:**
  1. **OAuth 2.0 / Social Login:**
     - Tích hợp đăng nhập nhanh qua Google (`Google OAuth 2.0`) và GitHub.
  2. **Quên & Đặt Lại Mật Khẩu (Password Reset Flow):**
     - `POST /api/v1/auth/forgot-password`: Sinh token OTP có hạn 15 phút.
     - `POST /api/v1/auth/reset-password`: Đặt mật khẩu mới kèm xác thực token.
  3. **Quản Lý Phiên Đăng Nhập (Active Sessions):**
     - Bảng `UserSession`: Lưu User-Agent, IP, thời gian đăng nhập gần nhất.
     - Cho phép người dùng xem danh sách thiết bị đang đăng nhập và bấm "Đăng xuất khỏi tất cả thiết bị khác".

---

### 3.7. [PKG-07] Scalability, Media Storage & Anti-Spam Infrastructure
* **Vấn đề hiện tại:** 
  - Ảnh tải lên hiện lưu trực tiếp trên ổ cứng local của server (`pulse/backend/uploads`).
  - Hàng đợi fan-out và outbox chạy in-process, chưa phân tán qua cụm Redis chuyên dụng.
* **Yêu cầu bổ sung:**
  1. **S3-Compatible Cloud Storage Adapter:**
     - Hỗ trợ lưu trữ file media trên AWS S3 / Cloudflare R2 / MinIO qua cấu hình ENV (`STORAGE_DRIVER=local|s3`).
     - Tự động nén ảnh thumbnail WebP để tối ưu băng thông.
  2. **Rate Limiting & Anti-Spam Guard:**
     - Giới hạn tần suất đăng bài (ví dụ: tối đa 10 bài/phút/tài khoản).
     - Ngăn chặn bot cào dữ liệu và spam comment phá vỡ trải nghiệm người dùng.

---

## 4. LỘ TRÌNH TRIỂN KHAI ĐỀ XUẤT (ACTION ROADMAP)

Dựa trên nguyên tắc tối đa hóa giá trị sản phẩm và trải nghiệm người dùng:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            PHASED ROADMAP PROPOSAL                          │
├─────────────────────────────────────────────────────────────────────────────┤
│ GIAI ĐOẠN 1 (P0 - Cấp bách nhất): Nâng tầm Trực quan & Trải nghiệm Đọc     │
│  👉 [PKG-01] OpenGraph Link Previews & Multi-image Layout                   │
│  👉 [PKG-02] Dark / Light / OLED / System Theme Switcher                    │
│                                                                             │
│ GIAI ĐOẠN 2 (P1 - Tính năng Xã hội cốt lõi): Tiện ích & Tin cậy            │
│  👉 [PKG-03] Trang Bookmarks độc lập & Post Drafts Autosave                 │
│  👉 [PKG-04] Báo cáo vi phạm (Report System) & Moderation Queue             │
│                                                                             │
│ GIAI ĐOẠN 3 (P1/P2 - Tương tác Realtime & Hoàn thiện Auth):                 │
│  👉 [PKG-05] Typing Indicator & Message Reactions cho Direct Messages       │
│  👉 [PKG-06] OAuth2 Social Login & Password Reset Flow                      │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

*Tài liệu này là căn cứ kỹ thuật chính thức để Tech Lead và Chủ nhân lựa chọn gói tính năng triển khai tiếp theo.*

> **Cập nhật 2026-10-01:** Bản kế hoạch thực thi chi tiết — gồm các gói trên, hạng mục bổ sung (PKG-08 Router, PKG-09 Media v2, PKG-10 Account Lifecycle, PKG-11 Full-text Search, PKG-12 PWA, PKG-13→16 chiến lược) và lộ trình Hardening Week (SEC-01→06) — được soạn tại `IMPROVEMENT_PLAN_V2.md`. Khi được phê duyệt, tài liệu đó là nguồn trạng thái thực thi duy nhất.

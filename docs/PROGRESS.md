# PROGRESS — PULSE

> Cập nhật: 2026-10-14. Đây là trạng thái code và kiểm chứng local; chưa xác nhận deployment thật.

## Snapshot

| Chỉ số | Kết quả đã kiểm chứng |
|---|---:|
| Backend | 462/462 pass trên PostgreSQL sạch |
| ActivityPub lặp riêng | 5 vòng × 40/40 pass |
| Frontend module tests | 12/12 pass |
| Browser tests | 21/21 pass, 7 kịch bản × 3 viewport |
| Initial JS production | 84,47 KB gzip |
| Production demo string scan | Không thấy mật khẩu/nút/tài khoản demo trong `dist` |

## Hoàn thành trong đợt cải thiện

### Dữ liệu và backend

- [x] Trending tôn trọng trạng thái bài viết, quyền riêng tư và trạng thái tài khoản.
- [x] Test đổi quyền riêng tư và xóa bài xác nhận hashtag được thêm/bỏ ngay.
- [x] `db:sync` chạy schema push và SQL full-text search tiếng Việt theo fail-fast.
- [x] CI dùng `db:sync`; không còn bước `prisma db push` độc lập làm mất `search_vector`.
- [x] ActivityPub outbox test cô lập dữ liệu và worker; sửa clock skew của job mới.
- [x] Có endpoint Explore phân trang cùng hợp đồng feed hiện hữu.

### Phiên đăng nhập, realtime và API

- [x] Access token chỉ ở RAM; xóa khóa cũ trong `localStorage`.
- [x] Khởi động app chờ refresh cookie bootstrap; 401 đưa về guest, lỗi mạng có màn hình retry riêng.
- [x] `ApiError` công khai `status` và `code`; lỗi mạng là `NETWORK_ERROR`.
- [x] Một realtime transport dùng chung cho mỗi account; reconnect xin ticket mới, backoff và cleanup khi logout/account switch.
- [x] API được tách `core`, `FeedApi`, `RealtimeClient`; façade cũ vẫn hoạt động.

### Luồng frontend

- [x] Home/For You/Explore/profile phân trang theo cursor bằng IntersectionObserver.
- [x] Chống request song song, loại post ID trùng, bỏ response cũ khi tab/account thay đổi và lưu scroll theo view.
- [x] Có trạng thái tải, hết dữ liệu, lỗi và thử lại.
- [x] Trending dùng API thật; production không hiển thị dữ liệu hoặc account switcher demo.
- [x] Link chia sẻ là `/post/:id`.
- [x] Like/Repost optimistic, disable khi gửi, rollback ở feed và conversation.

### UI, accessibility, hiệu năng và PWA

- [x] Mobile navigation có hồ sơ và Theme Switcher.
- [x] Light/Dark/OLED/System dùng token semantic; không còn màu hex/gray cố định trong `frontend/src`.
- [x] Modal có focus trap, Escape, initial focus và focus restore; toast có live region; có reduced motion/focus-visible.
- [x] Route lazy loading và contexts Auth/UI/Realtime riêng.
- [x] Initial JS giảm từ mốc 123,4 KB xuống 84,47 KB gzip.
- [x] Service worker version theo build, offline shell rõ ràng, API/private/DM network-only và giữ Web Push.

## Kiểm chứng còn phải chạy trước khi đóng đợt

- [x] Playwright 21/21, gồm lỗi feed/retry và phân trang trên mọi feed chính.
- [x] Chạy lại backend build và toàn bộ 462 tests trên code cuối.
- [x] `git diff --check` và audit yêu cầu theo từng bullet.

## Roadmap ngoài phạm vi

- [ ] OAuth Google/GitHub và SMTP password reset: chờ credentials.
- [ ] Fediverse end-to-end: cần instance ngoài, public URL và TLS.
- [ ] Redis pub/sub, BullMQ và S3: chỉ triển khai khi có nhu cầu scale.
- [ ] Deployment production: kiểm chứng riêng khi có hosting configuration.

## Lệnh chuẩn

```bash
cd backend
npm run db:sync
npm run build
npm test

cd ../frontend
npm test
npm run build
npm run test:e2e
```

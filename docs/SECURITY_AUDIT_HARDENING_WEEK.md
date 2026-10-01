# SECURITY AUDIT: HARDENING WEEK (IMPROVEMENT_PLAN_V2 — GĐ 1)

**Phạm vi:** SEC-01 → SEC-06 theo `IMPROVEMENT_PLAN_V2.md`
**Thực hiện:** 2026-10-01 | **Trạng thái:** ✅ HOÀN THÀNH — 431/431 backend + 174/174 frontend tests PASS

---

## 1. Tổng quan các lỗ hổng đã niêm phong

| Mã | Lỗ hổng | Mức độ | Trạng thái |
|---|---|---|---|
| SEC-01 | SSE stream không xác thực — ai cũng nghe được stream thông báo/DM của người khác qua `x-user-id`/`?userId=` | 🔴 Critical | ✅ Đã vá (one-time ticket) |
| SEC-02 | Kênh tự định danh `x-user-id` — spoof identity toàn hệ thống (dev-gated nhưng client gửi mọi request) | 🔴 Critical | ✅ Đã xóa hoàn toàn |
| SEC-03 | Secret hardcode (`pulse-secret-key-2026-production-token`) — JWT forge mọi identity | 🔴 Critical | ✅ Fail-fast |
| SEC-04 | VAPID keypair sinh in-memory — mất toàn bộ push subscription mỗi restart | 🟠 High | ✅ Persist ENV |
| SEC-05 | Zero rate limiting — spam đăng ký/đăng nhập/publish/upload không bị chặn | 🟠 High | ✅ @fastify/rate-limit |
| SEC-06 | Dữ liệu demo/credential trong bundle production | 🟡 Medium | ✅ Dev-gated + constant-folded |

## 2. Chi tiết kiểm chứng

### SEC-01 — SSE One-Time Ticket
- `POST /api/v1/realtime/ticket` (JWT bắt buộc) → ticket `crypto.randomBytes(32)` base64url, TTL 30s, **single-use**.
- `GET /realtime/stream?ticket=` chỉ nhận ticket hợp lệ; thiếu/sai/hết hạn/replay → **401 trước khi hijack** response.
- Header `x-user-id` và query `?userId=` không còn giá trị xác thực nào.
- Tests: `realtime-sse-auth.test.mjs` (6 cases: 401 các nhánh + single-use + expired + handshake bind đúng user).

### SEC-02 — Xóa kênh x-user-id
- Backend preHandler chỉ đọc Bearer JWT; CORS loại header `x-user-id`.
- 420+ chỗ trong tests chuyển sang `tests/helpers/auth.mjs` (mint JWT thật).
- Frontend gỡ 5 điểm gửi header; Demo User Switcher giờ **đăng nhập thật** qua `/auth/login` bằng password seed chung (`PulseDemo2026!`, chỉ cho 4 user demo local).
- `seed.mjs` thêm `passwordHash`; `scripts/set-demo-passwords.mjs` idempotent cho DB hiện có.
- ⚠️ **Ghi chú vận hành:** DB local hiện không có 4 user demo (9182 users là dữ liệu test). Chạy `npm run db:seed` (có wipe) hoặc tạo thủ công nếu muốn dùng switcher.

### SEC-03 — Secrets fail-fast
- `src/config/Secrets.ts`: thiếu `JWT_SECRET`/`COOKIE_SECRET`/`VAPID_*` → `MissingSecretError` ngay khi `buildApp()`, không boot.
- Quét dist: **0** chuỗi secret cũ còn sót (test tự động kiểm tra mỗi lần chạy).
- `.env.example` hướng dẫn sinh secret; `.env` local đã cập nhật (không commit).

### SEC-04 — VAPID persist
- Keypair nạp từ ENV (PEM hoặc base64 1 dòng); key ổn định giữa các restart → không orphan subscription.
- `scripts/generate-vapid-keys.mjs` sinh key. Test xác minh key giống hệt giữa 2 lần khởi tạo.

### SEC-05 — Rate limiting
- Global 300 req/phút/IP; bucket nghiêm ngặt: login/register 10/phút/IP, refresh 30/phút/IP, publish 20/phút/**user**, upload 20/giờ.
- 429 trả đúng envelope chuẩn `{ success:false, error:{ code:'RATE_LIMITED' } }` (qua Error object đưa vào error pipeline tập trung).
- `RATE_LIMIT_DISABLED=1` chỉ trong test preload; suite `rate-limiting.test.mjs` tự bật để kiểm chứng 4 nhánh.

### SEC-06 — Prod bundle sạch
- `PRESET_USERS`, mock feed, mock notifications, UI demo switcher: chỉ tồn tại khi `import.meta.env.DEV`.
- Constant-folded khỏi bundle (esbuild): **0** chuỗi `PulseDemo2026`/`sontungmtp`/`hoa_dev`/`Alice Nguyễn`/`mock-post-1` trong `dist/assets/*.js` (đã kiểm chứng bằng grep sau build).

## 3. Rủi ro tồn dư & khuyến nghị

1. **EventSource auto-reconnect:** khi SSE đứt, reconnect tự động sẽ 401 (ticket đã consume) — client nhận `onerror` và re-subscribe qua context lifecycle. Nếu thấy sót kết nối zombie, cân nhắc logic retry có backoff ở frontend.
2. **Legacy root routes:** ~59 route legacy ở root dùng global limiter (không có bucket riêng như bản `/api/v1`). INF-02 sẽ gộp chúng — khi đó chỉ giữ prefix `/api/v1` là chuẩn.
3. **Demo password trong môi trường chia sẻ:** chỉ seed 4 user demo trên máy dev; cấm chạy `db:seed` trên production.
4. **Rate limit in-memory:** đủ cho 1 instance; khi scale ngang (PKG-16) chuyển store sang Redis.
5. **`x-client-timestamp`/`Date` header:** đã có test xác nhận server luôn dùng thời gian server cho edit-window (client không bypass được).

## 4. Số liệu nghiệm thu

- Backend: **431/431 PASS** (24.4s, gồm 6 test SEC-01 mới, 5 test SEC-03/04, 5 test SEC-05).
- Frontend: **174/174 PASS** (0.2s).
- `tsc --noEmit`: sạch cả hai package.
- Prod build: sạch dữ liệu demo (đã kiểm chứng grep).

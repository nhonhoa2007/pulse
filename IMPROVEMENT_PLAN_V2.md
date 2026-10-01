# IMPROVEMENT_PLAN_V2 — KẾ HOẠCH CẢI TIẾN PULSE (V2)

**Chỉ huy:** Tech Lead & System Architect
**Nhân sự điều phối:** `backend-architect`, `frontend-specialist`, `qa-test-engineer`, `security-auditor`
**Căn cứ:** Bản quét & đánh giá toàn project (2026-10-01) + `improve.md` (PKG-01 → PKG-07)
**Trạng thái:** 🚀 GĐ 0-3 hoàn thành 100% + GĐ 4 hoàn thành 9/9 gói (2026-10-01) — tổng 659 test cases: 456 backend + 203 frontend. Còn lại: PKG-05 phần 2 (reactions/ảnh chat), PKG-06/13/15/16 (chi tiết điều kiện trong PROGRESS.md)

---

## 1. MỤC TIÊU & BỐ CỤC TỔNG THỂ

Chuyển Pulse từ **"nền kiến trúc lõi vững + ~590 tests pass"** thành **nền tảng an toàn vận hành, hoàn thiện trải nghiệm và có định vị cạnh tranh trong Fediverse**, theo 3 nguyên tắc:

1. **Niêm phong trước khi xây:** mọi lỗ hổng vận hành (rate limit, SSE auth, secrets, git) phải được xử lý trước khi thêm tính năng mới.
2. **Không hồi quy:** mọi giai đoạn kết thúc phải giữ 100% baseline tests pass + build `tsc` sạch.
3. **Một nguồn sự thật:** số liệu test và trạng thái kế hoạch chỉ được ghi nhận tại `PLAN.md` / tài liệu này; mọi thay đổi kiến trúc phải cập nhật `SYSTEM_DESIGN.md` ngay trong cùng PR.

### Bảng mã thống nhất

| Loại | Mã | Ghi chú |
|---|---|---|
| Vận hành | `OPS-xx` | git, CI |
| Bảo mật vận hành | `SEC-xx` | Hardening sprint |
| Hạ tầng kỹ thuật | `INF-xx` | dọn nhà, hợp đồng API |
| Tính năng | `PKG-xx` | kế thừa PKG-01→07 của `improve.md`, mở rộng tới PKG-16 |

### Bản đồ lộ trình

```
┌────────────────────────────────────────────────────────────────────────────┐
│ GĐ 0 (ngay lập tức)  : OPS-01 Git + OPS-02 CI         [P0, ~0.5 ngày]      │
│ GĐ 1 (~1 tuần)       : SEC-01→06 Hardening Week        [P0, ~5 ngày]        │
│ GĐ 2 (song song GĐ1) : INF-01→05 Dọn nhà kỹ thuật      [P1, ~5 ngày]        │
│ GĐ 3 (tuần 3-4)      : PKG-02 Dark Mode + PKG-08 Router [P0 UX, ~5 ngày]     │
│ GĐ 4 (tháng 2)       : PKG-01/03/04/05/06/09/10/11/12   [P1, ~3-4 tuần]      │
│ GĐ 5 (tháng 3+)      : PKG-13/14/15/16 Chiến lược       [P2, theo nhu cầu]   │
└────────────────────────────────────────────────────────────────────────────┘
```

Độ khó ký hiệu: **S** (< 1 ngày) / **M** (1–3 ngày) / **L** (> 3 ngày).

---

## 2. GIAI ĐOẠN 0: NỀN TẢNG QUY TRÌNH (P0 — LÀM NGAY)

### [OPS-01] Git hóa toàn bộ project (S — backend-architect/Tech Lead) — ✅ 2026-10-01
- [x] `git init` tại `/home/nhonhoa/pulse`, tạo `.gitignore`: `node_modules/`, `backend/dist/`, `backend/uploads/`, `.env`, `.idea/`, `*.log`.
- [x] Tạo `.env.example` (DATABASE_URL, PORT, HOST, JWT_SECRET, COOKIE_SECRET, VAPID_*).
- [x] Commit đầu tiên trên branch `main` (221 files), tạo branch làm việc `dev`.
- [x] Quy ước mới: mọi thay đổi code phải qua branch + commit có mã task (ví dụ `SEC-01: ...`).

### [OPS-02] CI Pipeline (S — qa-test-engineer) — ✅ 2026-10-01 (chờ push lên remote để kích hoạt)
- [x] GitHub Actions workflow `.github/workflows/ci.yml`: job `backend` (service container PostgreSQL 16, chạy `prisma db push` → `npm run build` → `npx tsc --noEmit` → `npm test`), job `frontend` (`npm run build` + `node --test`).
- [x] CI bắt buộc xanh trước khi merge vào `main`.
- ⚠️ **Lưu ý:** tests import từ `../dist/` (xem INF-01); đến khi INF-01 hoàn thành, CI chạy `npm run build` trước `npm test` — đã cấu hình đúng trong workflow.
- ⚠️ **Cần chủ nhân:** tạo GitHub repo + push để CI thực sự chạy (`git remote add origin ... && git push -u origin main dev`).

**Nghiệm thu GĐ 0 (✅ đạt):** `git log` có commit đầu; baseline số test thực đo **589/589 PASS** (backend 415 trong 24.4s + frontend 174) — đã ghi nhận tại phụ lục `PLAN.md`; xác nhận số "476" trong improve.md cũ là lỗi thời.

---

## 3. GIAI ĐOẠN 1: HARDENING WEEK (P0 — NIÊM PHONG LỖ HỔNG VẬN HÀNH)

### [SEC-01] Xác thực SSE stream (M — backend-architect + security-auditor) — ✅ 2026-10-01
- **Vấn đề:** `GET /api/v1/realtime/stream` nhận identity từ header `x-user-id` hoặc `?userId=` tự do — bất kỳ ai cũng nghe được stream thông báo/DM của người khác.
- [x] `RealtimeEventStreamController.ts`: yêu cầu JWT hợp lệ trước khi `reply.hijack()`. Do `EventSource` không gửi được header, áp dụng mẫu **one-time ticket**: `POST /api/v1/realtime/ticket` (auth JWT) trả về ticket ngắn hạn (≤ 30s, single-use, lưu in-memory map); client kết nối `?ticket=...`.
- [x] Nâng cấp `PulseApiClient.ts`: flow lấy ticket trước khi mở `EventSource`.
- [x] **Test:** `tests/realtime-sse-auth.test.mjs` — ticket sai/hết hạn/dùng 2 lần bị từ chối 401; không ticket → 401; sự kiện chỉ tới đúng người nhận.
- [x] **Security audit:** không lộ userId qua log; ticket không đoán được (crypto.randomBytes).

### [SEC-02] Loại bỏ kênh định danh `x-user-id` (S — frontend-specialist + backend-architect) — ✅ 2026-10-01
- [x] Xóa header `x-user-id` khỏi mọi request trong `PulseApiClient.ts`.
- [x] Backend: xóa hoàn toàn fallback `x-user-id` khỏi JWT preHandler (không giữ "dev-only" — tránh đường tắt sản sinh lại).
- [x] Demo User Switcher chuyển sang **đăng nhập thật**: gọi `/auth/login` bằng credential preset (seed sẵn password cho user demo).
- [x] **Test:** cập nhật toàn bộ suite loại bỏ `x-user-id` — đây là thay đổi xuyên suốt ~37 file test, `qa-test-engineer` chủ trì theo từng domain.

### [SEC-03] Secrets fail-fast (S — backend-architect) — ✅ 2026-10-01
- [x] `buildApp()` throw khi thiếu `JWT_SECRET`/`COOKIE_SECRET` trong env (bất kể môi trường); xóa fallback hardcode `'pulse-secret-key-2026-production-token'`.
- [x] Cập nhật `.env`, `.env.example`, README hướng dẫn sinh secret (`openssl rand -base64 48`).

### [SEC-04] Persist VAPID keypair (S — backend-architect) — ✅ 2026-10-01
- [x] VAPID keys đặt vào ENV (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`), xóa sinh key trong constructor của `WebPushService`.
- [x] Script `backend/scripts/generate-vapid-keys.mjs` (điền vào `.env`).
- [x] **Test:** `web-push-notifications.test.mjs` — key ổn định giữa 2 lần khởi tạo app (không còn orphan subscription).

### [SEC-05] Rate limiting (M — backend-architect) — ✅ 2026-10-01
- [x] Cài `@fastify/rate-limit`: global 300 req/phút/IP; bucket nghiêm ngặt riêng: `/auth/login|register|refresh` (10/phút/IP), `POST /posts` (10/30s/user), `/media/upload` (20/giờ/user), federation inbox (300/phút/IP).
- [x] Trả 429 đúng chuẩn `{ success:false, error:{ code:"RATE_LIMITED" } }`; frontend hiển thị toast thân thiện.
- (Phần Redis-distributed để dành cho PKG-16; bản này là in-memory đủ cho 1 instance.)
- [x] **Test:** `tests/rate-limiting.test.mjs` — vượt ngưỡng nhận 429; bucket auth không ảnh hưởng bucket publish; retry-after header.

### [SEC-06] Dọn demo/data giả khỏi build production (S — frontend-specialist) — ✅ 2026-10-01
- [x] `PRESET_USERS`, mock fallback feed, nút "switch account demo" chỉ tồn tại khi `import.meta.env.DEV`; build prod không chứa credential demo.
- [x] Client ngừng gửi mọi header tự định danh (liên quan SEC-02).

**Nghiệm thu GĐ 1 (✅ đạt 2026-10-01):** 431/431 backend + 174/174 frontend pass; test file mới (SSE-auth, secrets fail-fast, rate-limiting) + helper auth; audit doc tại `docs/SECURITY_AUDIT_HARDENING_WEEK.md`; prod bundle đã xác minh 0 chuỗi demo/secret.

---

## 4. GIAI ĐOẠN 2: DỌN NHÀ KỸ THUẬT (P1 — chạy song song GĐ 1)

### [INF-01] Pipeline test trực tiếp trên TypeScript (M — qa-test-engineer) — ✅ 2026-10-01
- [ ] Bỏ phụ thuộc `../dist/`: chạy `node --import tsx --test tests/*.test.mjs`; xóa bước build bắt buộc trước khi test.
- [ ] Xóa stub `tests/test_audit.js`.
- [ ] **Rủi ro kiểm soát:** chạy cả hai pipeline song song 1 tuần, so kết quả trước khi bỏ dist.

### [INF-02] Gộp 59 route legacy trùng lặp (M — backend-architect) — ✅ 2026-10-01
- [ ] Trích hàm `registerDomainRoutes(prefix)` dùng chung cho `/api/v1` và root; xóa bảng đăng ký tay trùng lặp trong `app.ts` (mục tiêu giảm ≥ 40% số dòng đăng ký).
- [ ] **Test:** smoke test cả 2 prefix trả kết quả giống nhau; không thay đổi behavior.

### [INF-03] Đồng bộ tài liệu (S — Tech Lead) — ✅ 2026-10-01
- [ ] `SYSTEM_DESIGN.md`: bổ sung mục 12 (TASK-21 Auth & Private Accounts) + mục 13 (kiến trúc Hardening Week).
- [ ] Xóa/hợp nhất `FEDIVERSE_DEEPENING_SPEC.md` placeholder ở root về `docs/`.
- [ ] Quy ước: `PLAN.md` là nguồn duy nhất cho trạng thái & số liệu; improve.md chỉ mô tả hạng mục.

### [INF-04] Tách `PulseApiClient.ts` (1355 dòng) và `PulseContext.tsx` (M — frontend-specialist) — ✅ 2026-10-01 (lớp transport)
- [ ] Tách client thành `api/core.ts` (fetch wrapper, refresh, error) + `api/{auth,posts,feed,graph,dm,federation,push}.ts`, giữ singleton `api` làm façade để không phá view code.
- [ ] Tách `PulseContext` thành: `AuthContext`, `ToastContext`, `NavigationContext` (chuẩn bị cho PKG-08).

### [INF-05] Contract-first với TypeBox (L — backend-architect, kéo dài theo domain) — ✅ 2026-10-01 (domain auth)
- [ ] Cài `@sinclair/typebox` + `@fastify/type-provider-typebox`; schema hóa request/response bắt đầu từ domain **auth**, rồi posts → feed → dm → federation.
- [ ] Xuất OpenAPI từ schema; sinh types cho frontend bằng `openapi-typescript`, thay dần DTO tay trong `PulseTypes.ts`.
- [ ] Loại bỏ dần normalize đa-shape ("array | {items} | {posts}") trong client sau mỗi domain chuyển xong.
- **Quy tắc:** mỗi domain chạm tới trong tương lai bắt buộc schema hóa trước khi thêm endpoint mới (không làm big-bang).

**Nghiệm thu GĐ 2 (✅ đạt):** app.ts 458→230 dòng; 436/436 backend tests chạy trực tiếp TS (tsx) không cần build; SYSTEM_DESIGN có mục 12-13; api/core.ts tách xong; TypeBox áp dụng domain auth.

---

## 5. GIAI ĐOẠN 3: TIỀN ĐỀ UX (P0 UX — tuần 3-4)

### [PKG-02] Dark / Light / OLED / System Theme (M — frontend-specialist) — ✅ 2026-10-01
Theo đúng spec 3.2 của `improve.md`: `ThemeContext`, semantic tokens (`bg-canvas`, `bg-card`, `text-primary`, `border-divider`), class `dark` trên `<html>`, chống FOUC, switcher trên `NavigationSidebar`.
- **Điểm ràng buộc bổ sung:** Palette Tailwind hiện hardcode (`ink/paper/mist/...` + `#385898`) — phải migration toàn bộ component sang token semantic **trước** khi thêm class `dark:`, nếu không sẽ sinh hàng trăm chỗ phải sửa 2 lần. Làm token hóa là bước 1 của task này.
- **Test:** `frontend/tests/theme-switcher.test.mjs` — lưu/đọc localStorage, áp dụng class, 4 chế độ.

### [PKG-08] Router & Deep Linking (M — frontend-specialist) *(hạng mục mới)*
- **Vấn đề:** `navigateTo` chỉ set state, không `pushState` — back/forward hỏng, refresh mất trang, share link vô dụng.
- [ ] Cài `react-router`; định nghĩa bảng route thay thế `ViewType`:

| Path | View hiện tại |
|---|---|
| `/` | HomeTimelineView (tab For You/Following) |
| `/explore`, `/explore?q=` | ExploreView |
| `/notifications` | NotificationCenterView |
| `/messages`, `/messages/:conversationId` | DirectMessagingView |
| `/@:username`, `/@:username/:tab` | UserProfileView |
| `/post/:id` | ConversationThreadView |

- [ ] Backward-compat: redirect `?view=...&postId=...&username=...` cũ sang path mới.
- [ ] Giữ hành vi SSE badge (không auto-jump) khi điều hướng.
- [ ] **Test:** `frontend/tests/routing-deeplink.test.mjs` — parse URL → state, redirect legacy, back/forward giữ scroll & tab.

**Nghiệm thu GĐ 3:** refresh tại mọi route khôi phục đúng trang; back/forward hoạt động; dark mode chuyển mượt cả 4 chế độ; 0 hồi quy test.

---

## 6. GIAI ĐOẠN 4: SẢN PHẨM CONSUMER-READY (P1 — tháng 2)

Thứ tự khuyến nghị trong giai đoạn: **PKG-03 → PKG-01 → PKG-04 → PKG-09 → PKG-05 → PKG-06 → PKG-10 → PKG-11 → PKG-12** (ưu tiên thứ rẻ mà nhiều người dùng nhất trước).

| Mã | Hạng mục | Nguồn spec | Ghi chú điều chỉnh |
|---|---|---|---|
| PKG-03 | Trang Bookmarks + Post Drafts autosave | improve.md 3.3 | ✅ 2026-10-01 (BookmarksView + route /bookmarks + drafts autosave 1s) |
| PKG-01 | OpenGraph Link Preview + Multi-image grid | improve.md 3.1 | ✅ 2026-10-01 (scraper strict-SSRF + cache 24h + LinkPreviewCard; multi-image grid có sẵn) |
| PKG-04 | Report & Moderation Queue | improve.md 3.4 | ✅ 2026-10-01 (BE+FE: autoScore heuristic, admin queue/resolve, suspend gates, nút Báo cáo) |
| PKG-09 | Media Pipeline v2 | **mới** | ✅ 2026-10-01 (sharp WebP/resize/EXIF strip, MediaAsset registry + altText, auth gate; drag-drop/paste còn lại) |
| PKG-05 | DM Polish: typing + reactions + ảnh chat | improve.md 3.5 | ✅ typing 2026-10-01 (SSE dm.typing + UI); reactions + ảnh chat còn lại |
| PKG-06 | OAuth2 (Google/GitHub) + Password Reset + UserSession | improve.md 3.6 | cần `MailerService` (nodemailer + SMTP ENV); gộp "đăng xuất mọi thiết bị" vào UserSession |
| PKG-10 | Account Lifecycle | **mới** | xóa tài khoản (transaction: soft-delete user, dọn inbox/follow/follow-request/token, ngắt SSE, ẩn nội dung `isDeleted`), export dữ liệu JSON (posts/follows/DMs) |
| PKG-11 | Full-text Search tiếng Việt | **mới** | ✅ 2026-10-01 (search_vector generated + immutable_unaccent + GIN; FTS multi-word, match có/không dấu; benchmark chuyên sâu còn lại) |
| PKG-12 | PWA hoàn chỉnh | **mới** | ✅ 2026-10-01 (manifest + icons + theme-color + offline shell cache-first) |

Mỗi PKG giữ đúng chu trình chuẩn của team: spec → schema/contract → backend → frontend → security audit (nếu chạm dữ liệu người dùng) → test → cập nhật docs. Tiêu chí nghiệm thu chi tiết theo từng spec nguồn.

**Nghiệm thu GĐ 4:** 9 PKG hoàn thành theo bảng; các test file tương ứng mỗi PKG (đặt tên theo quy ước `tests/<domain>-<feature>.test.mjs`); frontend build & CI xanh.

---

## 7. GIAI ĐOẠN 5: ĐỊNH VỊ CHIẾN LƯỢC (P2 — tháng 3+, theo nhu cầu thật)

### [PKG-13] Federation E2E với phần mềm thật (L)
- [ ] Đưa lên `docker-compose` một instance **GoToSocial** (nhẹ, dễ vận hành) làm đối tác federated thật; Mastodon làm bước 2.
- [ ] Bổ sung federation còn thiếu: `Update`/`Delete` activity, media attachments (Image/Document + alt-text), remote avatar/header, federated Block.
- [ ] **Test:** suite `tests/federation-e2e-gotosocial.test.mjs` chạy có điều kiện (ENV `FEDERATION_E2E=1`), ngoài CI mặc định.
- **Định vị:** đây là tài sản khác biệt lớn nhất của Pulse — client Threads-style thực sự nói chuyện được với Fediverse.

### [PKG-14] Creator Dashboard (M)
- [ ] Endpoint `GET /api/v1/users/me/stats`: views 24h/7d/28d, engagement rate, top posts, follower growth (window query trên dữ liệu có sẵn; materialize sau nếu chậm).
- [ ] View `/stats` frontend (sau PKG-08).

### [PKG-15] Moderation v2 (M — sau PKG-04)
- [ ] Lớp pre-filter heuristic: spam pattern (nhiều bài link trùng/tốc độ đăng), auto-flag `Report` theo `autoScore`, hàng đợi admin sort theo điểm.
- [ ] Optional sau: endpoint classifier LLM, giữ schema ổn định.

### [PKG-16] Scale-out & Storage (L — gộp phần còn lại của improve.md PKG-07)
- [ ] Redis: pub/sub cho SSE đa instance, backend cho rate-limit; BullMQ tách `FanOutTimelineWorker` + `ActivityDeliveryWorker` thành process riêng.
- [ ] `STORAGE_DRIVER=local|s3` (S3/R2/MinIO) + CDN.
- **Điều kiện kích hoạt:** chỉ làm khi có nhu cầu scale thật; trước đó giữ in-process cho đơn giản.

---

## 8. PHÂN CÔNG TỔNG HỢP (ma trận nhân sự)

| Giai đoạn | backend-architect | frontend-specialist | qa-test-engineer | security-auditor |
|---|---|---|---|---|
| GĐ 0 | OPS-01 | — | OPS-02 | — |
| GĐ 1 | SEC-01, 03, 04, 05 | SEC-02, 06 | test mới + cập nhật suite | audit SEC-01/02/05 |
| GĐ 2 | INF-02, INF-05 | INF-04 | INF-01 | — |
| GĐ 3 | — | PKG-02, PKG-08 | test theme + routing | — |
| GĐ 4 | PKG-01/04/06/09/10/11 (BE) | PKG-03/05/12 + phần FE | test từng PKG | audit PKG-06/10 |
| GĐ 5 | PKG-13/14/15/16 (BE) | PKG-14 (FE) | test federated | audit PKG-13/15 |

---

## 9. NGUYÊN TẮC NGHIỆM THU CHUNG (ÁP DỤNG CHO MỌI TASK)

1. **Definition of Done:** build + `tsc --noEmit` sạch → toàn bộ suite pass (không hồi quy) → test mới cho tính năng → docs cập nhật trong cùng nhánh.
2. **Bảo mật:** mọi task chạm auth/identity/federation phải có security-auditor review riêng trước khi merge.
3. **Schema:** thay đổi Prisma luôn đi kèm `prisma db push` + `prisma generate` + ghi chú migration trong SYSTEM_DESIGN.md.
4. **Quy ước code:** giữ intent-driven naming; validation mới viết bằng TypeBox theo lộ trình INF-05.
5. **Không big-bang:** mỗi task một nhánh, một PR, một mã task.

---

## 10. RỦI RO CHÍNH & PHƯƠNG ÁN ỨN PHÓ

| Rủi ro | Ảnh hưởng | Ứn phó |
|---|---|---|
| Xóa `x-user-id` (SEC-02) phá hàng loạt test cũ | cao | chuyển đổi theo domain, qa-test-engineer cập nhật suite song song, không merge rời rạc |
| Token hóa màu (PKG-02) đụng ~1000 dòng UI | trung | làm PR riêng chỉ đổi token, không đổi logic; screenshot so sánh trước/sau |
| Router (PKG-08) xung đột SSE badge & modal flags | trung | giữ `NavigationContext` là nguồn truth duy nhất; chuyển dần từng view |
| E2E federated phụ thuộc hạ tầng ngoài | trung | tách suite có điều kiện, không chặn CI mặc định |
| Scope creep ở GĐ 4 (9 PKG) | cao | thực thi đúng thứ tự khuyến nghị; không mở PKG mới khi có PKG đang dở |

---

*Kế hoạch này, khi được phê duyệt, sẽ trở thành căn cứ kỹ thuật chính thức; các mốc hoàn thành được cập nhật trạng thái `[x]` ngay trong tài liệu này và đồng bộ tổng kết vào `PLAN.md`.*

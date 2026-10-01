# PROGRESS — TRẠNG THÁI THỰC THI IMPROVEMENT_PLAN_V2

> **Cập nhật:** 2026-10-02 (lần 3 — PKG-05 phần 2 + PKG-15 hoàn thành) | **Branch:** `dev`
> **Tài liệu kế hoạch gốc:** `IMPROVEMENT_PLAN_V2.md` | **Số liệu test nguồn duy nhất:** phụ lục `PLAN.md`

---

## 1. SNAPSHOT HIỆN TẠI

| Chỉ số | Giá trị |
|---|---|
| Backend tests | **459/459 PASS** |
| Frontend tests | **203/203 PASS** |
| tsc --noEmit | Sạch cả 2 package |
| Prod bundle | Sạch 100% dữ liệu demo |
| Working tree | Sạch — mọi thay đổi đã commit |
| Remote | **Chưa có** — CI file sẵn sàng nhưng chưa chạy được trên GitHub |

## 2. ĐÃ HOÀN THÀNH (đã commit trên `dev`, theo thứ tự thực thi)

### GĐ 0 — Nền tảng quy trình ✅
- [x] OPS-01 git hóa (221 files), .gitignore, .env.example
- [x] OPS-02 CI GitHub Actions (backend + frontend jobs, Postgres service container)
- [x] Baseline: 589/589

### GĐ 1 — Hardening Week ✅ (SEC-01→06, 605/605 lúc đóng fase)
- [x] SEC-03 secrets fail-fast | SEC-04 VAPID persist | SEC-05 rate limiting
- [x] SEC-01 SSE one-time ticket | SEC-02 xóa x-user-id toàn hệ thống | SEC-06 prod bundle sạch
- [x] Audit: `docs/SECURITY_AUDIT_HARDENING_WEEK.md`

### GĐ 2 — Dọn nhà kỹ thuật ✅ (INF-01→05)
- [x] INF-01 test chạy TS qua tsx (NODE_OPTIONS --import tsx) | INF-02 routes tách module (app.ts 458→230)
- [x] INF-03 SYSTEM_DESIGN mục 12-13 | INF-04 api/core.ts | INF-05 TypeBox domain auth

### GĐ 3 — Tiền đề UX ✅
- [x] PKG-02 theme Light/Dark/OLED/System (token hóa 1.658 class, 3 palette CSS vars)
- [x] PKG-08 router/deep-linking (/post/:id, /@user, legacy redirect, popstate)

### GĐ 4 — Sản phẩm consumer-ready ✅ 9/9 gói
- [x] **PKG-03** BookmarksView + /bookmarks + drafts autosave (commit 8fc2f52)
- [x] **PKG-12** PWA: manifest + icons + offline shell cache-first (fdbc892)
- [x] **PKG-10** Account lifecycle: DELETE /users/me (atomic scrub + counters + token revoke + username freeze), GET /users/me/export (5ef04a4, ecf49b8)
- [x] **PKG-11** Full-text search tiếng Việt: search_vector generated (immutable_unaccent) + GIN; FTS nhánh ưu tiên multi-word, match có/không dấu (0c6aa92)
- [x] **PKG-04** Report & Moderation: bảng Report (autoScore/autoLabels), POST /reports, admin queue + resolve (DELETE_POST/SUSPEND_USER chặn login+publish), nút Báo cáo trong menu (ddd1464, 71a71a8)
- [x] **PKG-01** OpenGraph Link Preview: scraper SSRF-guarded strict + cache 24h + LinkPreviewCard (41395ba)
- [x] **PKG-14** Creator Dashboard: GET /users/me/stats (totals/windows/topPosts) + StatsView /stats (442c2cd)
- [x] **PKG-09** Media v2: sharp WebP/resize≤1600/EXIF strip, MediaAsset registry + altText, upload auth gate (f4e6cd9)
- [x] **PKG-05** Typing Indicator (47005bd) + **phần 2: Reactions** (7e8656a) — DmReaction/GroupDmReaction, toggle API + SSE updated events, chips/picker UI; ảnh trong DM dùng pipeline PKG-09 (upload đã sẵn, composer UI còn lại)
- [x] **PKG-15** Moderation v2 (d0cd904): SpamDetectionService auto-flag (link flood/duplicate/rate ≥60 điểm), Report.reporterId nullable, ModerationCenterView /moderation (filter status + 4 actions), isAdmin trong UserDto

## 3. CÒN LẠI — chi tiết từng hạng mục + điều kiện kích hoạt

### PKG-05 phần 3 (ảnh trong DM) — P2
- [ ] Composer DM: nút attach → api.uploadMedia → preview → gửi kèm mediaUrls (backend DmMessage.mediaUrls đã có sẵn)
- **Điều kiện:** không có — thuần code, ~2-3 giờ

### PKG-06 — Production Auth — P2, **CHỜ QUYẾT ĐỊNH/INPUT**
- [ ] OAuth2 Google/GitHub: **cần credentials thật** (client id/secret + redirect URIs) từ chủ nhân
- [ ] Password Reset: cần `MailerService` + SMTP credentials (hoặc dev-mailer console)
- [ ] UserSession bảng + "đăng xuất mọi thiết bị"
- **Điều kiện:** input từ chủ nhân (OAuth keys, SMTP)

### PKG-13 — Federation E2E — P2, **CẦN DOCKER**
- [ ] docker-compose GoToSocial instance làm đối tác federated thật
- [ ] Federate Update/Delete/media attachments (Image/Document)/remote Block
- [ ] Suite `federation-e2e-gotosocial.test.mjs` chạy có điều kiện `FEDERATION_E2E=1`
- **Điều kiện:** Docker khả dụng trên máy

### PKG-16 — Scale-out — P2, **CHỈ KHI CÓ NHU CẦU THẬT**
- [ ] Redis pub/sub SSE + rate-limit store; BullMQ tách workers; STORAGE_DRIVER=s3
- **Điều kiện:** nhu cầu scale ngang thật

### Việc vận hành dành cho chủ nhân
- [ ] Tạo GitHub repo + `git remote add origin <url> && git push -u origin main dev` để CI kích hoạt
- [ ] DB local chưa có 4 user demo: `npm run db:seed` (wipe) hoặc tạo tay + `node scripts/set-demo-passwords.mjs`
- [ ] Production deep-linking cần SPA fallback (dev đã OK nhờ Vite)

## 4. GHI CHÚ KỸ THUẬT QUAN TRỌNG (bẫy đã gặp — đừng dẫm lại)

1. **Test backend import `../src/**.ts`**, chạy qua `NODE_OPTIONS="--import tsx --import ./tests/setup-env.mjs"` (Node 26 không alias .js→.ts trong native strip-types; --import không lan xuống test children).
2. **Frontend src import nội bộ phải có extension `.ts`**; **test frontend là .mjs thuần JS** (không TS annotation); **`import.meta.env` phải optional-chain**.
3. **Rate limit tắt trong test** qua `RATE_LIMIT_DISABLED=1` (preload); suite rate-limiting tự bật.
4. **TypeBox 0.34**: `Type.String({ pattern })` thay vì Type.Regex; login sai định dạng = 401 AuthUnauthorizedError.
5. **`prisma db push` DROP cột `search_vector`** (generated column không khai báo trong schema) — sau MỖI db push phải chạy lại `psql $DATABASE_URL -f prisma/sql/pkg11-search-vector.sql`.
6. **fastify-multipart `req.parts()`**: phải consume file part (toBuffer) NGAY TRONG vòng lặp — nếu lưu part rồi lặp tiếp sẽ deadlock (busboy không advance).
7. **Migration class hex→token (PKG-02)**: map và phương pháp replace regex escape — xem commit PKG-02.
8. **SSE test pattern**: mở socket qua listen(0) + one-time ticket; cleanup trong try/finally (destroy + delay 120ms + app.close()) — nếu assert fail giữa chừng mà không finally thì process treo.
9. **Test outbox retry (`5d/5e`) là flaky timing** (worker sweep 5s) — standalone pass 40/40; đừng tìm bug ở code mới khi chỉ nó fail trong full run.

## 5. LỆNH KHỞI ĐỘNG NHANH (session tiếp theo)

```bash
cd /home/nhonhoa/pulse && git log --oneline -5 && git status
cd backend && npm test          # kỳ vọng 459/459
cd ../frontend && npm test      # kỳ vọng 203/203
# Tiếp theo: PKG-05 phần 3 (ảnh trong DM), PKG-06/13 chờ input/Docker
```

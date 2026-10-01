# PROGRESS — TRẠNG THÁI THỰC THI IMPROVEMENT_PLAN_V2

> **Cập nhật:** 2026-10-01 | **Branch:** `dev` | **Commit cuối:** `554dcd9` (PKG-08)
> **Tài liệu kế hoạch gốc:** `IMPROVEMENT_PLAN_V2.md` | **Số liệu test nguồn duy nhất:** phụ lục `PLAN.md`
>
> File này là bảng theo dõi tiến độ thực thi. Sau mỗi task hoàn thành, cập nhật trạng thái
> `[x]` tại đây + đánh dấu ✅ trong IMPROVEMENT_PLAN_V2.md + commit với mã task tương ứng.

---

## 1. SNAPSHOT HIỆN TẠI

| Chỉ số | Giá trị |
|---|---|
| Backend tests | **436/436 PASS** (chạy trực tiếp TS qua tsx, không cần build trước) |
| Frontend tests | **203/203 PASS** (chưa gồm xác minh cuối của PKG-03 — xem mục 2) |
| tsc --noEmit | Sạch cả 2 package (sau fix cuối của PKG-03, chưa chạy lại lần xác minh) |
| Prod bundle | Sạch 100% dữ liệu demo (`PulseDemo2026`, `sontungmtp`, `hoa_dev`... = 0) |
| Working tree | Có thay đổi **chưa commit** — toàn bộ thuộc PKG-03 (mục 2) |
| Remote | **Chưa có** — CI file đã sẵn sàng nhưng chưa chạy được trên GitHub |

## 2. ĐANG DỞ — CẦN ĐÓNG NGAY KHI TIẾP TỤC (PKG-03)

Code đã viết xong, đã có 9 test cases riêng pass; chỉ còn thiếu bước xác minh + commit:

- [ ] Chạy xác minh: `cd frontend && npx tsc --noEmit && npm run build && cd tests && node --experimental-strip-types --test *.test.mjs`
  - Lỗi TS cuối đã sửa: bỏ `observePostElement` + import `useViewportImpressionTracker` thừa trong `BookmarksView.tsx`.
- [ ] Commit: `git add frontend/ && git commit -m "PKG-03: Trang Bookmarks độc lập + Post Drafts autosave"`.

**Nội dung đã làm trong PKG-03 (đang ở working tree):**
- `frontend/src/views/BookmarksView.tsx` (mới) — trang Đã lưu độc lập, fetch `GET /bookmarks`.
- `frontend/src/utils/router.ts` — thêm view `bookmarks` + route `/bookmarks` (parse + serialize).
- `frontend/src/App.tsx` — case `'bookmarks'` trong MainContentRouter.
- `frontend/src/components/NavigationSidebar.tsx` — 2 entry "Đã lưu" chuyển sang `navigateTo('bookmarks')`, `isBookmarksActive` theo view mới.
- `frontend/src/utils/drafts.ts` (mới) — Post Drafts: slot theo mục đích (`post`/`reply:<id>`/`quote:<id>`), save/load/clear/list, `isDraftMeaningful`, `createAutosaver` debounce 1s.
- `frontend/src/components/PostComposerCard.tsx` — restore nháp khi mount, autosave theo content/media/CW/poll, xoá nháp khi đăng thành công.
- `frontend/tests/post-drafts.test.mjs` (mới, 9 cases).

## 3. ĐÃ HOÀN THÀNH (đã commit trên `dev`)

### GĐ 0 — Nền tảng quy trình
- [x] **OPS-01** `git init` (main) + `.gitignore` + initial commit 221 files + branch `dev` + `.env.example`
- [x] **OPS-02** CI GitHub Actions (`.github/workflows/ci.yml`): backend (Postgres service + build + tsc + test) + frontend

### GĐ 1 — Hardening Week (SEC-01→06) — 605/605 tests lúc đóng fase
- [x] **SEC-03** Secrets fail-fast (`src/config/Secrets.ts`, xóa fallback hardcode, preload `tests/setup-env.mjs`)
- [x] **SEC-04** VAPID keypair persist qua ENV + `scripts/generate-vapid-keys.mjs`
- [x] **SEC-05** Rate limiting: global 300/phút/IP; auth 10/phút, refresh 30/phút, publish 20/phút/user, upload 20/giờ
- [x] **SEC-01** SSE one-time ticket (`POST /realtime/ticket`, single-use TTL 30s, 401 trước hijack)
- [x] **SEC-02** Xóa `x-user-id` toàn hệ thống (backend + 420 chỗ test + frontend); demo switcher đăng nhập thật
- [x] **SEC-06** Prod bundle sạch demo data (dev-gating + constant folding, đã grep xác minh = 0)
- [x] Audit doc: `docs/SECURITY_AUDIT_HARDENING_WEEK.md`

### GĐ 2 — Dọn nhà kỹ thuật (INF-01→05)
- [x] **INF-01** Test chạy trực tiếp TS qua tsx (`NODE_OPTIONS="--import tsx --import ./tests/setup-env.mjs"`), imports `../dist/` → `../src/`, xóa stub test_audit.js
- [x] **INF-02** Route registration tách sang `src/routes/registerRoutes.ts`; app.ts 458→230 dòng
- [x] **INF-03** SYSTEM_DESIGN.md mục 12 (TASK-21) + 13 (Hardening); xóa placeholder `FEDIVERSE_DEEPENING_SPEC.md` root
- [x] **INF-04** Transport layer tách sang `frontend/src/api/core.ts` (PulseApiClient extends PulseApiCore) — lưu ý: import trong src phải có extension `.ts` cho Node test runner
- [x] **INF-05** TypeBox contract-first domain auth (`src/contracts/AuthSchemas.ts`); login giữ 401 cho input sai; 436/436

### GĐ 3 — Tiền đề UX
- [x] **PKG-02** Theme Light/Dark/OLED Black/System: token hóa 1.658 class hex → 8 semantic tokens qua CSS vars; 3 palette trong index.css; `utils/theme.ts` + ThemeContext + ThemeSwitcher; chống FOUC trong index.html; test mới 9 cases → **183/183**
- [x] **PKG-08** Router & deep linking: `utils/router.ts` (route `/`, `/explore`, `/notifications`, `/messages[/:id]`, `/@:username[?tab=]`, `/post/:id`), pushState/popstate, legacy `?view=` redirect; 11 tests → **194/194**

## 4. CHƯA HOÀN THÀNH (theo thứ tự ưu tiên trong kế hoạch)

### GĐ 4 — Sản phẩm consumer-ready
- [ ] **PKG-03** Bookmarks + Drafts — *đang dở, xem mục 2*
- [ ] **PKG-12** PWA hoàn chỉnh: manifest.webmanifest + icons + theme-color meta + offline shell (service worker đã có sẵn từ TASK-20)
- [ ] **PKG-10** Account Lifecycle: `DELETE /api/v1/users/me` (transaction: soft-delete, dọn inbox/follow/follow-request/token, ngắt SSE), export dữ liệu JSON, UI xác nhận xóa
- [ ] **PKG-11** Full-text Search tiếng Việt: cột generated `tsvector` (config `simple` + extension `unaccent`), GIN index, chuyển `SearchService` sang `websearch_to_tsquery`, benchmark trước/sau. *Kiểm tra trước: `CREATE EXTENSION IF NOT EXISTS unaccent;` có chạy được trên DB local không*
- [ ] **PKG-01** OpenGraph Link Preview + multi-image grid (`FetchOpenGraphMetadataService.ts` tái dùng `SsrfProtectionGuardService`, cache 24h; `LinkPreviewCard.tsx`)
- [ ] **PKG-04** Report & Moderation (bảng `Report` — nhớ thêm sẵn `autoScore`/`autoLabels` cho PKG-15; API + ModerationCenterView)
- [ ] **PKG-09** Media Pipeline v2 (`sharp`: resize/WebP/strip EXIF; alt-text; drag-drop/paste ảnh)
- [ ] **PKG-05** DM Polish: typing indicator (SSE `dm.typing`, throttle 3s), message reactions (bảng `DmReaction`/`GroupDmReaction`), ảnh trong chat
- [ ] **PKG-06** OAuth2 (Google/GitHub — *cần credentials thật, cần quyết định của chủ nhân*) + Password Reset (cần `MailerService`/SMTP) + UserSession

### GĐ 5 — Chiến lược
- [ ] **PKG-13** Federation E2E: docker GoToSocial, federate `Update`/`Delete`/media attachments/remote block; suite `federation-e2e-gotosocial.test.mjs` chạy có điều kiện `FEDERATION_E2E=1`
- [ ] **PKG-14** Creator Dashboard: `GET /api/v1/users/me/stats` (views 24h/7d/28d, engagement, top posts) + view `/stats`
- [ ] **PKG-15** Moderation v2: auto-flag heuristic theo `autoScore` (chờ PKG-04), admin queue sort theo điểm
- [ ] **PKG-16** Scale-out: Redis pub/sub SSE + rate-limit store, BullMQ tách workers, `STORAGE_DRIVER=local|s3`

### Việc vận hành dành cho chủ nhân
- [ ] Tạo GitHub repo + `git remote add origin <url> && git push -u origin main dev` để CI kích hoạt
- [ ] DB local chưa có 4 user demo (9182 users hiện tại là dữ liệu test): chạy `npm run db:seed` (có wipe) hoặc `node scripts/set-demo-passwords.mjs` sau khi seed nếu muốn dùng Demo User Switcher
- [ ] Production deep-linking cần static host có SPA fallback về index.html (dev đã OK nhờ Vite)

## 5. GHI CHÚ KỸ THUẬT QUAN TRỌNG (bẫy đã gặp — đừng dẫm lại)

1. **Test backend không import `../dist/` nữa** — chạy qua tsx với `NODE_OPTIONS="--import tsx --import ./tests/setup-env.mjs"` (Node 26 native strip-types không alias `.js`→`.ts`, và `--import` trực tiếp không lan xuống test child processes).
2. **Frontend src import nội bộ phải có extension `.ts`** (`./core.ts` không phải `./core`) — Node test runner không resolve extensionless.
3. **Test frontend là `.mjs` thuần JS** — không viết TypeScript annotation trong file `.test.mjs` (Node không strip types cho `.mjs`).
4. **`import.meta.env` phải optional-chain** (`(import.meta as any).env?.DEV ?? true`) — Node thuần không có env object của Vite; vite build vẫn constant-fold để loại demo data khỏi bundle.
5. **Rate limit bị tắt trong test** qua `RATE_LIMIT_DISABLED=1` (preload); riêng `tests/rate-limiting.test.mjs` tự bật `=0` trước `buildApp()`.
6. **TypeBox 0.34**: dùng `Type.String({ pattern })` — KHÔNG có `Type.Regex`. Login validation throw `AuthUnauthorizedError` (401), không phải AuthValidationError (400).
7. **dist/ phải rebuild trước khi test backend** nếu code cũ còn import dist — giờ không còn cần (INF-01), nhưng script `generate-vapid-keys.mjs`/`set-demo-passwords.mjs` chạy trực tiếp bằng node.
8. **Migration class hex → token (PKG-02)**: map `-[#fafafa]`→`-paper`, `-[#000000]`→`-ink`, `-[#efefef]`→`-mist`, `-[#d5d5d5]`→`-cloud`, `-[#969696]`/`#71717a`/`#737373`→`-ash`, `-[#424242]`/`#475569`→`-graphite`, `-[#385898]`→`-meta`, `-[#ffffff]`→`-card`. File test assert class dùng dạng regex escape `\[...\]` — replace bằng `re.sub(r'\\\[HEX\\\]', token, ...)` (str.replace thường đã hỏng 1 lần).

## 6. LỆNH KHỞI ĐỘNG NHANH (session tiếp theo)

```bash
# 1. Kiểm tra trạng thái
cd /home/nhonhoa/pulse && git status && git log --oneline -5

# 2. Đóng PKG-03 (mục 2) — xác minh + commit

# 3. Chạy test để lấy baseline hiện tại
cd backend && npm test          # kỳ vọng 436/436
cd ../frontend && npm test      # kỳ vọng 203/203 (hoặc hơn sau xác minh PKG-03)

# 4. Tiếp tục GĐ 4 theo checklist mục 4 (PKG-12 là gói rẻ nhất tiếp theo)
```

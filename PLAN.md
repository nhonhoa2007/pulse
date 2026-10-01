# PLAN.md - KẾ HOẠCH TRIỂN KHAI DỰ ÁN PULSE MICROBLOGGING

**Chỉ huy:** Tech Lead & System Architect  
**Nhân sự điều phối:** `backend-architect`, `frontend-specialist`, `qa-test-engineer`  
**Trạng thái:** ✅ ĐÃ HOÀN THÀNH 100% & NGHIỆM THU

---

## GIAI ĐOẠN 0: KHỞI TẠO NỀN TẢNG & PRE-SYNC SCHEMA (TECH LEAD)
* [x] Tạo cơ sở dữ liệu `pulse_social` trên PostgreSQL 18 local.
* [x] Soạn thảo `SYSTEM_DESIGN.md` và `AGENTS.md`.
* [x] Thiết lập cấu trúc thư mục dự án `pulse/backend` và `pulse/frontend`.
* [x] Cài đặt dependencies cho backend (Fastify, Prisma, TypeScript).
* [x] Viết `schema.prisma`, chạy `prisma db push` đồng bộ bảng vào DB và chạy `prisma generate` tạo types.
* [x] Viết file seed `backend/prisma/seed.mjs` để tạo dữ liệu mẫu (User thường, Celebrity KOL, quan hệ follow).

---

## GIAI ĐOẠN 1: TRIỂN KHAI TẦNG DỮ LIỆU & ENGINE BACKEND (`backend-architect`)
* [x] `PublishPostService.ts`: Tạo bài viết mới, parse hashtags/mentions, kích hoạt background fan-out.
* [x] `HybridFeedTimelineService.ts`: Lấy bài từ inboxes + merge bài từ followed Celebrities bằng K-way merge.
* [x] `ToggleLikeService.ts` & `RepostService.ts`: Xử lý tương tác atomic, chống race conditions.
* [x] `BlockUserService.ts` & `FollowUserService.ts`: Đảm bảo toàn vẹn 2-way block transaction.
* [x] `ConversationThreadService.ts`: Lấy toàn bộ cây thảo luận bằng `rootPostId` trong 1 câu SQL.
* [x] `NotificationAggregatorService.ts`: Gom thông báo theo cửa sổ thời gian 24h.
* [x] `RealtimeEventStreamController.ts`: Quản lý kết nối SSE cho client và đẩy sự kiện tức thì.
* [x] `app.ts`: Đăng ký Fastify routes, CORS, validation schemas, build thành công với TypeScript.

---

## GIAI ĐOẠN 2: TRIỂN KHAI GIAO DIỆN CLIENT UI (`frontend-specialist`)
* [x] Khởi tạo Vite + React + Tailwind CSS + Lucide Icons theo tông Dark Mode chuẩn Threads/X (`#0a0a0a`).
* [x] `NavigationSidebar.tsx`: Logo Pulse, menu điều hướng, Demo User Switcher dropdown.
* [x] `PostComposerCard.tsx` & `PostComposerModal.tsx`: Khung soạn thảo bài viết, hỗ trợ reply và quote.
* [x] `PostFeedItem.tsx`: Card bài viết tương tác mượt mà, hỗ trợ like optimistic, repost, quote view.
* [x] `LiveFeedToastIndicator.tsx`: Nút pill nổi trên đầu feed khi nhận SSE `NEW_TIMELINE_POST`.
* [x] `ConversationThreadView.tsx`: Đường line nối dọc các replies phân cấp chuẩn Threads.
* [x] `UserProfileView.tsx`: Hồ sơ người dùng, nút Follow/Unfollow/Block, danh sách bài viết.
* [x] `NotificationCenterView.tsx`: Trung tâm thông báo đã gom nhóm kèm bộ lọc.
* [x] Build production frontend thành công (`tsc && vite build`).

---

## GIAI ĐOẠN 3: KIỂM THỬ TỰ ĐỘNG & NGHIỆM THU (`qa-test-engineer` & TECH LEAD)
* [x] `feed-hybrid-fanout.test.mjs`: PASS
* [x] `concurrency-atomic-likes.test.mjs`: PASS (50 concurrent requests không lệch counter)
* [x] `social-graph-block-invariants.test.mjs`: PASS (Xóa follow 2 chiều, dọn dẹp inboxes, chặn truy cập)
* [x] `conversation-thread.test.mjs`: PASS (Lấy toàn bộ chuỗi reply 3 cấp trong 1 query)
* [x] `notification-aggregation.test.mjs`: PASS (Gom thông báo 24h)
* [x] `realtime-sse-stream.test.mjs`: PASS (Nhận event SSE theo thời gian thực)
* [x] 100% test suite đạt 6/6 bài test trong 667ms.

---

## GIAI ĐOẠN 4: ACTIVITYPUB FEDERATION SUBSYSTEM (W3C / MASTODON / THREADS)

### 4.0. Khởi tạo Kiến trúc & Hợp đồng Dữ liệu (Tech Lead - Task `t_4b2d9f2c`)
* [x] Nghiên cứu tiêu chuẩn W3C ActivityPub, RFC 7033 WebFinger, draft-cavage-12 HTTP Signatures.
* [x] Soạn thảo đặc tả kỹ thuật chi tiết: `docs/ACTIVITYPUB_ARCHITECTURE_SPEC.md` và `ACTIVITYPUB_SPEC.md`.
* [x] Định nghĩa TypeScript Contracts: `backend/src/contracts/ActivityPubContracts.ts`.
* [x] Mở rộng Prisma Schema với `FederationKey`, `FederatedActor`, `FederatedFollow`, `ActivityDeliveryJob` và cập nhật `User`/`Post`.
* [x] Đồng bộ DB với `prisma db push` và sinh types `prisma generate`.
* [x] Kiểm tra bảo đảm 34/34 tests hiện tại không bị hồi quy (regression).

### 4.1. Triển khai Federation Endpoints & Services (`be-coder` - Task `t_18d45e2c`)
* [x] `WebFingerDiscoveryController.ts` & `ResolveWebFingerQueryService.ts`: Phân giải `/.well-known/webfinger` theo RFC 7033 & W3C SWICG, trả về `application/jrd+json; charset=utf-8`, CORS `*`, Cache-Control `max-age=3600`.
* [x] `ActivityPubActorController.ts` & `FetchActivityPubActorService.ts`: Cung cấp JSON-LD Actor profile cho User (`Person`) và Instance Actor (`Application` tại `/actor`) với khóa công khai RSA 2048-bit.
* [x] `ActivityPubKeyManagerService.ts`, `HttpSignatureSignerService.ts`, `HttpSignatureVerifierService.ts`: Sinh khóa RSA 2048, ký outbound requests, xác thực inbound requests (draft-cavage-12, clock skew 300s, digest verification, replay attack prevention).
* [x] `ActivityPubInboxController.ts` & `ProcessInboundActivityService.ts`: Xử lý các hoạt động đến (`Follow`, `Accept`, `Create`, `Undo`, `Delete`) tại shared `/inbox` và personal inboxes `/users/:username/inbox`.
* [x] `ActivityPubOutboxController.ts`, `FetchActivityPubOutboxService.ts`, `ActivityDeliveryWorkerService.ts`: Hàng đợi giao vận outbox bất đồng bộ, gom nhóm `sharedInboxUrl`, retry exponential backoff, hook vào `PublishPostService`.
* [x] Triển khai test suite nền tảng `activitypub-federation.test.mjs` đạt 18/18 tests (100% pass) và đảm bảo toàn bộ 118/118 tests của hệ thống Pulse đạt 100%.

### 4.2. Kiểm duyệt Bảo mật & Phòng chống Tấn công (`security-auditor` - Task `t_8e62290e`)
* [x] Audit SSRF Protection Filter: Chặn triệt để IP private, loopback, link-local và chống DNS Rebinding.
* [x] Audit HTTP Signature Verification: Kiểm tra chống tấn công Replay Attack (quá 5 phút) và làm sai lệch body.
* [x] Audit JSON-LD & Fetch Limiting: Kiểm tra giới hạn 256KB body và timeout 5000ms.

### 4.3. Kiểm thử Tự động Hợp nhất (`qa-tester` - Task `t_8aa55201`)
* [x] Xây dựng test suite tự động toàn diện `activitypub-federation.test.mjs` đạt 40/40 tests (100% pass) trong ~750ms:
  * [x] **WebFinger Discovery (RFC 7033)**: Phân giải chuẩn `acct:username@domain`, không domain, `@username@domain`, URL format, case-insensitive, URL-encoded special chars, loại trừ shadow user (`isRemote: false`), các trường hợp lỗi (missing, empty, whitespace, 404 not found, domain mismatch), CORS & Cache-Control headers.
  * [x] **Dual Actor Profile Endpoints**: Instance Actor (`Application` tại `/actor`) kèm `publicKey`, Person JSON-LD tại `/users/:username` qua content negotiation (Accept `application/activity+json`), fallback REST profile cho REST clients.
  * [x] **HTTP Signatures Verification (draft-cavage-12)**: Mock Mastodon/Threads requests, clock skew quá 300s trong quá khứ và tương lai, thiếu hoặc sai định dạng `Date`, xác thực `Digest` (SHA-256, cấm thuật toán yếu MD5, phát hiện sai lệch payload), cú pháp header `Signature` và `Authorization: Signature`, thiếu header được liệt kê trong danh sách ký, phát hiện replay attack trong 5 phút, từ chối sai khóa RSA-2048, tìm nạp khóa công khai động (dynamic key resolution) với mock server, và SSRF Guard chặn URL nguy hiểm (169.254.169.254).
  * [x] **Inbound Activity State Machine & E2E Flows**: Follow đến (tăng followersCount, enqueues Accept delivery job, sinh Notification), bảo vệ chống trùng lặp Follow (idempotency), Undo follow (giảm followersCount an toàn, không âm), bắt tay hai chiều Outbound Follow + Inbound Accept (tăng followingCount), Inbound Create Note (phân phối chọn lọc vào TimelineInbox của người theo dõi, loại trừ người không theo dõi, chống trùng Note), luồng Reply (liên kết replyToId, rootPostId, tăng repliesCount và gửi Notification), Inbound Delete (soft-delete bài viết federated).
  * [x] **Outbox Collection & Delivery Worker (Retries & Backoff)**: OrderedCollection và phân trang OrderedCollectionPage (loại trừ bài viết đã xóa), giao vận outbox có chữ ký draft-cavage-12, tối ưu hóa gom nhóm SharedInbox (nhiều followers cùng instance chỉ gửi 1 job), cơ chế retry và exponential backoff khi server lỗi HTTP 500, lỗi mạng connection dropped, chuyển trạng thái FAILED khi cạn kiệt số lần thử tối đa, và SSRF Guard chặn giao vận tới IP metadata nội bộ.
* [x] Toàn bộ 162/162 automated tests của toàn bộ hệ thống Pulse Social đều đạt 100% PASS.

---

## GIAI ĐOẠN 5: TRUST, SAFETY & POST LIFECYCLE MANAGEMENT (TASK-18)

### 5.0. Khởi tạo Kiến trúc & Hợp đồng Dữ liệu (Tech Lead - Task `t_9a894412`)
* [x] Nghiên cứu tiêu chuẩn Meta Threads 15-min edit window, Twitter PostVersion audit trail, W3C AS2 summary/sensitive, Mastodon mute protocol.
* [x] Soạn thảo đặc tả kỹ thuật chi tiết: `docs/TRUST_SAFETY_POST_LIFECYCLE_SPEC.md` và `TRUST_SAFETY_SPEC.md`.
* [x] Mở rộng Prisma Schema với `PostVersion`, `UserMute`, `KeywordMute`, `pinnedPostId`, cập nhật `User` & `Post`.
* [x] Đồng bộ DB bằng `prisma db push` và sinh TypeScript types bằng `prisma generate`.
* [x] Định nghĩa TypeScript Contracts tại `backend/src/contracts/ApiContracts.ts`.
* [x] Kiểm tra bảo đảm 100% (162/162 tests) không bị hồi quy (regression).
* [x] Phân rã nhiệm vụ và khởi tạo các card chuyên trách cho `be-coder`, `fe-coder`, `security-auditor`, `qa-tester`.

### 5.1. Triển khai Backend Services & Endpoints (`be-coder`)
* [x] Nâng cấp `UpdatePostService.ts`: Kiểm tra cửa sổ thời gian 15 phút (`Date.now() - post.createdAt <= 900000 ms`), kiểm tra quyền tác giả, snapshot bản ghi vào `PostVersion` (bản 1 và các bản kế tiếp), cập nhật `isEdited: true`, `editCount`, re-parse hashtags/mentions.
* [x] `FetchPostVersionsService.ts` & Endpoint `GET /api/v1/posts/:id/versions`: Trả về danh sách phiên bản và lịch sử chỉnh sửa.
* [x] `PinPostService.ts`, `UnpinPostService.ts` & Endpoints `POST/DELETE /api/v1/posts/:id/pin`: Ghim và bỏ ghim bài viết vào hồ sơ cá nhân (`User.pinnedPostId`), kiểm tra tác giả, cấm ghim reply, tự động thay thế ghim cũ.
* [x] Cập nhật `UserController.ts` (`GET /api/v1/users/:username/posts`): Đưa bài viết được ghim lên đầu (index 0) kèm cờ `isPinned: true`.
* [x] `MuteUserService.ts`, `UnmuteUserService.ts`, `FetchMutedUsersService.ts` & Endpoints `POST/DELETE /api/v1/users/:id/mute`, `GET /api/v1/mutes/users`: Tắt tiếng người dùng âm thầm, bảo toàn quan hệ Follow và inboxes.
* [x] `MuteKeywordService.ts`, `UnmuteKeywordService.ts`, `FetchMutedKeywordsService.ts` & Endpoints `POST/DELETE /api/v1/mutes/keywords`, `GET /api/v1/mutes/keywords`: Quản lý từ khóa tắt tiếng (CONTAINS, EXACT_WORD, expiresAt).
* [x] Tích hợp bộ lọc tắt tiếng vào `HybridFeedTimelineService.ts`, `NotificationAggregatorService.ts` và `SearchService.ts`: Lọc bài viết và thông báo từ muted users và muted keywords.
* [x] Hỗ trợ `isSensitive` và `contentWarning` trong `PublishPostService.ts`, `UpdatePostService.ts` và tích hợp ánh xạ vào ActivityPub Outbox (`summary`, `sensitive`).

### 5.2. Triển khai Giao diện Client UI/UX (`fe-coder`)
* [x] `EditPostModal.tsx`: Modal chỉnh sửa bài viết với bộ đếm lùi thời gian thực 15 phút (`15-min countdown timer`), cảnh báo khi sắp hết giờ và khóa form khi hết hạn.
* [x] `PostVersionHistoryModal.tsx`: Modal xem lịch sử chỉnh sửa bài viết, hiển thị mốc thời gian và so sánh nội dung các phiên bản cũ.
* [x] Huy hiệu `" • Đã chỉnh sửa"` trên card bài viết (`PostFeedItem.tsx`), click mở modal lịch sử.
* [x] Nút Ghim/Bỏ ghim bài viết trong menu action dropdown (`PostFeedItem.tsx`), huy hiệu ghim `📌 Bài viết đã ghim` trên đầu bài viết ghim trong `UserProfileView.tsx`.
* [x] Tấm chắn `ContentWarningShield.tsx`: Khung bảo vệ nội dung nhạy cảm / spoiler với icon `EyeOff`, văn bản cảnh báo và nút bấm *"Xem nội dung"* / *"Ẩn"*, hiệu ứng làm mờ ảnh `filter blur-md`.
* [x] Form soạn thảo `PostComposerCard.tsx`: Thêm nút bật/tắt Content Warning và nhập nhãn cảnh báo.
* [x] Trang cài đặt / quản lý tắt tiếng `MuteManagementModal.tsx`: Quản lý danh sách User và Từ khóa bị tắt tiếng, form thêm từ khóa kèm thời hạn (24h, 7 ngày, vĩnh viễn).

### 5.3. Kiểm duyệt Bảo mật & Penetration Testing (`security-auditor`)
* [x] Audit kiểm tra phá vỡ cửa sổ 15 phút (Bypass Edit Window qua clock skew, race condition).
* [x] Audit kiểm tra tính bất biến của `PostVersion` (chống giả mạo, sửa đổi lịch sử).
* [x] Audit kiểm tra leo quyền ghim bài (Pinning Privilege Escalation - cố tình ghim bài người khác hoặc ghim reply).
* [x] Audit rò rỉ dữ liệu qua bộ lọc Tắt tiếng (Mute Leakage trong Search, Notifications, SSE stream).
* [x] Audit phòng chống Stored XSS trong nhãn `contentWarning` và từ khóa mute.

### 5.4. Kiểm thử Tự động Hợp nhất (`qa-tester`)
* [x] `tests/post-lifecycle-edit-version.test.mjs`: Test toàn diện cửa sổ 15 phút, snapshotting version 1, version 2, audit trail, re-parse hashtags/mentions.
* [x] `tests/post-lifecycle-pinning.test.mjs`: Test ghim, thay thế ghim, bỏ ghim, cascade delete, vị trí index 0 trên profile feed.
* [x] `tests/trust-safety-muting.test.mjs`: Test mute 1-way user, bảo toàn follow, lọc feed, lọc notifications, mute từ khóa contains vs exact word, hết hạn từ khóa.
* [x] `tests/trust-safety-content-warning.test.mjs`: Test tạo/sửa bài có CW, ánh xạ ActivityPub, bảo vệ XSS.
* [x] Toàn bộ 283/283 tests pass (205 backend, 78 frontend).

---

## GIAI ĐOẠN 6: FEDIVERSE DEEPENING (TASK-19)

### 6.0. Khởi tạo Kiến trúc & Hợp đồng Dữ liệu (Tech Lead - Task `t_405e0256`)
* [x] Nghiên cứu tiêu chuẩn NodeInfo 2.1 (jhass/nodeinfo), FEP-0151 (2025 edition), RFC 7033 WebFinger discovery, W3C AS2 Like/Announce/Undo, draft-cavage-12 HTTP signatures.
* [x] Soạn thảo đặc tả kỹ thuật chi tiết: `docs/FEDIVERSE_DEEPENING_SPEC.md` và `FEDIVERSE_DEEPENING_SPEC.md`.
* [x] Mở rộng TypeScript Contracts trong `backend/src/contracts/ActivityPubContracts.ts`, `backend/src/contracts/ApiContracts.ts` và `frontend/src/types/PulseTypes.ts`.
* [x] Kiểm tra bảo đảm 100% (283/283 tests) không bị hồi quy (regression).
* [x] Phân rã nhiệm vụ và khởi tạo các card chuyên trách cho `be-coder`, `fe-coder`, `security-auditor`, `qa-tester`.

### 6.1. Triển khai Backend Services & Endpoints (`be-coder`)
* [x] Xây dựng `NodeInfoController.ts` & `FetchNodeInfoService.ts`: Phục vụ `GET /.well-known/nodeinfo`, `GET /nodeinfo/2.1` (schema 2.1) và `GET /nodeinfo/2.0` với cache 30 phút.
* [x] Xây dựng `ResolveRemoteActorService.ts`: Khám phá tài khoản từ xa qua WebFinger (`GET https://{domain}/.well-known/webfinger?resource=acct:{user}@{domain}`), xác thực SSRF Guard, fetch JSON-LD actor, bọc lọc XSS và upsert `FederatedActor` + shadow `User`.
* [x] Đăng ký endpoint `POST /api/v1/federation/resolve` và tích hợp phân giải tự động trong `SearchService.ts` khi người dùng nhập `@user@domain`.
* [x] Mở rộng `ToggleLikeService.ts`: Tạo và enqueue ActivityPub `Like` hoặc `Undo(Like)` khi tương tác với bài viết liên hợp.
* [x] Mở rộng `RepostService.ts`: Tạo và enqueue ActivityPub `Announce` hoặc `Undo(Announce)` chuyển phát tới tác giả và remote followers.
* [x] Mở rộng `ProcessInboundActivityService.ts`: Tiếp nhận và xử lý Inbound `Like`, `Announce`, `Undo` từ Fediverse gửi đến bài viết Pulse.

### 6.2. Triển khai Giao diện Client UI/UX (`fe-coder`)
* [x] Cập nhật `ExploreView.tsx`: Tự động nhận diện chuỗi `@user@domain` trong search input, hiển thị banner và trigger phân giải Fediverse.
* [x] Xây dựng component `FederatedUserCard.tsx`: Hiển thị thông tin profile từ xa với avatar, display name, handle `@user@domain`, Fediverse badge, bio và nút Theo dõi (Follow/Following).
* [x] Cập nhật `PulseApiClient.ts`: Bổ sung hàm `resolveFederatedActor(handle: string)`.
* [x] Tối ưu trải nghiệm: Loading skeleton khi đang WebFinger fetch, thông báo lỗi thân thiện nếu không tìm thấy máy chủ ngoài.

### 6.3. Kiểm duyệt Bảo mật & Penetration Testing (`security-auditor`)
* [x] Audit kiểm tra SSRF trên Remote Discovery: Thử nghiệm dải IP nội bộ, loopback (127.0.0.1), IPv6 bracketed, CGNAT, link-local, AWS metadata (169.254.169.254), DNS rebinding.
* [x] Audit kiểm tra Stored XSS trong hồ sơ remote actor: Thử chèn HTML/JS payload vào name và summary.
* [x] Audit chữ ký HTTP Signatures & Replay attacks trên Inbound Like/Announce.
* [x] Audit Resource Exhaustion: Giới hạn kích thước phản hồi remote download tối đa 1MB và timeout 5s.

### 6.4. Kiểm thử Tự động Hợp nhất (`qa-tester`)
* [x] `backend/tests/fediverse-deepening-nodeinfo.test.mjs`: Test toàn diện NodeInfo 2.1 schema validation, headers CORS & cache, usage counters.
* [x] `backend/tests/fediverse-remote-discovery.test.mjs`: Test mock WebFinger & Actor fetch, SSRF protection, shadow user generation.
* [x] `backend/tests/fediverse-like-announce-federation.test.mjs`: Test outbound Like/Announce queue, HTTP Signatures signing, Inbound Like/Announce processing, Undo flows.
* [x] `frontend/tests/fediverse-remote-discovery-visual-states.test.mjs`: Test visual states của component tìm kiếm và thẻ FederatedUserCard.
* [x] Toàn bộ 360/360 tests (250 backend, 110 frontend) đạt 100% PASS.

---

## GIAI ĐOẠN 7: ALGORITHMIC FEEDS & GROUP REAL-TIME COMMUNICATIONS (TASK-20: PHASE C)

### 7.0. Khởi tạo Kiến trúc & Hợp đồng Dữ liệu (Tech Lead - Task `t_49d918ff`)
* [x] Nghiên cứu tiêu chuẩn thuật toán gravity HackerNews/Reddit/Twitter, cơ chế đệm ghi sau (Write-behind buffer), mô hình Group DM đa bên và Web Push IETF RFC 8030 / RFC 8292 VAPID.
* [x] Soạn thảo đặc tả kỹ thuật chi tiết: `docs/ALGORITHMIC_FEEDS_GROUP_COMMS_SPEC.md` và `ALGORITHMIC_FEEDS_GROUP_COMMS_SPEC.md`.
* [x] Mở rộng Prisma Schema với `viewsCount` trên `Post`, `GroupConversation`, `GroupMember`, `GroupMessage`, `GroupReadReceipt` và `WebPushSubscription`.
* [x] Đồng bộ PostgreSQL bằng `prisma db push` và sinh types `prisma generate`.
* [x] Mở rộng TypeScript Contracts trong `backend/src/contracts/ApiContracts.ts` và `frontend/src/types/PulseTypes.ts`.
* [x] Kiểm tra bảo đảm 100% (360/360 tests) không bị hồi quy (regression) và build 0 lỗi.
* [x] Phân rã nhiệm vụ và khởi tạo các card chuyên trách cho `be-coder`, `fe-coder`, `security-auditor`, `qa-tester`.

### 7.1. Triển khai Backend Services & Endpoints (`be-coder`)
* [x] Xây dựng `ForYouRecommendationFeedService.ts` & Controller `GET /api/v1/feed/for-you`: Phân tích candidate đa nguồn, tính điểm heuristic gravity, phạt độc quyền tác giả, lọc chặn/mute/từ khóa.
* [x] Xây dựng `PostImpressionsBufferService.ts` & Controller `POST /api/v1/posts/views`: Bộ đệm ghi sau, lọc trùng lặp 30 phút, xả tự động định kỳ 5s qua SQL nguyên tử `UPDATE "Post" SET "viewsCount" = "viewsCount" + delta`.
* [x] Xây dựng `GroupDmConversationService.ts`, `GroupDmMessageService.ts` & Controller `/api/v1/dm/groups/*`: Quản lý tạo nhóm, thêm/xóa thành viên, rời nhóm, gửi tin nhắn, phân trang tin nhắn và đọc tin nhắn.
* [x] Xây dựng `WebPushService.ts` & Controller `/api/v1/push/*`: Cung cấp VAPID public key, đăng ký/hủy subscription, ký ES256 JWT header (RFC 8292) và tự động xóa subscription khi nhận 404/410.
* [x] Tích hợp phát sóng SSE thời gian thực `dm.group.message.new` và thông báo Web Push.

### 7.2. Triển khai Giao diện Client UI/UX (`fe-coder`)
* [x] Cập nhật giao diện Home Feed: Thêm tab chuyển đổi "Dành cho bạn" (For You) song song với "Đang theo dõi" (Following) theo Threads Light Theme.
* [x] Xây dựng `ViewportImpressionTracker.ts` (hoặc hook `usePostImpressionTracker`): Tự động phát hiện bài viết xuất hiện trên viewport qua IntersectionObserver và gửi batch `POST /api/v1/posts/views`.
* [x] Hiển thị huy hiệu số lượt xem (`viewsCount`) trên card bài viết `PostFeedItem.tsx`.
* [x] Xây dựng giao diện Group DMs: Danh sách nhóm chat, modal tạo nhóm (`CreateGroupModal.tsx`), giao diện hội thoại nhóm (`GroupDmConversationView.tsx`), quản lý thành viên (`GroupMembersModal.tsx`).
* [x] Xây dựng component bật/tắt Web Push Notification: Yêu cầu quyền thông báo trình duyệt, đăng ký Service Worker và gửi endpoint lên backend.

### 7.3. Kiểm duyệt Bảo mật & Penetration Testing (`security-auditor`)
* [x] Audit kiểm tra rò rỉ quyền riêng tư trong "For You" Feed: Kiểm chứng không bao giờ xuất hiện bài viết từ tác giả bị chặn 2 chiều, tác giả bị mute, hoặc chứa từ khóa bị mute.
* [x] Audit kiểm tra gian lận số lượt xem (Impression Count Fraud): Thử nghiệm spam views, race conditions, memory leak trong buffer.
* [x] Audit kiểm tra IDOR & Leo quyền trong Group DMs: Người ngoài không thể đọc tin nhắn, không thể gửi tin, thành viên thường không thể kick thành viên khác.
* [x] Audit Web Push: Kiểm tra SSRF trên push endpoint URL, bảo vệ khóa VAPID private key và payload injection.

### 7.4. Kiểm thử Tự động Hợp nhất (`qa-tester`)
* [x] `backend/tests/algorithmic-for-you-feed.test.mjs`: Test thuật toán tính điểm heuristic, gravity decay, affinity multiplier, diversity cap, block/mute filtering, phân trang.
* [x] `backend/tests/post-views-buffer.test.mjs`: Test batch view reporting, 30-min deduplication, in-memory aggregation, periodic atomic SQL flush, counter accuracy.
* [x] `backend/tests/group-dm-lifecycle.test.mjs`: Test tạo nhóm, thêm/xóa thành viên, quyền admin, block invariants, gửi/xóa tin nhắn, unread receipts, real-time SSE.
* [x] `backend/tests/web-push-notifications.test.mjs`: Test VAPID public key, RFC 8292 ES256 JWT format, subscription registration/unregistration, auto-pruning 410 Gone.
* [x] `frontend/tests/algorithmic-feeds-visual-states.test.mjs`: Test visual states của tab For You, view counts, group DM chat list và member modal.
* [x] Toàn bộ 475/475 tests (328 backend, 147 frontend) đạt 100% PASS.

---

## GIAI ĐOẠN 8: AUTH HARDENING & PRIVATE ACCOUNTS (TASK-21)

### 8.0. Khởi tạo Kiến trúc & Hợp đồng Dữ liệu (Tech Lead - Task `t_a27b1839`)
* [x] Nghiên cứu kiến trúc HttpOnly Cookies, Rotating Refresh Tokens, Token Denylist, và Private Accounts FSM từ `mitekk/pulse`.
* [x] Soạn thảo đặc tả kỹ thuật chi tiết: `docs/SECURITY_AUTH_PRIVATE_ACCOUNTS_SPEC.md`.
* [x] Mở rộng Prisma Schema với `isPrivate` trên `User`, `FollowRequest` FSM (`PENDING`, `ACCEPTED`, `REJECTED`), `RefreshToken` rotation và `RevokedToken` denylist.
* [x] Đồng bộ PostgreSQL bằng `prisma db push` và sinh types `prisma generate`.
* [x] Mở rộng TypeScript Contracts trong `backend/src/contracts/ApiContracts.ts` và `frontend/src/types/PulseTypes.ts`.
* [x] Kiểm tra bảo đảm không hồi quy và phân rã các card chuyên trách trên Hermes Kanban.

### 8.1. Triển khai Backend Services & Endpoints (`be-coder` - Task `t_68058d94`)
* [x] Cài đặt và đăng ký plugin `@fastify/cookie` trong `app.ts`.
* [x] Nâng cấp `AuthController.ts` và `AuthService.ts`: Dual-Token (15m Access Token + 7d HttpOnly SameSite=Strict Cookie), Refresh Token Rotation nguyên tử trong transaction.
* [x] Xây dựng `TokenRevocationManager.ts`: Thu hồi phiên đăng xuất tức thì, lưu vết `RevokedToken` DB kết hợp In-Memory TTL Set cache kiểm tra $O(1)$.
* [x] Nâng cấp máy trạng thái `FollowUserService.ts`: Rẽ nhánh tạo `FollowRequest` PENDING khi đối phương là private account.
* [x] Xây dựng `FetchFollowRequestsService.ts`, `AcceptFollowRequestService.ts`, `RejectFollowRequestService.ts`, `CancelFollowRequestService.ts` và `FollowRequestController.ts`.
* [x] Cập nhật `UserController.ts` và `SocialGraphController.ts`: Khóa danh sách bài viết (`posts: []`, `isLocked: true`) và danh sách follower/following đối với người lạ chưa được duyệt follow.

### 8.2. Triển khai Giao diện Client UI/UX (`fe-coder` - Task `t_b1528658`)
* [x] Nâng cấp `PulseApiClient.ts`: Thêm `credentials: 'include'` cho mọi request, bộ chặn tự động refresh token ngầm khi nhận mã 401 UNAUTHORIZED (In-flight deduplication promise chống refresh storm).
* [x] Nâng cấp `UserProfileView.tsx`: Tấm chắn Khóa tài khoản riêng tư (`Private Account Lock Shield`) kèm icon Lock, ẩn feed bài viết; nút Follow hỗ trợ 3 trạng thái ("Theo dõi", "Đã yêu cầu", "Đang theo dõi").
* [x] Nâng cấp `EditProfileModal.tsx`: Thêm switch toggle "Tài khoản riêng tư" (`isPrivate`).
* [x] Xây dựng `FollowRequestsModal.tsx`: Quản lý danh sách yêu cầu theo dõi đang chờ duyệt kèm hành động Chấp nhận / Xóa; tích hợp badge số lượng trên `NavigationSidebar.tsx` và banner trên `NotificationCenterView.tsx`.

### 8.3. Kiểm duyệt Bảo mật & Penetration Testing (`security-auditor` - Task `t_3d17635f`)
* [x] Audit kiểm tra cờ Cookie: `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/api/v1/auth`.
* [x] Audit kiểm tra Token Rotation & chống Replay Attack (tái sử dụng token cũ bị thu hồi gia đình token).
* [x] Audit kiểm tra Token Denylist: Token đã logout bị chặn 100% tại mọi endpoint.
* [x] Audit kiểm tra các điểm rò rỉ bài viết của Private Account: Phát hiện và vá 5 lỗ hổng (thread replies, explore trending hashtags, search, like/repost gates).
* [x] Xuất báo cáo kiểm toán bảo mật chi tiết tại `docs/SECURITY_AUDIT_TASK21_AUTH_PRIVATE_ACCOUNTS.md`.

### 8.4. Kiểm thử Tự động Hợp nhất (`qa-tester` - Task `t_c0157f8e`)
* [x] `backend/tests/auth-cookie-refresh-denylist.test.mjs`: 25 test cases kiểm thử chu trình dual-token, cookie, rotation, replay defense, denylist.
* [x] `backend/tests/private-accounts-follow-requests.test.mjs`: 37 test cases kiểm thử máy trạng thái FSM follow requests, approval fanout, privacy gates, 2-way block cleanup.
* [x] `backend/tests/auth-private-accounts-security-audit.test.mjs`: 24 test cases kiểm toán thâm nhập độc lập.
* [x] `frontend/tests/private-accounts-visual-states.test.mjs`: 27 test cases kiểm thử visual states của Lock Shield, nút Follow states, modal duyệt.
* [x] Toàn bộ 589/589 tests (415 backend, 174 frontend) đạt 100% PASS tuyệt đối.

---

## PHỤ LỤC (2026-10-01): BASELINE KIỂM THỬ & GIAI ĐOẠN 0 KẾ HOẠCH CẢI TIẾN V2

### Baseline kiểm thử thực đo — NGUỒN SỐ LIỆU DUY NHẤT
Chạy ngày 2026-10-01, Node v26.8.1, PostgreSQL local (user postgres):

| Suite | Lệnh | Kết quả | Thời lượng |
|---|---|---|---|
| Backend (37 file test) | `npm test` (`node --test --test-concurrency=1`) | **415/415 PASS** | 24.4s |
| Frontend (8 file test) | `npm test` | **174/174 PASS** | 0.2s |
| **Tổng baseline** | | **589/589 PASS** | |
| *Cập nhật 2026-10-01 sau GĐ 1* | *sau Hardening Week* | ***605/605 PASS*** (431 backend + 174 frontend) | |

> Ghi chú: con số "476/476" từng ghi trong `improve.md` là số liệu cũ đã lỗi thời. Từ ngày 2026-10-01, mọi số liệu test của dự án chỉ được ghi nhận tại phụ lục này.

### GĐ 0 — Nền tảng quy trình (`IMPROVEMENT_PLAN_V2.md`): ✅ HOÀN THÀNH
* [x] **OPS-01:** `git init` (branch `main`), `.gitignore` (loại `.env`, `dist/`, `uploads/`, `.idea/`, `node_modules/`), initial commit 221 files, branch làm việc `dev`, template `.env.example`.
* [x] **OPS-02:** CI GitHub Actions tại `.github/workflows/ci.yml` — job `backend` (PostgreSQL 16 service container → `prisma db push` → `npm run build` → `tsc --noEmit` → `npm test`) + job `frontend` (`npm run build` + `npm test`), Node 22, cache npm, bắt buộc xanh trước merge vào `main`.




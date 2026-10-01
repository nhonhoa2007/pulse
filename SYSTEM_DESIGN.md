# SYSTEM DESIGN DOCUMENT: PULSE MICROBLOGGING ENGINE

**Version:** 1.0.0  
**Author:** Tech Lead & System Architect  
**Status:** Approved for Implementation  
**Target Environment:** Arch Linux, Node.js v26.8, PostgreSQL 18.6, Fastify, React 18 / Vite  

---

## 1. TỔNG QUAN HỆ THỐNG & MỤC TIÊU KIẾN TRÚC

**Pulse** là một hệ thống mạng xã hội Microblogging phân tán (lấy cảm hứng từ kiến trúc của Meta Threads và Twitter/X), tập trung giải quyết triệt để 5 bài toán kỹ thuật cốt lõi:
1. **Hybrid Fan-out Feed Engine:** Giải quyết bài toán Write Amplification bằng mô hình kết hợp Fan-out on Write (cho người dùng thường) và Fan-out on Read (cho tài khoản Celebrity/KOLs).
2. **ACID Transaction & Concurrency Invariants:** Bảo vệ tính toàn vẹn số đếm (likes, reposts, follower counts) chống race condition bằng PostgreSQL Atomic Updates và Idempotency keys.
3. **Two-Way Social Graph & Block Invariants:** Bảo vệ quyền riêng tư 2 chiều bằng transaction nguyên tử khi chặn (Block): lập tức hủy quan hệ follow 2 chiều và quét sạch bài viết khỏi timeline inboxes.
4. **Flattened Conversation Threading:** Cấu trúc hội thoại phân cấp hỗ trợ Reply, Repost, Quote post với định danh `rootPostId` giúp lấy toàn bộ mạch đàm thoại chỉ với 1 câu query duy nhất.
5. **Smart Notification Aggregator & Real-Time SSE:** Tự động gom nhóm thông báo theo chuẩn ActivityStreams 2.0 và đẩy sự kiện trực tiếp tới client qua Server-Sent Events (SSE).

---

## 2. KIẾN TRÚC TỔNG THỂ (HIGH-LEVEL ARCHITECTURE)

```
[ Frontend: React 18 + Vite + Tailwind CSS + Lucide Icons ]
                           │   ▲
          REST API (JSON)  │   │  Server-Sent Events (SSE Stream)
                           ▼   │
[ Backend: Fastify 4.x + TypeScript + Node.js 26 ]
       ├── API Gateway & Controllers (TypeBox / Validation)
       ├── Domain Services (Posts, Feed, Social Graph, Notifications)
       ├── Background Fan-out Worker (Non-blocking In-process / Queue)
       └── Database Access Layer (Prisma ORM + Native PostgreSQL Driver)
                           │
                           ▼
[ Database: PostgreSQL 18.6 (Localhost:5432 / pulse_social) ]
       ├── Relational Graph: users, follows, blocks
       ├── Content Graph: posts (with root_post_id & reply_to_id)
       ├── Feed Inbox: timeline_inboxes (Pre-computed timeline cache)
       └── Engagements: likes, reposts, bookmarks, notifications, hashtags
```

---

## 3. MÔ HÌNH DỮ LIỆU (DATABASE SCHEMA & ERD)

### 3.1. Entity Relationship Overview
* `User` (1) ──── (N) `Post`
* `User` (N) ──── (N) `User` qua `Follow` (followerId, followingId)
* `User` (N) ──── (N) `User` qua `Block` (blockerId, blockedId)
* `User` (N) ──── (N) `Post` qua `Like`
* `User` (N) ──── (N) `Post` qua `Repost`
* `User` (1) ──── (N) `TimelineInbox` (userId, postId, authorId)
* `Post` (1) ──── (N) `Post` qua quan hệ tự thân (`replyToId`, `rootPostId`, `quoteOfId`)
* `User` (1) ──── (N) `Notification` (recipientId, actorId)

### 3.2. Chi tiết các bảng (Prisma Schema Specification)

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model User {
  id              String   @id @default(uuid())
  username        String   @unique
  email           String   @unique
  displayName     String
  avatarUrl       String?
  bio             String?
  isCelebrity     Boolean  @default(false) // Ngưỡng chuyển sang Fan-out on Read
  followersCount  Int      @default(0)
  followingCount  Int      @default(0)
  postsCount      Int      @default(0)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  posts           Post[]          @relation("UserPosts")
  following       Follow[]        @relation("UserFollowing")
  followers       Follow[]        @relation("UserFollowers")
  blockedUsers    Block[]         @relation("UserBlocker")
  blockedBy       Block[]         @relation("UserBlocked")
  likes           Like[]
  reposts         Repost[]
  bookmarks       Bookmark[]
  timelineInboxes TimelineInbox[] @relation("UserTimeline")
  notificationsReceived Notification[] @relation("NotificationRecipient")
  notificationsActed    Notification[] @relation("NotificationActor")

  @@index([username])
}

model Follow {
  followerId  String
  followingId String
  createdAt   DateTime @default(now())

  follower    User     @relation("UserFollowing", fields: [followerId], references: [id], onDelete: Cascade)
  following   User     @relation("UserFollowers", fields: [followingId], references: [id], onDelete: Cascade)

  @@id([followerId, followingId])
  @@index([followingId])
  @@index([followerId])
}

model Block {
  blockerId String
  blockedId String
  createdAt DateTime @default(now())

  blocker   User     @relation("UserBlocker", fields: [blockerId], references: [id], onDelete: Cascade)
  blocked   User     @relation("UserBlocked", fields: [blockedId], references: [id], onDelete: Cascade)

  @@id([blockerId, blockedId])
  @@index([blockerId])
  @@index([blockedId])
}

model Post {
  id           String   @id @default(uuid())
  authorId     String
  content      String
  mediaUrls    String[] @default([])
  
  // Quan hệ cấu trúc Thread & Repost
  replyToId    String?  // ID của bài cha trực tiếp (nếu là reply)
  rootPostId   String?  // ID của bài gốc đầu tiên trong chuỗi hội thoại
  repostOfId   String?  // ID của bài viết được repost nguyên văn
  quoteOfId    String?  // ID của bài viết được trích dẫn kèm bình luận

  // Phân quyền trả lời (Reply Privacy Controls - TASK-16)
  reply_privacy ReplyPrivacy @default(EVERYONE) // EVERYONE, FOLLOWING, MENTIONED

  // Bộ đếm tương tác (Counters)
  likesCount   Int      @default(0)
  repliesCount Int      @default(0)
  repostsCount Int      @default(0)
  quotesCount  Int      @default(0)

  // Bóc tách nội dung
  hashtags     String[] @default([])
  mentions     String[] @default([])

  isDeleted    Boolean  @default(false)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  author       User     @relation("UserPosts", fields: [authorId], references: [id], onDelete: Cascade)
  replyTo      Post?    @relation("PostReplies", fields: [replyToId], references: [id], onDelete: SetNull)
  replies      Post[]   @relation("PostReplies")
  repostOf     Post?    @relation("PostReposts", fields: [repostOfId], references: [id], onDelete: SetNull)
  reposts      Post[]   @relation("PostReposts")
  quoteOf      Post?    @relation("PostQuotes", fields: [quoteOfId], references: [id], onDelete: SetNull)
  quotes       Post[]   @relation("PostQuotes")

  likes        Like[]
  userReposts  Repost[]
  bookmarks    Bookmark[]
  inboxes      TimelineInbox[]

  @@index([authorId, createdAt(sort: Desc)])
  @@index([rootPostId, createdAt(sort: Asc)])
  @@index([replyToId])
}

model TimelineInbox {
  id        String   @id @default(uuid())
  userId    String   // Người nhận bài viết trên bảng tin của mình
  postId    String
  authorId  String   // Người viết bài
  createdAt DateTime @default(now())

  user      User     @relation("UserTimeline", fields: [userId], references: [id], onDelete: Cascade)
  post      Post     @relation(fields: [postId], references: [id], onDelete: Cascade)

  @@unique([userId, postId])
  @@index([userId, createdAt(sort: Desc)])
}

model Like {
  userId    String
  postId    String
  createdAt DateTime @default(now())

  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  post      Post     @relation(fields: [postId], references: [id], onDelete: Cascade)

  @@id([userId, postId])
  @@index([postId])
}

model Repost {
  userId    String
  postId    String
  createdAt DateTime @default(now())

  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  post      Post     @relation(fields: [postId], references: [id], onDelete: Cascade)

  @@id([userId, postId])
  @@index([postId])
}

model Bookmark {
  userId    String
  postId    String
  createdAt DateTime @default(now())

  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  post      Post     @relation(fields: [postId], references: [id], onDelete: Cascade)

  @@id([userId, postId])
}

model Notification {
  id              String   @id @default(uuid())
  recipientId     String
  actorId         String
  verb            String   // LIKE, REPLY, REPOST, QUOTE, MENTION, FOLLOW
  targetType      String   // POST, USER
  targetId        String
  aggregatedCount Int      @default(1)
  actorSummary    String   // "Hòa, Nam và 3 người khác"
  isRead          Boolean  @default(false)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  recipient       User     @relation("NotificationRecipient", fields: [recipientId], references: [id], onDelete: Cascade)
  actor           User     @relation("NotificationActor", fields: [actorId], references: [id], onDelete: Cascade)

  @@index([recipientId, isRead, createdAt(sort: Desc)])
}

model Hashtag {
  id         String   @id @default(uuid())
  tag        String   @unique
  postsCount Int      @default(0)
  updatedAt  DateTime @updatedAt

  @@index([postsCount(sort: Desc)])
}
```

---

## 4. QUY TẮC BẤT BIẾN & LUỒNG THỰC THI (INVARIANTS & LOGIC FLOWS)

### 4.1. Invariant 1: Thuật toán Bảng tin Lai (Hybrid Fan-Out Algorithm)
1. **Khi User A đăng một bài viết mới (`PublishPostService`):**
   * Nếu `author.isCelebrity === false`:
     * Background worker lấy danh sách `followerId` của A từ bảng `Follow`.
     * Thực hiện Bulk Insert vào bảng `TimelineInbox`:
       ```sql
       INSERT INTO "TimelineInbox" ("id", "userId", "postId", "authorId", "createdAt")
       SELECT gen_random_uuid(), "followerId", $newPostId, $authorId, NOW()
       FROM "Follow" WHERE "followingId" = $authorId
       ON CONFLICT DO NOTHING;
       ```
   * Nếu `author.isCelebrity === true`:
     * **Không đẩy ghi** vào bất kỳ inbox nào để tránh Write Amplification Storm.
2. **Khi User B tải Bảng tin cá nhân (`FetchHomeFeedController`):**
   * Bước 1: Lấy các `postId` từ bảng `TimelineInbox` của B (phân trang theo cursor `createdAt`, limit 20).
   * Bước 2: Tìm danh sách các tài khoản Celebrity mà B đang theo dõi:
     `SELECT followingId FROM Follow f JOIN User u ON f.followingId = u.id WHERE f.followerId = B AND u.isCelebrity = true`.
   * Bước 3: Lấy các bài viết mới nhất từ những Celebrity này trong cùng khoảng thời gian.
   * Bước 4: Thực hiện thuật toán **K-Way Merge** sắp xếp giảm dần theo `createdAt` và trả về danh sách bài viết hoàn chỉnh. Độ phức tạp $O(N \log K)$.

### 4.2. Invariant 2: Bảo vệ Tính Toàn vẹn Concurrency (Atomic Counters & Idempotency)
* Khi một người dùng bấm Like:
  ```sql
  BEGIN;
  INSERT INTO "Like" ("userId", "postId", "createdAt")
  VALUES ($userId, $postId, NOW())
  ON CONFLICT DO NOTHING;

  -- Chỉ tăng counter nếu row thực sự được insert thành công
  UPDATE "Post"
  SET "likesCount" = "likesCount" + 1
  WHERE "id" = $postId AND EXISTS (
    SELECT 1 FROM "Like" WHERE "userId" = $userId AND "postId" = $postId
  );
  COMMIT;
  ```
* Khi Unlike:
  ```sql
  BEGIN;
  DELETE FROM "Like" WHERE "userId" = $userId AND "postId" = $postId;
  UPDATE "Post"
  SET "likesCount" = GREATEST(0, "likesCount" - 1)
  WHERE "id" = $postId;
  COMMIT;
  ```
* Số đếm `likesCount` và `repostsCount` **không bao giờ bị âm** và không bao giờ bị lệch khi hàng nghìn request chạy song song.

### 4.3. Invariant 3: Bảo mật Quyền Riêng tư 2 Chiều khi Chặn (Block Invariants)
Khi User A thực hiện thao tác Chặn User B (`BlockUserService`):
1. Không cho phép tự block chính mình (`blockerId !== blockedId`).
2. Mở một **PostgreSQL Transaction nguyên tử**:
   * Hủy quan hệ follow cả 2 chiều:
     `DELETE FROM "Follow" WHERE ("followerId" = A AND "followingId" = B) OR ("followerId" = B AND "followingId" = A)`
   * Dọn sạch bảng tin 2 chiều:
     `DELETE FROM "TimelineInbox" WHERE ("userId" = A AND "authorId" = B) OR ("userId" = B AND "authorId" = A)`
   * Ghi nhận vào bảng `Block`:
     `INSERT INTO "Block" ("blockerId", "blockedId") VALUES (A, B) ON CONFLICT DO NOTHING`
   * Cập nhật lại số lượng `followersCount` và `followingCount` cho cả 2 tài khoản.
3. Mọi truy vấn xem Feed, Profile, Thread hoặc Search đều có điều kiện kiểm tra quan hệ block: nếu tồn tại bất kỳ bản ghi nào trong `Block` giữa 2 người (A chặn B hoặc B chặn A), kết quả trả về `404 Not Found` hoặc lọc bỏ khỏi danh sách.

### 4.4. Invariant 4: Cấu trúc Chuỗi Hội thoại (Conversation Threading)
* Khi Post C trả lời Post B (bài B vốn là trả lời bài A):
  * `replyToId = B.id`
  * `rootPostId = B.rootPostId || B.id` (luôn luôn trỏ về gốc `A.id`).
* Lấy toàn bộ cây đàm thoại:
  `SELECT * FROM "Post" WHERE "rootPostId" = $rootId OR "id" = $rootId ORDER BY "createdAt" ASC;`
  -> Chỉ tốn **1 câu SQL duy nhất**, không đệ quy, không $N+1$ query.

### 4.5. Invariant 5: Bộ gom Thông báo Thông minh (Notification Aggregator)
* Cửa sổ gom nhóm: 24 giờ.
* Nếu trong vòng 24 giờ có nhiều người cùng Like bài viết X của User A:
  * Hệ thống tìm kiếm bản ghi thông báo chưa đọc (`isRead = false`) có cùng `(recipientId, targetId, verb = 'LIKE')`.
  * Nếu đã tồn tại: Cập nhật `aggregatedCount = aggregatedCount + 1`, `actorId = người mới nhất`, `actorSummary = "Người A, Người B và X người khác"`.
  * Nếu chưa tồn tại: Tạo mới bản ghi `Notification`.

---

## 5. API CONTRACTS (REST DTO SPECIFICATIONS)

Tất cả API trả về cấu trúc chuẩn:
```typescript
interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}
```

### 5.1. Authentication / Current User Context
* Dự án hỗ trợ header `x-user-id` mô phỏng phiên đăng nhập của người dùng để kiểm thử nhanh chóng và độc lập.

### 5.2. Post & Thread Endpoints
* `POST /api/v1/posts`: Đăng bài viết mới hoặc bài trả lời (reply) / quote post.
  * Body: `{ content: string, mediaUrls?: string[], replyToId?: string, quoteOfId?: string }`
* `GET /api/v1/posts/:id`: Lấy chi tiết bài viết kèm thông tin author, parent post, quote post.
* `GET /api/v1/posts/:id/thread`: Lấy toàn bộ chuỗi thảo luận (root post + tất cả replies liên quan).
* `POST /api/v1/posts/:id/like`: Bật/tắt trạng thái Like (Toggle).
* `POST /api/v1/posts/:id/repost`: Bật/tắt trạng thái Repost.

### 5.3. Feed & Timeline Endpoints
* `GET /api/v1/feed/home`: Lấy bảng tin cá nhân kết hợp (Hybrid Timeline).
  * Query: `?cursor=<timestamp>&limit=20`
* `GET /api/v1/feed/user/:username`: Lấy danh sách bài viết trên trang cá nhân của một người.

### 5.4. Social Graph Endpoints
* `POST /api/v1/graph/follow`: Theo dõi người dùng (`{ targetUserId: string }`).
* `POST /api/v1/graph/unfollow`: Hủy theo dõi (`{ targetUserId: string }`).
* `POST /api/v1/graph/block`: Chặn người dùng (`{ targetUserId: string }`).
* `POST /api/v1/graph/unblock`: Bỏ chặn người dùng (`{ targetUserId: string }`).
* `GET /api/v1/users/:username`: Xem hồ sơ người dùng kèm trạng thái follow/blocked tương ứng.

### 5.5. Notifications & Real-Time SSE
* `GET /api/v1/notifications`: Lấy danh sách thông báo đã gom nhóm.
* `PATCH /api/v1/notifications/read-all`: Đánh dấu tất cả là đã đọc.
* `GET /api/v1/realtime/stream`: Server-Sent Events stream đẩy trực tiếp các sự kiện:
  * `EVENT: NEW_TIMELINE_POST` (khi có bài viết mới đẩy vào inbox)
  * `EVENT: NEW_NOTIFICATION` (khi có tương tác mới)

---

## 6. TIÊU CHUẨN KIỂM THỬ (TESTING & VERIFICATION)

Toàn bộ test suite được viết bằng `node:test` + `node:assert/strict` trong thư mục `backend/tests/`:
1. `feed-hybrid-fanout.test.mjs`: Kiểm tra phân phối bài viết giữa tài khoản thường (push) và tài khoản Celebrity (pull + merge).
2. `concurrency-atomic-likes.test.mjs`: Giả lập 50 requests đồng thời like/unlike cùng một bài viết; kiểm tra số `likesCount` cuối cùng khớp 100%.
3. `social-graph-block-invariants.test.mjs`: Kiểm tra việc A block B xóa sạch follow 2 chiều, dọn dẹp inboxes và ngăn truy cập bài viết.
4. `conversation-thread.test.mjs`: Kiểm tra tạo chuỗi reply 3 cấp và lấy toàn bộ thread trong 1 query.
5. `notification-aggregation.test.mjs`: Kiểm tra tính năng gom nhiều lượt like thành 1 thông báo tổng hợp.
6. `interactive-polls.test.mjs`: Kiểm tra toàn diện vòng đời Poll, tính nguyên tử khi 50 user vote đồng thời, đẩy SSE real-time và bộ đếm hết hạn.

---

## 7. HỆ THỐNG LIÊN HỢP ACTIVITYPUB (FEDIVERSE FEDERATION ENGINE)

Chi tiết đặc tả kiến trúc toàn diện xem tại: [`docs/ACTIVITYPUB_ARCHITECTURE_SPEC.md`](./docs/ACTIVITYPUB_ARCHITECTURE_SPEC.md) và [`ACTIVITYPUB_SPEC.md`](./ACTIVITYPUB_SPEC.md).

### 7.1. Căn cứ Tiêu chuẩn & Tương thích
* **W3C ActivityPub Recommendation (2018):** Inbox/Outbox model, Actor dereferencing.
* **W3C ActivityStreams 2.0:** Định dạng JSON-LD cho Object và Activity.
* **RFC 7033 (WebFinger):** Endpoint `/.well-known/webfinger` phục vụ tìm kiếm tài khoản Fediverse.
* **draft-cavage-http-signatures-12:** Tiêu chuẩn xác thực chữ ký HTTP bắt buộc của Fediverse (Mastodon & Meta Threads).

### 7.2. Các Thành phần Cốt lõi
1. **WebFinger Discovery (`/.well-known/webfinger`):**
   * Định dạng phản hồi `application/jrd+json; charset=utf-8`, header `Access-Control-Allow-Origin: *`.
   * Hỗ trợ chuẩn hóa `acct:username@domain` và trỏ về actor URL qua rel `self`.
2. **Dual Actor Architecture:**
   * `User Actor` (`Person`) tại `/users/:username` cho tài khoản cá nhân.
   * `Instance Actor` (`Application`) tại `/actor` cho toàn hệ thống để phá vỡ vòng lặp xác thực (infinite fetch loop) khi các máy chủ Fediverse chạy ở chế độ `authorized_fetch` / `secure_mode`.
3. **Draft-Cavage HTTP Signatures:**
   * Cặp khóa RSA 2048-bit PKCS#1 v1.5 với thuật toán `rsa-sha256`.
   * Inbound verification: Parse `Signature` header, kiểm tra độ lệch thời gian (clock skew $\le 300$s), kiểm tra băm `Digest: SHA-256=...` trên body bằng `crypto.timingSafeEqual`, xác thực chữ ký bằng public key của remote actor.
   * Outbound signing: Tự động ký các activity gửi tới remote inboxes với các header `(request-target)`, `host`, `date`, `digest`.
4. **Inbox/Outbox Data Flow & State Machine:**
   * Inbound: Xử lý các hoạt động `Follow`, `Undo`, `Create (Note)`, `Accept`, `Delete`, `Like`, `Announce`.
   * Tự động phản hồi `Accept` khi nhận được `Follow`.
   * Phân phối bài viết từ remote actor vào `TimelineInbox` của người theo dõi tại local.
   * Outbox: Hàng đợi `ActivityDeliveryJob` xử lý gửi bài viết bất đồng bộ với cơ chế retry exponential backoff và tối ưu hóa `sharedInboxUrl` để giảm thiểu write amplification.
5. **Security Invariants:**
   * **SSRF Guard:** Chặn tuyệt đối mọi kết nối tới IP private (RFC 1918, RFC 3927, Loopback `127.0.0.1`, Link-local, IPv6 `::1`), kiểm tra trước khi fetch remote keys/inboxes và ghim IP để chống DNS Rebinding.
   * **Replay Protection:** Giới hạn thời gian $\pm 300$s và cache chữ ký đã kiểm tra.
   * **DoS Protection:** Giới hạn body 256KB và connection timeout 5000ms.

---

## 8. TÍNH NĂNG BÌNH CHỌN TƯƠNG TÁC (INTERACTIVE POLLS ENGINE)

### 8.1. Mô hình Dữ liệu (Database Schema)
* **`Poll`**: Thực thể chính chứa câu hỏi (`question`), thời điểm hết hạn (`expiresAt`), trạng thái hoạt động (`isActive`), liên kết 1-1 với `Post` qua `postId`.
* **`PollChoice`**: Mỗi bình chọn có từ 2 đến 4 lựa chọn, lưu trữ vị trí (`index`), nội dung (`text`), và số lượt vote (`voteCount`). Khóa duy nhất `@@unique([pollId, index])`.
* **`PollVote`**: Lưu vết người đã vote (`userId`, `pollId`, `choiceId`, `choiceIndex`). Khóa duy nhất `@@unique([pollId, userId])` ngăn chặn triệt để hành vi vote 2 lần ở tầng cơ sở dữ liệu.

### 8.2. Invariant Concurrency & Atomic Increments
* Khi người dùng vote (`VotePollService`):
  * Mọi thao tác thực hiện trong một **PostgreSQL Transaction** (`prisma.$transaction`).
  * Kiểm tra trạng thái bình chọn: từ chối nếu `!isActive` hoặc `NOW() >= expiresAt` (HTTP 409 `POLL_EXPIRED`).
  * Validate `choiceIndex` trong phạm vi $0 \le \text{choiceIndex} < \text{choices.length}$ (HTTP 400 `INVALID_CHOICE_INDEX`).
  * Thực hiện ghi nhận `PollVote`: nếu người dùng đã vote, vi phạm ràng buộc `@@unique([pollId, userId])` ném lỗi P2002 ngay lập tức được chuyển đổi thành HTTP 409 `ALREADY_VOTED`.
  * Tăng số đếm vote nguyên tử trên lựa chọn tương ứng:
    ```sql
    UPDATE "poll_choices" SET "vote_count" = "vote_count" + 1 WHERE "id" = $choiceId;
    ```
  * Loại trừ 100% rủi ro race condition hoặc sai lệch số vote dưới tải đồng thời (đã kiểm chứng qua 50 request song song).

### 8.3. Thời gian thực (Real-time SSE Broadcast)
* Ngay sau khi vote thành công (< 500 ms):
  * Tính toán lại tỷ lệ phần trăm các lựa chọn: $\text{percentage} = \frac{\text{voteCount}}{\text{totalVotes}} \times 100$ (hoặc $0\%$ nếu chưa có lượt vote nào).
  * Đẩy event `POLL_UPDATED` và `POLL_VOTED` qua kênh Server-Sent Events `/api/v1/realtime/stream` tới toàn bộ client đang kết nối.

### 8.4. Cơ chế Hết hạn Tự động (Poll Expiration Scheduler)
* Dịch vụ `PollExpirationSchedulerService` chạy background định kỳ mỗi 1 giây (quét các poll có `expiresAt <= NOW()` và `isActive = true`), kết hợp timer chính xác (`setTimeout`) cho các poll sắp hết hạn.
* Đảm bảo thời điểm chuyển trạng thái `isActive = false` diễn ra trong phạm vi $\pm 1$s (đạt tiêu chuẩn $\pm 5$s của hệ thống).
* Khi hết hạn, scheduler tự động phát sự kiện SSE `POLL_EXPIRED` và `POLL_UPDATED` để client vô hiệu hóa form voting và hiển thị trạng thái "Poll closed".

### 8.5. API Endpoints
* `POST /polls` (và `/api/v1/polls`): Tạo bình chọn mới gắn với bài viết (HTTP 201).
* `GET /polls/:id` (và `/api/v1/polls/:id`): Lấy thông tin bình chọn kèm số vote và tỷ lệ phần trăm (HTTP 200).
* `POST /polls/:id/vote` (và `/api/v1/polls/:id/vote`): Gửi lượt vote (HTTP 200).
* `DELETE /polls/:id` (và `/api/v1/polls/:id`): Đóng / kết thúc bình chọn sớm (HTTP 200).

---

## 9. TRUST, SAFETY & POST LIFECYCLE MANAGEMENT (TASK-18)

### 9.1. Cửa sổ Chỉnh sửa 15 Phút & Bảng Lịch sử Bất biến (`PostVersion`)
1. **Quy tắc Nghiệp vụ:**
   * Tác giả bài viết (`post.authorId === currentUserId`) được quyền chỉnh sửa nội dung bài viết trong vòng tối đa **15 phút (900 giây)** tính từ `post.createdAt`.
   * Thời gian được kiểm chứng dựa trên Server Timestamp (`Date.now() - post.createdAt.getTime() <= 900000 ms`). Nếu quá 15 phút, trả về HTTP 403 `EDIT_WINDOW_EXPIRED`.
   * Người khác không được quyền chỉnh sửa bài viết (HTTP 403 `FORBIDDEN`).
2. **Cơ chế Snapshotting Bất biến (`PostVersion`):**
   * Lần chỉnh sửa đầu tiên (`post.editCount === 0`): Snapshot bản gốc của bài viết thành bản ghi `PostVersion` với `versionNumber = 1`.
   * Các lần chỉnh sửa kế tiếp: Tạo bản ghi `PostVersion` với `versionNumber = post.editCount + 1`.
   * Cập nhật `Post`: `content`, `mediaUrls`, `contentWarning`, `isSensitive`, `hashtags`, `mentions`, `isEdited = true`, `editCount = editCount + 1`, `lastEditedAt = new Date()`.
   * Toàn bộ quá trình diễn ra trong 1 atomic transaction (`prisma.$transaction`).
   * Bảng `PostVersion` là append-only, không thể sửa đổi đơn lẻ.
3. **Endpoint Lịch sử Chỉnh sửa:**
   * `GET /api/v1/posts/:id/versions`: Trả về danh sách phiên bản cũ và phiên bản hiện tại, công khai cho người có quyền xem bài viết.

### 9.2. Ghim Bài viết vào Trang Cá nhân (Pinned Post to Profile)
1. **Quy tắc Nghiệp vụ:**
   * Mỗi tài khoản có tối đa 1 bài viết được ghim vào trang cá nhân (`User.pinnedPostId`).
   * Chỉ được ghim bài viết do chính mình tạo ra (`post.authorId === currentUserId`). Không được ghim bài viết của người khác (HTTP 403 `FORBIDDEN`).
   * Không được ghim bài viết trả lời / reply (`post.replyToId !== null`) hoặc bài viết đã xóa (HTTP 400).
   * Ghim bài viết mới tự động thay thế bài viết ghim trước đó mà không cần gỡ thủ công.
   * Khi bài viết được ghim bị xóa: `User.pinnedPostId` tự động chuyển về `null` (`onDelete: SetNull`).
2. **Hiển thị Trang Cá nhân:**
   * Khi gọi `GET /api/v1/users/:username/posts`, nếu `user.pinnedPostId` tồn tại:
     * Truy vấn bài viết ghim, đánh dấu cờ ảo `isPinned: true`.
     * Ghép bài viết ghim vào vị trí đầu tiên (Index 0) của danh sách bài viết.
     * Các bài viết thông thường còn lại loại trừ `pinnedPostId` và sắp xếp theo `createdAt DESC`.

### 9.3. Tắt tiếng Một chiều (One-Way Mute Users & Keywords)
1. **Tắt tiếng Người dùng (`UserMute`):**
   * Hoạt động theo nguyên lý **Stealth Filter (Bộ lọc âm thầm)**: Phía bị tắt tiếng hoàn toàn không biết mình bị tắt tiếng.
   * **Không phá vỡ Social Graph**: Mối quan hệ `Follow` và dữ liệu `TimelineInbox` được bảo toàn nguyên vẹn 100%.
   * Không cho phép tự tắt tiếng chính mình (HTTP 400 `SELF_MUTE_NOT_ALLOWED`).
   * Bộ lọc truy vấn thời gian thực (Read-time filter):
     * Home Timeline (`HybridFeedTimelineService`): Loại trừ bài viết có `authorId IN (mutedUserIds)`.
     * Notifications: Loại trừ thông báo có `actorId IN (mutedUserIds)`.
     * Real-time SSE: Ngăn chặn đẩy event từ user bị tắt tiếng tới người tắt tiếng.
2. **Tắt tiếng Từ khóa (`KeywordMute`):**
   * Cho phép người dùng tắt tiếng theo từ khóa, cụm từ, hoặc hashtag.
   * Hỗ trợ 2 kiểu khớp (`MuteMatchType`): `CONTAINS` (chuỗi con) và `EXACT_WORD` (ranh giới từ regex `\bkeyword\b`).
   * Hỗ trợ ngữ cảnh áp dụng (`MuteContext`): `HOME_TIMELINE`, `NOTIFICATIONS`, hoặc `ALL`.
   * Hỗ trợ thời hạn hết hạn (`expiresAt`): 24h, 7 ngày, 30 ngày hoặc vĩnh viễn (`null`). Khi hết hạn, bộ lọc tự động vô hiệu hóa.

### 9.4. Cảnh báo Nội dung & Tấm chắn Spoiler (Content Warnings)
1. **Lưu trữ & Tương thích:**
   * Trường `isSensitive Boolean @default(false)` và `contentWarning String?` trên bảng `Post`.
   * Tương thích hai chiều với W3C ActivityStreams 2.0: Map `post.contentWarning` <-> `summary`, `post.isSensitive` <-> `sensitive`.
2. **Trải nghiệm Giao diện (Threads Light Theme):**
   * Bài viết có cảnh báo nội dung hiển thị tấm chắn spoiler: Nền xám nhạt `#f4f4f5`, viền `1px solid #e4e4e7`, bo góc `12px`, icon `EyeOff` kèm nhãn cảnh báo.
   * Nút tương tác *"Xem bài viết"* / *"Show post"* cho phép mở hoặc đóng lại nội dung theo ý muốn.
   * Hình ảnh nhạy cảm được làm mờ với hiệu ứng `blur-md` và overlay cảnh báo cho đến khi người dùng chủ động nhấn xem.

---

## 10. FEDIVERSE DEEPENING (TASK-19: NODEINFO 2.1, REMOTE DISCOVERY & OUTBOUND FEDERATION)

### 10.1. Giao thức NodeInfo 2.1 & FEP-0151 Discovery
* **Mục tiêu:** Cung cấp metadata cấp máy chủ cho mạng lưới Fediverse và các công cụ lập chỉ mục (Fediverse indexers: fediverse.observer, the-federation.info).
* **Endpoints:**
  * `GET /.well-known/nodeinfo`: Trả về tài liệu JRD liên kết tới schema 2.1 và 2.0 theo chuẩn FEP-0151.
  * `GET /nodeinfo/2.1`: Trả về siêu dữ liệu máy chủ tuân thủ đầy đủ schema `http://nodeinfo.diaspora.software/ns/schema/2.1#` gồm: `software` (name: "pulse", version), `protocols` (activitypub), `services` (inbound, outbound), `openRegistrations`, `usage` (users: total, activeHalfyear, activeMonth; localPosts; localComments), và `metadata` (nodeName, nodeDescription, staffAccounts, federation: { enabled: true }).

### 10.2. Federated Remote Discovery từ UI (@user@domain)
* **Khám phá Hai Chiều:** Người dùng có thể tìm kiếm bất kỳ handle Fediverse nào (`@user@domain` hoặc `user@domain` hoặc HTTPS Actor URL) trực tiếp từ thanh tìm kiếm.
* **Quy trình Phân giải An toàn:**
  1. Kiểm tra cache trong `FederatedActor` để trả về ngay lập tức nếu đã biết.
  2. Kích hoạt WebFinger lookup `GET https://{domain}/.well-known/webfinger?resource=acct:{user}@{domain}` được bảo vệ bằng `SsrfProtectionGuardService` (chặn dải IP nội bộ, loopback, AWS metadata).
  3. Lấy JSON-LD Actor từ `actorUri`, xác minh nguồn gốc và bọc lọc Stored XSS trong bio/displayName.
  4. Tạo shadow `User` cục bộ (`isRemote: true`, `federatedActorId: actor.id`) để cho phép người dùng Pulse theo dõi (Follow), xem bài viết và tương tác mượt mà.

### 10.3. Outbound & Inbound ActivityPub Like & Announce Federation
* **Outbound Like & Undo:** Khi người dùng bấm Thích bài viết từ xa, hệ thống tạo Activity `Like` và chuyển phát bất đồng bộ tới inbox của tác giả bài viết; khi bỏ thích tạo Activity `Undo` gói `Like`.
* **Outbound Announce (Repost) & Undo:** Khi bấm Đăng lại bài viết từ xa hoặc bài viết có người theo dõi từ xa, hệ thống tạo Activity `Announce` chuyển phát tới tác giả và tất cả các sharedInbox của các follower từ xa qua `ActivityDeliveryWorkerService` ký bởi HTTP Signatures (draft-cavage-12).
* **Inbound Handling:** Xử lý `Like` và `Announce` từ các máy chủ ngoài gửi tới bài viết cục bộ, cập nhật số đếm nguyên tử và thông báo thời gian thực.

---

## 11. ALGORITHMIC FEEDS & GROUP REAL-TIME COMMUNICATIONS (TASK-20: PHASE C)

### 11.1. "For You" Recommendation Heuristic Feed Engine
* **Mục tiêu:** Cung cấp luồng khám phá nội dung tự động cá nhân hóa ("Dành cho bạn" / "For You") song song với bảng tin thời gian thực ("Đang theo dõi" / "Following").
* **Thuật toán Xếp hạng Đa nhân tố (Multi-factor Gravity Heuristic):**
  $$Score(P, U) = \left( \frac{W_{\text{engagement}}(P) \times A_{\text{affinity}}(P, U)}{(T_{\text{age\_hours}}(P) + 2)^\gamma} \right) \times D_{\text{author}}(P)$$
  1. **Trọng số Tương tác ($W_{\text{engagement}}$):** Kết hợp tỷ lệ trọng số giữa lượt Thích ($1.0$), Đăng lại ($2.0$), Trả lời ($1.5$), Trích dẫn ($2.5$) và hàm logarit lượt xem $0.5 \cdot \log_{10}(1 + viewsCount)$.
  2. **Độ thân thuộc Mạng xã hội ($A_{\text{affinity}}$):** Tác giả người dùng theo dõi trực tiếp ($\times 2.0$), có bạn chung mạng xã hội ($\times 1.5$), KOL/Celebrity ($\times 1.2$), tài khoản mới/khám phá ($\times 1.0$).
  3. **Hàm suy giảm Trọng lực Thời gian ($T_{\text{age\_hours}} + 2)^\gamma$:** $\gamma = 1.5$ đảm bảo bài viết mới nổi bật và ngăn bài cũ viral chiếm đỉnh vĩnh viễn.
  4. **Phạt Độc quyền Tác giả ($D_{\text{author}}$):** Giới hạn tối đa bài viết từ cùng một tác giả trong một trang kết quả (bài 1: $1.0$, bài 2: $0.6$, bài 3: $0.3$, bài $\ge 4$: loại bỏ).
  5. **Bảo vệ Tính toàn vẹn Riêng tư:** Lọc sạch tuyệt đối bài viết từ tác giả bị Chặn 2 chiều, Tắt tiếng (Muted user) và Từ khóa bị tắt tiếng (Keyword mutes) đang hiệu lực.

### 11.2. Bộ đệm Đếm Lượt xem & Ấn tượng Bài viết (Post Views / Impressions Counter Buffer)
* **Vấn đề Kỹ thuật:** Việc ghi trực tiếp `UPDATE "Post" SET "viewsCount" = "viewsCount" + 1` cho mỗi lần bài viết xuất hiện trên màn hình (viewport intersection) gây ra Write-Amplification nghiêm trọng, xung đột khóa dòng (row-level locks) và nghẽn tài nguyên PostgreSQL.
* **Kiến trúc Bộ đệm Ghi sau (Write-Behind In-Memory Buffer):**
  1. Client gửi mảng post IDs nhìn thấy theo lô: `POST /api/v1/posts/views` (`{ postIds: string[] }`).
  2. Bộ lọc chống gian lận (Deduplication filter): Sử dụng cache bộ nhớ gắn nhãn `userId:postId` hoặc `clientIp:postId` với cửa sổ làm nguội 30 phút, chống spam F5/reload.
  3. Bộ đệm tích lũy `PostImpressionsBufferService`: Tích lũy số đếm trong memory map và tự động xả (flush) định kỳ mỗi 5 giây hoặc khi bộ đệm đạt ngưỡng 100 items bằng câu lệnh SQL nguyên tử `UPDATE "Post" SET "viewsCount" = "viewsCount" + delta`.
  4. Cơ chế Graceful Shutdown tự động xả sạch bộ đệm khi server dừng.

### 11.3. Hệ thống Nhắn tin Nhóm Thời gian thực (Group DMs)
* **Mô hình Dữ liệu Độc lập & Tương thích 100%:**
  * `GroupConversation`: Nhóm chat đa thành viên (`title`, `avatarUrl`, `creatorId`, `createdAt`, `updatedAt`).
  * `GroupMember`: Quản lý thành viên và phân quyền (`role`: `ADMIN` | `MEMBER`, `joinedAt`).
  * `GroupMessage`: Tin nhắn nhóm (`content`, `messageType`, `mediaUrls`, `deletedAt`).
  * `GroupReadReceipt`: Đánh dấu điểm đọc và tính toán unread count chính xác từng thành viên.
* **Bảo đảm An ninh & Invariants:**
  * **Ràng buộc Chặn (Block Invariant):** Không thể tạo nhóm hoặc thêm thành viên nếu tồn tại quan hệ chặn 2 chiều giữa người thêm và thành viên đích.
  * **Ranh giới Phân quyền (Access Boundary & IDOR):** Chỉ thành viên chính thức mới có quyền đọc tin nhắn, gửi tin nhắn hoặc xem danh sách nhóm. Người ngoài bị từ chối 403 `FORBIDDEN`.
  * **Quyền Quản trị (Admin Permissions):** Chỉ `ADMIN` mới được đổi tên nhóm, avatar, thêm hoặc xóa thành viên. Thành viên thường được quyền tự rời nhóm.
  * **Phát sóng SSE Thời gian thực:** Sự kiện `dm.group.message.new` được đẩy tức thì tới toàn bộ thành viên đang kết nối.

### 11.4. Phân hệ Web Push Notifications (IETF RFC 8030 / RFC 8292 VAPID)
* **Chuẩn hóa Giao thức:**
  * Tuân thủ IETF RFC 8030 (Generic Event Delivery Using HTTP Push) và RFC 8292 (Voluntary Application Server Identification for Web Push).
  * Cặp khóa Bất đối xứng NIST P-256 (`prime256v1` / `secp256r1`) sinh bằng native Node.js `crypto`.
  * Tạo header xác thực VAPID: `Authorization: vapid t=<JWT>, k=<VAPID_PUBLIC_KEY_BASE64URL>` với chữ ký thuật toán `ES256`.
* **Vòng đời Đăng ký & Tự động Dọn dẹp (Auto-Pruning):**
  * Bảng `WebPushSubscription` lưu trữ `endpoint` (unique), `p256dh`, `auth`, `userAgent`.
  * Cung cấp endpoint `GET /api/v1/push/vapid-public-key` cho Service Worker client đăng ký `pushManager.subscribe`.
  * Khi gửi thông báo, nếu Push Service (FCM, Mozilla Autopush, Apple Push) trả về HTTP 404 (`Not Found`) hoặc 410 (`Gone`), hệ thống tự động xóa bản ghi đăng ký khỏi cơ sở dữ liệu để chống lãng phí tài nguyên.





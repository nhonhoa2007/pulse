# KIẾN TRÚC HỆ THỐNG: TRUST, SAFETY & POST LIFECYCLE MANAGEMENT (TASK-18)
## Đặc tả Kỹ thuật Toàn diện cho Giai đoạn Phase A: Pulse Social Engine

**Tác giả:** Tech Lead & System Architect  
**Trạng thái:** Nghiệm thu Kiến trúc & Chuyển giao Triển khai (`Approved for Implementation`)  
**Mục tiêu hệ thống:** Thiết lập nền tảng tin cậy, an toàn người dùng và quản lý vòng đời bài viết hoàn chỉnh cho mạng xã hội Pulse, bao gồm:
1. Cửa sổ chỉnh sửa 15 phút nghiêm ngặt với nhật ký kiểm toán bất biến `PostVersion` (Immutable Audit Trail).
2. Tính năng ghim bài viết vào trang cá nhân (Pinned Post to Profile).
3. Hệ thống tắt tiếng một chiều không đối xứng (One-Way Mute Users & Muted Keywords).
4. Cảnh báo nội dung nhạy cảm & tấm chắn spoiler (Content Warnings / Sensitive Media Shield).

---

## 1. TỔNG QUAN & CĂN CỨ TIÊU CHUẨN (EXECUTIVE SUMMARY & GROUNDED CITATIONS)

Hệ thống Trust, Safety & Post Lifecycle được thiết kế dựa trên các tiêu chuẩn kỹ thuật mạng xã hội hàng đầu thế giới:
* **Meta Threads Post Edit Window Specification (2023-present):** Chuẩn cửa sổ chỉnh sửa 15 phút (900 giây) tính từ thời điểm đăng bài, hiển thị bộ đếm lùi và lưu giữ lịch sử chỉnh sửa để ngăn chặn hành vi lừa đảo (Bait-and-Switch scam).[1]
* **Twitter/X Edit Tweets & Version Audit Specification (2022-present):** Cơ chế lưu vết bất biến các phiên bản bài viết (`PostVersion`), đánh dấu huy hiệu "Đã chỉnh sửa" và cho phép người dùng xem lịch sử thay đổi công khai minh bạch.[2]
* **W3C ActivityStreams 2.0 Core & Vocabulary Specification:** Chuẩn hóa các trường `summary` (Content Warning description), `sensitive` (Sensitive media flag), và hoạt động `Update` Note khi bài viết được chỉnh sửa.[3]
* **Mastodon Filters v2 & Moderation Protocol:** Cơ chế bộ lọc từ khóa một chiều (Keyword Muting) theo ngữ cảnh (`home`, `notifications`) kèm thời hạn tự hủy (`expires_at`), và tính năng tắt tiếng tài khoản âm thầm (Silent Account Muting) không làm xáo trộn Social Graph.[4]

```
+----------------------------------------------------------------------------------------------------+
|                                    PULSE SOCIAL SYSTEM ARCHITECTURE                                |
+----------------------------------------------------------------------------------------------------+
                                                  │
                ┌─────────────────────────────────┴─────────────────────────────────┐
                ▼                                                                   ▼
+───────────────────────────────────────────────+   +───────────────────────────────────────────────+
|         POST LIFECYCLE MANAGEMENT             |   |            TRUST & SAFETY SUBSYSTEM           |
|                                               |   |                                               |
| 1. 15-Min Edit Window & Immutable Audit Trail |   | 3. One-Way Mute (Users & Keywords)            |
|    - Time check: now() - createdAt <= 15m     |   |    - Silent stealth filtering (Non-breaking)  |
|    - PostVersion snapshotting (Immutable)     |   |    - Context: Home Timeline, Notifications    |
|    - Version History API (GET /versions)      |   |    - Exact word boundary & Contains matching  |
|                                               |   |    - Expiring keywords (24h, 7d, 30d, forever)|
| 2. Pinned Post to Profile                     |   |                                               |
|    - O(1) User.pinnedPostId lookup            |   | 4. Content Warnings & Sensitive Media Shield  |
|    - Author ownership & root post invariant   |   |    - W3C AS2 summary & sensitive interop      |
|    - Prepend to user profile posts list       |   |    - Threads Light Theme spoiler/blur shield  |
+───────────────────────────────────────────────+   +───────────────────────────────────────────────+
                                                  │
                                                  ▼
+───────────────────────────────────────────────────────────────────────────────────────────────────+
|                             DATABASE SCHEMA EXTENSION (PostgreSQL 18)                             |
|                                                                                                   |
|   User  ──(1:1)──> pinnedPost (Post)                                                              |
|   Post  ──(1:N)──> PostVersion (postId, versionNumber, content, mediaUrls, contentWarning, etc.)  |
|   User  ──(1:N)──> UserMute (muterId, mutedId)                                                    |
|   User  ──(1:N)──> KeywordMute (userId, keyword, matchType, muteContext, expiresAt)               |
+───────────────────────────────────────────────────────────────────────────────────────────────────+
```

---

## 2. CHI TIẾT 4 TRỤ CỘT KỸ THUẬT (THE 4 TECHNICAL PILLARS)

### TRỤ CỘT 1: CỬA SỔ CHỈNH SỬA 15 PHÚT & NHẬT KÝ KIỂM TOÁN BẤT BIẾN (`PostVersion`)

#### 1.1. Quy tắc Nghiệp vụ & Các Bất biến Bắt buộc (Invariants)
1. **Quyền sở hữu tác giả (Author Ownership Invariant):**
   * Chỉ duy nhất tác giả của bài viết (`post.authorId === currentUserId`) mới có quyền chỉnh sửa.
   * Nếu người khác cố tình gửi request: Lập tức trả về HTTP `403 Forbidden` (`FORBIDDEN`).
2. **Cửa sổ thời gian nghiêm ngặt 15 phút (15-Minute Window Invariant):**
   * Thời gian được tính toán dựa trên **Server Database Timestamp** (`now()`), tuyệt đối không tin tưởng client time.
   * Công thức: `const isWithinWindow = (Date.now() - new Date(post.createdAt).getTime()) <= 15 * 60 * 1000;`
   * Nếu quá 900,000 ms (15 phút 0 giây): Server từ chối cập nhật với HTTP `403 Forbidden` (`EDIT_WINDOW_EXPIRED`, message: *"Bài viết chỉ có thể chỉnh sửa trong vòng 15 phút sau khi đăng"*).
3. **Tính bất biến của Audit Trail (Immutable Versioning):**
   * Mỗi lần chỉnh sửa, nội dung trước đó PHẢI được snapshot nguyên vẹn vào bảng `PostVersion`.
   * Ở lần chỉnh sửa đầu tiên (`post.editCount === 0`): Snapshot bản thảo gốc ban đầu thành `versionNumber: 1`.
   * Ở các lần chỉnh sửa tiếp theo: Tạo bản ghi `PostVersion` với số thứ tự tăng dần (`versionNumber: post.editCount + 1`).
   * Bảng `PostVersion` là **Append-Only / Immutable**: Không cho phép bất kỳ API nào sửa đổi (`UPDATE`) hoặc xóa đơn lẻ bản ghi trong bảng này.
4. **Bảo toàn định danh & các liên kết phụ thuộc:**
   * `id` của bài viết không bao giờ thay đổi. Mọi liên kết `replyToId`, `rootPostId`, `quoteOfId`, `likes`, `reposts`, `bookmarks` vẫn giữ nguyên vẹn.
   * Cập nhật các trường trên `Post`: `content`, `mediaUrls`, `hashtags`, `mentions`, `contentWarning`, `isSensitive`, `isEdited: true`, `editCount: post.editCount + 1`, `lastEditedAt: new Date()`.
   * Re-parse hashtags và mentions mới từ nội dung bài viết.
5. **Đồng bộ hóa Fediverse ActivityPub:**
   * Nếu bài viết đã liên hợp (hoặc có remote followers), phát hành Activity `Update` chuẩn W3C ActivityStreams 2.0 tới Outbox delivery queue.

#### 1.2. Lược đồ Dữ liệu `PostVersion`
```prisma
model PostVersion {
  id             String   @id @default(uuid())
  postId         String   @map("post_id")
  versionNumber  Int      @map("version_number")
  content        String   @db.Text
  mediaUrls      String[] @default([]) @map("media_urls")
  contentWarning String?  @map("content_warning")
  isSensitive    Boolean  @default(false) @map("is_sensitive")
  hashtags       String[] @default([])
  mentions       String[] @default([])
  editorId       String   @map("editor_id")
  createdAt      DateTime @default(now()) @map("created_at")

  post           Post     @relation(fields: [postId], references: [id], onDelete: Cascade)
  editor         User     @relation("PostVersionEditor", fields: [editorId], references: [id], onDelete: Cascade)

  @@unique([postId, versionNumber])
  @@index([postId, createdAt(sort: Desc)])
  @@map("post_versions")
}
```

---

### TRỤ CỘT 2: GHIM BÀI VIẾT VÀO TRANG CÁ NHÂN (PINNED POST TO PROFILE)

#### 2.1. Quy tắc Nghiệp vụ & Các Bất biến Bắt buộc
1. **Chỉ ghim bài chính chủ (Ownership Invariant):**
   * Người dùng chỉ được ghim bài viết do chính mình tạo ra (`post.authorId === currentUserId`).
   * Không thể ghim bài của người khác (kể cả bài repost). Trả về HTTP `403 Forbidden` (`FORBIDDEN`).
2. **Chỉ ghim bài viết gốc (Root Post Only Invariant):**
   * Chỉ các bài viết gốc (`replyToId === null`) mới được ghim.
   * Không được ghim bài viết bình luận / reply. Nếu cố tình ghim reply: Trả về HTTP `400 Bad Request` (`CANNOT_PIN_REPLY`).
3. **Trạng thái hoạt động (Non-Deleted Invariant):**
   * Không được ghim bài viết đã bị xóa mềm (`isDeleted === true`). Trả về HTTP `400 Bad Request` (`CANNOT_PIN_DELETED`).
4. **Mô hình 1 Pinned Post tối ưu O(1):**
   * Mỗi tài khoản có tối đa 1 bài viết ghim cùng một lúc (chuẩn Threads / Twitter).
   * Trường `pinnedPostId String? @unique` được lưu trực tiếp trên bảng `User`.
   * Khi ghim bài viết mới: Tự động ghi đè và thay thế bài ghim cũ mà không cần thao tác unpin thủ công.
   * Khi bài viết bị xóa: Ràng buộc `onDelete: SetNull` tự động đưa `User.pinnedPostId` về `null`.
5. **Hiển thị ưu tiên trên Feed Profile:**
   * Khi query danh sách bài viết của người dùng (`GET /api/v1/users/:username/posts`):
     - Nếu `user.pinnedPostId` tồn tại: Lấy bài viết đó, gán cờ `isPinned: true`, và đưa lên vị trí đầu tiên (Index 0).
     - Các bài viết còn lại query loại trừ `pinnedPostId` và sắp xếp theo `createdAt DESC`.
     - Điều này đảm bảo hiệu năng `O(1)` query, không sinh ra duplicate post trong feed profile.

---

### TRỤ CỘT 3: TẮT TIẾNG MỘT CHIỀU (ONE-WAY MUTE USERS & KEYWORDS)

#### 3.1. Phân biệt Bản chất Kiến trúc giữa BLOCK và MUTE
| Tiêu chí | BLOCK (Chặn 2 chiều) | MUTE (Tắt tiếng 1 chiều) |
| :--- | :--- | :--- |
| **Bản chất xã hội** | Cắt đứt quan hệ công khai, cách ly 2 chiều | Bộ lọc âm thầm cá nhân (Stealth Filter) |
| **Quan hệ Follow** | Xóa sạch follow 2 chiều lập tức | **Giữ nguyên 100%** (Vẫn có thể đang follow nhau) |
| **Timeline Inboxes** | Xóa sạch bài viết khỏi inboxes 2 chiều | Giữ nguyên dữ liệu inboxes, lọc khi query (Read filter) |
| **Phía bị chặn/tắt tiếng** | Bị chặn xem profile, 404/Forbidden | **Hoàn toàn không biết mình bị mute** |
| **Tương tác của đối phương**| Không thể Like, Reply, Quote, DM | Vẫn tương tác bình thường nhưng bên mute không thấy |
| **Khả năng đảo ngược** | Phải follow lại từ đầu | Bỏ mute là feed hiển thị lại bình thường ngay |

#### 3.2. Mute Người dùng (User Muting)
* Model `UserMute`:
```prisma
model UserMute {
  id        String   @id @default(uuid())
  muterId   String   @map("muter_id")
  mutedId   String   @map("muted_id")
  createdAt DateTime @default(now()) @map("created_at")

  muter     User     @relation("UserMutesGiven", fields: [muterId], references: [id], onDelete: Cascade)
  muted     User     @relation("UserMutesReceived", fields: [mutedId], references: [id], onDelete: Cascade)

  @@unique([muterId, mutedId], name: "unique_muter_muted")
  @@index([muterId])
  @@index([mutedId])
  @@map("user_mutes")
}
```
* **Bất biến:**
  - Không thể tự mute chính mình (`muterId !== mutedId`), trả về `400 SELF_MUTE_NOT_ALLOWED`.
  - Không xóa quan hệ `Follow` hay `TimelineInbox`.
* **Áp dụng bộ lọc (Read-time Filtering):**
  - **Home Timeline (`HybridFeedTimelineService`):** Lọc bỏ các bài viết có `authorId IN (SELECT muted_id FROM user_mutes WHERE muter_id = :currentUserId)`.
  - **Notifications (`NotificationAggregatorService`):** Lọc bỏ thông báo có `actorId IN (mutedUserIds)`.
  - **Real-time SSE (`RealtimeEventStreamController`):** Không phát sự kiện `NEW_TIMELINE_POST` hoặc notification nếu nguồn phát là user bị mute.

#### 3.3. Mute Từ khóa & Hashtags (Keyword Muting)
* Model `KeywordMute`:
```prisma
enum MuteMatchType {
  CONTAINS
  EXACT_WORD
}

enum MuteContext {
  ALL
  HOME_TIMELINE
  NOTIFICATIONS
}

model KeywordMute {
  id          String        @id @default(uuid())
  userId      String        @map("user_id")
  keyword     String
  matchType   MuteMatchType @default(CONTAINS) @map("match_type")
  muteContext MuteContext   @default(ALL) @map("mute_context")
  expiresAt   DateTime?     @map("expires_at")
  createdAt   DateTime      @default(now()) @map("created_at")
  updatedAt   DateTime      @updatedAt @map("updated_at")

  user        User          @relation("UserKeywordMutes", fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, keyword], name: "unique_user_keyword")
  @@index([userId, expiresAt])
  @@map("keyword_mutes")
}
```
* **Thuật toán Khớp Từ khóa (Matching Engine):**
  1. Chuẩn hóa: Từ khóa lưu trữ luôn được `trim().toLowerCase()`.
  2. Thời hạn (Expiration): Bỏ qua các từ khóa có `expiresAt != null && expiresAt < now()`.
  3. Khớp `EXACT_WORD`: Sử dụng Word Boundary Regex: `new RegExp(`\\b${escapeRegex(keyword)}\\b`, 'i')`.
  4. Khớp `CONTAINS`: Substring matching: `text.toLowerCase().includes(keyword)`.
  5. Đối tượng quét: Khớp trên `post.content` và mảng `post.hashtags`.
  6. Ngữ cảnh:
     - `HOME_TIMELINE`: Chỉ lọc trên bảng tin Home Feed.
     - `NOTIFICATIONS`: Chỉ lọc trên danh sách thông báo.
     - `ALL`: Lọc trên cả Home Feed, Notifications và Search results.

---

### TRỤ CỘT 4: CẢNH BÁO NỘI DUNG & TẤM CHẮN SPOILER (CONTENT WARNINGS)

#### 4.1. Quy tắc Nghiệp vụ & Đặc tả Giao diện
* **Các trường dữ liệu trên `Post`:**
  - `isSensitive Boolean @default(false)`: Đánh dấu bài viết hoặc media có yếu tố nhạy cảm.
  - `contentWarning String?`: Nhãn mô tả lý do cảnh báo (Ví dụ: *"Spoiler tập cuối"*, *"Nội dung nhạy cảm"*, *"Ánh sáng nhấp nháy"*).
* **Chuẩn hóa Fediverse / ActivityPub:**
  - Map `post.contentWarning` <-> W3C ActivityStreams `summary`.
  - Map `post.isSensitive` <-> W3C ActivityStreams `sensitive`.
* **Hành vi Giao diện Client (Threads Light Theme):**
  - Mặc định: Bài viết có `isSensitive: true` hoặc `contentWarning != null` sẽ bị che bởi tấm chắn **Content Warning Shield**.
  - Tấm chắn là khung màu xám nhạt (`#f0f0f0`), bo góc `12px`, hiển thị icon `AlertTriangle` hoặc `EyeOff`, đi kèm văn bản cảnh báo và nút bấm rõ ràng:
    - Nút bấm: *"Xem bài viết"* / *"Show post"*.
    - Khi người dùng nhấn nút: Nội dung văn bản hiển thị đầy đủ, nút chuyển thành *"Ẩn bài viết"* / *"Hide"*.
  - Đối với hình ảnh nhạy cảm: Ảnh bị làm mờ bằng CSS blur (`filter: blur(20px)`), kèm lớp phủ overlay *"Ảnh nhạy cảm - Nhấn để xem"*.

---

## 3. BẢNG SO SÁNH ĐỐI ĐẦU & ĐÁNH GIÁ TRADE-OFFS (COMPARISON MATRIX)

### 3.1. Post Editing: Audit Trail In-table vs Separate History Table
| Tiêu chí | Phương án A: JSON Array trên cột `Post.versions` | Phương án B: Bảng riêng `PostVersion` (ĐƯỢC CHỌN) |
| :--- | :--- | :--- |
| **Hiệu năng Query Post** | Nặng payload của Post khi fetch thông thường | **Rất nhẹ (Zero overhead)**, chỉ query versions khi cần |
| **Tính toàn vẹn Dữ liệu** | Dễ bị corrupt do race condition khi edit | **Ràng buộc FK chuẩn ACID**, `@@unique([postId, versionNumber])` |
| **Phân trang Lịch sử** | Khó phân trang nếu sửa đổi nhiều lần | Dễ dàng query `LIMIT/OFFSET`, sort `createdAt DESC` |
| **Độ phức tạp Migration**| Thấp | Cần tạo bảng mới và thiết lập foreign keys |
| **Quyết định** | ❌ Loại bỏ | ✅ **Chọn Phương án B** (Đảm bảo kiến trúc chuẩn doanh nghiệp) |

### 3.2. Pinned Post: Cột trên User vs Bảng trung gian
| Tiêu chí | Phương án A: Bảng trung gian `PinnedPost` | Phương án B: Cột `pinnedPostId` trên `User` (ĐƯỢC CHỌN) |
| :--- | :--- | :--- |
| **Độ phức tạp mô hình**| Cần join thêm 1 bảng trên mỗi profile query | **Tối giản, O(1) lookup trực tiếp từ User model** |
| **Giới hạn số lượng ghim**| Cần lock logic để giới hạn 1 bài | **Tự nhiên enforced bởi 1 foreign key duy nhất** |
| **Thay thế bài ghim cũ** | Cần transaction: xóa bản ghi cũ, tạo mới | **1 câu update duy nhất**: `pinnedPostId = newPostId` |
| **Quyết định** | ❌ Dư thừa cho bài toán 1 pinned post | ✅ **Chọn Phương án B** (Tối ưu truy vấn, không race condition) |

### 3.3. Muting: Fan-out Cleanup vs Read-time Filter
| Tiêu chí | Phương án A: Xóa Inboxes khi Mute (như Block) | Phương án B: Bộ lọc khi Query (Read-time Filter) (ĐƯỢC CHỌN) |
| :--- | :--- | :--- |
| **Bản chất nghiệp vụ** | Sai bản chất của Mute (Mute là bộ lọc cá nhân) | **Đúng chuẩn Twitter/Threads/Mastodon** |
| **Chi phí Unmute** | Cực kỳ tốn kém (phải quét lại toàn bộ lịch sử để bù bài)| **Tức thì O(1)** (Chỉ cần xóa bản ghi Mute) |
| **Độ phức tạp Backend** | Nặng Write Amplification trên worker | **Gọn gàng**, bọc trong subquery hoặc memory filter |
| **Quyết định** | ❌ Bị loại vì lãng phí tài nguyên | ✅ **Chọn Phương án B** |

---

## 4. CHI TIẾT BỘ API CONTRACTS (RESTFUL API SPECIFICATIONS)

### 4.1. Nhóm API Quản lý Vòng đời Bài viết & Chỉnh sửa
#### `PATCH /api/v1/posts/:id`
* **Mục đích:** Chỉnh sửa nội dung bài viết trong vòng 15 phút.
* **Headers:** `Authorization: Bearer <token>` hoặc `x-user-id: <userId>`
* **Request Body (`UpdatePostInput`):**
```json
{
  "content": "Nội dung bài viết sau khi sửa lỗi chính tả",
  "mediaUrls": ["https://pulse.social/uploads/image1.jpg"],
  "contentWarning": "Cảnh báo tiết lộ nội dung",
  "isSensitive": false
}
```
* **Success Response (HTTP 200 OK):**
```json
{
  "success": true,
  "data": {
    "id": "post-uuid-123",
    "content": "Nội dung bài viết sau khi sửa lỗi chính tả",
    "isEdited": true,
    "editCount": 1,
    "lastEditedAt": "2026-09-16T15:10:00.000Z",
    "contentWarning": "Cảnh báo tiết lộ nội dung",
    "isSensitive": false,
    "createdAt": "2026-09-16T15:00:00.000Z"
  }
}
```
* **Error Cases:**
  * HTTP `403 Forbidden` (`EDIT_WINDOW_EXPIRED`): Nếu `Date.now() - post.createdAt > 15 * 60 * 1000`.
  * HTTP `403 Forbidden` (`FORBIDDEN`): Nếu `post.authorId !== currentUserId`.
  * HTTP `404 Not Found` (`POST_NOT_FOUND`): Nếu không tìm thấy hoặc đã bị xóa.

#### `GET /api/v1/posts/:id/versions`
* **Mục đích:** Lấy toàn bộ lịch sử các phiên bản chỉnh sửa của bài viết.
* **Success Response (HTTP 200 OK):**
```json
{
  "success": true,
  "data": {
    "postId": "post-uuid-123",
    "current": {
      "versionNumber": 2,
      "content": "Nội dung hiện tại",
      "editedAt": "2026-09-16T15:10:00.000Z"
    },
    "versions": [
      {
        "id": "version-uuid-1",
        "versionNumber": 1,
        "content": "Nội dung gốc ban đầu khi tạo bài",
        "mediaUrls": [],
        "contentWarning": null,
        "isSensitive": false,
        "createdAt": "2026-09-16T15:00:00.000Z"
      }
    ]
  }
}
```

---

### 4.2. Nhóm API Ghim Bài viết (Pinned Post)
#### `POST /api/v1/posts/:id/pin`
* **Mục đích:** Ghim bài viết lên đầu trang hồ sơ cá nhân của tác giả.
* **Success Response (HTTP 200 OK):**
```json
{
  "success": true,
  "data": {
    "pinnedPostId": "post-uuid-123",
    "isPinned": true,
    "message": "Ghim bài viết thành công"
  }
}
```
* **Error Cases:**
  * HTTP `403 Forbidden` (`FORBIDDEN`): Không phải bài viết của mình.
  * HTTP `400 Bad Request` (`CANNOT_PIN_REPLY`): Bài viết là câu trả lời / reply.
  * HTTP `400 Bad Request` (`CANNOT_PIN_DELETED`): Bài viết đã bị xóa.

#### `DELETE /api/v1/posts/:id/pin`
* **Mục đích:** Hủy ghim bài viết khỏi hồ sơ cá nhân.
* **Success Response (HTTP 200 OK):**
```json
{
  "success": true,
  "data": {
    "pinnedPostId": null,
    "isPinned": false,
    "message": "Bỏ ghim bài viết thành công"
  }
}
```

---

### 4.3. Nhóm API Tắt tiếng Người dùng (User Muting)
#### `POST /api/v1/users/:id/mute`
* **Mục đích:** Tắt tiếng âm thầm một người dùng.
* **Success Response (HTTP 200 OK):**
```json
{
  "success": true,
  "data": {
    "muterId": "user-alice",
    "mutedId": "user-bob",
    "isMuted": true,
    "createdAt": "2026-09-16T15:15:00.000Z"
  }
}
```
* **Error Cases:**
  * HTTP `400 Bad Request` (`SELF_MUTE_NOT_ALLOWED`): Cố tình mute chính mình.

#### `DELETE /api/v1/users/:id/mute`
* **Mục đích:** Bỏ tắt tiếng một người dùng.
* **Success Response (HTTP 200 OK):**
```json
{
  "success": true,
  "data": {
    "mutedId": "user-bob",
    "isMuted": false,
    "message": "Đã bỏ tắt tiếng người dùng"
  }
}
```

#### `GET /api/v1/mutes/users`
* **Mục đích:** Danh sách các tài khoản đang bị current user tắt tiếng.
* **Success Response (HTTP 200 OK):**
```json
{
  "success": true,
  "data": {
    "mutes": [
      {
        "id": "mute-uuid-1",
        "mutedUser": {
          "id": "user-bob",
          "username": "bob",
          "displayName": "Bob Builder",
          "avatarUrl": null
        },
        "createdAt": "2026-09-16T15:15:00.000Z"
      }
    ]
  }
}
```

---

### 4.4. Nhóm API Tắt tiếng Từ khóa (Keyword Muting)
#### `POST /api/v1/mutes/keywords`
* **Mục đích:** Thêm từ khóa hoặc hashtag vào danh sách tắt tiếng.
* **Request Body:**
```json
{
  "keyword": "crypto",
  "matchType": "CONTAINS",
  "muteContext": "ALL",
  "durationDays": 7
}
```
* **Success Response (HTTP 201 Created):**
```json
{
  "success": true,
  "data": {
    "id": "kw-uuid-1",
    "keyword": "crypto",
    "matchType": "CONTAINS",
    "muteContext": "ALL",
    "expiresAt": "2026-09-23T15:20:00.000Z",
    "createdAt": "2026-09-16T15:20:00.000Z"
  }
}
```

#### `GET /api/v1/mutes/keywords`
* **Mục đích:** Lấy danh sách các từ khóa đang được tắt tiếng còn hiệu lực của current user.

#### `DELETE /api/v1/mutes/keywords/:id`
* **Mục đích:** Xóa từ khóa khỏi danh sách tắt tiếng.

---

## 5. ĐẶC TẢ GIAO DIỆN CLIENT & HỆ TOKENS THREADS LIGHT THEME

Tuân thủ nghiêm ngặt theo đặc tả thiết kế `/home/nhonhoa/pulse/DESIGN.md`:
1. **Huy hiệu "Đã chỉnh sửa" (Edited Badge):**
   * Hiển thị cạnh timestamp bài viết dạng văn bản graphite `#71717a` (hoặc `#424242`): `" • Đã chỉnh sửa"`.
   * Khi click: Mở Modal `PostVersionHistoryModal` hiển thị danh sách các lần sửa đổi, bao gồm mốc thời gian và diff trực quan.
2. **Bộ đếm lùi trong Modal Chỉnh sửa (15-min Countdown Timer):**
   * Trong modal sửa bài viết `EditPostModal`: Hiển thị thanh trạng thái nhỏ báo hiệu thời gian còn lại:
     `"Còn lại 11 phút 30 giây để chỉnh sửa"`.
   * Khi hết thời gian: Vô hiệu hóa nút *"Lưu thay đổi"* và chuyển thông báo thành *"Đã hết hạn chỉnh sửa"*.
3. **Thẻ Ghim Bài viết (Pinned Post Indicator):**
   * Nằm trên cùng của bài viết được ghim trong trang profile.
   * Icon Lucide `Pin` kích thước 14px xoay 45 độ màu Graphite `#71717a`, kèm nhãn chữ đậm nhẹ: `"Bài viết đã ghim"`.
4. **Tấm chắn Nội dung Nhạy cảm (Content Warning Shield Component):**
   * Vỏ bọc: Nền `#f4f4f5` (hoặc `#efefef`), viền mờ `1px solid #e4e4e7`, bo góc chuẩn `12px`.
   * Icon `EyeOff` hoặc `AlertCircle` kèm nhãn `contentWarning` (ví dụ: *"Cảnh báo tiết lộ nội dung: Phim Avatar"*).
   * Nút bấm không viền hiện đại: *"Xem nội dung"* (toggling show/hide).
5. **Cài đặt Tắt tiếng (Mute Management Settings):**
   * Tab mới trong trang Settings / Profile: Quản lý danh sách người dùng và từ khóa bị tắt tiếng, hỗ trợ thêm nhanh từ khóa và nút gỡ bỏ tức thì.

---

## 6. MA TRẬN KIỂM THỬ TỰ ĐỘNG & TIÊU CHUẨN NGHIỆM THU (QA TEST SUITE MATRIX)

Bộ test tự động native `node:test` + `node:assert/strict` cho TASK-18 phải đạt tối thiểu **35 tests** kiểm chứng toàn diện:
1. **Kiểm thử 15-Minute Edit Window & Versioning (`tests/post-lifecycle-edit-version.test.mjs`):**
   - [x] Sửa bài viết thành công trong vòng 15 phút (`diff <= 15m`).
   - [x] Tự động snapshot bản gốc thành `PostVersion` với `versionNumber: 1` ở lần edit đầu tiên.
   - [x] Lần edit thứ hai sinh `PostVersion` với `versionNumber: 2` và cập nhật `editCount: 2`.
   - [x] Từ chối sửa bài viết sau khi quá 15 phút với HTTP 403 `EDIT_WINDOW_EXPIRED`.
   - [x] Từ chối sửa bài viết của người khác với HTTP 403 `FORBIDDEN`.
   - [x] Endpoint `GET /posts/:id/versions` trả về đầy đủ thứ tự phiên bản từ cũ đến mới.
   - [x] Re-parsing chính xác các hashtags và mentions sau khi sửa bài.
2. **Kiểm thử Ghim bài viết Profile (`tests/post-lifecycle-pinning.test.mjs`):**
   - [x] Tác giả ghim bài viết thành công, cập nhật `user.pinnedPostId`.
   - [x] Ghim bài thứ 2 tự động thay thế bài thứ nhất.
   - [x] Từ chối ghim bài của người khác (HTTP 403).
   - [x] Từ chối ghim bài reply (HTTP 400).
   - [x] Từ chối ghim bài đã bị xóa mềm (HTTP 400).
   - [x] Hủy ghim thành công (`DELETE /posts/:id/pin`).
   - [x] Xóa bài viết được ghim tự động reset `user.pinnedPostId` về `null`.
   - [x] Endpoint `GET /users/:username/posts` luôn đưa bài ghim lên vị trí index 0 với cờ `isPinned: true`.
3. **Kiểm thử Tắt tiếng User & Từ khóa (`tests/trust-safety-muting.test.mjs`):**
   - [x] Mute user thành công và bảo toàn quan hệ `Follow` (Không hủy follow).
   - [x] Từ chối self-mute (HTTP 400).
   - [x] Bảng tin Home Feed tự động lọc sạch các bài của user bị mute.
   - [x] Danh sách Notifications lọc sạch các tương tác từ user bị mute.
   - [x] Mute từ khóa với `matchType: CONTAINS` lọc đúng bài viết chứa từ khóa.
   - [x] Mute từ khóa với `matchType: EXACT_WORD` chỉ lọc đúng ranh giới từ (word boundary).
   - [x] Từ khóa đã hết hạn (`expiresAt < now()`) tự động không còn hiệu lực lọc.
   - [x] Bỏ mute user và gỡ từ khóa khôi phục hiển thị trên feed ngay lập tức.
4. **Kiểm thử Cảnh báo Nội dung & Bảo mật (`tests/trust-safety-content-warning.test.mjs`):**
   - [x] Tạo bài viết với `isSensitive: true` và `contentWarning: "Spoiler"` lưu trữ chính xác.
   - [x] Sửa bài viết cập nhật được cờ cảnh báo nội dung.
   - [x] Outbox ActivityPub sinh Note chứa đúng trường `summary` và `sensitive`.
   - [x] Chống tấn công XSS trong trường `contentWarning` (Sanitization).
   - [x] Chống tấn công IDOR khi unpin/edit/mute.

---
*Tài liệu này là hợp đồng kỹ thuật tối cao cho TASK-18. Tất cả các subagent `be-coder`, `fe-coder`, `security-auditor`, `qa-tester` bắt buộc tuân thủ tuyệt đối.*

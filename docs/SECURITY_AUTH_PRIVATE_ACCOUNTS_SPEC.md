# ĐẶC TẢ KIẾN TRÚC KỸ THUẬT: BẢO MẬT PHIÊN HTTPONLY COOKIE & TÀI KHOẢN RIÊNG TƯ (TASK-21)

**Dự án:** Pulse Microblogging Engine  
**Mã Task:** `TASK-21` (Gói 1: Security & Privacy Hardening)  
**Chỉ huy & Thiết kế:** Tech Lead, System Architect & Deep Researcher  
**Môi trường mục tiêu:** Arch Linux, Node.js 26.8 / 22.14, PostgreSQL 18.6 (`pulse_social`), Fastify 4.x, React 18 / Vite 5  
**Trạng thái:** Approved Architecture Contract  

---

## 1. MỤC TIÊU & TỔNG QUAN HỆ THỐNG

Gói nâng cấp này giải quyết 2 điểm yếu cốt lõi về bảo mật và quyền riêng tư được đúc kết từ bài học kiến trúc `mitekk/pulse`:
1. **Xóa bỏ hoàn toàn nguy cơ rò rỉ Token qua XSS (Zero-Trust Session Architecture):**
   * Chuyển đổi từ cơ chế Bearer Token thuần trong `localStorage` sang mô hình **Dual-Token**:
     * **Access Token:** Ngắn hạn (15 phút), truyền qua Header `Authorization: *** hoặc in-memory client.
     * **Refresh Token:** Dài hạn (7 ngày), lưu trữ an toàn trong **`HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth` Cookie**, JavaScript trên trình duyệt hoàn toàn không thể đọc trộm.
   * **Cơ chế Token Rotation & Token Denylist:**
     * Mỗi lần gọi `POST /api/v1/auth/refresh`, Refresh Token cũ bị thu hồi và cấp cặp token mới.
     * Thu hồi phiên tức thì (Instant Revocation) khi người dùng bấm Đăng xuất hoặc đổi mật khẩu: Lưu signature vào bảng `RevokedToken` (PostgreSQL) kết hợp bộ đệm In-Memory TTL Cache để kiểm tra $O(1)$.
2. **Khóa Tài khoản Riêng tư (Private Accounts & Follow Approvals):**
   * Hỗ trợ người dùng thiết lập `isPrivate: true` trong hồ sơ cá nhân.
   * Máy trạng thái (FSM) **`FollowRequest`**:
     * Tài khoản thường (`isPrivate: false`): Bấm follow tạo ngay bản ghi `Follow` và tăng `followersCount` / `followingCount`.
     * Tài khoản riêng tư (`isPrivate: true`): Bấm follow tạo bản ghi `FollowRequest` với trạng thái `PENDING`. Người nhận nhận thông báo và có quyền Chấp nhận (`ACCEPTED`) hoặc Từ chối (`REJECTED`).
     * Khi Chấp nhận: Thực hiện trong `prisma.$transaction` tạo `Follow`, xóa/cập nhật `FollowRequest`, tăng counters, và đẩy bài viết vào `TimelineInbox`.
   * **Bảo vệ quyền riêng tư tuyệt đối (Privacy Invariant):**
     * Người chưa được duyệt follow không thể xem danh sách bài viết (`GET /api/v1/users/:username/posts` chặn 403 hoặc trả về trạng thái tài khoản khóa).
     * Giao diện `UserProfileView.tsx` hiển thị tấm chắn Khóa tài khoản: *"Tài khoản này ở chế độ riêng tư. Hãy theo dõi để xem bài viết của họ"*.

---

## 2. MÔ HÌNH DỮ LIỆU & PRISMA SCHEMA ENHANCEMENT

### 2.1. Cập nhật Model `User`
```prisma
model User {
  // ... các trường hiện tại
  isPrivate                 Boolean               @default(false)
  
  followRequestsSent        FollowRequest[]       @relation("SentFollowRequests")
  followRequestsReceived    FollowRequest[]       @relation("ReceivedFollowRequests")
  refreshTokens             RefreshToken[]        @relation("UserRefreshTokens")
  revokedTokens             RevokedToken[]        @relation("UserRevokedTokens")
}
```

### 2.2. Model `FollowRequest`
```prisma
enum FollowRequestStatus {
  PENDING
  ACCEPTED
  REJECTED
}

model FollowRequest {
  id           String              @id @default(uuid())
  requesterId  String              @map("requester_id")
  targetUserId String              @map("target_user_id")
  status       FollowRequestStatus @default(PENDING)
  createdAt    DateTime            @default(now()) @map("created_at")
  updatedAt    DateTime            @updatedAt @map("updated_at")

  requester    User                @relation("SentFollowRequests", fields: [requesterId], references: [id], onDelete: Cascade)
  targetUser   User                @relation("ReceivedFollowRequests", fields: [targetUserId], references: [id], onDelete: Cascade)

  @@unique([requesterId, targetUserId], name: "unique_follow_request")
  @@index([targetUserId, status])
  @@index([requesterId])
  @@map("follow_requests")
}
```

### 2.3. Model `RefreshToken` & `RevokedToken`
```prisma
model RefreshToken {
  id           String    @id @default(uuid())
  userId       String    @map("user_id")
  tokenHash    String    @unique @map("token_hash")
  expiresAt    DateTime  @map("expires_at")
  isRevoked    Boolean   @default(false) @map("is_revoked")
  createdAt    DateTime  @default(now()) @map("created_at")
  updatedAt    DateTime  @updatedAt @map("updated_at")

  user         User      @relation("UserRefreshTokens", fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, isRevoked])
  @@index([expiresAt])
  @@map("refresh_tokens")
}

model RevokedToken {
  id             String    @id @default(uuid())
  tokenSignature String    @unique @map("token_signature") // jti hoặc SHA-256 signature
  reason         String?
  expiresAt      DateTime  @map("expires_at")
  revokedAt      DateTime  @default(now()) @map("revoked_at")
  userId         String?   @map("user_id")

  user           User?     @relation("UserRevokedTokens", fields: [userId], references: [id], onDelete: Cascade)

  @@index([tokenSignature])
  @@index([expiresAt])
  @@map("revoked_tokens")
}
```

---

## 3. HỢP ĐỒNG API (API CONTRACTS & DTOS)

### 3.1. Phân hệ Xác thực Bảo mật (Auth Endpoints)
1. **`POST /api/v1/auth/login` & `POST /api/v1/auth/register`:**
   * Response JSON: `{ success: true, data: { user: UserDto, accessToken: string } }`.
   * Set-Cookie Header: `pulse_refresh_token=<token>; Path=/api/v1/auth; HttpOnly; SameSite=Strict; Max-Age=604800`.
2. **`POST /api/v1/auth/refresh`:**
   * Nhận `pulse_refresh_token` từ Cookie hoặc body `{ refreshToken: string }`.
   * Kiểm tra trong DB: token còn hạn, chưa bị revoked, hash khớp.
   * Xoay vòng token (Rotate): Đánh dấu token cũ `isRevoked: true`, sinh Refresh Token mới và Access Token mới.
   * Trả về Access Token mới và cập nhật Set-Cookie.
3. **`POST /api/v1/auth/logout`:**
   * Thu hồi Refresh Token hiện tại trong DB.
   * Thêm chữ ký Access Token hiện tại vào `RevokedToken` (Token Denylist).
   * Clear-Cookie `pulse_refresh_token`.

### 3.2. Phân hệ Tài khoản Riêng tư & Duyệt Follow
1. **`PATCH /api/v1/users/profile`:**
   * Payload hỗ trợ thêm cờ: `{ isPrivate?: boolean }`.
2. **`POST /api/v1/users/:id/follow` (Sửa đổi):**
   * Nếu đối phương `isPrivate === false`: Hoạt động như cũ (tạo `Follow`, tăng counter, trả về `{ status: 'FOLLOWING' }`).
   * Nếu đối phương `isPrivate === true`: Tạo `FollowRequest` trạng thái `PENDING`, gửi Notification verb `FOLLOW_REQUEST`, trả về `{ status: 'REQUESTED' }`.
3. **`GET /api/v1/users/follow-requests`:**
   * Lấy danh sách các yêu cầu đang chờ (`status: 'PENDING'`) của user hiện tại.
4. **`POST /api/v1/users/follow-requests/:id/accept`:**
   * Chỉ target user mới có quyền duyệt (`targetUserId === currentUserId`).
   * Chạy `prisma.$transaction`: Cập nhật `status: ACCEPTED`, tạo bản ghi `Follow`, tăng `followersCount`/`followingCount`, enqueue fan-out inboxes, gửi Notification verb `FOLLOW_ACCEPT`.
5. **`POST /api/v1/users/follow-requests/:id/reject`:**
   * Cập nhật `status: REJECTED` hoặc xóa yêu cầu.
6. **`DELETE /api/v1/users/:id/follow-request`:**
   * Người gửi tự hủy yêu cầu theo dõi đã gửi.

---

## 4. CÁC BẤT BIẾN BẢO MẬT & AN NINH (SECURITY INVARIANTS)

1. **Anti-XSS Cookie Guard:** Refresh Token không bao giờ được trả về trong JSON body của endpoint `/login`, `/register`, `/refresh` nếu client hỗ trợ cookie; cờ `HttpOnly` ngăn chặn triệt để JavaScript đánh cắp.
2. **Denylist TTL Cache:** Bộ đệm In-Memory `Set<string>` lưu các token đã thu hồi. Mỗi lần server khởi động hoặc có token bị revoke, cập nhật vào cache. Định kỳ dọn dẹp các token đã quá hạn `expiresAt`.
3. **Private Account Profile Lock:** Khi truy cập `GET /api/v1/users/:username/posts` hoặc `GET /api/v1/users/:username`:
   * Nếu `user.isPrivate === true` VÀ `requesterId !== user.id` VÀ requester chưa được duyệt follow (`isFollowing === false`):
   * Danh sách bài viết bắt buộc trả về mảng rỗng `[]` kèm metadata `isLocked: true`, ngăn chặn rò rỉ nội dung qua API.
4. **Two-Way Block Precedence:** Nếu User A chặn User B, mọi `FollowRequest` giữa 2 bên đều bị hủy và cấm tạo mới (HTTP 403 `USER_BLOCKED`).

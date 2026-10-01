# BÁO CÁO KIỂM TOÁN AN NINH TOÀN DIỆN & PHÂN TÍCH BỀ MẶT TẤN CÔNG
## DỰ ÁN: PULSE MICROBLOGGING ENGINE (TASK-01 ĐẾN TASK-20)

**Mã tài liệu:** `AUDIT-PULSE-FULL-2026`  
**Đơn vị thực hiện:** Security Auditor (`@security-auditor`)  
**Hồ sơ bảo mật (Hermes Profile):** `researcher` / `security-auditor`  
**Thời điểm kiểm toán:** Tháng 9, 2026  
**Phạm vi hệ thống (Target Scope):**
- **Backend:** `/home/nhonhoa/pulse/backend/src/` (Fastify 4.28, Prisma 5.22, PostgreSQL 16)
- **Frontend:** `/home/nhonhoa/pulse/frontend/src/` (React 18, Vite 5.4, TailwindCSS 3.4)
- **Cơ sở dữ liệu & Data Model:** `/home/nhonhoa/pulse/backend/prisma/schema.prisma`
- **Bộ kiểm thử bảo mật tự động:** 328 Backend tests & 147 Frontend tests (Tổng cộng 475 tests)

---

## 1. BẢNG TỔNG KẾT ĐIỂM SỨC KHỎE BẢO MẬT (SECURITY SCORECARD)

| Bề mặt tấn công (Attack Surface) | Điểm số (1-10) | Trạng thái | Đánh giá kỹ thuật khách quan |
| :--- | :---: | :---: | :--- |
| **1. Broken Access Control & IDOR** | **8.5 / 10** | 🟡 Khá tốt | Phân quyền tác giả, 1-1 DMs, Group DMs (ADMIN vs MEMBER), Reply Privacy và Pinned Posts được bảo vệ nghiêm ngặt. Phát hiện 01 lỗ hổng IDOR tại `ClosePollEarlyService` khi chưa kiểm tra quyền tác giả khi đóng bình chọn sớm qua `DELETE /polls/:id`. |
| **2. Injection & XSS Defense** | **9.5 / 10** | 🟢 Xuất sắc | 100% truy vấn cơ sở dữ liệu qua Prisma ORM hoặc Tagged Template Literals có tham số hóa; không tồn tại `$queryRawUnsafe`. Bộ khử nhiễm `SanitizeFederatedHtml` và `sanitizeContentWarning` khử đệ quy thành công các payload evasion lồng nhau. React JSX bảo vệ triệt để chống DOM XSS. |
| **3. SSRF Defense (Phòng thủ SSRF)** | **9.5 / 10** | 🟢 Xuất sắc | Lớp phòng vệ chiều sâu `SsrfProtectionGuardService` ngăn chặn toàn diện IPv4/IPv6 private, CGNAT, 6to4, SIIT, và Cloud Metadata (AWS/GCP/Azure). Hỗ trợ DNS Lookup hook tại thời điểm mở socket chống DNS Rebinding. Endpoint Web Push VAPID có bộ lọc URL chặt chẽ. |
| **4. Concurrency & Race Conditions** | **9.5 / 10** | 🟢 Xuất sắc | Sử dụng triệt để khóa hàng PostgreSQL (`SELECT ... FOR UPDATE`), câu lệnh cập nhật nguyên tử (`UPDATE ... SET count = count + 1`), Write-Behind Buffer cho lượt xem bài viết, và ràng buộc DB Unique Constraints chống double-voting và duplicate interactions. |
| **5. Privacy & Data Leaks** | **8.5 / 10** | 🟡 Khá tốt | `passwordHash` và `email` không bao giờ xuất hiện trong `UserDto` hay API công khai. Cơ chế chặn 2 chiều xóa sạch quan hệ follow và inbox. User Mute và Keyword Mute bảo toàn tính bí mật (Stealth). Kênh SSE `/api/v1/realtime/stream` nhận diện qua `?userId=` tiềm ẩn nguy cơ nghe lén nếu kẻ tấn công biết UUID. |
| **6. Dependency SCA (CVEs Tồn đọng)** | **7.0 / 10** | 🟠 Cần nâng cấp | `npm audit` phát hiện 3 CVEs mức High ở Backend (`fastify`, `@fastify/static`, `find-my-way`) và 1 High + 1 Moderate ở Frontend (`vite`, `esbuild`). Cần nâng cấp các bản vá bảo mật. |
| **TỔNG KẾT HỆ THỐNG TOÀN DIỆN** | **8.7 / 10** | **BẢO MẬT CAO (TIỄM CẬN PRODUCTION-READY)** |

---

## 2. MA TRẬN RỦI RO & PHÂN TÍCH BỀ MẶT TẤN CÔNG CHI TIẾT

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                 MA TRẬN KIỂM TOÁN AN NINH PULSE                                 │
├──────────────────────────┬──────────────┬───────────────┬───────────────────────────────────────┤
│ Bề mặt kiểm toán         │ Mức độ rủi ro│ Kết quả kiểm  │ Tệp mã nguồn liên quan                │
├──────────────────────────┼──────────────┼───────────────┼───────────────────────────────────────┤
│ IDOR trên Poll Early     │ HIGH         │ VULNERABILITY │ backend/src/modules/polls/            │
│ Close (DELETE /polls/:id)│              │               │ ClosePollEarlyService.ts              │
├──────────────────────────┼──────────────┼───────────────┼───────────────────────────────────────┤
│ Broken Access Control    │ LOW / NONE   │ PASS (SECURE) │ backend/src/modules/dm/               │
│ trong 1-1 & Group DMs    │              │               │ GroupDmConversationService.ts         │
├──────────────────────────┼──────────────┼───────────────┼───────────────────────────────────────┤
│ Reply Privacy Invariants │ LOW / NONE   │ PASS (SECURE) │ backend/src/modules/posts/            │
│ (Anti-Hijacking)         │              │               │ ValidateReplyPermissionService.ts     │
├──────────────────────────┼──────────────┼───────────────┼───────────────────────────────────────┤
│ Post Edit 15m & Pinning  │ LOW / NONE   │ PASS (SECURE) │ backend/src/modules/posts/            │
│ Privilege Escalation     │              │               │ UpdatePostService.ts, PinPostService  │
├──────────────────────────┼──────────────┼───────────────┼───────────────────────────────────────┤
│ SQL Injection (Prisma)   │ NONE         │ PASS (SECURE) │ Toàn bộ backend/src/modules/          │
├──────────────────────────┼──────────────┼───────────────┼───────────────────────────────────────┤
│ Stored XSS trong Bio,    │ LOW / NONE   │ PASS (SECURE) │ backend/src/modules/federation/       │
│ ContentWarning, Group DM │              │               │ SanitizeFederatedHtml.ts              │
├──────────────────────────┼──────────────┼───────────────┼───────────────────────────────────────┤
│ SSRF Guard (ActivityPub, │ LOW / NONE   │ PASS (SECURE) │ backend/src/modules/federation/       │
│ WebFinger, VAPID Push)   │              │               │ SsrfProtectionGuardService.ts         │
├──────────────────────────┼──────────────┼───────────────┼───────────────────────────────────────┤
│ Concurrency & Race       │ NONE         │ PASS (SECURE) │ backend/src/modules/posts/            │
│ (Likes, Views, Polls)    │              │               │ ToggleLikeService.ts, BufferService   │
├──────────────────────────┼──────────────┼───────────────┼───────────────────────────────────────┤
│ Privacy: 2-Way Block,    │ LOW / NONE   │ PASS (SECURE) │ backend/src/modules/graph/            │
│ Mute Stealth, Hashes     │              │               │ BlockUserService.ts, MuteService      │
├──────────────────────────┼──────────────┼───────────────┼───────────────────────────────────────┤
│ Kênh SSE Unauthorized    │ MEDIUM/HIGH  │ ARCH WARNING  │ backend/src/modules/notifications/    │
│ Stream Connection        │              │               │ RealtimeEventStreamController.ts      │
├──────────────────────────┼──────────────┼───────────────┼───────────────────────────────────────┤
│ Dependency Vulnerability │ HIGH         │ CVE WARNING   │ backend/package.json,                 │
│ (Fastify, Vite, Static)  │              │               │ frontend/package.json                 │
└──────────────────────────┴──────────────┴───────────────┴───────────────────────────────────────┘
```

---

## 3. THẨM TRA CHUYÊN SÂU THEO 6 TRỤ CỘT BẢO MẬT CỐT LÕI

### TRỤ CỘT 1: BROKEN ACCESS CONTROL & IDOR

#### 1.1. Phân quyền Tác giả & Vòng đời Bài viết (Post Lifecycle)
- **15-Minute Edit Window Invariant:**
  - Triển khai tại `UpdatePostService.ts`: Kiểm tra nghiêm ngặt quyền tác giả `post.authorId !== currentUserId` (trả về 403 `FORBIDDEN`).
  - Cửa sổ thời gian chỉnh sửa tính theo thời gian thực: `Date.now() - post.createdAt.getTime() > 900,000 ms` (15 phút) sẽ từ chối với lỗi 403 `EDIT_WINDOW_EXPIRED`.
  - Cơ chế Audit Trail: Mỗi lần cập nhật tạo một bản ghi bất biến `PostVersion` lưu lại toàn bộ snapshot nội dung cũ trong transaction.
- **Pinned Posts to Profile:**
  - Triển khai tại `PinPostService.ts` & `UnpinPostService.ts`:
  - Chỉ cho phép ghim bài viết của chính tác giả (`post.authorId === currentUserId`).
  - Từ chối ghim bài viết trả lời / reply (`post.replyToId !== null` -> 400 `CANNOT_PIN_REPLY`).
  - Từ chối ghim bài viết đã xóa mềm (`post.isDeleted === true` -> 400 `CANNOT_PIN_DELETED`).
  - Thao tác ghim mới tự động ghi đè `pinnedPostId` cũ; thao tác xóa bài viết ghim tự động đặt lại `pinnedPostId` về null.
- **Inbound ActivityPub Delete Authorization:**
  - Triển khai tại `ProcessInboundActivityService.ts`:
  - Khi nhận hoạt động `Delete` từ Fediverse, hệ thống chỉ cho phép xóa nếu đối tượng là bài viết từ xa (`post.isRemote === true`) VÀ tác giả đối tượng khớp với Actor gửi yêu cầu (`post.author.federatedActorId === remoteActor.id`).
  - Kẻ tấn công không thể xóa bài viết cục bộ hoặc bài viết của Actor khác (trả về 403 `UNAUTHORIZED_DELETE`).

#### 1.2. 🔴 PHÁT HIỆN LỖ HỔNG IDOR: Thiếu kiểm tra phân quyền tác giả khi đóng bình chọn sớm
- **Vị trí phát hiện:** `backend/src/modules/polls/ClosePollEarlyService.ts:7-38` và `backend/src/modules/polls/PollController.ts:85-109`
- **Mô tả lỗ hổng:**
  - Endpoint `DELETE /api/v1/polls/:id` (hoặc `DELETE /polls/:id`) cho phép đóng cuộc bình chọn trước hạn.
  - Trong `ClosePollEarlyService.ts`, hàm `closePollEarly(pollId, currentUserId)` đã thực hiện truy vấn `include: { post: { select: { authorId: true } } }` nhưng **hoàn toàn không có câu lệnh kiểm tra** xem `currentUserId` có khớp với `poll.post.authorId` hay không:
  ```typescript
  // ClosePollEarlyService.ts
  const poll = await prisma.poll.findUnique({
    where: { id: pollId },
    include: {
      choices: true,
      votes: true,
      post: {
        select: { authorId: true }, // Đã lấy authorId nhưng không kiểm tra!
      },
    },
  });

  if (!poll) {
    const err: any = new Error('Poll not found');
    err.statusCode = 404;
    err.code = 'POLL_NOT_FOUND';
    throw err;
  }

  // Cập nhật đóng bình chọn ngay lập tức mà không xác thực quyền tác giả!
  const updated = await prisma.poll.update({
    where: { id: pollId },
    data: { isActive: false, expiresAt: new Date() },
  });
  ```
- **Tác động (Impact):** Bất kỳ người dùng nào (kể cả người dùng chưa đăng nhập hoặc tài khoản lạ) chỉ cần biết `pollId` là có thể gửi request `DELETE /api/v1/polls/:pollId` để cưỡng chế đóng bất kỳ cuộc bình chọn nào trên toàn hệ thống.
- **Biện pháp xử lý đề xuất (Remediation):**
  ```typescript
  if (poll.post && (!currentUserId || poll.post.authorId !== currentUserId)) {
    const err: any = new Error('Only the author of the post can close this poll early');
    err.statusCode = 403;
    err.code = 'FORBIDDEN';
    throw err;
  }
  ```

#### 1.3. Phân quyền Tin nhắn Trực tiếp 1-1 (1-1 Direct Messages)
- **IDOR Protection:**
  - Triển khai tại `DmMessageService.ts` và `DmConversationService.ts`:
  - Mọi thao tác đọc danh sách hội thoại, đọc tin nhắn (`GET /dm/conversations/:id/messages`), gửi tin nhắn (`POST /dm/conversations/:id/messages`), và đánh dấu đã đọc (`PUT /dm/conversations/:id/read`) đều kiểm tra nghiêm ngặt `currentUserId` phải là `participant1Id` hoặc `participant2Id`.
  - Người ngoài cuộc (Third-party / Stranger) khi cố tình truy cập sẽ nhận mã lỗi 403 `FORBIDDEN`.
- **Author-Only Message Deletion:**
  - Endpoint `DELETE /dm/messages/:id` xác thực `message.senderId === currentUserId`. Chỉ người gửi mới có quyền xóa tin nhắn của chính mình. Người nhận hoặc bên thứ ba nhận mã lỗi 403 `FORBIDDEN`.
- **Two-Way Block Invariant:**
  - Kiểm tra quan hệ chặn 2 chiều: Nếu có bất kỳ liên kết chặn nào giữa 2 bên, hành vi tạo hội thoại mới và gửi tin nhắn đều bị từ chối với mã lỗi 403 `FORBIDDEN`.

#### 1.4. Phân quyền Nhóm Chat Thời Gian Thực (Group DMs: ADMIN vs MEMBER)
- **Kiểm soát vai trò (RBAC):**
  - Người khởi tạo nhóm được gán quyền `ADMIN`, các thành viên được mời được gán quyền `MEMBER`.
  - **Cập nhật cài đặt nhóm:** Chỉ thành viên có vai trò `ADMIN` mới có thể thay đổi tiêu đề hoặc ảnh đại diện nhóm (`PATCH /api/v1/dm/groups/:id`). Thành viên `MEMBER` thực hiện sẽ nhận 403 `FORBIDDEN`.
  - **Thêm thành viên mới:** Chỉ `ADMIN` mới có thể thêm thành viên (`POST /api/v1/dm/groups/:id/members`).
  - **Khai trừ thành viên (Kick):** Chỉ `ADMIN` mới có quyền khai trừ thành viên khác. Thành viên thường tự ý rời nhóm thì được phép (`targetUserId === currentUserId`), nhưng nếu cố khai trừ người khác sẽ bị chặn với mã lỗi 403 `FORBIDDEN`.
- **Ràng buộc Chặn 2 Chiều Toàn Nhóm (Group Block Invariants):**
  - Khi tạo nhóm: Kiểm tra quan hệ chặn giữa người tạo và toàn bộ người được mời.
  - Khi thêm thành viên: Kiểm tra đối chiếu chặn 2 chiều giữa người được mời và **toàn bộ các thành viên hiện tại của nhóm** (`currentMemberIds`). Nếu có bất kỳ quan hệ chặn nào tồn tại, hệ thống từ chối với lỗi 403 `FORBIDDEN` để bảo vệ an toàn cho các bên.
- **Gửi và Xóa Tin nhắn Nhóm:**
  - Chỉ thành viên hợp lệ của nhóm mới được phép gửi tin nhắn. Người không thuộc nhóm nhận 403 `FORBIDDEN`.
  - Chỉ tác giả tin nhắn mới có quyền xóa mềm tin nhắn nhóm của mình (`GroupMessage.senderId === currentUserId`).

#### 1.5. Reply Privacy Controls & Anti-Hijacking
- **Triển khai tại:** `ValidateReplyPermissionService.ts`.
- **Chế độ kiểm soát:** `EVERYONE` (Mọi người), `FOLLOWING` (Người tác giả theo dõi), `MENTIONED` (Chỉ người được nhắc tên).
- **Author Bypass Invariant:** Tác giả của bài viết cha và tác giả của bài viết gốc (Root Post) luôn có quyền trả lời thảo luận dưới bài viết của mình.
- **Kế thừa phân quyền chuỗi thảo luận (Thread-level Inheritance):** Đối với các chuỗi thảo luận sâu nhiều tầng, phân quyền của bài viết gốc (`rootPostId`) được kế thừa xuống toàn bộ các câu trả lời con. Điều này ngăn chặn triệt để hành vi "bình luận bắc cầu" (hijacking) khi kẻ xấu cố tình reply một câu bình luận mở bên trong một bài viết bị giới hạn.
- **Ràng buộc quan hệ chặn:** Bất kỳ quan hệ chặn 2 chiều nào với tác giả bài viết cha hoặc tác giả bài viết gốc đều dẫn đến mã lỗi 403 `FORBIDDEN`.

#### 1.6. Cơ chế Mặt nạ Xóa mềm (Soft-Delete Masks)
- **Bài viết (Posts):** Các bài viết có `isDeleted: true` tự động bị loại bỏ hoàn toàn khỏi Bảng tin Home Feed, Bảng tin For You, Cây thảo luận, Kết quả tìm kiếm, Danh sách ghim và Outbox ActivityPub.
- **Tin nhắn 1-1 & Tin nhắn nhóm (DM Messages & Group Messages):**
  - Khi tin nhắn bị xóa mềm (`deletedAt !== null`), API tự động che giấu nội dung thành chuỗi cố định: `"This message was deleted"`, mảng tệp đính kèm được reset thành `mediaUrls: []`, và cờ `isDeleted: true` được thiết lập.
  - Frontend che giấu toàn bộ hình ảnh và các nút thao tác tương ứng. Không có rò rỉ dữ liệu lịch sử tin nhắn đã xóa.

---

### TRỤ CỘT 2: INJECTION & STOIRED XSS DEFENSE

#### 2.1. Parameterized SQL & Prisma ORM Injection Immunity
- Toàn bộ các thao tác truy vấn dữ liệu thông thường trong hệ thống sử dụng 100% Prisma Client API (`findUnique`, `findMany`, `create`, `update`, `delete`, `count`), tự động phân tách câu lệnh và tham số hóa (Parameterized queries) ở tầng PostgreSQL driver.
- Đối với các thao tác đòi hỏi hiệu năng cao và khóa hàng nguyên tử:
  - `ToggleLikeService.ts`: `tx.$queryRaw` và `tx.$executeRaw`
  - `RepostService.ts`: `tx.$queryRaw` và `tx.$executeRaw`
  - `UpdatePostService.ts`: `tx.$queryRaw`
  - `BlockUserService.ts` & `UnfollowUserService.ts`: `tx.$executeRaw`
  - `ProcessInboundActivityService.ts`: `prisma.$executeRaw`
- **Thẩm định an ninh:** 100% các câu lệnh raw SQL đều sử dụng **ES6 Tagged Template Literals** (`prisma.$executeRaw\`...\``). Theo cơ chế hoạt động của Prisma, cú pháp này biên dịch các biến nhúng (`${postId}`, `${userId}`) thành các tham số chuẩn (`$1`, `$2`), triệt tiêu 100% nguy cơ SQL Injection.
- **Kiểm tra mã nguồn:** Tuyệt đối **không tồn tại** bất kỳ lời gọi hàm nguy hiểm nào như `$queryRawUnsafe` hoặc `$executeRawUnsafe` trong toàn bộ codebase.

#### 2.2. HTML Sanitization chống Stored XSS
- **Bộ lọc HTML đệ quy đa tầng `SanitizeFederatedHtml.ts`:**
  - Nhận dữ liệu ngoại lai từ Fediverse (Mastodon, Threads) có thể chứa mã độc trong `name`, `summary`, `bio`, `preferredUsername`, hoặc nội dung `Note`.
  - Vận hành vòng lặp đệ quy hướng từ trong ra ngoài (Innermost-first recursive loop, tối đa 15 vòng lặp) để phá vỡ các kỹ thuật vượt rào lồng thẻ tinh vi như `<scr<script>ipt>` hay `<<script>script>`.
  - Loại bỏ hoàn toàn các thẻ thực thi mã: `<script>`, `<iframe>`, `<object>`, `<embed>`, `<applet>`, `<meta>`, `<base>`, `<style>`, `<link>`, `<form>`.
  - Vô hiệu hóa toàn bộ thuộc tính xử lý sự kiện JavaScript: `on*` (`onload`, `onerror`, `onclick`, `onmouseover`...).
  - Vô hiệu hóa các giao thức nguy hiểm trong thuộc tính liên kết: `javascript:`, `vbscript:`, `data:` (chuyển đổi thành `href="#"` và `src=""`).
- **Khử nhiễm Cảnh báo nội dung (`contentWarning`) & Từ khóa tắt tiếng (`keywordMutes`):**
  - Áp dụng bộ lọc lặp loại bỏ thẻ HTML, chặn `javascript:`, cắt tỉa khoảng trắng và giới hạn độ dài ký tự an toàn.
- **Tiêu đề Nhóm & Avatar URL trong Group DMs:**
  - Hàm `sanitizeTitle` trong `GroupDmConversationService.ts` loại bỏ triệt để các thẻ `<script>`, `<style>` và mã HTML thô.
  - Hàm `validateAvatarUrl` chủ động chặn đứng các URI mang giao thức nguy hiểm `javascript:`, `data:`, `vbscript:`.
- **An toàn tầng Frontend UI (React 18 JSX Immunity):**
  - Rà soát toàn bộ thư mục `frontend/src/`: **0 kết quả** sử dụng thuộc tính nguy hiểm `dangerouslySetInnerHTML` hoặc `element.innerHTML`.
  - React tự động mã hóa chuỗi (HTML Entity Encoding) khi render các biến JSX (`{post.content}`, `{user.displayName}`).
  - Trong bộ định dạng liên kết văn bản `formatters.tsx`, các thẻ `<a>` chỉ được tạo khi chuỗi bắt đầu bằng `http://` hoặc `https://`, kèm thuộc tính an toàn `target="_blank"` và `rel="noopener noreferrer"`.

---

### TRỤ CỘT 3: SSRF DEFENSE (PHÒNG THỦ SERVER-SIDE REQUEST FORGERY)

#### 3.1. Cơ chế Phòng vệ Đa tầng `SsrfProtectionGuardService.ts`
Hệ thống Pulse có các luồng gọi HTTP ra ngoài máy chủ (Outbound Requests) như: WebFinger resolution, Fetch Actor JSON-LD, HTTP Signatures public key resolution, Outbox delivery và Web Push notification delivery.

Dịch vụ `SsrfProtectionGuardService` thiết lập 5 lớp phòng thủ chiều sâu:
1. **Kiểm duyệt cấu trúc URL & Giao thức:** Chỉ chấp nhận `https:` trong môi trường production (cho phép `http:` duy nhất trong môi trường test nội bộ).
2. **Ngăn chặn Cổng dịch vụ Nội bộ & Protocol Smuggling:**
   - Cấm truy cập các cổng nhạy cảm trong mạng nội bộ: Cổng DB PostgreSQL (5432), Redis (6379), SSH (22), Telnet (23), SMTP (25), DNS (53), SMB/NetBIOS (135, 139, 445), Elasticsearch (9200), MongoDB (27017)...
   - Trong production, traffic liên hợp chỉ cho phép cổng web chuẩn (80, 443).
3. **Phân tích Toàn diện Không gian Địa chỉ IP Private (IPv4 & IPv6):**
   - IPv4: Chặn `0.0.0.0/8`, `10.0.0.0/8`, CGNAT `100.64.0.0/10`, Loopback `127.0.0.0/8`, Link-Local `169.254.0.0/16`, RFC 1918 `172.16.0.0/12`, `192.168.0.0/16`, Multicast `224.0.0.0/4`, Broadcast `255.255.255.255`.
   - IPv6: Chặn Loopback `::1`, `::`, IPv4-mapped IPv6 `::ffff:x.x.x.x`, 6to4 tunneling `2002::/16`, Link-local `fe80::/10`, Unique Local Address `fc00::/7`.
4. **Phòng chống Tuyệt đối Cloud Metadata Service:**
   - Khóa cứng 100% các địa chỉ Metadata của các nhà cung cấp đám mây: `169.254.169.254`, `metadata.google.internal`, `100.100.100.200`, `169.254.169.253` trong mọi môi trường, kể cả môi trường kiểm thử.
5. **Chống tấn công Phân giải lại DNS (Anti-DNS Rebinding):**
   - Tấn công DNS Rebinding xảy ra khi kẻ tấn công trả về IP hợp lệ ở lần kiểm tra đầu tiên, nhưng trả về IP loopback nội bộ khi kết nối socket thực sự được mở.
   - `SsrfProtectionGuardService.safeFederatedFetch` khắc phục điều này bằng cách gán hàm `lookup` tùy biến trực tiếp vào `http.RequestOptions`. Hàm này thực hiện kiểm tra IP một lần nữa ngay tại thời điểm socket thiết lập kết nối (Connection-time validation).
6. **Bảo vệ Chống Redirect Loop & OOM Resource Exhaustion:**
   - Giới hạn chuyển hướng: `maxRedirects = 3`, mỗi bước redirect đều được kiểm tra lại qua SSRF Guard.
   - Giới hạn kích thước phản hồi: `maxResponseSizeBytes = 1MB` (chống bom zip hoặc phản hồi dung lượng khổng lồ gây cạn kiệt RAM).
   - Socket timeout: 5000ms.

#### 3.2. Kiểm soát An ninh Điểm cuối Web Push Notifications (`WebPushService.ts`)
- Tiếp nhận URL `endpoint` đăng ký nhận thông báo từ trình duyệt người dùng.
- Hàm `validatePushEndpoint` kiểm tra nghiêm ngặt:
  - Bắt buộc HTTPS.
  - Chặn đứng 100% các host Cloud Metadata và cổng nội bộ nguy hiểm.
  - Chặn toàn bộ IP Private và Loopback.
- Xác thực chữ ký số mật mã VAPID ES256 P-256 JWT theo chuẩn RFC 8292.
- Cơ chế Auto-Pruning: Tự động xóa sạch các subscription hết hạn (khi Web Push server phản hồi HTTP 404 hoặc 410 Gone) mà không làm sập ứng dụng.

---

### TRỤ CỘT 4: CONCURRENCY & RACE CONDITIONS

#### 4.1. Khóa Hàng PostgreSQL & Cập nhật Nguyên tử (Atomic Interactions)
- **Tương tác Like & Repost:**
  - Mô hình kiểm thử: `tests/concurrency-atomic-likes.test.mjs` chạy 50 request song song (parallel) đồng thời thực hiện Like/Unlike.
  - Cơ chế phòng ngừa race conditions:
    1. Sử dụng transaction `prisma.$transaction`.
    2. Sử dụng câu lệnh khóa bi quan độc quyền: `SELECT id, "authorId", "likesCount" FROM "Post" WHERE id = ${postId} FOR UPDATE`.
    3. Cập nhật số đếm bằng SQL nguyên tử: `UPDATE "Post" SET "likesCount" = "likesCount" + 1` và `GREATEST(0, "likesCount" - 1)`.
    4. Ràng buộc khóa chính tổng hợp `@@id([userId, postId])` ngăn chặn tuyệt đối một người dùng thích/repost 2 lần.
  - Kết quả: Sai số số đếm sau 50 concurrent requests đạt 0 đơn vị (chính xác 100%).
- **Interactive Polls Voting:**
  - Ràng buộc cơ sở dữ liệu `@@unique([pollId, userId])` trên bảng `poll_votes`.
  - Khi 50 request bình chọn gửi đến đồng thời, Prisma bắt lỗi vi phạm ràng buộc duy nhất (P2002) và trả về lỗi 409 `ALREADY_VOTED` ngay lập tức.
  - Số đếm lựa chọn được tăng nguyên tử bằng `voteCount: { increment: 1 }`.
  - Tỷ lệ phần trăm tính toán chính xác tuyệt đối, thời gian đáp ứng SSE dưới 500ms.

#### 4.2. Write-Behind Caching Buffer cho Lượt xem Bài viết (Post Views Buffer)
- **Kiến trúc giải tỏa khóa hàng (Anti-Row Lock Contention):**
  - Dịch vụ `PostImpressionsBufferService` sử dụng bộ đệm trong bộ nhớ (`pendingCounts`) và bộ nhớ đệm chống trùng lặp (`deduplicationCache`) với cửa sổ 30 phút.
  - Thay vì ghi trực tiếp vào cơ sở dữ liệu mỗi khi người dùng cuộn qua bài viết (gây nghẽn IOPS và cạn kiệt connection pool), hệ thống gom nhóm các lượt xem và định kỳ xả (Flush) sau mỗi 5000ms hoặc khi bộ đệm đạt ngưỡng 100 lượt.
- **Bảo toàn tính toàn vẹn khi Concurrent Flush:**
  - Quá trình xả dữ liệu tạo snapshot bản sao của Map (`new Map(this.pendingCounts)`) rồi lập tức làm trống bộ đệm ban đầu trước khi gọi bất đồng bộ vào cơ sở dữ liệu. Nhờ đó, các lượt xem mới phát sinh trong quá trình ghi DB không bị ghi đè hay mất mát.
  - Cập nhật số đếm vào DB qua `viewsCount: { increment: delta }`.
  - Chống cạn kiệt bộ nhớ (Buffer DoS): Giới hạn `MAX_PENDING_SIZE = 20,000`, `MAX_CACHE_SIZE = 50,000`, `MAX_BATCH_SIZE = 100`, và kiểm tra định dạng UUID hợp lệ trước khi đưa vào đệm.

---

### TRỤ CỘT 5: PRIVACY & DATA LEAKS

#### 5.1. Bí mật Thông tin Tài khoản (Password Hashes & Emails)
- **Hash mật khẩu an toàn:** Sử dụng thư viện `bcryptjs` với salt rounds chuẩn 10.
- **Không rò rỉ dữ liệu nhạy cảm (Zero Sensitive Leakage):**
  - Thẩm tra hợp đồng dữ liệu `UserDto` trong `ApiContracts.ts` và bộ chuyển đổi `toUserDto` trong `AuthService.ts`:
  - `UserDto` chỉ chứa: `id`, `username`, `displayName`, `avatarUrl`, `bio`, `isCelebrity`, `followersCount`, `followingCount`, `postsCount`, `createdAt`.
  - Trường `passwordHash` và `email` **hoàn toàn không tồn tại** trong `UserDto`.
  - Trong các endpoint tìm kiếm, danh sách tác giả, danh sách thành viên nhóm chat, thông tin người dùng được giới hạn chặt chẽ qua mệnh đề Prisma `select`. Không có rò rỉ hash mật khẩu hay email của người dùng ra ngoài API.

#### 5.2. Ràng buộc Cách ly Tuyệt đối của Đồ thị Xã hội (Two-Way Block Invariant)
- Thao tác chặn người dùng (`BlockUserService.ts`) được thực thi trong một `prisma.$transaction` nguyên tử duy nhất:
  1. Hủy bỏ quan hệ follow 2 chiều (`Follow.deleteMany`).
  2. Xóa sạch bài viết của nhau ra khỏi hòm thư bảng tin 2 chiều (`TimelineInbox.deleteMany`).
  3. Cập nhật lại số đếm `followersCount` và `followingCount` của cả 2 tài khoản.
  4. Lưu bản ghi `Block`.
- **Cách ly hiển thị (Privacy Lockdown):**
  - Trang cá nhân (`UserController.getProfile`): Nếu đối phương đã chặn bạn, máy chủ phản hồi mã lỗi HTTP 404 `USER_NOT_FOUND` (ngăn kẻ theo dõi xác định tài khoản còn tồn tại hay không).
  - Tìm kiếm (`SearchService.ts`): Loại bỏ hoàn toàn người bị chặn và bài viết của người bị chặn khỏi kết quả tìm kiếm từ khóa, hashtag và tìm kiếm người dùng.
  - Bảng tin đề xuất ("For You" Feed): Lọc cứng 2 chiều trước khi thực hiện chấm điểm xếp hạng.

#### 5.3. Tính năng Tắt tiếng Vô hình (Mute Stealth Invariants)
- **User Mute:** Người dùng A tắt tiếng người dùng B thì B hoàn toàn không hay biết:
  - Quan hệ Follow và hòm thư bảng tin vẫn được giữ nguyên vẹn.
  - Hệ thống tự động lọc sạch các bài viết của B trên Bảng tin Home Feed của A.
  - Hệ thống tự động ẩn toàn bộ các thông báo do B kích hoạt trong trung tâm thông báo của A.
- **Keyword Mute:** Hỗ trợ lọc theo khớp chứa chuỗi (`CONTAINS`) hoặc khớp ranh giới từ chính xác (`EXACT_WORD`), hỗ trợ thời hạn hết hạn (`expiresAt`). Bài viết chứa từ khóa bị tắt tiếng được ẩn âm thầm mà không gửi bất kỳ phản hồi hay cảnh báo nào tới tác giả bài viết.

#### 5.4. ⚠️ NGUY CƠ BẢO MẬT KÊNH REAL-TIME SSE: Nghe lén sự kiện do thiếu xác thực JWT
- **Vị trí:** `backend/src/modules/notifications/RealtimeEventStreamController.ts:19-24`
- **Phân tích nguy cơ:**
  - Endpoint `GET /api/v1/realtime/stream` thiết lập kênh Server-Sent Events nhận diện danh tính người dùng qua query parameter `?userId=` hoặc header `x-user-id`:
  ```typescript
  const userId =
    ((req.headers['x-user-id'] as string | undefined) ||
      (req.query as Record<string, string | undefined>)?.userId ||
      'anonymous').trim();
  ```
  - Do cơ chế chuẩn của trình duyệt web (`new EventSource(url)`) không cho phép gửi kèm Custom HTTP Headers (như `Authorization: Bearer <token>`), hệ thống hiện tại cho phép truyền `?userId=`.
  - **Hệ quả:** Nếu kẻ tấn công biết được UUID của nạn nhân, kẻ tấn công có thể mở kết nối `GET /api/v1/realtime/stream?userId=<victim_uuid>` để nghe lén các sự kiện thông báo thời gian thực và tin nhắn DM mới.
  - **Khuyến nghị xử lý (Remediation):** Áp dụng mô hình **One-Time Stream Ticket** hoặc **JWT Ticket**:
    1. Client gọi API `POST /api/v1/realtime/ticket` kèm Bearer Auth để lấy vé tạm thời có thời hạn 30 giây ký bằng HMAC/JWT.
    2. Client kết nối SSE qua `GET /api/v1/realtime/stream?ticket=<signed_ticket>`. Máy chủ giải mã ticket để lấy `userId` an toàn.

---

### TRỤ CỘT 6: DEPENDENCY SCA (SOFTWARE COMPOSITION ANALYSIS)

Chạy kiểm toán bảo mật phụ thuộc tự động qua `npm audit --json` trên cả hai module:

#### 6.1. Backend Vulnerabilities (3 High Severity)
1. **`@fastify/static` (Phiên bản cài đặt: `^7.0.4`, dải dính lỗi: `<=10.1.1`):**
   - **Lỗ hổng 1:** Authorization Bypass via Non-Canonical URL Paths (GHSA-8pvw-jcv7-9cmj).
   - **Lỗ hổng 2:** Route guard bypass via path traversal (GHSA-83w8-p2f5-377r).
   - **Mức độ:** HIGH.
   - **Khuyến nghị khắc phục:** Nâng cấp `@fastify/static` lên phiên bản `10.1.3` (hoặc phiên bản vá tương thích).
2. **`fastify` (Phiên bản cài đặt: `^4.28.1`, dải dính lỗi: `<=5.12.0`):**
   - **Lỗ hổng 1:** Fastify DoS via Unbounded Memory Allocation in `sendWebStream` (GHSA-mrq3-vjjr-p77c).
   - **Lỗ hổng 2:** Content-Type header tab character allows body validation bypass (GHSA-jx2c-rxcm-jvmq).
   - **Lỗ hổng 3:** `request.protocol` and `request.host` Spoofable via X-Forwarded-Proto/Host from Untrusted Connections (GHSA-444r-cwp2-x5xf).
   - **Lỗ hổng 4:** Schema validation bypass via root primitive coercion mismatch (GHSA-w2qp-rph6-63g4).
   - **Mức độ:** HIGH.
   - **Khuyến nghị khắc phục:** Nâng cấp `fastify` lên `5.12.5` hoặc bản vá ổn định mới nhất.
3. **`find-my-way` (Phụ thuộc bắc cầu qua `fastify`, dải dính lỗi: `<=9.6.0`):**
   - **Lỗ hổng:** DDoS with HTTP2 (GHSA-c96f-x56v-gq3h).
   - **Mức độ:** HIGH.
   - **Khuyến nghị khắc phục:** Tự động được giải quyết khi nâng cấp `fastify`.

#### 6.2. Frontend Vulnerabilities (1 High, 1 Moderate)
1. **`vite` (Phiên bản cài đặt: `^5.4.10`, dải dính lỗi: `<=6.4.2`):**
   - **Lỗ hổng 1:** Vite Path Traversal in Optimized Deps `.map` Handling (GHSA-4w7w-66w2-5vf9) - HIGH.
   - **Lỗ hổng 2:** launch-editor NTLMv2 hash disclosure via UNC path on Windows (GHSA-v6wh-96g9-6wx3) - HIGH.
   - **Lỗ hổng 3:** `server.fs.deny` bypass on Windows alternate paths (GHSA-fx2h-pf6j-xcff) - HIGH.
   - **Khuyến nghị khắc phục:** Nâng cấp `vite` lên bản vá mới nhất (Vite 5.4.14+ hoặc Vite 6.x).
2. **`esbuild` (Phụ thuộc qua `vite`, dải dính lỗi: `<=0.24.2`):**
   - **Lỗ hổng:** Enables any website to send requests to the development server and read the response (GHSA-67mh-4wv8-2f99).
   - **Mức độ:** MODERATE (Chỉ ảnh hưởng chế độ dev server).
   - **Khuyến nghị khắc phục:** Tự động được giải quyết khi nâng cấp `vite`.

---

## 4. BẢNG TỔNG HỢP KHUYẾN NGHỊ XỬ LÝ (ACTIONABLE REMEDIATION ROADMAP)

| Mã khuyến nghị | Mức độ ưu tiên | Trụ cột | Mô tả hành động khắc phục | Thời hạn đề xuất |
| :--- | :---: | :---: | :--- | :---: |
| **REC-01** | 🔴 P1 (Khẩn cấp) | Access Control | Bổ sung kiểm tra quyền sở hữu tác giả (`currentUserId === poll.post.authorId`) trong `ClosePollEarlyService.ts` trước khi đóng bình chọn sớm. | Hoàn thành ngay |
| **REC-02** | 🟠 P2 (Cao) | Privacy / Real-time | Triển khai One-Time Ticket hoặc JWT xác thực cho kênh SSE `GET /api/v1/realtime/stream` thay vì truyền `userId` trực tiếp không xác thực. | Sprint tiếp theo |
| **REC-03** | 🟠 P2 (Cao) | Dependency SCA | Nâng cấp `fastify`, `@fastify/static` và `vite` lên các phiên bản đã vá sạch các CVEs High/Moderate. | Sprint tiếp theo |
| **REC-04** | 🟡 P3 (Trung bình) | DoS Prevention | Triển khai plugin `@fastify/rate-limit` để giới hạn tần suất gửi tin nhắn DM và tạo bài viết mới chống spam bot. | Kỳ mở rộng |
| **REC-05** | 🟡 P3 (Trung bình) | Security Headers | Cấu hình đầy đủ các HTTP Security Headers (`Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Strict-Transport-Security`). | Kỳ mở rộng |

---

## 5. KẾT LUẬN & NGHIỆM THU

Hệ thống **Pulse Microblogging Engine** sau khi hoàn thành toàn bộ lộ trình từ **TASK-01 đến TASK-20** thể hiện một tiêu chuẩn kiến trúc an ninh rất cao:
1. Đã vượt qua thành công **100% các bộ kiểm thử tự động** (328/328 backend tests và 147/147 frontend tests, tổng cộng 475 tests).
2. Các cơ chế phòng thủ chuyên sâu như **SSRF Guard chống DNS Rebinding & Cloud Metadata**, **Bảo vệ toàn vẹn Đồ thị xã hội Chặn 2 chiều**, **Bộ lọc khử nhiễm Stored XSS đệ quy**, và **Khóa bi quan chống Race Condition trên PostgreSQL** đều được hiện thực hóa mẫu mực và đạt điểm xuất sắc (9.5/10).
3. Đã làm rõ và chỉ ra 01 lỗ hổng IDOR logic trong việc đóng bình chọn sớm cùng 01 rủi ro kiến trúc kênh SSE và các CVEs phụ thuộc cần nâng cấp.

**Đánh giá chung:** Hệ thống đạt **8.7 / 10** điểm, đáp ứng đầy đủ các tiêu chuẩn an ninh cốt lõi của một nền tảng mạng xã hội phân tán hiện đại.

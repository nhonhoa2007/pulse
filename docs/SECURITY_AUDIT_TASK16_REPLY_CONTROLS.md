# BÁO CÁO KIỂM TOÁN AN NINH & ĐÁNH GIÁ CHẤT LƯỢNG HỆ THỐNG
## Chuyên đề: Kiểm toán Cơ chế Ủy quyền & Kiểm soát Quyền Trả lời (Reply Privacy Controls)
**Task ID:** `t_ad47c37a` (TASK-16)  
**Profile:** `security-auditor`  
**Dự án:** Pulse Social Network  
**Phạm vi kiểm toán:** Các endpoints khởi tạo, cập nhật, truy vấn bài viết & phản hồi (`/posts`, `/posts/:id`, `/posts/:id/thread`), các dịch vụ nghiệp vụ (`ValidateReplyPermissionService`, `PublishPostService`, `UpdatePostService`, `ConversationThreadService`), và luồng liên hợp ActivityPub (`ProcessInboundActivityService`).

---

### 1. BẢNG TỔNG KẾT ĐIỂM SỨC KHỎE DỰ ÁN (PROJECT HEALTH SCORECARD)

| Hạng mục | Điểm số (1-10) | Nhận định kỹ thuật khách quan |
| :--- | :---: | :--- |
| **Bảo mật (Security & Access Control)** | **9.5 / 10** | Đã khắc phục triệt để nguy cơ Thread Hijacking/Root Lockout, lỗ hổng bypass khi thiếu `rootPostId`, lỗ hổng bypass qua Quote Post với người dùng bị block, regex injection qua email/URL, và bypass ActivityPub Inbound. |
| **Kiến trúc & Clean Code** | **9.0 / 10** | Tách bạch rõ ràng giữa Controller và Service. Phân định rành mạch quyền root conversation vs immediate comment. Hỗ trợ fallback phân giải cây thảo luận đệ quy. |
| **Xử lý lỗi (Error Handling)** | **9.0 / 10** | Trả về mã HTTP chuẩn mực (401 UNAUTHORIZED, 403 FORBIDDEN / REPLY_RESTRICTED, 404 POST_NOT_FOUND). Không rò rỉ stack trace. Xử lý TOCTOU an toàn với rollback nguyên tử. |
| **Kiểm thử (Test Coverage)** | **9.5 / 10** | Đạt 118/118 tests pass trên toàn bộ test suite backend (trong đó có 7 tests thâm nhập chuyên sâu trong `reply-security-audit.test.mjs` và 11 tests kiểm soát quyền trong `reply-privacy-controls.test.mjs`). Frontend đạt 33/33 tests pass. |

---

### 2. CHI TIẾT LỖ HỔNG & RỦI RO PHÁT HIỆN QUA PENETRATION TESTING

#### 🔴 CRITICAL: VULN-1 — Thread Hijacking & Root Author Lockout (Tước quyền chủ bài viết)
- **Vị trí phát hiện:** `backend/src/modules/posts/ValidateReplyPermissionService.ts:182-206`
- **Vector tấn công (Threat Vector):**
  - Tác giả gốc Alice đăng bài công khai với `reply_privacy: 'EVERYONE'`.
  - Kẻ tấn công (hoặc người bình luận) Bob phản hồi vào bài viết của Alice, cố tình đặt quyền phản hồi của comment là `reply_privacy: 'FOLLOWING'` (trong đó Bob không follow Alice) hoặc `'MENTIONED'` (không nhắc tên Alice).
  - Khi Alice (chủ sở hữu toàn bộ chuỗi đàm thoại) muốn phản hồi lại bình luận của Bob ngay trên bài viết của chính mình, `ValidateReplyPermissionService` kiểm tra `requesterId === parentPost.authorId` (Alice !== Bob -> false), sau đó đánh giá `parentPost.reply_privacy` ('FOLLOWING'). Do Bob không follow Alice, hệ thống ném lỗi `403 FORBIDDEN (REPLY_RESTRICTED)`.
  - **Hậu quả:** Tác giả bài viết bị khóa họng (silenced) ngay trên bài thảo luận của mình. Bất kỳ ai cũng có thể chiếm quyền điều phối luồng thảo luận của người khác.
- **Biện pháp khắc phục (Fix Patch):**
  Cấp quyền vượt qua kiểm tra quyền bình luận con (`isRootAuthor`) cho tác giả của root post trong toàn bộ chuỗi thảo luận (trừ trường hợp tồn tại quan hệ Block trực tiếp 2 chiều):
  ```typescript
  // ValidateReplyPermissionService.ts
  const isParentAuthor = requesterId === parentPost.authorId;
  const isRootAuthor = resolvedRootId && requesterId === rootPost.authorId;

  if (isParentAuthor || isRootAuthor) {
    return { allowed: true };
  }
  ```

---

#### 🔴 HIGH: VULN-2 — Root Post Privacy Bypass do `rootPostId` bị Null hoặc Đứt gãy
- **Vị trí phát hiện:** `backend/src/modules/posts/ValidateReplyPermissionService.ts:102` & `PublishPostService.ts:73`
- **Vector tấn công (Threat Vector):**
  - Trước đây, logic kế thừa chỉ kiểm tra: `if (parentPost.rootPostId && parentPost.rootPostId !== parentPost.id)`.
  - Nếu một phản hồi trong DB có `replyToId` nhưng `rootPostId` bị `null` (do dữ liệu cũ, migration, hoặc lỗi phân giải liên hợp), hệ thống bỏ qua hoàn toàn việc kiểm tra bài viết gốc.
  - Người dùng lạ (stranger) gửi request trực tiếp đến API `POST /api/v1/posts` với `replyToId` trỏ vào comment này, vượt mặt hoàn toàn rào cản `FOLLOWING` hoặc `MENTIONED` của bài viết gốc. Hơn nữa, `PublishPostService` gán sai `rootPostId = parentPost.id`, làm đứt gãy tính toàn vẹn của cây thảo luận.
- **Biện pháp khắc phục (Fix Patch):**
  Thêm cơ chế tự động truy vết ngược theo `parentPost.replyToId` khi `rootPostId` bị thiếu:
  ```typescript
  let resolvedRootId = parentPost.rootPostId;
  if (!resolvedRootId && parentPost.replyToId) {
    const immediateParent = await prisma.post.findUnique({
      where: { id: parentPost.replyToId },
      select: { id: true, rootPostId: true },
    });
    resolvedRootId = immediateParent?.rootPostId || immediateParent?.id || null;
  }
  ```

---

#### 🔴 HIGH: VULN-3 — Phá vỡ Bất biến Chặn (Block Invariant Bypass) thông qua Trích dẫn bài viết (Quote Post)
- **Vị trí phát hiện:** `backend/src/modules/posts/PublishPostService.ts:80-92`
- **Vector tấn công (Threat Vector):**
  - Người dùng A chặn (Block) người dùng B.
  - Bị chặn không thể reply bài viết của A (đã chặn thành công). Tuy nhiên, B gọi trực tiếp API `POST /api/v1/posts` với tham số `quoteOfId: postA.id`.
  - `PublishPostService` trước đây không kiểm tra quan hệ `Block` trên `quoteOfId`, cho phép người bị chặn quote bài của người chặn, tăng bộ đếm `quotesCount` và bắn thông báo (`QUOTE` notification) quấy rối người chặn, vi phạm nghiêm trọng Social Graph Block Invariant.
- **Biện pháp khắc phục (Fix Patch):**
  Bắt buộc xác thực quan hệ chặn 2 chiều trước khi cho phép trích dẫn:
  ```typescript
  const quoteBlock = await prisma.block.findFirst({
    where: {
      OR: [
        { blockerId: authorId, blockedId: quotedPost.authorId },
        { blockerId: quotedPost.authorId, blockedId: authorId },
      ],
    },
  });
  if (quoteBlock) {
    throw new ReplyRestrictedError(
      'You cannot quote this post because of block privacy settings',
      'FORBIDDEN',
      403
    );
  }
  ```

---

#### 🟡 MEDIUM: VULN-4 — Rò rỉ Quyền Trả lời do Regex Phân tích Mentions Bắt nhầm Email và URL
- **Vị trí phát hiện:** `backend/src/modules/posts/PublishPostService.ts:263` & `UpdatePostService.ts:179`
- **Vector tấn công (Threat Vector):**
  - Biểu thức regex cũ: `content.match(/@([a-zA-Z0-9_]+)/g)`.
  - Nếu nội dung bài viết chứa email (ví dụ: `support@charlie.com`) hoặc đường dẫn URL (`https://domain/@charlie`), hệ thống trích xuất `charlie` vào mảng `mentions`.
  - Nếu bài viết đặt `reply_privacy: 'MENTIONED'`, tài khoản `charlie` nghiễm nhiên được cấp quyền trả lời dù tác giả không hề chủ đích mention tài khoản này.
- **Biện pháp khắc phục (Fix Patch):**
  Sử dụng boundary-aware regex yêu cầu ký tự đứng trước `@` phải là đầu dòng hoặc khoảng trắng:
  ```typescript
  private extractMentions(content: string): string[] {
    const regex = /(?:^|\s)@([a-zA-Z0-9_]{1,30})\b/g;
    const mentions: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      mentions.push(match[1]);
    }
    return [...new Set(mentions)];
  }
  ```

---

#### 🟡 MEDIUM: VULN-5 — Hoạt động Liên hợp ActivityPub Inbound Bỏ qua Xác thực Quyền Phản hồi
- **Vị trí phát hiện:** `backend/src/modules/federation/ProcessInboundActivityService.ts:369-389`
- **Vector tấn công (Threat Vector):**
  - Khi máy chủ nhận ActivityPub Inbound `Create` có trường `inReplyTo`, dịch vụ liên hợp tự động tăng `repliesCount` và liên kết `replyToId` mà không kiểm tra quyền `ValidateReplyPermissionService`.
  - Bất kỳ remote actor nào gửi inbound activity giả mạo đều có thể trả lời các bài viết bị giới hạn (`FOLLOWING`, `MENTIONED`) hoặc các bài viết mà tác giả local đã chặn remote actor đó.
- **Biện pháp khắc phục (Fix Patch):**
  Tích hợp `validateReplyPermissionService.validate(shadowUser.id, parentPost.id)` trước khi chấp thuận liên kết reply và tăng bộ đếm.

---

#### 🟡 MEDIUM: VULN-6 — Nguy cơ TOCTOU Race Condition khi Bài viết bị Xóa đồng thời với Gửi phản hồi
- **Vị trí phát hiện:** `backend/src/modules/posts/PublishPostService.ts:94-110`
- **Vector tấn công (Threat Vector):**
  - `validateReplyPermissionService.validate` diễn ra trước khối `prisma.$transaction`.
  - Nếu tác giả bài cha xóa bài viết (`isDeleted = true`) đúng thời điểm trước transaction, lệnh `tx.post.update({ where: { id: replyToId } })` vẫn tăng `repliesCount` trên bài đã xóa do câu lệnh `where` không ràng buộc trạng thái `isDeleted: false`.
- **Biện pháp khắc phục (Fix Patch):**
  Dùng `tx.post.updateMany({ where: { id: replyToId, isDeleted: false }, data: { repliesCount: { increment: 1 } } })`. Nếu `count === 0`, throw lỗi để rollback toàn bộ transaction ngay lập tức.

---

### 3. KẾ HOẠCH HÀNH ĐỘNG ĐÃ TRIỂN KHAI & BẢO ĐẢM HỆ THỐNG

1. **P1 Hotfixes (Đã hoàn tất & xác minh):**
   - Đã cập nhật `ValidateReplyPermissionService.ts` bảo vệ quyền bất khả xâm phạm của Root Author trong thảo luận và vá lỗi truy vết `rootPostId`.
   - Đã cập nhật `PublishPostService.ts` chặn Quote Post đối với người dùng bị block và đảm bảo tính nguyên tử chống race condition.
   - Đã cập nhật regex phân tích mention tránh false positives trên email/URL ở cả `PublishPostService.ts` và `UpdatePostService.ts`.
   - Đã vá `ProcessInboundActivityService.ts` đảm bảo kiểm soát truy cập trên liên hợp ActivityPub.
2. **Xác minh thực nghiệm (Penetration Verification):**
   - Viết bộ kiểm thử chuyên sâu `backend/tests/reply-security-audit.test.mjs` với 7 ca thử nghiệm thâm nhập. Kết quả: 7/7 ca kiểm tra đều đạt chuẩn an ninh.
   - Chạy toàn bộ 118 unit & integration tests của hệ thống Backend: 100% tests vượt qua thành công.
   - Kiểm tra tương thích Frontend (`npm test` & `npm run build`): Đạt 33/33 tests pass, biên dịch Vite thành công không lỗi.

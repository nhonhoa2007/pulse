# SECURITY AUDIT & EVALUATION REPORT: 1-1 DIRECT MESSAGING (DM) FEATURE
**Project:** Pulse Social Network (TASK-14)
**Auditor:** Security Auditor & Project Evaluator (Hermes Profile: `security-auditor`)
**Audit Date:** September 16, 2026
**Target Codebase:**
- Backend: `/home/nhonhoa/pulse/backend/src/modules/dm/*`
- Realtime SSE: `/home/nhonhoa/pulse/backend/src/modules/notifications/RealtimeEventStreamController.ts`
- Frontend: `/home/nhonhoa/pulse/frontend/src/components/dm/*`, `DirectMessagingView.tsx`
- Database Schema: `/home/nhonhoa/pulse/backend/prisma/schema.prisma`
- Automated Test Suite: `/home/nhonhoa/pulse/backend/tests/security-dm-audit.test.mjs`

---

## 1. BẢNG TỔNG KẾT ĐIỂM SỨC KHỎE DỰ ÁN (PROJECT HEALTH SCORECARD)

| Hạng mục Đánh giá (Category) | Điểm số (Score / 10) | Trạng thái (Status) | Nhận xét tổng quan |
| :--- | :---: | :---: | :--- |
| **Bảo mật & Kiểm soát truy cập (Security & Access Control)** | **6.5 / 10** | ⚠️ Cần khắc phục | IDOR REST API và SQLi được xử lý rất tốt. Tuy nhiên, tồn tại **lỗ hổng CRITICAL tại kênh SSE** cho phép nghe lén tin nhắn thời gian thực mà không cần xác thực. Thiếu Rate Limiting. |
| **Kiến trúc & Clean Code (Architecture & Modularity)** | **9.0 / 10** | ✅ Xuất sắc | Cấu trúc phân tầng rõ ràng (Controller -> Service -> DB). Áp dụng thuật toán Canonical Ordering triệt để để chống race condition và duplicate chat rooms. |
| **Xử lý lỗi & Phục hồi (Error Handling & Robustness)** | **7.5 / 10** | ⚠️ Khá | Phân loại lỗi tốt (`DmError` hierarchy), nhưng vẫn để lộ `err.message` ra client ở lỗi 500. Thiếu kiểm tra idempotency khi soft-delete tin nhắn. |
| **Kiểm thử & Độ tin cậy (Test Coverage & Reliability)** | **9.5 / 10** | ✅ Xuất sắc | 99/99 tests toàn bộ backend pass 100%. Bộ test audit chuyên sâu 13/13 ca kiểm thử bảo mật bao phủ IDOR, SQLi, XSS, SSE leakage và Data privacy. |
| **TỔNG KẾT CHUNG (OVERALL RATING)** | **8.1 / 10** | **B+ (Khá - Sẵn sàng sau khi vá Hotfix P1)** |

---

## 2. MA TRẬN PHÂN TÍCH BỀ MẶT TẤN CÔNG (SECURITY AUDIT MATRIX)

| Bề mặt tấn công (Surface) | Kết quả thẩm tra (Audit Result) | Mức độ rủi ro |
| :--- | :--- | :---: |
| **1. Broken Access Control (IDOR / BOLA)** | **PASS (REST)**: Tất cả endpoint đều xác thực quyền tham gia của `currentUserId`. Người lạ không thể đọc, gửi, hay đánh dấu đã đọc. | 🟢 SECURE |
| **2. Injection (SQLi, Stored XSS)** | **PASS**: Prisma ORM ngăn chặn 100% SQLi. React escape text node chống XSS. Tuy nhiên `mediaUrls` chưa validate định dạng URL. | 🟡 LOW RISK |
| **3. Real-time Security (SSE / WebSocket)** | **FAIL (CRITICAL)**: `RealtimeEventStreamController` cho phép đăng ký nhận tin `?userId=` mà không xác thực JWT, làm lộ tin nhắn riêng tư. | 🔴 CRITICAL |
| **4. Data Privacy & Leaks** | **PASS**: `passwordHash`, `email` không bị lộ. Tin nhắn soft-delete được che giấu nội dung (`This message was deleted`). | 🟢 SECURE |
| **5. Rate Limiting & DoS** | **FAIL (HIGH)**: Toàn bộ API gửi tin nhắn và tạo hội thoại không có Rate Limiting, dễ bị tấn công spam và làm cạn kiệt tài nguyên. | 🟠 HIGH |
| **6. Phân tích Dependencies (SCA)** | **WARNING (HIGH)**: Phát hiện 3 CVEs High trong `@fastify/static`, `fastify`, và `find-my-way`. | 🟠 HIGH |

---

## 3. CHI TIẾT LỖ HỔNG & RỦI RO (VULNERABILITY DETAILS)

### 🔴 CRITICAL-01: Unauthorized Real-Time SSE Channel Subscription & Cleartext DM Eavesdropping
- **Vị trí:** `backend/src/modules/notifications/RealtimeEventStreamController.ts:15-43`
- **Phân loại:** OWASP Top 10 A01:2021 – Broken Access Control / Insecure Direct Object Reference (BOLA)
- **Mối đe dọa (Threat Vector):**
  Endpoint `GET /api/v1/realtime/stream` nhận diện người dùng thông qua query string `?userId=` hoặc header `x-user-id` mà **không hề kiểm tra tính hợp lệ của JWT token hay phiên xác thực**:
  ```typescript
  const userId =
    ((req.headers['x-user-id'] as string | undefined) ||
      (req.query as Record<string, string | undefined>)?.userId ||
      'anonymous').trim();
  ```
  Kẻ tấn công không cần đăng nhập, chỉ cần kết nối đến `GET /api/v1/realtime/stream?userId=<victim_id>` là có thể chiếm quyền lắng nghe toàn bộ sự kiện thời gian thực của nạn nhân. Khi bất kỳ ai gửi tin nhắn trực tiếp cho nạn nhân, sự kiện `dm.message.new` kèm toàn bộ nội dung tin nhắn dạng cleartext (`message.content`), thông tin người gửi (`sender`), và `conversationId` sẽ được gửi trực tiếp đến kết nối của kẻ tấn công.
- **Bằng chứng thực nghiệm (Reproduction Step & Proof):**
  Đã viết kịch bản kiểm thử độc lập trong `backend/tests/security-dm-audit.test.mjs` (test case `AUDIT-3.1`). Kẻ tấn công Charlie mở kết nối SSE với `userId` của Alice mà không truyền Authorization header hay token. Khi Bob gửi tin nhắn bí mật cho Alice, Charlie đã bắt trọn payload tin nhắn cleartext thành công 100%.
- **Đoạn mã khắc phục mẫu (Fix Patch):**
  ```typescript
  // In RealtimeEventStreamController.ts:
  public handleStream(req: FastifyRequest, reply: FastifyReply): void {
    // 1. Enforce authentication
    const currentUserId = req.currentUserId;
    const requestedUserId = (req.query as Record<string, string | undefined>)?.userId;

    if (!currentUserId) {
      reply.status(401).send({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication token required' }
      });
      return;
    }

    // 2. Prevent user impersonation on SSE stream
    if (requestedUserId && requestedUserId !== currentUserId) {
      reply.status(403).send({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Cannot subscribe to another user\'s event stream' }
      });
      return;
    }

    const userId = currentUserId;
    // ... proceed with reply.hijack() and connection registration
  }
  ```

---

### 🟠 HIGH-01: Thiếu Rate Limiting trên các Endpoints Direct Messaging (Spam & Denial of Service)
- **Vị trí:** `backend/src/modules/dm/DmController.ts`, `backend/src/app.ts`
- **Phân loại:** OWASP Top 10 A04:2021 – Insecure Design / Rate Limiting Failure
- **Mối đe dọa (Threat Vector):**
  Các API:
  - `POST /api/v1/dm/conversations/:id/messages`
  - `POST /api/v1/dm/conversations`
  - `PUT /api/v1/dm/conversations/:id/read`
  không hề có bất kỳ lớp bọc Rate Limiting nào. Kẻ tấn công có tài khoản hợp lệ có thể sử dụng script gửi 1.000 - 5.000 requests/giây để:
  1. Ghi tràn bảng `dm_messages` trong cơ sở dữ liệu PostgreSQL.
  2. Kích hoạt liên tục các lệnh `realtimeStreamController.sendToUser`, làm tràn bộ nhớ (buffer bloat) và nghẽn CPU của Node.js event loop.
  3. Làm treo trình duyệt của nạn nhân do DOM bị re-render hàng nghìn tin nhắn trong vài giây.
- **Đoạn mã khắc phục mẫu (Fix Patch):**
  Cài đặt và cấu hình plugin `@fastify/rate-limit`:
  ```typescript
  import rateLimit from '@fastify/rate-limit';

  await app.register(rateLimit, {
    global: false, // Apply selectively
  });

  // Apply to DM message sending route:
  v1.post(
    '/dm/conversations/:id/messages',
    {
      config: {
        rateLimit: {
          max: 15,
          timeWindow: '1 minute',
          errorResponseBuilder: () => ({
            success: false,
            error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Quá nhiều tin nhắn gửi đi. Vui lòng thử lại sau.' }
          }),
        }
      }
    },
    dmController.sendMessage.bind(dmController)
  );
  ```

---

### 🟠 HIGH-02: Lỗ hổng bảo mật trong Third-Party Dependencies (SCA)
- **Vị trí:** `backend/package.json`
- **Chi tiết lỗ hổng:**
  1. `@fastify/static <= 10.1.1`: Dính **GHSA-8pvw-jcv7-9cmj** (Bypass phân quyền qua Non-Canonical URL Paths) và **GHSA-83w8-p2f5-377r** (Path Traversal bypass route guard).
  2. `fastify <= 5.12.0`: Dính **GHSA-mrq3-vjjr-p77c** (DoS qua Unbounded Memory Allocation trong sendWebStream) và **GHSA-444r-cwp2-x5xf** (Spoofing Host header).
  3. `find-my-way <= 9.6.0`: Dính **GHSA-c96f-x56v-gq3h** (DDoS với HTTP2).
- **Khắc phục:** Chạy nâng cấp các dependencies:
  ```bash
  npm update fastify @fastify/static
  ```

---

### 🟡 MEDIUM-01: Lộ thông tin nhạy cảm qua Stack Trace / Error Messages ở mã lỗi 500
- **Vị trí:** `backend/src/modules/dm/DmController.ts:241-248`
- **Mối đe dọa:** Khi có lỗi runtime hoặc cơ sở dữ liệu (Prisma database error, connection timeout), phương thức `handleError` trả về trực tiếp `message: err.message`. Trong môi trường Production, điều này vô tình làm lộ cấu trúc bảng, tên cột, hoặc chuỗi kết nối nội bộ cho attacker.
- **Khắc phục:**
  ```typescript
  const message = process.env.NODE_ENV === 'production' 
    ? 'An unexpected error occurred' 
    : (err instanceof Error ? err.message : 'An unexpected error occurred');
  ```

---

### 🟡 MEDIUM-02: Thiếu Schema Validation cho `mediaUrls` và `messageType`
- **Vị trí:** `backend/src/modules/dm/DmMessageService.ts:31-40, 85-86`
- **Mối đe dọa:** 
  - `mediaUrls` được gán trực tiếp từ request body (`input.mediaUrls || []`) mà không kiểm tra xem có phải là mảng string hợp lệ hay không, không giới hạn số lượng ảnh (ví dụ attacker gửi mảng chứa 1.000 URLs), và không kiểm tra URL scheme (`https://` hoặc `/uploads/...`). 
  - Nếu attacker chèn URL ảnh độc hại chứa query parameters tracking (`https://tracker.com/pixel?user=victim`), nạn nhân khi mở chat sẽ tự động gửi request đến máy chủ đó, làm lộ địa chỉ IP và thông tin trình duyệt.
- **Khắc phục:**
  Thêm validation nghiêm ngặt:
  ```typescript
  if (input.mediaUrls !== undefined) {
    if (!Array.isArray(input.mediaUrls) || input.mediaUrls.length > 5) {
      throw new DmValidationError('mediaUrls must be an array with maximum 5 items');
    }
    for (const url of input.mediaUrls) {
      if (typeof url !== 'string' || (!url.startsWith('https://') && !url.startsWith('/uploads/'))) {
        throw new DmValidationError('Each mediaUrl must be a secure https URL or local upload path');
      }
    }
  }
  ```

---

### 🟡 MEDIUM-03: Thiếu tính Idempotent khi Soft-Delete tin nhắn dẫn đến Event Replay Spam
- **Vị trí:** `backend/src/modules/dm/DmMessageService.ts:344-388`
- **Mối đe dọa:** Khi gọi `DELETE /dm/messages/:id`, dịch vụ không kiểm tra xem tin nhắn đã có `deletedAt` hay chưa. Nếu gọi lặp đi lặp lại endpoint này trên cùng một tin nhắn đã xóa, hệ thống vẫn liên tục cập nhật lại `deletedAt` và bắn sự kiện SSE `dm.message.deleted` đến cả hai phía, tạo kẽ hở cho kẻ xấu spam event stream.
- **Khắc phục:**
  ```typescript
  if (message.deletedAt !== null) {
    return {
      messageId: message.id,
      conversationId: message.conversationId,
      deleted: true,
      deletedAt: message.deletedAt.toISOString(),
    };
  }
  ```

---

### 🟢 LOW-01 & LOW-02: Khuyến nghị Tối ưu Kiến trúc & Bảo vệ Kênh Truyền
1. **Thống nhất mã lỗi 404 cho Broken Object Level Access:** Hiện tại nếu hội thoại không tồn tại trả về 404, nhưng nếu tồn tại mà user không thuộc hội thoại lại trả về 403. Kẻ tấn công có thể phân biệt được ID nào có thật. Nên cân nhắc trả về 404 trong cả 2 trường hợp để chống dò quét ID.
2. **CORS trên SSE Stream:** Cần giới hạn origin cụ thể trên header `Access-Control-Allow-Origin` của kênh SSE thay vì sử dụng wildcard `*`.

---

## 4. KẾ HOẠCH HÀNH ĐỘNG ƯU TIÊN (PRIORITIZED ACTION PLAN)

```
[P1 - NGAY LẬP TỨC / HOTFIX TRƯỚC KHI DEPLOY]
│  ├── 1. Khóa kênh SSE: Xác thực bắt buộc JWT token và đối chiếu userId trên GET /api/v1/realtime/stream.
│  └── 2. Cài đặt Rate Limiting cho API gửi tin nhắn (tối đa 15 tin/phút/user).
│
[P2 - TRONG VÒNG 24H / SECURITY HARDENING]
│  ├── 3. Cập nhật các dependencies có CVE (fastify, @fastify/static).
│  ├── 4. Bổ sung validation chặt chẽ cho mảng `mediaUrls` (max 5 items, URL schema https://).
│  ├── 5. Bổ sung kiểm tra Idempotency khi soft-delete tin nhắn để chặn event spamming.
│  └── 6. Che giấu error message chi tiết ở lỗi 500 trên môi trường Production.
│
[P3 - THEO DÕI & TỐI ƯU HÓA]
   ├── 7. Cấu hình CORS chặt chẽ cho endpoint SSE stream.
   └── 8. Xem xét chính sách xóa triệt để nội dung nhạy cảm trong DB sau khi soft-delete (GDPR compliance).
```

---

## 5. KẾT LUẬN & ĐÁNH GIÁ CHUNG (VERDICT)
Tính năng 1-1 Direct Messaging (TASK-14) sở hữu nền tảng kiến trúc backend rất vững chắc: **bảo vệ IDOR tầng dữ liệu hoàn hảo, chống SQL Injection tuyệt đối, kiểm soát Block 2 chiều nghiêm ngặt và cơ chế Canonical Ordering ngăn chặn race condition rất thông minh**.

Tuy nhiên, do **kênh truyền SSE thời gian thực bị bỏ lọt khâu xác thực danh tính**, lỗ hổng **CRITICAL-01** phải được vá ngay trước khi đưa tính năng này lên môi trường Production. Sau khi áp dụng Fix Patch cho kênh SSE và kích hoạt Rate Limiting, tính năng sẽ đạt chuẩn an toàn cao cấp (A-Grade Enterprise Ready).

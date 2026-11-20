# SYSTEM DESIGN DOCUMENT: 1-1 DIRECT MESSAGING (DM) ENGINE

**Project:** Pulse Social Network  
**Module:** Direct Messaging Subsystem (TASK-14)  
**Version:** 1.0.0  
**Author:** Tech Lead & System Architect (`researcher`)  
**Status:** Approved Specification & Architecture Contract  
**Target Environment:** Arch Linux, Node.js 26.8, PostgreSQL 18.6, Fastify 4.x, Prisma ORM, React 18 / Vite  

---

## 1. EXECUTIVE SUMMARY & OBJECTIVES

Tài liệu này định nghĩa toàn bộ đặc tả kỹ thuật, mô hình dữ liệu (ERD), hợp đồng API (REST DTOs), lược đồ sự kiện thời gian thực (SSE/WebSocket), và các bất biến bảo mật (Security Invariants) cho tính năng **1-1 Direct Messaging (Tin nhắn trực tiếp cá nhân)** trên mạng xã hội Pulse.

### Mục tiêu kiến trúc cốt lõi:
1. **Canonical Conversation Invariant (Deduplication):** Đảm bảo duy nhất 1 cuộc trò chuyện giữa 2 người dùng bằng cơ chế sắp xếp thứ tự chuẩn (`participant1Id < participant2Id`) kết hợp PostgreSQL Unique Index. Tuyệt đối không thể xảy ra tình trạng trùng lặp hội thoại do race condition khi 2 bên cùng bấm nhắn tin cùng lúc.
2. **Sub-50ms Real-Time Delivery:** Tận dụng hạ tầng Server-Sent Events (SSE) sẵn có của Pulse qua `/api/v1/realtime/stream` để đẩy tin nhắn, trạng thái xóa và đã đọc (read receipts) tới người nhận ngay lập tức, hỗ trợ mở rộng sang WebSocket RFC 6455 khi cần tương tác 2 chiều liên tục.
3. **Strict Two-Way Privacy & Block Invariants:** Đồng bộ chặt chẽ với hệ thống Social Graph Block của Pulse: khi User A chặn User B (hoặc ngược lại), mọi hành vi tạo hội thoại mới hoặc gửi tin nhắn đều bị chặn đứng ngay tại tầng domain service (HTTP 403 `USER_BLOCKED`).
4. **Resilient Read Receipts & Unread Counters:** Đảm bảo số lượng tin nhắn chưa đọc được tính toán chính xác và hiệu năng cao qua index `(conversationId, createdAt)` kết hợp bản ghi `dm_read_receipts`.
5. **Safe Soft-Deletion & Content Sanitization:** Khi tin nhắn bị xóa (`deletedAt IS NOT NULL`), nội dung raw lập tức bị che giấu (`"This message was deleted"`) và media URLs bị gỡ bỏ, chỉ người gửi gốc mới có quyền xóa.

---

## 2. TRADE-OFF ANALYSIS: REAL-TIME TRANSPORT PROTOCOL

Khi thiết kế kênh truyền thời gian thực cho tính năng Direct Messaging trong hệ sinh thái Pulse, chúng tôi tiến hành đánh giá 2 phương án công nghệ khả dĩ:

| Tiêu chí | Server-Sent Events (SSE) + HTTP POST (Phương án được chọn) | WebSocket 2 chiều (RFC 6455) |
| :--- | :--- | :--- |
| **Kiến trúc hạ tầng** | ✅ Tận dụng 100% `RealtimeEventStreamController` sẵn có trong Pulse, không phát sinh port/daemon mới. | ⚠️ Yêu cầu cài đặt thêm `@fastify/websocket`, cấu hình upgrade connection và heartbeat song song. |
| **Độ trễ (Latency)** | Cực thấp (<20ms) cho server-to-client push; client-to-server gửi qua HTTP POST chuẩn REST. | Cực thấp (<10ms) cho cả 2 chiều qua TCP stream liên tục. |
| **Xác thực & Bảo mật** | Tự nhiên với header `x-user-id` và cookie/token HTTP chuẩn, hỗ trợ đầy đủ Fastify preHandler hooks. | Phức tạp hơn: cần handshake token query param hoặc custom upgrade authentication. |
| **Reconnection & Resilience** | Native EventSource tự động reconnect với `Last-Event-ID`, cơ chế retry tích hợp sẵn ở trình duyệt. | Phải tự code logic reconnect, exponential backoff và queueing tin nhắn chưa gửi trên client. |
| **Proxy / Firewall Traversal** | Chạy trên HTTP/1.1 và HTTP/2 cổng 80/443 tiêu chuẩn, không bị chặn bởi corporate proxies/WAF. | Có thể bị chặn bởi các proxy cũ không hỗ trợ WebSocket Upgrade. |
| **Độ phức tạp kiểm thử** | Thấp: kiểm thử được dễ dàng bằng `node:test`, `curl`, EventSource mock. | Trung bình: cần duy trì mock socket client trong test suite. |

**Quyết định kiến trúc:**  
Sử dụng mô hình **Hybrid REST + SSE**:
- **Client to Server:** Gửi tin nhắn, cập nhật read receipt, xóa tin qua REST API endpoints (`POST`, `PUT`, `DELETE`).
- **Server to Client:** Đẩy sự kiện tức thì qua SSE stream (`/api/v1/realtime/stream`) với các sự kiện định danh `dm.message.new`, `dm.message.deleted`, `dm.read_receipt.updated`.
- Thiết kế Payload tuân theo chuẩn W3C/SSE và sẵn sàng ánh xạ 1:1 sang WebSocket format khi hệ thống mở rộng chat nhóm (Group Chat) trong tương lai.

---

## 3. MÔ HÌNH DỮ LIỆU & ERD (DATA MODEL & SCHEMA)

### 3.1. Entity Relationship Diagram (ERD)

```
┌────────────────────────────────────────────────────────┐
│                          User                          │
├────────────────────────────────────────────────────────┤
│ id (PK, UUID)                                          │
│ username, displayName, avatarUrl                       │
└──────────┬──────────────────────────────────┬──────────┘
           │ 1                                │ 1
           │ (as participant1 or 2)           │ (as sender)
           ▼ N                                ▼ N
┌───────────────────────────────┐  1       N  ┌───────────────────────────────┐
│        DmConversation         │─────────────│           DmMessage           │
├───────────────────────────────┤             ├───────────────────────────────┤
│ id (PK, UUID)                 │             │ id (PK, UUID)                 │
│ participant1Id (FK -> User)   │             │ conversationId (FK -> Conv)   │
│ participant2Id (FK -> User)   │             │ senderId (FK -> User)         │
│ createdAt (DateTime)          │             │ content (Text, max 5000)      │
│ updatedAt (DateTime)          │             │ messageType (TEXT | IMAGE)    │
└──────────┬────────────────────┘             │ mediaUrls (String[])          │
           │ 1                                │ createdAt (DateTime)          │
           │                                  │ updatedAt (DateTime)          │
           ▼ N                                │ deletedAt (DateTime, Nullable)│
┌───────────────────────────────┐             └───────────────────────────────┘
│         DmReadReceipt         │                             ▲
├───────────────────────────────┤                             │
│ id (PK, UUID)                 │                             │ 0..1
│ conversationId (FK -> Conv)   │                             │
│ userId (FK -> User)           │                             │
│ lastReadMessageId (FK -> Msg) ├─────────────────────────────┘
│ readAt (DateTime)             │
│ updatedAt (DateTime)          │
└───────────────────────────────┘
```

### 3.2. Đặc tả Prisma Schema (`backend/prisma/schema.prisma`)

Bổ sung các models sau vào Prisma Schema:

```prisma
model DmConversation {
  id              String   @id @default(uuid())
  participant1Id  String
  participant2Id  String
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  participant1    User     @relation("DmParticipant1", fields: [participant1Id], references: [id], onDelete: Cascade)
  participant2    User     @relation("DmParticipant2", fields: [participant2Id], references: [id], onDelete: Cascade)
  messages        DmMessage[]
  readReceipts    DmReadReceipt[]

  // Bất biến: participant1Id luôn nhỏ hơn participant2Id theo thứ tự từ điển (lexicographical order)
  @@unique([participant1Id, participant2Id], name: "unique_dm_participants")
  @@index([participant1Id, updatedAt(sort: Desc)])
  @@index([participant2Id, updatedAt(sort: Desc)])
  @@index([updatedAt(sort: Desc)])
  @@map("dm_conversations")
}

model DmMessage {
  id             String    @id @default(uuid())
  conversationId String
  senderId       String
  content        String    @db.Text
  messageType    String    @default("TEXT") // "TEXT" | "IMAGE" | "SYSTEM"
  mediaUrls      String[]  @default([])
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt
  deletedAt      DateTime?

  conversation   DmConversation  @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  sender         User            @relation("DmMessageSender", fields: [senderId], references: [id], onDelete: Cascade)
  readReceipts   DmReadReceipt[] @relation("LastReadMessage")

  @@index([conversationId, createdAt(sort: Desc)])
  @@index([senderId])
  @@map("dm_messages")
}

model DmReadReceipt {
  id                String    @id @default(uuid())
  conversationId    String
  userId            String
  lastReadMessageId String?
  readAt            DateTime  @default(now())
  updatedAt         DateTime  @updatedAt

  conversation      DmConversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  user              User           @relation("DmUserReadReceipt", fields: [userId], references: [id], onDelete: Cascade)
  lastReadMessage   DmMessage?     @relation("LastReadMessage", fields: [lastReadMessageId], references: [id], onDelete: SetNull)

  @@unique([conversationId, userId], name: "unique_conversation_user_receipt")
  @@index([userId])
  @@index([conversationId])
  @@map("dm_read_receipts")
}
```

*Cập nhật quan hệ trong `User` model:*
```prisma
model User {
  // ... existing fields ...
  dmConversationsAs1 DmConversation[] @relation("DmParticipant1")
  dmConversationsAs2 DmConversation[] @relation("DmParticipant2")
  dmSentMessages     DmMessage[]      @relation("DmMessageSender")
  dmReadReceipts     DmReadReceipt[]  @relation("DmUserReadReceipt")
}
```

### 3.3. PostgreSQL Raw DDL & Database Constraints

Khi sinh bảng hoặc migration trên PostgreSQL 18:

```sql
-- 1. Bảng dm_conversations
CREATE TABLE IF NOT EXISTS "dm_conversations" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "participant1Id" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
    "participant2Id" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "check_dm_canonical_ordering" CHECK ("participant1Id" < "participant2Id"),
    CONSTRAINT "unique_dm_participants" UNIQUE ("participant1Id", "participant2Id")
);

CREATE INDEX IF NOT EXISTS "idx_dm_conversations_p1_updated" ON "dm_conversations"("participant1Id", "updatedAt" DESC);
CREATE INDEX IF NOT EXISTS "idx_dm_conversations_p2_updated" ON "dm_conversations"("participant2Id", "updatedAt" DESC);
CREATE INDEX IF NOT EXISTS "idx_dm_conversations_updated" ON "dm_conversations"("updatedAt" DESC);

-- 2. Bảng dm_messages
CREATE TABLE IF NOT EXISTS "dm_messages" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "conversationId" UUID NOT NULL REFERENCES "dm_conversations"("id") ON DELETE CASCADE,
    "senderId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
    "content" TEXT NOT NULL,
    "messageType" VARCHAR(32) NOT NULL DEFAULT 'TEXT',
    "mediaUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3) NULL
);

CREATE INDEX IF NOT EXISTS "idx_dm_messages_conv_created" ON "dm_messages"("conversationId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "idx_dm_messages_sender" ON "dm_messages"("senderId");

-- 3. Bảng dm_read_receipts
CREATE TABLE IF NOT EXISTS "dm_read_receipts" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "conversationId" UUID NOT NULL REFERENCES "dm_conversations"("id") ON DELETE CASCADE,
    "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
    "lastReadMessageId" UUID NULL REFERENCES "dm_messages"("id") ON DELETE SET NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "unique_conversation_user_receipt" UNIQUE ("conversationId", "userId")
);

CREATE INDEX IF NOT EXISTS "idx_dm_read_receipts_user" ON "dm_read_receipts"("userId");
CREATE INDEX IF NOT EXISTS "idx_dm_read_receipts_conv" ON "dm_read_receipts"("conversationId");
```

---

## 4. FINITE STATE MACHINES (FSM) & FLOWS

### 4.1. Message Lifecycle State Machine
```
   [Composing on Client]
             │ (POST /dm/conversations/:id/messages)
             ▼
      [Persisted to DB]
             │
             ├─────────────────────────────────────────────────┐
             │ (SSE push dm.message.new)                       │ (DELETE /dm/messages/:id)
             ▼                                                 ▼
     [Delivered to Client]                             [Soft-Deleted]
             │                                         (content masked,
             │ (Recipient opens view /                 deletedAt set)
             │  PUT /dm/conversations/:id/read)                │
             ▼                                                 ▼
          [Read]                                     [SSE dm.message.deleted]
    (readReceipt updated,
    SSE dm.read_receipt.updated)
```

### 4.2. Conversation Creation Flow & Idempotency
```
Client A calls POST /dm/conversations with { recipientId: B }
   │
   ├─► Check A === B? ──► YES ──► 400 Bad Request ("Cannot DM yourself")
   │
   ├─► Check Block relation between A and B? ──► YES ──► 403 Forbidden ("User is blocked")
   │
   ├─► Sort canonical IDs:
   │      p1 = min(A, B)
   │      p2 = max(A, B)
   │
   ├─► Query DB: SELECT * FROM dm_conversations WHERE participant1Id = p1 AND participant2Id = p2
   │      │
   │      ├── Found existing? ──► Return existing conversation (200 OK)
   │      │
   │      └── Not found? ──► INSERT INTO dm_conversations (id, participant1Id, participant2Id)
   │                            Return newly created conversation (201 Created)
```

---

## 5. API CONTRACTS & SPECIFICATIONS

Tất cả endpoints tuân thủ cấu trúc đồng nhất của Pulse:
- **Base URL:** `/api/v1/dm`
- **Authentication:** Header `x-user-id: <uuid>` (nạp vào `request.currentUserId`)
- **Phản hồi chuẩn:** `ApiResponse<T>` với `{ success: true, data: T }` hoặc `{ success: false, error: { code, message } }`.

### 5.1. `POST /api/v1/dm/conversations`
Lấy hoặc tạo mới cuộc trò chuyện trực tiếp giữa 2 người dùng. Đảm bảo tính lũy kế (idempotent).

* **Header:** `x-user-id: <authUserId>` (Bắt buộc)
* **Request Body:**
  ```json
  {
    "recipientId": "22222222-2222-2222-2222-222222222222"
  }
  ```
* **Success Response (200 OK hoặc 201 Created):**
  ```json
  {
    "success": true,
    "data": {
      "id": "c1a2b3c4-5678-90ab-cdef-111122223333",
      "participant1Id": "11111111-1111-1111-1111-111111111111",
      "participant2Id": "22222222-2222-2222-2222-222222222222",
      "createdAt": "2026-09-16T10:00:00.000Z",
      "updatedAt": "2026-09-16T10:00:00.000Z",
      "otherUser": {
        "id": "22222222-2222-2222-2222-222222222222",
        "username": "alice",
        "displayName": "Alice Nguyễn",
        "avatarUrl": "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150"
      },
      "lastMessage": null,
      "unreadCount": 0
    }
  }
  ```
* **Error Responses:**
  - `400 BAD_REQUEST`: `Self-DM is not allowed` (khi `recipientId === currentUserId`)
  - `400 BAD_REQUEST`: `Missing or invalid recipientId`
  - `403 FORBIDDEN`: `Cannot start conversation with this user due to block settings`
  - `404 NOT_FOUND`: `Recipient user not found`

---

### 5.2. `GET /api/v1/dm/conversations`
Lấy danh sách các cuộc trò chuyện của người dùng hiện tại, sắp xếp theo thời gian hoạt động mới nhất (`updatedAt DESC`), kèm preview tin nhắn cuối và số tin chưa đọc.

* **Header:** `x-user-id: <authUserId>`
* **Query Parameters:**
  - `limit` (optional, default: 20, max: 50)
  - `cursor` (optional, `conversationId` phân trang)
* **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "data": {
      "conversations": [
        {
          "id": "c1a2b3c4-5678-90ab-cdef-111122223333",
          "participant1Id": "11111111-1111-1111-1111-111111111111",
          "participant2Id": "22222222-2222-2222-2222-222222222222",
          "createdAt": "2026-09-16T10:00:00.000Z",
          "updatedAt": "2026-09-16T10:15:30.000Z",
          "otherUser": {
            "id": "22222222-2222-2222-2222-222222222222",
            "username": "alice",
            "displayName": "Alice Nguyễn",
            "avatarUrl": "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150"
          },
          "lastMessage": {
            "id": "m9999999-8888-7777-6666-555544443333",
            "conversationId": "c1a2b3c4-5678-90ab-cdef-111122223333",
            "senderId": "22222222-2222-2222-2222-222222222222",
            "content": "Chào Hoà! Hệ thống DM chạy rất mượt.",
            "messageType": "TEXT",
            "mediaUrls": [],
            "isDeleted": false,
            "createdAt": "2026-09-16T10:15:30.000Z"
          },
          "unreadCount": 2,
          "isBlocked": false
        }
      ],
      "nextCursor": null
    }
  }
  ```

---

### 5.3. `GET /api/v1/dm/conversations/:id/messages`
Lấy lịch sử tin nhắn trong cuộc trò chuyện theo phân trang con trỏ (Cursor-based Pagination).

* **Header:** `x-user-id: <authUserId>`
* **Path Parameters:** `id` (Conversation ID)
* **Query Parameters:**
  - `limit` (optional, default: 30, max: 100)
  - `cursor` (optional, `messageId` để lấy tin nhắn trước đó)
  - `direction` (optional, `'before'` | `'after'`, default: `'before'`)
* **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "data": {
      "conversationId": "c1a2b3c4-5678-90ab-cdef-111122223333",
      "messages": [
        {
          "id": "m1111111-2222-3333-4444-555566667777",
          "conversationId": "c1a2b3c4-5678-90ab-cdef-111122223333",
          "senderId": "11111111-1111-1111-1111-111111111111",
          "content": "Hello Alice!",
          "messageType": "TEXT",
          "mediaUrls": [],
          "isDeleted": false,
          "createdAt": "2026-09-16T10:05:00.000Z",
          "updatedAt": "2026-09-16T10:05:00.000Z",
          "sender": {
            "id": "11111111-1111-1111-1111-111111111111",
            "username": "hoa_dev",
            "displayName": "Hoà Phùng",
            "avatarUrl": "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150"
          }
        },
        {
          "id": "m2222222-3333-4444-5555-666677778888",
          "conversationId": "c1a2b3c4-5678-90ab-cdef-111122223333",
          "senderId": "11111111-1111-1111-1111-111111111111",
          "content": "This message was deleted",
          "messageType": "TEXT",
          "mediaUrls": [],
          "isDeleted": true,
          "createdAt": "2026-09-16T10:06:00.000Z",
          "updatedAt": "2026-09-16T10:07:00.000Z",
          "sender": {
            "id": "11111111-1111-1111-1111-111111111111",
            "username": "hoa_dev",
            "displayName": "Hoà Phùng",
            "avatarUrl": "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150"
          }
        }
      ],
      "nextCursor": "m1111111-2222-3333-4444-555566667777",
      "hasMore": false
    }
  }
  ```
* **Error Responses:**
  - `403 FORBIDDEN`: `You are not a participant of this conversation` (IDOR check)
  - `404 NOT_FOUND`: `Conversation not found`

---

### 5.4. `POST /api/v1/dm/conversations/:id/messages`
Gửi tin nhắn mới vào cuộc trò chuyện.

* **Header:** `x-user-id: <authUserId>`
* **Path Parameters:** `id` (Conversation ID)
* **Request Body:**
  ```json
  {
    "content": "Chào bạn, mình vừa hoàn thành tài liệu kiến trúc DM!",
    "messageType": "TEXT",
    "mediaUrls": []
  }
  ```
* **Success Response (201 Created):**
  ```json
  {
    "success": true,
    "data": {
      "id": "m3333333-4444-5555-6666-777788889999",
      "conversationId": "c1a2b3c4-5678-90ab-cdef-111122223333",
      "senderId": "11111111-1111-1111-1111-111111111111",
      "content": "Chào bạn, mình vừa hoàn thành tài liệu kiến trúc DM!",
      "messageType": "TEXT",
      "mediaUrls": [],
      "isDeleted": false,
      "createdAt": "2026-09-16T10:20:00.000Z",
      "updatedAt": "2026-09-16T10:20:00.000Z",
      "sender": {
        "id": "11111111-1111-1111-1111-111111111111",
        "username": "hoa_dev",
        "displayName": "Hoà Phùng",
        "avatarUrl": "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150"
      }
    }
  }
  ```
* **Side Effects:**
  1. Cập nhật `dm_conversations.updatedAt = NOW()`.
  2. Bắn sự kiện thời gian thực `dm.message.new` qua SSE tới người nhận.
* **Error Responses:**
  - `400 BAD_REQUEST`: `Message content cannot be empty or exceed 5000 characters`
  - `403 FORBIDDEN`: `Cannot send message: User is blocked` (Block invariant)
  - `403 FORBIDDEN`: `You are not a participant in this conversation` (IDOR check)
  - `404 NOT_FOUND`: `Conversation not found`

---

### 5.5. `PUT /api/v1/dm/conversations/:id/read`
Đánh dấu cuộc trò chuyện đã đọc (Read Receipt) đến một tin nhắn cụ thể hoặc tin nhắn mới nhất.

* **Header:** `x-user-id: <authUserId>`
* **Path Parameters:** `id` (Conversation ID)
* **Request Body:**
  ```json
  {
    "messageId": "m3333333-4444-5555-6666-777788889999"
  }
  ```
  *(Nếu `messageId` để trống, hệ thống tự động gán `lastReadMessageId` bằng ID của tin nhắn mới nhất trong conversation).*
* **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "data": {
      "conversationId": "c1a2b3c4-5678-90ab-cdef-111122223333",
      "userId": "11111111-1111-1111-1111-111111111111",
      "lastReadMessageId": "m3333333-4444-5555-6666-777788889999",
      "readAt": "2026-09-16T10:21:00.000Z"
    }
  }
  ```
* **Side Effects:**
  - Upsert bản ghi vào bảng `dm_read_receipts`.
  - Bắn sự kiện `dm.read_receipt.updated` tới thành viên còn lại trong cuộc trò chuyện.
* **Error Responses:**
  - `403 FORBIDDEN`: `You are not a participant in this conversation`
  - `404 NOT_FOUND`: `Conversation not found`

---

### 5.6. `DELETE /api/v1/dm/messages/:id`
Xóa mềm (Soft Delete) một tin nhắn đã gửi. Chỉ người gửi gốc (`senderId === currentUserId`) mới có quyền xóa.

* **Header:** `x-user-id: <authUserId>`
* **Path Parameters:** `id` (Message ID)
* **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "data": {
      "messageId": "m3333333-4444-5555-6666-777788889999",
      "conversationId": "c1a2b3c4-5678-90ab-cdef-111122223333",
      "deleted": true,
      "deletedAt": "2026-09-16T10:25:00.000Z"
    }
  }
  ```
* **Side Effects:**
  - Cập nhật `deletedAt = NOW()` trong database.
  - Bắn sự kiện `dm.message.deleted` qua SSE tới cả 2 người tham gia cuộc trò chuyện.
* **Error Responses:**
  - `403 FORBIDDEN`: `You can only delete your own messages`
  - `404 NOT_FOUND`: `Message not found`

---

## 6. REAL-TIME EVENT STREAM SPECIFICATION (SSE & WEBSOCKET)

Các sự kiện thời gian thực được phát qua endpoint SSE sẵn có: `GET /api/v1/realtime/stream` (kết nối bởi `RealtimeEventStreamController`). Dưới đây là định dạng message chuẩn:

### 6.1. Sự kiện: `dm.message.new`
Được phát khi có tin nhắn mới được tạo.
* **Đích gửi (Routing Target):** Gửi tới người nhận (`recipientId`) và đồng thời gửi cho các tab khác của người gửi (`senderId`) để đồng bộ trạng thái multi-device.
* **SSE Event Frame:**
  ```
  event: dm.message.new
  data: {"conversationId":"c1a2b3c4-5678-90ab-cdef-111122223333","message":{"id":"m3333333-4444-5555-6666-777788889999","conversationId":"c1a2b3c4-5678-90ab-cdef-111122223333","senderId":"11111111-1111-1111-1111-111111111111","content":"Chào bạn, mình vừa hoàn thành tài liệu kiến trúc DM!","messageType":"TEXT","mediaUrls":[],"isDeleted":false,"createdAt":"2026-09-16T10:20:00.000Z","updatedAt":"2026-09-16T10:20:00.000Z","sender":{"id":"11111111-1111-1111-1111-111111111111","username":"hoa_dev","displayName":"Hoà Phùng","avatarUrl":"https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150"}}}
  ```

### 6.2. Sự kiện: `dm.message.deleted`
Được phát khi một tin nhắn bị xóa mềm.
* **Đích gửi (Routing Target):** Cả 2 người trong conversation.
* **SSE Event Frame:**
  ```
  event: dm.message.deleted
  data: {"conversationId":"c1a2b3c4-5678-90ab-cdef-111122223333","messageId":"m3333333-4444-5555-6666-777788889999","deletedAt":"2026-09-16T10:25:00.000Z"}
  ```

### 6.3. Sự kiện: `dm.read_receipt.updated`
Được phát khi người dùng mở hoặc xem cuộc hội thoại, cập nhật mốc đã đọc.
* **Đích gửi (Routing Target):** Người tham gia còn lại trong cuộc trò chuyện (để hiển thị dấu tick đã đọc `✓✓`).
* **SSE Event Frame:**
  ```
  event: dm.read_receipt.updated
  data: {"conversationId":"c1a2b3c4-5678-90ab-cdef-111122223333","userId":"22222222-2222-2222-2222-222222222222","lastReadMessageId":"m3333333-4444-5555-6666-777788889999","readAt":"2026-09-16T10:21:00.000Z"}
  ```

---

## 7. SECURITY INVARIANTS & CRITICAL EDGE CASES

| STT | Tình huống / Rủi ro | Nguy cơ bảo mật & Trải nghiệm | Giải pháp & Quy tắc kiến trúc bất biến (Security Invariants) |
| :--- | :--- | :--- | :--- |
| **1** | **IDOR (Insecure Direct Object Reference)** | Người dùng trái phép đọc/gửi/xóa tin nhắn trong cuộc trò chuyện của người khác. | **Strict Participant Check:** Mọi controller thao tác với `:id` (conversation) đều truy vấn DB và bắt buộc `currentUserId IN (participant1Id, participant2Id)`. Nếu không thỏa mãn, trả về ngay lập tức HTTP `403 FORBIDDEN`. Không bao giờ bỏ qua bước này. |
| **2** | **Social Graph Blocking (2 chiều)** | Người bị chặn vẫn gửi tin nhắn quấy rối người chặn, hoặc người chặn gửi tin cho người bị chặn. | **Block Pre-validation:** Trước khi tạo conversation hoặc gửi tin nhắn mới, gọi `prisma.block.findFirst` kiểm tra quan hệ chặn 2 chiều (`OR: [{blockerId, blockedId}, {blockerId: target, blockedId: current}]`). Nếu tồn tại, từ chối với HTTP `403 FORBIDDEN` (`USER_BLOCKED`). |
| **3** | **Tự gửi tin nhắn cho chính mình (Self-DM)** | Tạo các bản ghi vô nghĩa hoặc lỗi logic xử lý participant1/2. | **Self-DM Rejection:** Kiểm tra `currentUserId === recipientId`. Lập tức trả về HTTP `400 BAD_REQUEST` (`SELF_DM_NOT_ALLOWED`). |
| **4** | **Race Condition & Conversation Duplication** | 2 người dùng đồng thời bấm nhắn tin cho nhau tại cùng một mili-giây dẫn đến 2 bản ghi cuộc trò chuyện. | **Canonical Sorting + Unique Index:** Canonical sorting luôn áp dụng: `p1 = min(idA, idB)`, `p2 = max(idA, idB)`. Database có constraint `UNIQUE (participant1Id, participant2Id)`. Nếu gặp race condition, câu lệnh INSERT thứ hai sẽ bắt lỗi unique constraint và tự động chuyển sang đọc bản ghi đã tạo. |
| **5** | **Rò rỉ nội dung tin nhắn đã xóa (Data Privacy)** | Tin nhắn đã xóa mềm vẫn bị lộ nội dung nhạy cảm qua API hoặc WebSocket. | **Content Masking:** Khi `deletedAt IS NOT NULL`, service bắt buộc ghi đè trường `content` thành chuỗi cố định `"This message was deleted"` và gán `mediaUrls = []`, `isDeleted = true`. Client không bao giờ nhận được nội dung gốc của tin nhắn đã xóa. |
| **6** | **Tấn công Stored XSS qua nội dung tin nhắn** | Kẻ tấn công gửi mã độc `<script>` hoặc HTML độc hại trong `content`. | **Content Sanitization & React Auto-Escaping:** Tầng backend validate chuỗi không chứa malicious scripts. Tầng frontend sử dụng chuẩn JSX React (mặc định render chuỗi văn bản thuần an toàn chống XSS). |
| **7** | **Spam & Flooding (Rate Limiting)** | Bot spam hàng nghìn tin nhắn làm nghẽn SSE stream và tràn DB. | **Throttle Guard:** Giới hạn mỗi người dùng chỉ được gửi tối đa 20 tin nhắn/phút. Chiều dài tin nhắn tối đa 5000 ký tự. |

---

## 8. TYPESCRIPT TYPE DEFINITIONS & CONTRACTS

Dưới đây là mã nguồn TypeScript định nghĩa đầy đủ DTOs để đồng bộ vào `backend/src/contracts/ApiContracts.ts` và `frontend/src/types/PulseTypes.ts`:

```typescript
// ==========================================
// 1-1 DIRECT MESSAGING (DM) CONTRACTS
// ==========================================

export interface DmUserSummaryDto {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface DmMessageDto {
  id: string;
  conversationId: string;
  senderId: string;
  content: string;
  messageType: 'TEXT' | 'IMAGE' | 'SYSTEM';
  mediaUrls: string[];
  isDeleted: boolean;
  createdAt: string;
  updatedAt: string;
  sender?: DmUserSummaryDto;
}

export interface DmConversationDto {
  id: string;
  participant1Id: string;
  participant2Id: string;
  createdAt: string;
  updatedAt: string;
  otherUser: DmUserSummaryDto;
  lastMessage: DmMessageDto | null;
  unreadCount: number;
  isBlocked?: boolean;
}

export interface DmReadReceiptDto {
  conversationId: string;
  userId: string;
  lastReadMessageId: string | null;
  readAt: string;
}

export interface CreateDmConversationInput {
  recipientId: string;
}

export interface SendDmMessageInput {
  content: string;
  messageType?: 'TEXT' | 'IMAGE';
  mediaUrls?: string[];
}

export interface MarkDmReadInput {
  messageId?: string;
}

export interface DmConversationListResponse {
  conversations: DmConversationDto[];
  nextCursor: string | null;
}

export interface DmMessageListResponse {
  conversationId: string;
  messages: DmMessageDto[];
  nextCursor: string | null;
  hasMore: boolean;
}

export type DmRealtimeEventType =
  | 'dm.message.new'
  | 'dm.message.deleted'
  | 'dm.read_receipt.updated';

export interface DmMessageNewEventData {
  conversationId: string;
  message: DmMessageDto;
}

export interface DmMessageDeletedEventData {
  conversationId: string;
  messageId: string;
  deletedAt: string;
}

export interface DmReadReceiptUpdatedEventData {
  conversationId: string;
  userId: string;
  lastReadMessageId: string | null;
  readAt: string;
}
```

---

## 9. IMPLEMENTATION ROADMAP FOR SUBAGENTS

### 9.1. Nhiệm vụ Backend (`be-coder` - Task `t_6884e8fc`)
1. **Schema & Migration:**
   - Cập nhật `backend/prisma/schema.prisma` với 3 models: `DmConversation`, `DmMessage`, `DmReadReceipt`.
   - Chạy `npx prisma db push` và `npx prisma generate`.
2. **DTO & Contracts:**
   - Append các types ở Mục 8 vào `backend/src/contracts/ApiContracts.ts`.
3. **Services:**
   - Tạo `backend/src/modules/dm/DmConversationService.ts`: Xử lý canonical sorting, findOrCreate, list with unread counts.
   - Tạo `backend/src/modules/dm/DmMessageService.ts`: Xử lý gửi tin nhắn, soft delete, cursor pagination, read receipts, broadcast SSE.
4. **Controllers & Routes:**
   - Tạo `backend/src/modules/dm/DmController.ts`.
   - Đăng ký routes tại `backend/src/app.ts` dưới tiền tố `/api/v1/dm`.
5. **SSE Integration:**
   - Gọi `realtimeStreamController.sendToUser(recipientId, 'dm.message.new', ...)` khi gửi tin và update read receipts.

### 9.2. Nhiệm vụ Frontend (`fe-coder` - Task `t_30ca607d`)
1. **Types & API Client:**
   - Append các types ở Mục 8 vào `frontend/src/types/PulseTypes.ts`.
   - Bổ sung phương thức gọi DM trong `frontend/src/api/PulseApiClient.ts`:
     - `getDmConversations()`, `getOrCreateDmConversation(recipientId)`, `getDmMessages(convId, cursor)`, `sendDmMessage(convId, payload)`, `markDmRead(convId, messageId)`, `deleteDmMessage(messageId)`.
2. **UI Components:**
   - `DirectMessagingView.tsx`: Giao diện chia 2 cột: Sidebar danh sách hội thoại bên trái, Khung chat chi tiết bên phải.
   - `DmConversationListItem.tsx`: Avatar, tên, tin nhắn cuối, badge số tin chưa đọc, thời gian tương đối.
   - `DmChatWindow.tsx`: Header hiển thị thông tin đối phương, khung tin nhắn dạng bubble cuộn tự động xuống đáy.
   - `DmMessageBubble.tsx`: Tin nhắn gửi đi (màu tím/xanh nổi bật) vs tin nhắn nhận được (màu tối), hiển thị dấu tick đã đọc `✓✓`, hiển thị `"This message was deleted"` nếu đã xóa kèm nút xóa cho tin của mình.
   - `DmMessageComposer.tsx`: Ô nhập liệu kèm nút Gửi, hỗ trợ bấm Enter để gửi, Shift+Enter xuống dòng.
   - `NewDmModal.tsx`: Modal tìm kiếm/chọn user để bắt đầu cuộc trò chuyện mới.
3. **Navigation & SSE Real-Time:**
   - Thêm tab "Messages" / Icon tin nhắn vào `NavigationSidebar.tsx`.
   - Lắng nghe các event `dm.message.new`, `dm.message.deleted`, `dm.read_receipt.updated` trong EventSource handler của `PulseContext.tsx` để cập nhật UI tức thì không cần reload trang.

### 9.3. Nhiệm vụ Kiểm thử Tự động (`qa-tester` - Task `t_70d63956`)
- Viết test suite `backend/tests/dm-chat-invariants.test.mjs` kiểm tra 100%:
  1. Tạo conversation mới và lấy lại conversation cũ (Deduplication).
  2. Ngăn chặn Self-DM (HTTP 400).
  3. Ngăn chặn gửi tin khi có quan hệ Block 2 chiều (HTTP 403).
  4. Gửi tin nhắn và phân trang con trỏ (Cursor pagination).
  5. Xóa mềm tin nhắn và xác thực nội dung bị che giấu.
  6. Cơ chế Read receipt và tính toán chính xác số tin chưa đọc.

### 9.4. Nhiệm vụ Đánh giá An ninh (`security-auditor` - Task `t_fc92bcd4`)
- Kiểm thử IDOR giữa 2 người dùng khác nhau.
- Thử nghiệm payload Stored XSS trong trường content.
- Đánh giá tính toàn vẹn của dữ liệu trong điều kiện race condition.

---
*Tài liệu này đã được nghiệm thu và đóng băng kiến trúc. Các subagents tiếp nhận nhiệm vụ căn cứ chính xác vào tài liệu này để triển khai.*

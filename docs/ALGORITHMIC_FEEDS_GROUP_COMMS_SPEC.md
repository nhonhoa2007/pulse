# ALGORITHMIC FEEDS & GROUP REAL-TIME COMMUNICATIONS SPECIFICATION (TASK-20)
**Pulse Microblogging Engine — Phase C Architecture Specification**

**Version:** 1.0.0  
**Author:** Tech Lead & System Architect (`researcher`)  
**Target Environment:** Arch Linux, Node.js v26.8, PostgreSQL 18.6, Fastify, React 18 / Vite  
**Standards Grounded:**
- HackerNews / Reddit / Twitter Recommendation Gravity & EdgeRank heuristic formulations
- Distributed High-Throughput Impression Counter Buffering (Write-Behind Cache Pattern)
- Matrix / Slack / Telegram Multi-Party Chat State Machine & Membership Invariants
- IETF RFC 8030: Generic Event Delivery Using HTTP Push
- IETF RFC 8292: Voluntary Application Server Identification (VAPID) for Web Push
- IETF RFC 8188: Encrypted Content-Encoding for HTTP

---

## 1. EXECUTIVE SUMMARY & OBJECTIVES

TASK-20 (Phase C) expands the Pulse Microblogging platform from a purely chronological social network into a modern, high-engagement, real-time communication platform. This specification details the architecture, data models, protocol compliance, and security invariants for four core pillars:

1. **"For You" Algorithmic Recommendation Heuristic Feed:** An intelligent content discovery engine that surfaces high-quality relevant posts combining engagement velocity, social network affinity, time-decay gravity, and author diversity penalties while rigorously enforcing two-way block, mute, and keyword filtering invariants.
2. **Post Views / Impressions Counter Buffer:** A high-throughput write-behind in-memory buffering architecture that eliminates database row-lock contention and write-amplification caused by rapid viewport scrolling, periodically flushing aggregated impressions via atomic SQL increments.
3. **Group Direct Messaging (Group DMs):** Multi-party private messaging with conversation lifecycle management, role-based member permissions (ADMIN/MEMBER), block graph isolation, message persistence, cursor pagination, and real-time SSE broadcasting.
4. **Web Push Notifications (RFC 8030 / RFC 8292 VAPID):** Standards-compliant browser push notifications utilizing NIST P-256 elliptic curve cryptography, ES256-signed VAPID JWT tokens, client subscription lifecycle management, and automatic invalid endpoint pruning.

---

## 2. PILLAR 1: "FOR YOU" RECOMMENDATION SCORING HEURISTIC FEED

### 2.1. Candidate Generation (Sourcing)
The candidate generation pipeline retrieves posts within a sliding recency window (e.g., last 72 hours) across two streams:
1. **In-Network Stream (Second-Degree & Followed Content):** Posts authored by followed users and accounts followed by the user's followed accounts (friends of friends).
2. **Out-of-Network Stream (Platform Discovery):** Top-performing posts across the entire platform that achieve minimum engagement thresholds.

### 2.2. Hard Exclusion Filtering (Invariants)
Before scoring, candidate posts are subjected to deterministic exclusion filters:
- **Two-Way Block Invariant:** If `blockerId == user.id || blockedId == user.id` between the reader and the post author, the post is strictly dropped.
- **User Mute Invariant:** If `muterId == user.id && mutedId == post.authorId`, the post is strictly dropped.
- **Keyword Mute Invariant:** If post content matches active keyword mutes configured for `HOME_TIMELINE` or `ALL` contexts, the post is dropped.
- **Soft-Delete Invariant:** If `isDeleted == true`, the post is dropped.
- **Self-Filtering:** Posts authored by the requesting user are excluded from "For You" (or ranked lower to prioritize discovery).

### 2.3. Heuristic Scoring Formula
Each candidate post $P$ is scored using a multi-factor gravity formulation:

$$Score(P, U) = \left( \frac{W_{\text{engagement}}(P) \times A_{\text{affinity}}(P, U)}{(T_{\text{age\_hours}}(P) + 2)^\gamma} \right) \times D_{\text{author}}(P)$$

#### A. Engagement Velocity Weight ($W_{\text{engagement}}$)
$$W_{\text{engagement}}(P) = 1.0 \cdot L + 2.0 \cdot R + 1.5 \cdot C + 2.5 \cdot Q + 0.5 \cdot \log_{10}(1 + V)$$
Where:
- $L$ = `likesCount`
- $R$ = `repostsCount` (strong endorsement signal)
- $C$ = `repliesCount` (discussion catalyst signal)
- $Q$ = `quotesCount` (deep engagement signal)
- $V$ = `viewsCount` (normalized with $\log_{10}$ to prevent view-dominated feedback loops)

#### B. Social Affinity Multiplier ($A_{\text{affinity}}$)
- **Direct Follow:** If $U$ follows $Author(P) \implies A_{\text{affinity}} = 2.0$
- **Mutual Network:** If $U$ and $Author(P)$ have $\ge 1$ mutual followings $\implies A_{\text{affinity}} = 1.5$
- **Celebrity Post:** If $Author(P).isCelebrity == true \implies A_{\text{affinity}} = 1.2$
- **Stranger / Discovery:** Otherwise $\implies A_{\text{affinity}} = 1.0$

#### C. Time-Decay Gravity ($\gamma$)
- Standard gravity exponent $\gamma = 1.5$
- Prevents older viral posts from monopolizing the top of the feed, ensuring continuous fresh discovery.

#### D. Author Diversity Penalty ($D_{\text{author}}$)
To prevent a single prolific author from dominating the user's feed:
- 1st post from Author in result candidate batch: $D_{\text{author}} = 1.0$
- 2nd post from Author in result candidate batch: $D_{\text{author}} = 0.6$
- 3rd post from Author in result candidate batch: $D_{\text{author}} = 0.3$
- $\ge 4$th post from Author: Excluded from current feed page.

### 2.4. Feed Pagination
- Endpoint: `GET /api/v1/feed/for-you?limit=20&cursor={score}:{postId}`
- Sorting: `Score DESC`, tie-breaker `createdAt DESC`.

---

## 3. PILLAR 2: POST VIEWS & IMPRESSIONS COUNTER BUFFER

### 3.1. Architectural Problem
Directly issuing `UPDATE "Post" SET "viewsCount" = "viewsCount" + 1` on every viewport intersection generates destructive write-amplification ($O(N)$ row-level database locks, WAL contention, and connection starvation).

### 3.2. Write-Behind Counter Buffer Architecture
```
[ Client Viewport Beacon (POST /posts/views { postIds }) ]
                        │
                        ▼
[ In-Memory Impression Deduplication Filter (LRU Cache: 30-min window) ]
                        │
                        ▼
[ PostImpressionsBufferService (In-Memory Map: postId -> pendingCount) ]
                        │
                        │ (Periodic Timer: every 5s OR bufferSize >= 100)
                        ▼
[ Atomic SQL Batch Flush: UPDATE "Post" SET "viewsCount" = "viewsCount" + delta ]
```

### 3.3. Anti-Fraud & Deduplication
- A view is counted only once per `(userId || clientIp, postId)` within a 30-minute cooling window.
- Rapid client scrolling or malicious reload loops cannot inflate impressions.
- View count buffer is safely drained before server shutdown (`beforeExit` / `SIGTERM` hooks).
- Post view count is exposed on `PostDto` and `Post` model as `viewsCount: number`.

---

## 4. PILLAR 3: GROUP REAL-TIME COMMUNICATIONS (GROUP DMs)

### 4.1. Domain Model & Entities
To ensure 100% backward compatibility with existing 1-1 DMs (`dm_conversations`), Group DMs utilize a dedicated relational model:
1. `GroupConversation`: Represents the group entity (`id`, `title`, `avatarUrl`, `creatorId`, `createdAt`, `updatedAt`).
2. `GroupMember`: Represents group membership with role management (`id`, `conversationId`, `userId`, `role: ADMIN | MEMBER`, `joinedAt`).
3. `GroupMessage`: Represents messages sent within the group (`id`, `conversationId`, `senderId`, `content`, `messageType`, `mediaUrls`, `createdAt`, `deletedAt`).
4. `GroupReadReceipt`: Tracks read horizons for unread count calculation (`id`, `conversationId`, `userId`, `lastReadMessageId`, `readAt`).

### 4.2. Group DM Invariants & Security Boundaries
1. **Creation Invariant:** A group must have a valid title (1–100 characters) and at least 2 members (creator + at least 1 other participant, or creator + 2 participants).
2. **Social Graph Block Invariant:** A group cannot be created if any participant has an active two-way block with the creator. When adding members, neither the adder nor the target can have an active block between them.
3. **IDOR & Access Boundary:**
   - Only verified active members can read conversation details, messages, or member lists (HTTP 403 `FORBIDDEN` otherwise).
   - Only active members can send messages.
4. **Role Permissions:**
   - `ADMIN` (group creator or promoted admin): Can update group title/avatar, add new members, remove existing members.
   - `MEMBER`: Can send messages, view history, and voluntarily leave the group (`DELETE /dm/groups/:id/members/me` or `/members/:userId`).
5. **Real-time SSE Fan-out:** When a new group message is sent, an SSE event `dm.group.message.new` is pushed to all currently connected members.

---

## 5. PILLAR 4: WEB PUSH NOTIFICATIONS (RFC 8030 / RFC 8292 VAPID)

### 5.1. Cryptographic Standard Grounding
- **Key Pair:** Elliptic Curve NIST P-256 (`prime256v1` / `secp256r1`).
- **Algorithm:** `ES256` (ECDSA using P-256 curve and SHA-256 hash).
- **RFC 8292 VAPID Claims:**
  - `aud`: Push service origin extracted from endpoint (e.g. `https://fcm.googleapis.com` or `https://updates.push.services.mozilla.com`).
  - `exp`: Expiration timestamp (maximum 24 hours; recommended 12 hours).
  - `sub`: Identification URI, typically `mailto:admin@pulse.social` or URL.
- **VAPID Header:**
  `Authorization: vapid t=<JWT>, k=<VAPID_PUBLIC_KEY_BASE64URL>`
  `TTL: 86400`
  `Urgency: normal`

### 5.2. Subscription Lifecycle & Auto-Pruning
- Storage: `WebPushSubscription` table storing `userId`, `endpoint` (unique), `p256dh`, `auth`, `userAgent`.
- Auto-Pruning: When delivering a push notification to an endpoint, if the push service returns HTTP 404 (`Not Found`) or HTTP 410 (`Gone`), the endpoint is dead/unregistered and is immediately deleted from the database.

---

## 6. COMPARISON & TRADE-OFF ANALYSIS MATRIX

| Evaluation Dimension | Selected Architecture (TASK-20) | Alternative A (Redis / BullMQ / Third-party) | Alternative B (Synchronous In-DB) | Rationale |
| :--- | :--- | :--- | :--- | :--- |
| **For You Feed Strategy** | Heuristic Multi-factor gravity ranking in PostgreSQL + Node.js memory | Python/ML Vector Embeddings + FAISS / Pinecone | Pure SQL Order By (Likes + Reposts) | Instant low-latency scoring without external vector DB dependencies; fully testable in zero-config environment. |
| **View Count Buffering** | In-memory Write-behind map with periodic atomic batch flush | Redis HINCRBY + Celery cron sync | Direct UPDATE on each HTTP GET/Beacon | Prevents database write-lock amplification while maintaining zero external service dependencies. |
| **Group DM Schema** | Dedicated `GroupConversation` + `GroupMember` tables | Overloading `DmConversation` with nullable participant columns | NoSQL / Document Store (MongoDB) | 100% backward-compatible with existing 1-1 DMs; clean relational integrity and cascade deletes. |
| **Web Push Subsystem** | Native Node.js `crypto` NIST P-256 / ES256 VAPID (RFC 8292) | External proprietary SaaS (OneSignal / Pusher) | WebSocket-only notifications | Zero-vendor lock-in, standards-compliant across all modern browsers (Chrome, Firefox, Safari, Edge). |

---

## 7. DATABASE SCHEMA ENHANCEMENTS (PRISMA SPECIFICATION)

### 7.1. Post Model Extension
```prisma
model Post {
  // ... existing fields ...
  viewsCount Int @default(0)
}
```

### 7.2. Group DM Models
```prisma
enum GroupMemberRole {
  ADMIN
  MEMBER
}

model GroupConversation {
  id          String   @id @default(uuid())
  title       String
  avatarUrl   String?
  creatorId   String   @map("creator_id")
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  creator      User               @relation("GroupConversationCreator", fields: [creatorId], references: [id], onDelete: Cascade)
  members      GroupMember[]
  messages     GroupMessage[]
  readReceipts GroupReadReceipt[]

  @@index([updatedAt(sort: Desc)])
  @@map("group_conversations")
}

model GroupMember {
  id             String          @id @default(uuid())
  conversationId String          @map("conversation_id")
  userId         String          @map("user_id")
  role           GroupMemberRole @default(MEMBER)
  joinedAt       DateTime        @default(now()) @map("joined_at")

  conversation   GroupConversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  user           User              @relation("UserGroupMemberships", fields: [userId], references: [id], onDelete: Cascade)

  @@unique([conversationId, userId], name: "unique_group_conversation_user")
  @@index([userId])
  @@index([conversationId])
  @@map("group_members")
}

model GroupMessage {
  id             String    @id @default(uuid())
  conversationId String    @map("conversation_id")
  senderId       String    @map("sender_id")
  content        String    @db.Text
  messageType    String    @default("TEXT") @map("message_type")
  mediaUrls      String[]  @default([]) @map("media_urls")
  createdAt      DateTime  @default(now()) @map("created_at")
  updatedAt      DateTime  @updatedAt @map("updated_at")
  deletedAt      DateTime? @map("deleted_at")

  conversation   GroupConversation  @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  sender         User               @relation("GroupSentMessages", fields: [senderId], references: [id], onDelete: Cascade)
  readReceipts   GroupReadReceipt[] @relation("LastReadGroupMessage")

  @@index([conversationId, createdAt(sort: Desc)])
  @@index([senderId])
  @@map("group_messages")
}

model GroupReadReceipt {
  id                String    @id @default(uuid())
  conversationId    String    @map("conversation_id")
  userId            String    @map("user_id")
  lastReadMessageId String?   @map("last_read_message_id")
  readAt            DateTime  @default(now()) @map("read_at")
  updatedAt         DateTime  @updatedAt @map("updated_at")

  conversation      GroupConversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  user              User              @relation("UserGroupReadReceipts", fields: [userId], references: [id], onDelete: Cascade)
  lastReadMessage   GroupMessage?     @relation("LastReadGroupMessage", fields: [lastReadMessageId], references: [id], onDelete: SetNull)

  @@unique([conversationId, userId], name: "unique_group_conversation_user_receipt")
  @@index([userId])
  @@index([conversationId])
  @@map("group_read_receipts")
}
```

### 7.3. Web Push Subscription Model
```prisma
model WebPushSubscription {
  id        String   @id @default(uuid())
  userId    String   @map("user_id")
  endpoint  String   @unique
  p256dh    String   @db.Text
  auth      String   @db.Text
  userAgent String?  @map("user_agent")
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  user      User     @relation("UserWebPushSubscriptions", fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@map("web_push_subscriptions")
}
```

---

## 8. API CONTRACTS & PROTOCOLS

### 8.1. For You Feed
- `GET /api/v1/feed/for-you` (and `GET /feed/for-you`)
  - Query: `{ limit?: number, cursor?: string }`
  - Response: `ApiResponse<FeedResponse>`

### 8.2. Post Views & Impressions
- `POST /api/v1/posts/views` (and `POST /posts/views`)
  - Body: `{ postIds: string[] }`
  - Response: `ApiResponse<{ recorded: number, buffered: number }>`
- `POST /api/v1/posts/:id/view` (and `POST /posts/:id/view`)
  - Response: `ApiResponse<{ success: true, viewsCount: number }>`

### 8.3. Group DMs
- `POST /api/v1/dm/groups`: Create group `{ title: string, memberIds: string[] }`
- `GET /api/v1/dm/groups`: List user's groups `{ groups: GroupConversationDto[], nextCursor?: string }`
- `GET /api/v1/dm/groups/:id`: Get group details & members `{ group: GroupConversationDto }`
- `PATCH /api/v1/dm/groups/:id`: Update group `{ title?: string, avatarUrl?: string }`
- `POST /api/v1/dm/groups/:id/members`: Add member `{ userId: string }`
- `DELETE /api/v1/dm/groups/:id/members/:userId`: Remove member / leave group
- `POST /api/v1/dm/groups/:id/messages`: Send message `{ content: string, mediaUrls?: string[] }`
- `GET /api/v1/dm/groups/:id/messages`: Message history `{ messages: GroupMessageDto[], nextCursor?: string }`
- `DELETE /api/v1/dm/groups/:id/messages/:messageId`: Soft-delete message
- `PUT /api/v1/dm/groups/:id/read`: Mark read `{ messageId?: string }`

### 8.4. Web Push Notifications
- `GET /api/v1/push/vapid-public-key`: Returns `{ publicKey: string }`
- `POST /api/v1/push/subscriptions`: Save subscription `{ endpoint: string, keys: { p256dh: string, auth: string } }`
- `DELETE /api/v1/push/subscriptions`: Unsubscribe `{ endpoint: string }`
- `POST /api/v1/push/test`: Trigger test notification to user's registered endpoints

---

## 9. ORCHESTRATION & DECOMPOSITION PLAN

| Subtask ID | Assignee | Scope & Deliverables |
| :--- | :--- | :--- |
| **`t_task20_be`** | `be-coder` | **Backend Implementation:** For-You heuristic service, Post views buffer with atomic flush, Group DM services & controllers, Web Push VAPID generator & subscription endpoints. |
| **`t_task20_fe`** | `fe-coder` | **Frontend UI Implementation:** "Dành cho bạn" (For You) feed tab, Viewport impression tracker beacon, Group DM list / chat UI / member management modal, Web Push notification subscription prompt & SW handler. |
| **`t_task20_sec`**| `security-auditor` | **Security Audit & Penetration Testing:** For-You privacy leak verification (block/mute/keyword), View count fraud & DoS testing, Group DM IDOR & privilege escalation testing, Web Push SSRF & replay mitigation. |
| **`t_task20_qa`** | `qa-tester` | **Automated Integration Test Suite:** Comprehensive test suites covering all 4 pillars with 100% pass verification across backend (`node --test`) and frontend visual states. |

---
**Approved by:** Tech Lead & System Architect (`researcher`)  
**Date:** September 17, 2026

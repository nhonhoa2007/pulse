# ⚡ Pulse - The Real-Time Microblogging Engine

A production-grade, distributed microblogging system inspired by **Meta Threads** and **Twitter/X**, engineered from scratch to solve real-world architectural bottlenecks: **Hybrid Fan-out Feed**, **High-Concurrency Atomic Invariants**, **Two-Way Social Graph Isolation**, and **ActivityStream Aggregation with Real-Time SSE**.

---

## 🏗️ Technical Architecture & Core Invariants

### 1. Hybrid Fan-Out Timeline Engine (The Million-Dollar Feed Problem)
- **Fan-Out on Write (Push):** When a regular user (`isCelebrity: false`) publishes a post, the asynchronous worker pushes the `postId` into followers' pre-computed `TimelineInbox`. Fetching their feed takes $O(1)$ query time.
- **Fan-Out on Read (Pull):** When a celebrity/KOL (`isCelebrity: true`, e.g. Sơn Tùng M-TP with millions of followers) publishes, the system skips inbox pushes to avoid **Write Amplification Storms**. Follower feeds pull celebrity posts on-demand and perform **K-Way Merge** sorted by timestamp in memory.

### 2. High-Concurrency & Atomic Invariants
- Likes and Reposts are protected against race conditions using composite keys (`UNIQUE(userId, postId)`) and PostgreSQL atomic increments:
  ```sql
  UPDATE "Post" SET "likesCount" = "likesCount" + 1 WHERE "id" = $id;
  UPDATE "Post" SET "likesCount" = GREATEST(0, "likesCount" - 1) WHERE "id" = $id;
  ```
- Guaranteed zero counter drift even when 50+ concurrent requests hit simultaneously.

### 3. Two-Way Social Graph & Block Invariants
- When User A blocks User B, an atomic transaction executes:
  1. Purges two-way follow relationships (`A follows B` AND `B follows A`).
  2. Purges two-way timeline inboxes (`A`'s inbox cleared of `B`'s posts, and vice-versa).
  3. Records block entry in `Block`.
  4. Enforces two-way privacy: neither party can view profiles, feeds, or mention each other (returns 404 / filtered).

### 4. Flattened Conversation Threading
- Multi-tier replies (A → B → C) store `replyToId` and root conversation reference `rootPostId`.
- Fetches the entire conversation hierarchy in **1 single SQL query** without recursive CTEs or N+1 bottlenecks.

### 5. Smart Notification Aggregation & Real-Time SSE
- Implements **ActivityStreams 2.0** with 24-hour sliding aggregation window: *"Alice, Bob và 3 người khác đã thích bài viết của bạn"*.
- Pushes live updates over native **Server-Sent Events (SSE)** (`GET /api/v1/realtime/stream`).

---

## 🛠️ Tech Stack

- **Backend:** Fastify 4.x + TypeScript + Prisma ORM + PostgreSQL 18.6
- **Frontend:** React 18 + Vite + TailwindCSS (Dark aesthetic `#0a0a0a`) + Lucide Icons
- **Real-Time:** Server-Sent Events (SSE) HTTP/2 compatible
- **Testing:** Native `node:test` + `node:assert/strict` (Zero-config, < 700ms execution)

---

## 🚀 Getting Started

### 1. Database Setup & Seeding
```bash
cd backend
# Database is pre-configured on localhost:5432 with pulse_social
npm run db:push
npm run db:seed
```

### 2. Run Tests
```bash
cd backend
npm test
```

### 3. Start Backend & Frontend
* Terminal 1 (Backend - Port 3001):
  ```bash
  cd backend
  npm run dev
  ```
* Terminal 2 (Frontend - Port 5173):
  ```bash
  cd frontend
  npm run dev
  ```
Open your browser at `http://localhost:5173`.
Use the **Demo User Switcher** in the left sidebar to switch perspectives between Hoà Phùng, Alice, Bob, and Sơn Tùng M-TP to test live following, blocking, and feed fan-out!

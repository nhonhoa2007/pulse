# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Pulse is a high-concurrency, distributed microblogging engine inspired by Meta Threads and Twitter/X. The codebase is organized as a monorepo consisting of:
- **`backend/`**: Fastify 4.x REST API + Server-Sent Events, Prisma ORM, PostgreSQL 18.6, TypeScript.
- **`frontend/`**: React 18, Vite, TailwindCSS (Threads aesthetic), Lucide Icons.

Directory boundaries:
- Backend code: `backend/src/`, `backend/prisma/`
- Frontend code: `frontend/src/`, `frontend/public/`
- Automated tests: `backend/tests/`, `frontend/tests/`

---

## Commonly Used Commands

### Root Workspace Commands
```bash
npm run dev:backend    # Start Fastify backend on http://localhost:3001
npm run dev:frontend   # Start Vite frontend on http://localhost:5173
npm run build          # Build both backend (tsc) and frontend (tsc && vite build)
npm test               # Run backend tests
npm run db:seed        # Seed sample database data (Hoa, Alice, Bob, Son Tung M-TP)
```

### Backend Commands (`cd backend`)
```bash
npm run dev            # Start development server with tsx watch
npm run build          # Compile TypeScript to dist/ (tsc)
npm run db:push        # Synchronize Prisma schema with PostgreSQL
npm run db:generate    # Generate Prisma client types
npm run db:seed        # Seed sample data (node prisma/seed.mjs)
npm test               # Run all backend tests sequentially (--test-concurrency=1)
```

**Running Backend Tests:**
- Backend tests are written with native `node:test` and `node:assert/strict`.
- **CRITICAL:** Tests import from `../dist/` (compiled JavaScript). Always run `npm run build` in `backend/` before running tests when TypeScript files change.
- Run a single backend test:
  ```bash
  cd backend
  npm run build
  node --test tests/<test-filename>.test.mjs
  ```
  Example: `node --test tests/feed-hybrid-fanout.test.mjs`

### Frontend Commands (`cd frontend`)
```bash
npm run dev            # Start Vite dev server on http://localhost:5173
npm run build          # Type check and build bundle (tsc && vite build)
npm run preview        # Preview production build
npm test               # Run all frontend tests (node --experimental-strip-types --test tests/*.test.mjs)
```

**Running a Single Frontend Test:**
```bash
cd frontend
node --experimental-strip-types --test tests/<test-filename>.test.mjs
```
Example: `node --experimental-strip-types --test tests/poll-component.test.mjs`

---

## Database & Environment

- **PostgreSQL**: Runs on `localhost:5432` with database `pulse_social`.
  - Default URL: `postgresql://postgres@localhost:5432/pulse_social?schema=public`
- **Network Ports**:
  - Backend: `http://localhost:3001`
  - Frontend: `http://localhost:5173` (Vite proxies `/api`, `/uploads`, `/.well-known`, `/actor`, `/nodeinfo`, and `/inbox` to port 3001).

---

## High-Level Architecture & Core Invariants

### 1. Hybrid Fan-Out Timeline Engine
- **Fan-Out on Write (Push):** When a regular user (`isCelebrity: false`) posts, `FanOutTimelineWorker` bulk-inserts the `postId` into followers' pre-computed `TimelineInbox`.
- **Fan-Out on Read (Pull):** When a celebrity (`isCelebrity: true`) posts, inbox push is skipped to prevent write amplification. On home feed fetch (`HybridFeedTimelineService`), celebrity posts are fetched on-demand and merged with the user's `TimelineInbox` via in-memory **K-Way Merge** sorted by timestamp.

### 2. High-Concurrency & Atomic Invariants
- Interactions (likes, reposts, bookmarks) use composite keys (`@@id([userId, postId])`).
- Counters are updated atomically within `prisma.$transaction` using SQL increments/decrements:
  ```sql
  UPDATE "Post" SET "likesCount" = "likesCount" + 1 WHERE "id" = $id;
  UPDATE "Post" SET "likesCount" = GREATEST(0, "likesCount" - 1) WHERE "id" = $id;
  ```
- Prevents counter drift under concurrent loads (guaranteed $\ge 0$).

### 3. Two-Way Social Graph & Block Invariants
- Blocking (`BlockUserService`) executes within an atomic transaction:
  1. Purges two-way follow relationships (`A follows B` and `B follows A`).
  2. Purges two-way timeline inboxes (`A`'s inbox cleared of `B`'s posts, and vice-versa).
  3. Records block entry in `Block`.
- Enforces two-way privacy across feeds, profiles, thread views, mentions, and search: blocked relations return `404 Not Found` or are filtered out.

### 4. Flattened Conversation Threading
- Nested replies store `replyToId` (direct parent) and `rootPostId` (root of the thread).
- Entire conversation hierarchy is fetched in **1 single SQL query** (`WHERE "rootPostId" = $id OR "id" = $id ORDER BY "createdAt" ASC`) without recursive CTEs or N+1 queries.

### 5. Smart Notification Aggregation & Real-Time SSE
- Implements ActivityStreams 2.0 with a 24-hour sliding aggregation window (e.g., *"Alice, Bob and 3 others liked your post"*).
- Server-Sent Events (SSE) stream at `GET /api/v1/realtime/stream` pushes live events (`NEW_TIMELINE_POST`, `NEW_NOTIFICATION`, `dm.group.message.new`).

### 6. ActivityPub & Fediverse Federation Engine
- **Standards:** W3C ActivityPub, RFC 7033 WebFinger (`/.well-known/webfinger`), NodeInfo 2.1 (`/nodeinfo/2.1`), draft-cavage-12 HTTP Signatures.
- **SSRF Guard:** `SsrfProtectionGuardService` blocks private IP ranges, loopback, link-local, AWS/cloud metadata (169.254.169.254), and DNS rebinding on all outbound federation requests.
- **Delivery Worker:** `ActivityDeliveryWorkerService` handles async background delivery to remote actor inboxes with exponential backoff and shared inbox batching.

### 7. Trust, Safety & Post Lifecycle
- **15-Minute Edit Window:** Posts can be edited within 900,000 ms of creation. Every edit snapshots previous state into `PostVersion` for audit trails.
- **Post Pinning:** Author can pin one post to profile (`User.pinnedPostId`), appearing first in user post listings.
- **Muting:** 1-way user muting (preserves follow relationships while filtering feeds/notifications) and keyword muting (`CONTAINS` vs `EXACT_WORD`, optional expiration).
- **Content Warnings:** `isSensitive` and `contentWarning` fields trigger `ContentWarningShield` blur protection on client.

### 8. Algorithmic "For You" Feed & View Counters
- **Heuristic Gravity Algorithm:** `ForYouRecommendationFeedService` ranks candidate posts using gravity decay, engagement weighting, and author diversity penalties.
- **Write-Behind Views Buffer:** `PostImpressionsBufferService` batches post view increments in memory with 30-minute deduplication, periodically flushing atomic increments to PostgreSQL.
- **Group DMs & Web Push:** Multi-user group conversations with roles (ADMIN/MEMBER) and VAPID RFC 8030/8292 Web Push notifications.

### 9. Auth Hardening & Private Accounts
- **Dual-Token Auth:** Short-lived access token (15m) + 7-day HttpOnly `SameSite=Strict` refresh token cookie with automatic token rotation.
- **Token Denylist:** Immediate revocation on logout via `TokenRevocationManager` with database persistence and in-memory TTL cache.
- **Private Accounts FSM:** When `isPrivate: true`, follow requests create a `FollowRequest` in `PENDING` state. Profiles lock posts and follow graphs until approved.

---

## API & Coding Standards

### Response Contract
All endpoints return standard envelopes:
```typescript
// Success
{ "success": true, "data": ... }

// Error
{ "success": false, "error": { "code": "ERROR_CODE", "message": "Human readable message" } }
```

### Authentication Context in Requests
- Production: `Authorization: Bearer <JWT_ACCESS_TOKEN>`
- Development & Testing: `x-user-id: <USER_UUID>` header can be used to simulate user identity without full auth handshake when `Authorization` is absent.

### Naming Conventions
- Backend files follow intent-driven functional naming:
  - Controllers: `<Feature>Controller.ts` (e.g. `PostController.ts`, `SocialGraphController.ts`)
  - Services: `<Action><Domain>Service.ts` (e.g. `PublishPostService.ts`, `BlockUserService.ts`, `HybridFeedTimelineService.ts`)
- Multi-table mutations must be wrapped in `prisma.$transaction`.

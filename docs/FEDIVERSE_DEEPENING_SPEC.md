# KIẾN TRÚC HỆ THỐNG FEDIVERSE DEEPENING (TASK-19)
## Đặc tả Kỹ thuật NodeInfo 2.1 (FEP-0151), Federated Remote Discovery & Outbound Like/Announce

**Tác giả:** Tech Lead, System Architect & Deep Researcher  
**Dự án:** Pulse Microblogging Engine  
**Phiên bản:** 2.0.0  
**Trạng thái:** Nghiệm thu Kiến trúc & Chuyển giao Triển khai (`Approved for Implementation`)  
**Căn cứ tiêu chuẩn:** FEP-0151, NodeInfo 2.1 Schema, RFC 7033 (WebFinger), W3C ActivityPub, W3C ActivityStreams 2.0, draft-cavage-http-signatures-12

---

## 1. TỔNG QUAN HỆ THỐNG & CĂN CỨ TIÊU CHUẨN (EXECUTIVE SUMMARY)

Giai đoạn Phase B: **Fediverse Deepening** nâng cấp hệ sinh thái liên hợp Pulse từ chế độ cơ bản (MVP Actor/WebFinger/Follow/Note) lên cấp độ sâu sắc của một mạng xã hội phân tán chuyên nghiệp, tương thích hoàn toàn với Mastodon v4.x, Meta Threads, GoToSocial, Akkoma và các Fediverse indexers toàn cầu (fediverse.observer, the-federation.info). 

Hệ thống giải quyết triệt để 3 bài toán kiến trúc cốt lõi:
1. **NodeInfo 2.1 & FEP-0151 Discovery:** Khai báo siêu dữ liệu node máy chủ phân tán có cấu trúc theo chuẩn `http://nodeinfo.diaspora.software/ns/schema/2.1#` và khuyến nghị FEP-0151 (2025 edition) tại `/.well-known/nodeinfo` và `/nodeinfo/2.1`.
2. **Federated Remote Discovery (@user@domain):** Cho phép người dùng trực tiếp tìm kiếm, phân giải và khám phá hồ sơ người dùng từ bất kỳ máy chủ bên ngoài nào (`@user@mastodon.social`, `@user@threads.net`) ngay trên thanh tìm kiếm và giao diện Explore, tự động tạo shadow actor cục bộ và cho phép tương tác follow 2 chiều an toàn được bảo vệ bởi SSRF Guard.
3. **Outbound ActivityPub Like & Announce Federation:** Khi người dùng cục bộ bấm Thích (Like) hoặc Đăng lại/Chia sẻ (Announce/Repost) một bài viết liên hợp (hoặc khi có follower từ xa), hệ thống sẽ ký mật mã HTTP Signature (draft-cavage-12) và chuyển phát bất đồng bộ qua hàng đợi `ActivityDeliveryWorker` tới inbox của tác giả và sharedInbox của các follower từ xa, đi kèm cơ chế `Undo` toàn vẹn.

```
+----------------------------------------------------------------------------------------------------+
|                                    FEDIVERSE NETWORK (GLOBAL)                                      |
|          Mastodon Instances | Meta Threads | GoToSocial | FediDB / Fediverse Indexers              |
+----------------------------------------------------------------------------------------------------+
       ▲                                 ▲                                        ▲
       │ 1. NodeInfo Crawl               │ 2. WebFinger & Actor Fetch             │ 3. Outbound Like/Announce
       │    GET /.well-known/nodeinfo    │    GET /.well-known/webfinger?resource │    POST /inbox (Signed)
       │    GET /nodeinfo/2.1            │    GET /users/:id (JSON-LD)            │
       ▼                                 ▼                                        ▼
+----------------------------------------------------------------------------------------------------+
|                                      PULSE FEDERATION ENGINE                                       |
|                                                                                                    |
|  [ Discovery & Metadata Subsystem ]                                                                |
|   ├── GET /.well-known/nodeinfo        -> NodeInfoDiscoveryController (FEP-0151 JRD links)         |
|   ├── GET /nodeinfo/2.1                -> NodeInfoController (Schema 2.1 Profile & Stats)          |
|   ├── GET /nodeinfo/2.0                -> NodeInfoController (Backward Compatibility 2.0)          |
|   └── POST /api/v1/federation/resolve  -> RemoteActorResolverService (WebFinger -> Actor -> Cache) |
|                                                                                                    |
|  [ Unified Search Integration ]                                                                    |
|   └── GET /api/v1/search?q=@user@domain -> Detects remote handle, resolves actor, returns in UI   |
|                                                                                                    |
|  [ Social Interop & Outbound Federation ]                                                          |
|   ├── POST /posts/:id/like             -> ToggleLikeService -> Enqueue 'Like' or 'Undo(Like)'      |
|   ├── POST /posts/:id/repost           -> RepostService     -> Enqueue 'Announce' or 'Undo'        |
|   └── POST /inbox (Shared & Personal)  -> ProcessInboundActivityService: Inbound Like & Announce   |
|                                                                                                    |
|  [ Security & Defense Boundary ]                                                                   |
|   ├── SsrfProtectionGuardService       -> Enforces private IP, loopback, AWS metadata block        |
|   ├── HttpSignatureSignerService       -> Signs outbound requests with RSA-SHA256 & Digest         |
|   └── SanitizeFederatedHtml            -> Innermost-first recursive XSS neutralization             |
+----------------------------------------------------------------------------------------------------+
```

### 1.1. Căn cứ Tiêu chuẩn Quốc tế (Grounded Citations)
1. **FEP-0151: NodeInfo in Fediverse Software (2025 edition):** Đặc tả chuẩn hóa của Fediverse Enhancement Proposals về việc xuất bản NodeInfo 2.1, các thuộc tính bắt buộc và trường metadata khuyến nghị (`nodeName`, `nodeDescription`, `staffAccounts`, `federation`).  
   *Nguồn dẫn:* `https://codeberg.org/fediverse/fep/src/branch/main/fep/0151/fep-0151.md`
2. **NodeInfo Protocol 2.1 Schema Specification:** Định nghĩa JSON Schema chuẩn cho NodeInfo 2.1 (`http://nodeinfo.diaspora.software/ns/schema/2.1#`).  
   *Nguồn dẫn:* `https://github.com/jhass/nodeinfo/blob/main/PROTOCOL.md` & `schemas/2.1/schema.json`
3. **IETF RFC 7033 (WebFinger) & W3C SWICG apwf-20240608:** Phân giải định danh người dùng phi tập trung từ chuỗi `@user@domain` hoặc `acct:user@domain` sang HTTPS Actor URI.  
   *Nguồn dẫn:* `https://datatracker.ietf.org/doc/html/rfc7033`
4. **W3C ActivityStreams 2.0 Vocabulary (Activities & Objects):**
   - Section 5.1: `Like` Activity (`https://www.w3.org/TR/activitystreams-vocabulary/#dfn-like`)
   - Section 5.2: `Announce` Activity (`https://www.w3.org/TR/activitystreams-vocabulary/#dfn-announce`)
   - Section 5.7: `Undo` Activity (`https://www.w3.org/TR/activitystreams-vocabulary/#dfn-undo`)
5. **W3C ActivityPub Recommendation (Section 7: Server to Server Delivery):** Chuyển phát tin nhắn phân tán giữa các máy chủ liên hợp qua HTTP Signatures và SharedInbox deduplication.  
   *Nguồn dẫn:* `https://www.w3.org/TR/activitypub/`
6. **IETF draft-cavage-http-signatures-12:** Chuẩn mật mã ký HTTP Headers sử dụng RSA 2048-bit PKCS#1 v1.5 với thuật toán `rsa-sha256`, `(request-target)`, `host`, `date`, `digest`.

---

## 2. PHÂN TÍCH SO SÁNH ĐA CHIỀU (MULTI-DIMENSIONAL TRADE-OFF ANALYSIS)

| Tiêu chí Đánh giá | Phương án A: Tích hợp Đầy đủ Chuẩn W3C / FEP (ĐƯỢC CHỌN) | Phương án B: Giả lập Thủ công (Ad-hoc Endpoints) | Phương án C: Dùng Thư viện Ngoài Nặng (Fedify/ActivityPub-Express) |
| :--- | :--- | :--- | :--- |
| **1. Performance & Latency** | **Tối ưu vượt trội:** Tận dụng sẵn Fastify engine + in-process worker queue. NodeInfo có cache header 24h, Like/Announce chạy nền <15ms response. | Nhanh nhưng dễ vỡ khi tải cao, không có rate limit hoặc deduplication inbox chuẩn. | Tốn nhiều overhead RAM/CPU cho các abstraction layer và JSON-LD expansion không cần thiết. |
| **2. Developer Experience (DX)** | **Xuất sắc:** TypeScript contracts chặt chẽ, code định hướng mục đích (intent-driven), tương thích 100% với 283 tests hiện có. | Kém: Thiếu schema type safety, dễ sai khác cấu trúc JSON NodeInfo dẫn tới crawler từ chối. | Phức tạp: Buộc phải viết lại mô hình Prisma sang adapter riêng của thư viện, phá vỡ cấu trúc cơ sở dữ liệu. |
| **3. Community & Viability** | **Tuyệt đối:** Tuân thủ FEP-0151 và W3C ActivityStreams, tương thích 100% với Mastodon, Threads, Lemmy, FediDB. | Thấp: Không được Fediverse indexers công nhận, bị Mastodon coi là instance lỗi hoặc spam. | Cao trong cộng đồng của thư viện nhưng bị vendor lock-in vào chu kỳ phát hành của bên thứ ba. |
| **4. Migration & Risk Factor** | **0 rủi ro:** Kế thừa toàn bộ `FederatedActor`, `FederatedFollow`, `ActivityDeliveryJob` sẵn có. 0 thay đổi phá vỡ cơ sở dữ liệu. | Rủi ro trung bình về bảo mật do thiếu kiểm toán SSRF và chữ ký HTTP chuẩn. | Rủi ro rất cao: Phá vỡ toàn bộ kiến trúc ứng dụng Pulse hiện tại, phải migrate dữ liệu lớn. |

---

## 3. THIẾT KẾ KIẾN TRÚC CHI TIẾT (THE THREE CORE PILLARS)

### PILLAR 1: GIAO THỨC NODEINFO 2.1 & FEP-0151 DISCOVERY

#### 1.1. Discovery Endpoint: `GET /.well-known/nodeinfo`
Theo tiêu chuẩn NodeInfo 2.1 và FEP-0151, endpoint khám phá trả về tài liệu JRD liên kết tới các phiên bản schema được hỗ trợ:
- **Headers:**
  - `Content-Type: application/json; charset=utf-8` (hoặc `application/jrd+json; charset=utf-8`)
  - `Access-Control-Allow-Origin: *`
  - `Cache-Control: public, max-age=86400`
- **Payload Phản hồi:**
```json
{
  "links": [
    {
      "rel": "http://nodeinfo.diaspora.software/ns/schema/2.1",
      "href": "https://pulse.social/nodeinfo/2.1"
    },
    {
      "rel": "http://nodeinfo.diaspora.software/ns/schema/2.0",
      "href": "https://pulse.social/nodeinfo/2.0"
    }
  ]
}
```

#### 1.2. Protocol Document Endpoint: `GET /nodeinfo/2.1`
- **Headers:**
  - `Content-Type: application/json; profile="http://nodeinfo.diaspora.software/ns/schema/2.1#"; charset=utf-8`
  - `Access-Control-Allow-Origin: *`
  - `Cache-Control: public, max-age=1800` (cache 30 phút để giảm tải truy vấn thống kê)
- **Cấu trúc JSON Schema 2.1:**
```json
{
  "version": "2.1",
  "software": {
    "name": "pulse",
    "version": "1.0.0",
    "repository": "https://github.com/nhonhoa/pulse",
    "homepage": "https://pulse.social"
  },
  "protocols": [
    "activitypub"
  ],
  "services": {
    "inbound": [],
    "outbound": []
  },
  "openRegistrations": true,
  "usage": {
    "users": {
      "total": 1420,
      "activeHalfyear": 890,
      "activeMonth": 412
    },
    "localPosts": 5230,
    "localComments": 1840
  },
  "metadata": {
    "nodeName": "Pulse Social",
    "nodeDescription": "A decentralized high-concurrency microblogging engine federating with Fediverse.",
    "staffAccounts": [
      "https://pulse.social/users/admin"
    ],
    "federation": {
      "enabled": true
    },
    "theme": "light",
    "features": [
      "polls",
      "reply_privacy",
      "version_history",
      "content_warnings",
      "muting",
      "pinning",
      "bookmarks"
    ]
  }
}
```

#### 1.3. Quy tắc Thống kê Usage (Aggregation Invariants)
- `users.total`: Đếm số lượng người dùng nội bộ (`isRemote: false`). Không tính shadow users tạo từ Fediverse bên ngoài.
- `users.activeMonth`: Số lượng người dùng nội bộ có hoạt động (tạo bài viết, thích, bình luận) trong vòng 30 ngày qua (`updatedAt >= now() - 30 days`).
- `users.activeHalfyear`: Tương tự trong 180 ngày qua.
- `localPosts`: Đếm số lượng bài viết gốc của máy chủ (`replyToId: null`, `author.isRemote: false`, `isDeleted: false`).
- `localComments`: Đếm số lượng bài viết phản hồi/bình luận (`replyToId != null`, `author.isRemote: false`, `isDeleted: false`).
- *Cơ chế tối ưu hiệu năng:* Bộ nhớ đệm TTL 5 phút (In-memory Cache) tránh việc các web crawler quét liên tục kích hoạt `COUNT(*)` quét toàn bảng trên PostgreSQL.

---

### PILLAR 2: FEDERATED REMOTE ACTOR DISCOVERY TỪ GIAO DIỆN UI (`@user@domain`)

#### 2.1. Nhận diện Định danh & Định tuyến Truy vấn
Hệ thống hỗ trợ 2 hình thức nhập liệu từ người dùng trên giao diện:
1. **Fediverse Handle:** `@username@domain.com` hoặc `username@domain.com`
2. **Actor URI / URL:** `https://mastodon.social/users/alice` hoặc `https://threads.net/@alice`

Khi người dùng nhập chuỗi truy vấn vào thanh tìm kiếm hoặc ô khám phá:
- Regex nhận diện handle: `/^@?([a-zA-Z0-9._-]+)@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})(?::\d+)?$/`
- Regex nhận diện URI: `/^https?:\/\/([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})(?::\d+)?\/.*$/i`

#### 2.2. Luồng Phân giải Từ xa (Remote Resolution Workflow)

```
[ User nhập @alice@mastodon.social ]
                 │
                 ▼
[ Kiểm tra miền (Domain Check) ]
       │── Trùng domain hiện tại ──► Tìm kiếm User nội bộ trong DB
       └── Khác domain hiện tại  ──► Tiến hành Remote Federated Discovery
                 │
                 ▼
[ Bước 1: Cache Lookup trong PostgreSQL ]
       │── Đã có FederatedActor (domain, username) ──► Trả về Shadow User ngay lập tức (0ms network)
       └── Chưa có hoặc đã hết hạn (> 24h)
                 │
                 ▼
[ Bước 2: SSRF Guard Defense ]
       │── Kiểm tra Domain có trỏ về 127.0.0.1, 10.x, 192.168.x, 169.254.x (AWS)?
       │── Nếu vi phạm ──► Chặn lập tức với mã lỗi HTTP 400 SSRF_GUARD_BLOCKED
       └── An toàn
                 │
                 ▼
[ Bước 3: WebFinger Fetch (RFC 7033) ]
       │── GET https://{domain}/.well-known/webfinger?resource=acct:{user}@{domain}
       │   (Headers: Accept: application/jrd+json, application/json, Timeout: 5000ms, Size <= 1MB)
       │── Phân tích mảng "links": Tìm link rel="self" và type="application/activity+json"
       └── Trích xuất actorUri = link.href
                 │
                 ▼
[ Bước 4: Remote Actor JSON-LD Retrieval ]
       │── Kiểm tra SSRF trên host của actorUri
       │── GET actorUri (Accept: application/activity+json, application/ld+json; profile="https://www.w3.org/ns/activitystreams")
       │   (Kèm chữ ký HTTP Instance Actor nếu cần cho secure_mode)
       │── Kiểm tra tính hợp lệ của Actor:
       │   * id === actorUri
       │   * type thuộc ['Person', 'Application', 'Service', 'Group', 'Organization']
       │   * Trích xuất preferredUsername, name, summary, avatarUrl (icon.url), inbox, sharedInbox, publicKey
       └── Lọc sạch XSS trong summary và name bằng bộ lọc đệ quy chuyên sâu
                 │
                 ▼
[ Bước 5: Đồng bộ Cơ sở Dữ liệu & Shadow User ]
       │── Bắt đầu Prisma $transaction:
       │   1. Upsert bảng `FederatedActor`: uri, username, domain, name, summary, avatarUrl, inboxUrl, sharedInboxUrl, publicKeyPem, publicKeyId.
       │   2. Upsert bảng `User` (Shadow User): username = `${cleanUser}_${cleanDomain}_${randomSuffix}`, isRemote = true, federatedActorId = actor.id.
       └── Commit transaction và trả về kết quả cho Frontend UI
```

#### 2.3. Endpoint API Chuyên biệt
`POST /api/v1/federation/resolve`
- **Request Body:**
```json
{
  "handle": "@alice@mastodon.social"
}
```
- **Phản hồi Thành công (HTTP 200 OK):**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "c1f7b0f2-491c-4b36-a19f-0d94f291e0a2",
      "username": "alice_mastodon_social_7a8b",
      "displayName": "Alice Wonderland",
      "avatarUrl": "https://mastodon.social/avatars/alice.jpg",
      "bio": "Decentralized web enthusiast",
      "isCelebrity": false,
      "followersCount": 420,
      "followingCount": 115,
      "postsCount": 89,
      "isRemote": true,
      "domain": "mastodon.social",
      "actorUri": "https://mastodon.social/users/alice",
      "isFollowing": false,
      "createdAt": "2026-09-17T10:00:00.000Z"
    },
    "actor": {
      "uri": "https://mastodon.social/users/alice",
      "username": "alice",
      "domain": "mastodon.social",
      "inboxUrl": "https://mastodon.social/users/alice/inbox",
      "sharedInboxUrl": "https://mastodon.social/inbox"
    }
  }
}
```

---

### PILLAR 3: OUTBOUND ACTIVITYPUB LIKE & ANNOUNCE FEDERATION

#### 3.1. Outbound Like Federation
Khi người dùng cục bộ (ví dụ: `bob`) bấm Like một bài viết trên Pulse:
1. **Kiểm tra Đối tượng Bài viết:**
   - Nếu bài viết là bài liên hợp từ xa (`post.isRemote === true` hoặc `post.author.isRemote === true`):
     - Xác định URI đích: `post.federatedUri` (ví dụ: `https://mastodon.social/users/alice/statuses/1098234`).
     - Xác định Actor của tác giả từ xa để lấy `inboxUrl`.
   - Nếu `liked === true`:
     - Khởi tạo đối tượng `Like` Activity:
       ```json
       {
         "@context": "https://www.w3.org/ns/activitystreams",
         "id": "https://pulse.social/activities/like/bob-post123-1789615000",
         "type": "Like",
         "actor": "https://pulse.social/users/bob",
         "object": "https://mastodon.social/users/alice/statuses/1098234",
         "to": [
           "https://mastodon.social/users/alice",
           "https://www.w3.org/ns/activitystreams#Public"
         ],
         "cc": [
           "https://pulse.social/users/bob/followers"
         ]
       }
       ```
     - Đưa công việc vào hàng đợi chuyển phát: `activityDeliveryWorkerService.queueDelivery(...)` tới inbox của tác giả từ xa.
   - Nếu `liked === false` (Unlike):
     - Khởi tạo đối tượng `Undo` Activity gói lại `Like` Activity:
       ```json
       {
         "@context": "https://www.w3.org/ns/activitystreams",
         "id": "https://pulse.social/activities/undo-like/bob-post123-1789615000",
         "type": "Undo",
         "actor": "https://pulse.social/users/bob",
         "object": {
           "id": "https://pulse.social/activities/like/bob-post123",
           "type": "Like",
           "actor": "https://pulse.social/users/bob",
           "object": "https://mastodon.social/users/alice/statuses/1098234"
         },
         "to": [
           "https://mastodon.social/users/alice"
         ]
       }
       ```
     - Đưa vào hàng đợi chuyển phát `activityDeliveryWorkerService`.

#### 3.2. Outbound Announce (Repost/Boost) Federation
Khi người dùng cục bộ bấm Đăng lại (Repost):
1. **Xác định Danh sách Inbox Nhận Tin:**
   - **Tác giả bài viết gốc:** Nếu bài viết gốc là bài từ xa (`post.isRemote === true`), gửi về inbox của tác giả để thông báo bài viết đã được boost.
   - **Người theo dõi của Reposter:** Gửi tới tất cả các remote followers của người vừa bấm repost (lấy từ `FederatedFollow` có `localUserId === reposter.id`, `direction === 'INBOUND'`, `status === 'ACCEPTED'`).
   - Sử dụng `sharedInboxUrl` để gom nhóm (deduplication) nếu nhiều follower cùng thuộc 1 instance (ví dụ cùng ở `mastodon.social`).
2. **Khởi tạo Announce Activity:**
   ```json
   {
     "@context": "https://www.w3.org/ns/activitystreams",
     "id": "https://pulse.social/activities/announce/bob-post123-1789615000",
     "type": "Announce",
     "actor": "https://pulse.social/users/bob",
     "published": "2026-09-17T10:30:00.000Z",
     "object": "https://mastodon.social/users/alice/statuses/1098234",
     "to": [
       "https://www.w3.org/ns/activitystreams#Public"
     ],
     "cc": [
       "https://mastodon.social/users/alice",
       "https://pulse.social/users/bob/followers"
     ]
   }
   ```
3. **Khi Hủy Repost (Unrepost):**
   - Tạo Activity `Undo` chứa `Announce` Activity bên trong và gửi tới toàn bộ các inboxes đã gửi trước đó.

#### 3.3. Inbound Like & Announce Activity (Hai chiều Symmetrical)
Để hoàn thiện tính năng tương tác hai chiều, `ProcessInboundActivityService` mở rộng xử lý khi nhận Activity từ Fediverse gửi tới:
- **Nhận `Like`:**
  - Xác thực chữ ký HTTP Signature của request.
  - Tìm bài viết nội bộ theo `activity.object`.
  - Đảm bảo shadow user cho remote actor.
  - Tạo bản ghi `Like` và tăng `likesCount` nguyên tử (nếu chưa like).
  - Ghi nhận thông báo cho tác giả bài viết nội bộ: `verb: 'LIKE'`.
- **Nhận `Announce`:**
  - Xác thực chữ ký HTTP Signature.
  - Tìm bài viết nội bộ theo `activity.object`.
  - Đảm bảo shadow user cho remote actor.
  - Tạo bản ghi `Repost` và tăng `repostsCount` nguyên tử (nếu chưa repost).
  - Ghi nhận thông báo cho tác giả: `verb: 'REPOST'`.
- **Nhận `Undo(Like)` / `Undo(Announce)`:**
  - Xóa bản ghi `Like` hoặc `Repost` tương ứng và giảm bộ đếm `likesCount` / `repostsCount` an toàn với hàm `GREATEST(0, count - 1)`.

---

## 4. AN NINH HỆ THỐNG & CÁC RÀNG BUỘC BẤT BIẾN (SECURITY INVARIANTS)

1. **Bất biến SSRF & DNS Rebinding:**
   - Tuyệt đối không cho phép bất kỳ yêu cầu WebFinger hoặc Actor Fetch nào kết nối tới dải địa chỉ IP nội bộ:
     - IPv4 Loopback (`127.0.0.0/8`), Private LAN (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), Link-local (`169.254.0.0/16`), CGNAT (`100.64.0.0/10`).
     - IPv6 Loopback (`::1`), IPv4-mapped loopback (`::ffff:127.0.0.1`), ULA (`fc00::/7`), Link-local (`fe80::/10`).
     - AWS / GCP Cloud Metadata Endpoints (`169.254.169.254`, `metadata.google.internal`).
   - Mọi kết nối phải được bọc trong hàm `ssrfProtectionGuardService.isSafeUrl()` và `safeFederatedFetch()`.
2. **Bất biến Chống XSS (HTML Sanitization):**
   - Hồ sơ từ xa (Display Name, Bio/Summary) có thể chứa mã khai thác HTML/JS độc hại từ máy chủ Fediverse bị xâm phạm.
   - Hàm `sanitizeFederatedHtml()` phải được áp dụng đệ quy, loại bỏ toàn bộ thẻ `<script>`, `<iframe>`, `<object>`, `<embed>`, các thuộc tính sự kiện `onload`, `onerror`, `onclick`, và các đường link chứa giao thức `javascript:`.
3. **Bất biến Khóa Bí mật & Ký Mật mã HTTP Signatures:**
   - Private key của máy chủ (`FederationKey`) không bao giờ được xuất ra log, API responses hoặc trả về client.
   - Khi ký outbound Like/Announce, sử dụng thuật toán `rsa-sha256` với khóa riêng RSA 2048-bit của user (hoặc Instance Actor).
   - Inbound request bắt buộc kiểm tra Header `Digest` tính toán từ SHA-256 của body và dung sai thời gian `Date` không quá ±300 giây.

---

## 5. KẾ HOẠCH PHÂN RÃ NHIỆM VỤ & PHÂN CÔNG SUBAGENTS (DECOMPOSITION & ROADMAP)

Hệ thống được chia thành 4 gói công việc chuyên trách, phân công độc lập cho dàn subagent:

### Gói 1: Backend Implementation (`be-coder`)
* **Nhiệm vụ:**
  1. Xây dựng Controller & Service cho NodeInfo: `NodeInfoController.ts`, `FetchNodeInfoService.ts` phục vụ `/.well-known/nodeinfo`, `/nodeinfo/2.1` và `/nodeinfo/2.0`.
  2. Xây dựng dịch vụ khám phá người dùng liên hợp từ xa: `ResolveRemoteActorService.ts` (xử lý WebFinger RFC 7033, kiểm tra SSRF, fetch JSON-LD actor, transaction tạo shadow user) và gắn vào endpoint `POST /api/v1/federation/resolve`.
  3. Cập nhật `SearchService.ts`: Tự động nhận diện chuỗi `@user@domain` và kích hoạt phân giải nếu chưa có trong DB.
  4. Mở rộng `ToggleLikeService.ts` và `RepostService.ts`: Tự động phát sinh và enqueue ActivityPub `Like`, `Announce`, `Undo` khi tương tác với bài viết federated.
  5. Mở rộng `ProcessInboundActivityService.ts`: Xử lý thêm các activity gửi đến gồm `Like`, `Announce`, và `Undo`.
  6. Đăng ký các route mới trong `backend/src/app.ts`.

### Gói 2: Frontend UI Implementation (`fe-coder`)
* **Nhiệm vụ:**
  1. Cập nhật `ExploreView.tsx` & Search Box: Thêm chế độ hiển thị thẻ Fediverse Remote Discovery khi người dùng nhập chuỗi `@user@domain`.
  2. Tạo component `FederatedUserCard.tsx`: Hiển thị avatar, tên hiển thị, handle Fediverse (@user@domain), huy hiệu Fediverse biểu tượng mạng phân tán, số lượng follower/post, và nút Theo dõi (Follow/Following).
  3. Cập nhật `PulseApiClient.ts`: Thêm phương thức `resolveFederatedActor(handle: string)` gọi tới endpoint `POST /api/v1/federation/resolve`.
  4. Tích hợp xử lý Follow từ xa với phản hồi trạng thái Optimistic UI.

### Gói 3: Security Audit & Penetration Testing (`security-auditor`)
* **Nhiệm vụ:**
  1. Kiểm tra an ninh SSRF: Thử nghiệm phân giải `@admin@127.0.0.1`, `@user@169.254.169.254`, `@user@192.168.1.1` và DNS rebinding payloads để đảm bảo chặn 100%.
  2. Kiểm tra Stored XSS trong hồ sơ remote actor: Thử chèn `<script>alert(1)</script>`, `<img src=x onerror=steal()>` vào Display Name và Bio của remote actor.
  3. Kiểm tra chữ ký HTTP Signatures và replay attacks trên các endpoint Inbound Like & Announce.
  4. Đảm bảo giới hạn tải (Resource Exhaustion defense): Kích thước phản hồi remote download bị chặn ở mức 1MB và timeout sau 5000ms.

### Gói 4: Automated Testing & E2E Test Suite (`qa-tester`)
* **Nhiệm vụ:**
  1. Xây dựng bộ test suite `backend/tests/fediverse-deepening-nodeinfo.test.mjs` kiểm tra 100% tuân thủ NodeInfo 2.1 schema (FEP-0151), kiểu MIME, headers cache, và tính toán số liệu usage.
  2. Xây dựng bộ test suite `backend/tests/fediverse-remote-discovery.test.mjs` giả lập mock WebFinger & Actor server, xác thực tạo shadow user và chống hồi quy.
  3. Xây dựng bộ test suite `backend/tests/fediverse-like-announce-federation.test.mjs` kiểm tra việc phát sinh và chuyển phát ActivityPub Like/Announce và Undo.
  4. Xây dựng test suite frontend `frontend/tests/fediverse-remote-discovery-visual-states.test.mjs` xác nhận hiển thị thẻ Fediverse, nút Follow và trạng thái tìm kiếm.
  5. Đảm bảo 100% test suites pass với `node --test`.

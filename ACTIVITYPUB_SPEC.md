# KIẾN TRÚC HỆ THỐNG ACTIVITYPUB (W3C FEDIVERSE FEDERATION ENGINE)
## Đặc tả Kỹ thuật Tương thích Chuẩn Mastodon và Meta Threads

**Tác giả:** Tech Lead & System Architect  
**Trạng thái:** Nghiệm thu & Chuyển giao Triển khai (`Approved for Implementation`)  
**Mục tiêu hệ thống:** Đảm bảo hệ thống Pulse liên hợp hoàn toàn (federate) với mạng lưới Fediverse toàn cầu, tương thích hai chiều với cả Mastodon (các phiên bản v4.x) và Meta Threads.

---

## 1. TỔNG QUAN & CĂN CỨ TIÊU CHUẨN (EXECUTIVE SUMMARY)

Hệ thống liên hợp ActivityPub cho Pulse được thiết kế dựa trên các tiêu chuẩn quốc tế và đặc tả kỹ thuật chính thống:
* **W3C ActivityPub Recommendation (2018):** Giao thức mạng xã hội phân tán chuẩn hóa luồng Inbox, Outbox, Actor và phân phối bản tin.[1]
* **W3C ActivityStreams 2.0 Core & Vocabulary:** Định dạng dữ liệu JSON-LD cho các thực thể Actor (`Person`, `Application`), Object (`Note`) và Activity (`Create`, `Follow`, `Accept`, `Undo`, `Like`, `Announce`, `Delete`).[2]
* **IETF RFC 7033 (WebFinger) & W3C SWICG Report (2024):** Cơ chế khám phá định danh người dùng từ tay cầm Fediverse (`@username@domain` hoặc `acct:username@domain`) về HTTPS Actor URI.[3][6]
* **IETF draft-cavage-http-signatures-12 & Mastodon Security Spec:** Cơ chế xác thực phi tập trung giữa các máy chủ Fediverse thông qua chữ ký mật mã khóa công khai RSA-SHA256 trên HTTP headers.[4][5]

```
+-----------------------------------------------------------------------------------------+
|                                    FEDIVERSE NETWORK                                    |
|   (Mastodon Instances: mastodon.social, hachyderm.io | Meta Threads: threads.net)       |
+-----------------------------------------------------------------------------------------+
                    |                                        ^
       WebFinger    | GET /.well-known/webfinger             | Inbound POST /inbox (Signed)
       Discovery    | GET /users/:username (JSON-LD)         |
                    v                                        |
+-----------------------------------------------------------------------------------------+
|                                   PULSE ENGINE                                          |
|                                                                                         |
|  [ Fastify Federation Router ]                                                          |
|   ├── GET  /.well-known/webfinger            -> WebFingerDiscoveryController            |
|   ├── GET  /actor                            -> InstanceActorController (Application)   |
|   ├── GET  /users/:username                  -> UserActorController (Person)            |
|   ├── POST /inbox                            -> SharedInboxController (Batch Activities)|
|   ├── POST /users/:username/inbox            -> PersonalInboxController                 |
|   └── GET  /users/:username/outbox           -> OutboxCollectionController              |
|                                                                                         |
|  [ Security & Cryptography Subsystem ]                                                  |
|   ├── HttpSignatureVerifier (draft-cavage-12, rsa-sha256, Digest, Clock Skew <= 300s)   |
|   ├── HttpSignatureSigner (RSA 2048-bit PKCS#1 v1.5, KeyId, Digest generation)           |
|   ├── SsrfProtectionGuard (Block RFC 1918, RFC 5735, RFC 3927, Loopback, DNS Rebinding)|
|   └── KeyManagementService (RSA Keypair provision for Users & Instance Actor)           |
|                                                                                         |
|  [ Asynchronous Federation Dispatcher & DB ]                                            |
|   ├── ActivityDeliveryWorker (Background queue, exponential backoff, sharedInbox batch) |
|   └── PostgreSQL Models: FederationKey, FederatedActor, FederatedFollow, DeliveryJob    |
+-----------------------------------------------------------------------------------------+
```

---

## 2. WEBFINGER DISCOVERY SPECIFICATION (`/.well-known/webfinger`)

### 2.1. Chuẩn giao thức & Chuẩn hóa Tài nguyên
Theo RFC 7033 và tài liệu W3C SWICG apwf-20240608,[3][6] endpoint WebFinger phục vụ truy vấn:
`GET /.well-known/webfinger?resource={resource}`

Quy tắc phân giải `resource`:
1. Hỗ trợ 3 định dạng đầu vào:
   * `acct:username@domain` (hoặc `acct:username@pulse.social`)
   * `acct:username` (mặc định lấy domain hiện tại của server)
   * URL định danh: `https://pulse.social/users/username` hoặc `https://pulse.social/@username`
2. Bóc tách `username` và kiểm tra `domain`:
   * Nếu có domain trong `resource`, domain phải trùng khớp chính xác với `SERVER_DOMAIN` (hoặc biến môi trường `PULSE_DOMAIN`). Nếu domain khác, trả về `404 Not Found`.
   * Tự động loại bỏ ký tự `@` nếu người dùng nhập `@alice@pulse.social`.
3. Kiểm tra sự tồn tại của `User` trong cơ sở dữ liệu:
   * Nếu không tìm thấy: Trả về HTTP `404 Not Found` với body JSON chuẩn.
   * Nếu thiếu tham số `resource`: Trả về HTTP `400 Bad Request`.

### 2.2. Headers & Response Schema
* **Headers:**
  * `Content-Type: application/jrd+json; charset=utf-8` (Bắt buộc theo RFC 7033 Section 4.2).[3]
  * `Access-Control-Allow-Origin: *` (Bắt buộc để các web client Fediverse và trình duyệt fetch mà không bị CORS block).
  * `Cache-Control: max-age=3600, public` (Cho phép cache phản hồi trong 1 giờ).
* **Payload Mẫu (`application/jrd+json`):**
```json
{
  "subject": "acct:alice@pulse.social",
  "aliases": [
    "https://pulse.social/@alice",
    "https://pulse.social/users/alice"
  ],
  "links": [
    {
      "rel": "http://webfinger.net/rel/profile-page",
      "type": "text/html",
      "href": "https://pulse.social/@alice"
    },
    {
      "rel": "self",
      "type": "application/activity+json",
      "href": "https://pulse.social/users/alice"
    }
  ]
}
```

---

## 3. BIỂU DIỄN HỒ SƠ ACTOR (JSON-LD SPECIFICATION)

### 3.1. Kiến trúc Dual Actor (Instance Actor & User Actor)
Để tương thích hoàn toàn với Meta Threads và Mastodon (ở chế độ `authorized_fetch` / `secure_mode`), hệ thống phải có 2 loại Actor:[5]
1. **User Actor (`Person`):** Đại diện cho người dùng cá nhân tại `https://${DOMAIN}/users/${username}`.
2. **Instance Actor (`Application`):** Đại diện cho toàn bộ máy chủ Pulse tại `https://${DOMAIN}/actor`.
   * *Ý nghĩa kiến trúc:* Khi máy chủ đối tác (ví dụ Threads hoặc Mastodon secure-mode) nhận một Activity từ Pulse, nó phải fetch public key của Pulse để xác thực. Nhưng nếu Pulse cũng yêu cầu chữ ký để fetch profile, hai bên sẽ rơi vào vòng lặp vô tận (infinite fetch loop). Instance Actor giải quyết triệt để vấn đề này vì endpoint `/actor` luôn mở public không cần chữ ký HTTP.[5]

### 3.2. Content Negotiation
Endpoint `GET /users/:username` phải thực hiện phân luồng nội dung dựa trên header `Accept`:
* Nếu `Accept` chứa `application/activity+json` hoặc `application/ld+json; profile="https://www.w3.org/ns/activitystreams"`: Trả về JSON-LD Actor Object với `Content-Type: application/activity+json; charset=utf-8`.[1]
* Ngược lại: Trả về REST User Profile DTO (cho API nội bộ) hoặc redirect tới trang HTML giao diện.

### 3.3. Cấu trúc JSON-LD User Actor Chuẩn
```json
{
  "@context": [
    "https://www.w3.org/ns/activitystreams",
    "https://w3id.org/security/v1"
  ],
  "id": "https://pulse.social/users/alice",
  "type": "Person",
  "preferredUsername": "alice",
  "name": "Alice Wonderland",
  "summary": "<p>Software Engineer exploring the Fediverse</p>",
  "url": "https://pulse.social/@alice",
  "inbox": "https://pulse.social/users/alice/inbox",
  "outbox": "https://pulse.social/users/alice/outbox",
  "sharedInbox": "https://pulse.social/inbox",
  "endpoints": {
    "sharedInbox": "https://pulse.social/inbox"
  },
  "followers": "https://pulse.social/users/alice/followers",
  "following": "https://pulse.social/users/alice/following",
  "icon": {
    "type": "Image",
    "mediaType": "image/jpeg",
    "url": "https://pulse.social/uploads/avatars/alice.jpg"
  },
  "publicKey": {
    "id": "https://pulse.social/users/alice#main-key",
    "owner": "https://pulse.social/users/alice",
    "publicKeyPem": "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAz...\n-----END PUBLIC KEY-----\n"
  },
  "manuallyApprovesFollowers": false,
  "discoverable": true
}
```

### 3.4. Cấu trúc JSON-LD Instance Actor Chuẩn (`GET /actor`)
```json
{
  "@context": [
    "https://www.w3.org/ns/activitystreams",
    "https://w3id.org/security/v1"
  ],
  "id": "https://pulse.social/actor",
  "type": "Application",
  "preferredUsername": "pulse.social",
  "name": "Pulse Social Fediverse Bridge",
  "summary": "Instance actor for pulse.social",
  "inbox": "https://pulse.social/inbox",
  "outbox": "https://pulse.social/actor/outbox",
  "publicKey": {
    "id": "https://pulse.social/actor#main-key",
    "owner": "https://pulse.social/actor",
    "publicKeyPem": "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAv...\n-----END PUBLIC KEY-----\n"
  }
}
```

---

## 4. XÁC THỰC MẬT MÃ (DRAFT-CAVAGE HTTP SIGNATURES SPECIFICATION)

### 4.1. Thuật toán & Tạo Khóa (Key Generation)
* **Thuật toán:** `rsa-sha256` (RSASSA-PKCS1-v1_5 với hàm băm SHA-256). Đây là chuẩn bắt buộc và tương thích rộng rãi nhất trên toàn mạng lưới Fediverse (Mastodon, Threads, GoToSocial, Lemmy, Pixelfed).[4][5]
* **Độ dài khóa:** RSA 2048-bit (tối thiểu).
* **Định dạng:** PEM-encoded SPKI (`PUBLIC KEY`) và PKCS#8 (`PRIVATE KEY`).
* Khóa được sinh tự động khi khởi tạo máy chủ (cho `Instance Actor`) hoặc khi người dùng được tạo (cho `User Actor`), lưu trong bảng `federation_keys`.

### 4.2. Quy trình Xác minh Chữ ký Đến (Inbound Signature Verification)
Tất cả các request `POST` gửi tới `/inbox` và `/users/:username/inbox` bắt buộc phải được ký hợp lệ:

1. **Bóc tách Header `Signature`:**
   * Header có cấu trúc: `Signature: keyId="<URI>",algorithm="rsa-sha256",headers="<headers-list>",signature="<base64>"`.[4]
   * Trích xuất các trường: `keyId`, `headers` (mặc định nếu vắng mặt: `date`), `signature`.
   * Kiểm tra thuật toán: Phải là `rsa-sha256` hoặc tương đương (`hs2019`).
2. **Kiểm tra Độ lệch Thời gian (Clock Skew & Replay Attack Prevention):**
   * Đọc header `Date` (hoặc `(created)` nếu là RFC 9421).
   * Kiểm tra: $| \text{Timestamp hiện tại} - \text{Timestamp request} | \le 300\text{ giây}$ (5 phút). Nếu lệch quá 5 phút, từ chối ngay với HTTP `401 Unauthorized`.
3. **Xác thực Header `Digest`:**
   * Bắt buộc với tất cả các request `POST` có body.
   * Format header: `Digest: SHA-256=<base64-hash>`.
   * Server tính toán: `calculatedDigest = crypto.createHash('sha256').update(rawBodyBuffer).digest('base64')`.
   * So sánh bằng hàm an toàn thời gian: `crypto.timingSafeEqual(Buffer.from(receivedHash), Buffer.from(calculatedDigest))`.
4. **Giải mã & Tìm nạp Khóa công khai (`keyId` Resolution):**
   * Kiểm tra cache trong bảng `federated_actors`. Nếu public key của `keyId` đã được lưu và còn hạn (< 24h), sử dụng ngay.
   * Nếu chưa có trong cache:
     * Chạy qua bộ lọc **SSRF Guard** để kiểm tra tính hợp lệ của domain/IP.
     * Thực hiện HTTP `GET` tới URL `keyId` (kèm header `Accept: application/activity+json`).
     * Khi thực hiện fetch, request được ký bằng khóa riêng của `Instance Actor` của Pulse (đảm bảo vượt qua secure mode của đối tác).[5]
     * Trích xuất `publicKeyPem` và lưu vào cache `federated_actors`.
5. **Dựng Signing String & Kiểm tra Chữ ký:**
   * Với mỗi header trong danh sách `headers`:
     * Nếu header là `(request-target)`: `(request-target): ${method.toLowerCase()} ${path}`.
     * Các header khác: `${headerName.toLowerCase()}: ${req.headers[headerName.toLowerCase()]}`.
   * Nối các dòng bằng ký tự xuống dòng `\n`.
   * Xác thực chữ ký bằng Node.js crypto:
     ```typescript
     const verifier = crypto.createVerify('RSA-SHA256');
     verifier.update(signingString);
     const isValid = verifier.verify(publicKeyPem, signature, 'base64');
     ```
   * Nếu chữ ký không khớp: Trả về HTTP `401 Unauthorized`.

### 4.3. Quy trình Ký Chữ ký Đi (Outbound Request Signing)
Khi Pulse gửi bất kỳ Activity nào tới server đối tác (ví dụ Inbox của `mastodon.social` hoặc `threads.net`):

1. Chuẩn bị payload JSON-LD dạng chuỗi `rawPayload`.
2. Tính toán `Digest` header:
   `Digest: SHA-256=${crypto.createHash('sha256').update(rawPayload).digest('base64')}`
3. Lấy thời gian UTC: `Date: ${new Date().toUTCString()}`
4. Dựng signing string:
   ```
   (request-target): post ${targetInboxPath}
   host: ${targetHost}
   date: ${dateString}
   digest: ${digestString}
   ```
5. Ký bằng private key của Actor:
   ```typescript
   const signer = crypto.createSign('RSA-SHA256');
   signer.update(signingString);
   const signatureBase64 = signer.sign(privateKeyPem, 'base64');
   ```
6. Gắn header `Signature`:
   `Signature: keyId="${actorUri}#main-key",algorithm="rsa-sha256",headers="(request-target) host date digest",signature="${signatureBase64}"`

---

## 5. LUỒNG DỮ LIỆU INBOX/OUTBOX & STATE MACHINE

```
+-------------------------------------------------------------------------------------------------+
|                                   ACTIVITYPUB STATE MACHINE                                      |
+-------------------------------------------------------------------------------------------------+

                      [ Inbound Activity ]  -->  [ Signature & SSRF Guard ]
                                                      |
                   +----------------------------------+----------------------------------+
                   |                                  |                                  |
            [ Type = 'Follow' ]              [ Type = 'Create' ]                [ Type = 'Undo' ]
                   |                                  |                                  |
     - Check target user exists        - Check object is Note              - Match original Follow
     - Upsert FederatedActor           - Check follow relation or mention  - Remove FederatedFollow
     - Create FederatedFollow          - Insert into Post (isRemote=true)  - Decr followersCount
       (status: ACCEPTED)              - Fan-out to TimelineInbox          - Clean local inboxes
     - Enqueue async 'Accept' activity - Create Notification (if reply)
     - Incr followersCount
```

### 5.1. Xử lý các Inbound Activities Chuẩn (`POST /inbox` & `POST /users/:username/inbox`)

1. **`Follow` Activity:**
   * Nhận từ máy chủ đối tác khi người dùng Fediverse muốn theo dõi tài khoản Pulse.
   * Kiểm tra local target user.
   * Tạo bản ghi `FederatedActor` (nếu chưa có).
   * Tạo bản ghi `FederatedFollow` với `direction = 'INBOUND'`, `status = 'ACCEPTED'`.
   * Tăng `followersCount` của local user.
   * Tự động tạo một `Accept` Activity và đẩy vào hàng đợi `activity_delivery_jobs` để gửi phản hồi xác nhận về inbox của remote actor.[1]
   * Tạo bản ghi `Notification` (`verb = 'FOLLOW'`) cho local user.
2. **`Undo` Activity (hủy `Follow`):**
   * Nhận khi người dùng remote hủy theo dõi tài khoản Pulse.
   * Xóa bản ghi `FederatedFollow` tương ứng.
   * Giảm `followersCount` của local user (không để âm).
3. **`Create` Activity (với Object là `Note`):**
   * Nhận khi một tài khoản remote mà người dùng Pulse đang theo dõi đăng bài mới, hoặc khi có bài viết trả lời (reply) bài viết của Pulse.
   * Kiểm tra tính hợp lệ của `Note`: ID, content, published date, author URI.
   * Lưu vào bảng `Post` với cờ `isRemote = true`, `federatedUri = note.id`.
   * Gắn kết nối tác giả: Tạo một shadow `User` đại diện cho remote actor và liên kết qua `federatedActorId`.
   * Phân phối vào bảng tin (`TimelineInbox`) của tất cả người dùng Pulse đang theo dõi remote actor đó.
   * Nếu bài viết là Reply (`inReplyTo`) hoặc Quote (`_misskey_quote`): Cập nhật cây hội thoại `rootPostId` và sinh `Notification` tương ứng.
4. **`Accept` Activity:**
   * Nhận khi tài khoản remote chấp thuận yêu cầu follow của người dùng Pulse.
   * Cập nhật `FederatedFollow` (`direction = 'OUTBOUND'`) từ `PENDING` sang `ACCEPTED`.
   * Tăng `followingCount` cho người dùng Pulse.
5. **`Delete` Activity:**
   * Remote actor xóa bài viết.
   * Tìm bài viết trong DB theo `federatedUri` và đánh dấu `isDeleted = true`.
6. **`Like` / `Announce` (Repost) Activity:**
   * Remote actor tương tác với bài viết của Pulse.
   * Tăng `likesCount` hoặc `repostsCount` cho bài viết gốc; tạo `Notification` cho tác giả bài viết.

### 5.2. Luồng Phát tán Outbox & Delivery Queue (`Outbox Flow`)

1. **Khi người dùng Pulse tạo bài viết mới (`POST /api/v1/posts`):**
   * Bài viết được tạo trong DB như bình thường.
   * Hệ thống tìm tất cả các tài khoản Fediverse đang theo dõi tác giả này:
     `SELECT DISTINCT fa."sharedInboxUrl", fa."inboxUrl" FROM "federated_follows" ff JOIN "federated_actors" fa ON ff."remoteActorId" = fa.id WHERE ff."localUserId" = $authorId AND ff.direction = 'INBOUND' AND ff.status = 'ACCEPTED'`.
   * **Tối ưu hóa Shared Inbox (Mastodon & Threads Standard):**
     * Gom nhóm theo `sharedInboxUrl` của từng máy chủ đích. Thay vì gửi $N$ request cho $N$ người theo dõi trên cùng một server `mastodon.social`, hệ thống chỉ gửi **đúng 1 request duy nhất** tới `sharedInboxUrl`.[1][5]
   * Đóng gói payload ActivityStreams 2.0 `Create` wrapping `Note`.
   * Chèn các bản ghi vào bảng `activity_delivery_jobs` với `status = 'PENDING'`.
2. **Background Delivery Worker (`ActivityDeliveryWorker`):**
   * Định kỳ quét các job `PENDING` có `nextRunAt <= NOW()`.
   * Kiểm tra SSRF đối với `targetInboxUrl`.
   * Ký HTTP request bằng khóa riêng của tác giả.
   * Thực hiện `POST` payload với timeout 5 giây.
   * Nếu thành công (HTTP 200/201/202): Cập nhật `status = 'COMPLETED'`.
   * Nếu thất bại:
     * Tăng `attempts = attempts + 1`.
     * Tính toán exponential backoff: $nextDelay = 2^{attempts} \times 5\text{ giây}$.
     * Nếu `attempts >= maxAttempts` (5 lần): Đánh dấu `status = 'FAILED'`.

---

## 6. QUY TẮC BẢO MẬT & BẤT BIẾN (SECURITY INVARIANTS)

Bảo vệ hệ thống khỏi các lỗ hổng đặc thù của mạng phân tán Fediverse:

### 6.1. SSRF Mitigation Guard (`SsrfProtectionFilter`)
Hệ thống Fediverse liên tục thực hiện outbound HTTP requests dựa trên các URL do bên ngoài cung cấp (WebFinger queries, Actor profile fetches, Inbox delivery).
* **Bất biến:** Pulse tuyệt đối không bao giờ gửi HTTP request tới các dải IP nội bộ hoặc mạng riêng:
  * IPv4 Loopback: `127.0.0.0/8`
  * IPv4 Private Networks (RFC 1918): `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`
  * IPv4 Link-Local (RFC 3927): `169.254.0.0/16`
  * Special/Broadcast (RFC 5735, RFC 6598): `0.0.0.0/8`, `100.64.0.0/10`
  * IPv6 Loopback / Local: `::1`, `fe80::/10`, `fc00::/7`
* **Chống DNS Rebinding:**
  * Giải mã DNS của hostname trước khi kết nối (`dns.promises.lookup`).
  * Kiểm tra toàn bộ danh sách địa chỉ IP trả về. Nếu có bất kỳ IP nào nằm trong dải cấm, lập tức hủy request.
  * Ghim kết nối socket tới đúng IP đã kiểm tra (pinning IP) để ngăn chặn tấn công TOCTOU (Time-of-Check to Time-of-Use).
* **Giao thức:** Bắt buộc sử dụng `https:` trong môi trường production. Chỉ chấp nhận `http:` khi có cờ môi trường kiểm thử `ALLOW_HTTP_FEDERATION=true`.

### 6.2. Chống Replay Attack & Tampering trên HTTP Signature
* Ngưỡng dung sai thời gian: Bắt buộc kiểm tra header `Date` trong khoảng $\pm 300\text{ giây}$ (5 phút).[5]
* Xác thực Digest toàn vẹn: Header `Digest: SHA-256=...` phải khớp chính xác với kết quả băm SHA-256 của toàn bộ raw byte request body.
* Lưu vết Signature ID / Nonce: Cache chữ ký đã thấy trong 5 phút để loại trừ các request gửi lại (replay).

### 6.3. Giới hạn Tài nguyên & Phòng chống DoS (Resource Exhaustion)
* Giới hạn kích thước payload: Tối đa `256 KB` cho các request ActivityPub inbound.
* Timeout kết nối: Giới hạn tối đa 5000ms cho mọi thao tác fetch remote actor hoặc chuyển phát inbox.
* Khống chế số lượng kết nối đồng thời trong Background Delivery Worker.

---

## 7. MÔ HÌNH DỮ LIỆU ĐÃ ĐỒNG BỘ (PRISMA DATA MODELS)

Hệ thống đã cập nhật và đồng bộ 100% vào cơ sở dữ liệu PostgreSQL `pulse_social`:

```prisma
// 1. Quản lý Khóa Mật mã
model FederationKey {
  id            String   @id @default(uuid())
  userId        String?  @unique
  keyId         String   @unique
  publicKeyPem  String   @db.Text
  privateKeyPem String   @db.Text
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  user          User?    @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([keyId])
  @@map("federation_keys")
}

// 2. Cache Thông tin Remote Actor Fediverse
model FederatedActor {
  id             String   @id @default(uuid())
  uri            String   @unique
  username       String
  domain         String
  name           String?
  summary        String?  @db.Text
  avatarUrl      String?
  inboxUrl       String
  sharedInboxUrl String?
  publicKeyPem   String   @db.Text
  publicKeyId    String
  lastFetchedAt  DateTime @default(now())
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  shadowUser     User?    @relation("ShadowUserFederatedActor")
  follows        FederatedFollow[]

  @@index([domain, username])
  @@index([uri])
  @@map("federated_actors")
}

// 3. Quản lý Trạng thái Follow Liên hợp
enum FederatedFollowDirection {
  INBOUND   // Remote follow Local
  OUTBOUND  // Local follow Remote
}

enum FederatedFollowStatus {
  PENDING
  ACCEPTED
  REJECTED
}

model FederatedFollow {
  id            String                   @id @default(uuid())
  localUserId   String
  remoteActorId String
  direction     FederatedFollowDirection
  status        FederatedFollowStatus    @default(ACCEPTED)
  activityUri   String?
  createdAt     DateTime                 @default(now())
  updatedAt     DateTime                 @updatedAt

  localUser     User                     @relation(fields: [localUserId], references: [id], onDelete: Cascade)
  remoteActor   FederatedActor           @relation(fields: [remoteActorId], references: [id], onDelete: Cascade)

  @@unique([localUserId, remoteActorId, direction])
  @@index([remoteActorId])
  @@index([localUserId, direction, status])
  @@map("federated_follows")
}

// 4. Hàng đợi Giao vận Outbox Bất đồng bộ
enum DeliveryJobStatus {
  PENDING
  PROCESSING
  COMPLETED
  FAILED
}

model ActivityDeliveryJob {
  id             String            @id @default(uuid())
  activityId     String
  activityType   String
  actorUri       String
  targetInboxUrl String
  payloadJson    String            @db.Text
  attempts       Int               @default(0)
  maxAttempts    Int               @default(5)
  status         DeliveryJobStatus @default(PENDING)
  lastError      String?           @db.Text
  nextRunAt      DateTime          @default(now())
  createdAt      DateTime          @default(now())
  updatedAt      DateTime          @updatedAt

  @@index([status, nextRunAt])
  @@index([targetInboxUrl])
  @@map("activity_delivery_jobs")
}
```

---

## 8. PHÂN RÃ NHIỆM VỤ & HƯỚNG DẪN TRIỂN KHAI CHO CÁC BOT CẤP DƯỚI

### 8.1. Nhiệm vụ cho `be-coder` (Task `t_18d45e2c`)

**Lưu ý kỹ thuật đặc thù với Fastify:**
* **Fastify Content Type Parser:** Mặc định Fastify chỉ parse `application/json`. Do đó, trong `app.ts`, bắt buộc phải đăng ký parser cho các MIME type của ActivityPub:
  ```typescript
  app.addContentTypeParser(
    ['application/activity+json', 'application/ld+json', 'application/jrd+json'],
    { parseAs: 'buffer' },
    (req, body, done) => {
      try {
        (req as any).rawBody = body; // Lưu lại raw body buffer để tính toán Digest hash
        const json = JSON.parse(body.toString('utf-8'));
        done(null, json);
      } catch (err: any) {
        done(err, undefined);
      }
    }
  );
  ```
* **CORS Headers bổ sung:** Cần bổ sung `Signature`, `Date`, `Digest`, `Accept` vào mảng `allowedHeaders` của `@fastify/cors`.

1. **Endpoint `/.well-known/webfinger` (`WebFingerDiscoveryController.ts`):**
   * Parse query param `resource`.
   * Chuẩn hóa `acct:username@domain`, kiểm tra domain khớp với `PULSE_DOMAIN`.
   * Trả về JSON theo `WebFingerResponse` interface, status 200, Content-Type `application/jrd+json; charset=utf-8`, header `Access-Control-Allow-Origin: *`.
   * Trả về 404 nếu không tìm thấy user; 400 nếu thiếu resource.
2. **Actor Profile Endpoints (`ActorController.ts`):**
   * `GET /users/:username`: Content negotiation. Trả về `ActivityPubActor` JSON-LD nếu header `Accept` chứa `application/activity+json` hoặc `application/ld+json`.
   * `GET /actor`: Trả về `Instance Actor` (`Application` type) kèm `publicKey`.
3. **Cryptographic Signatures Module (`HttpSignatureService.ts`):**
   * Sinh và nạp RSA 2048 keypair (`KeyManagementService.ts`).
   * Xác minh chữ ký inbound (`verifyInboundSignature`): parse header `Signature`, check clock skew (300s), check `Digest`, fetch remote key (với Instance Actor fetch), kiểm tra `crypto.createVerify('RSA-SHA256')`.
   * Ký chữ ký outbound (`signOutboundRequest`): tạo `Date`, `Digest: SHA-256=...`, dựng signing string, ký với private key của author.
4. **Inbox Handling (`ActivityPubInboxController.ts`):**
   * `POST /inbox` & `POST /users/:username/inbox`:
     * Áp dụng xác thực chữ ký HTTP.
     * Switch-case theo `activity.type`:
       * `Follow`: Tạo `FederatedFollow`, sinh & gửi `Accept` activity vào queue.
       * `Undo`: Xóa `FederatedFollow`.
       * `Create` (`Note`): Lưu `Post` (`isRemote = true`), fan-out tới `TimelineInbox` của local followers.
5. **Outbox & Delivery Queue Worker (`ActivityDeliveryWorker.ts`):**
   * Hook vào `PublishPostService`: Khi đăng bài, lấy danh sách remote followers, gom nhóm theo `sharedInboxUrl`, tạo jobs trong `ActivityDeliveryJob`.
   * Background processor: Chạy lặp mỗi 5 giây, lấy jobs `PENDING`, ký HTTP request, gửi `POST` tới remote inbox, cập nhật `attempts` và `nextRunAt` với exponential backoff.

### 8.2. Nhiệm vụ cho `security-auditor` (Task `t_8e62290e`)
1. **Audit SSRF Guard (`SsrfProtectionFilter.ts`):**
   * Kiểm tra khả năng chặn 100% các IP private: `127.0.0.1`, `10.0.0.1`, `172.16.0.1`, `192.168.1.1`, `169.254.169.254` (cloud metadata endpoint), IPv6 `::1`.
   * Kiểm tra phòng chống DNS Rebinding bằng cách DNS resolve trước và ghim IP vào socket.
2. **Audit HTTP Signatures:**
   * Kiểm tra tấn công Replay Attack: Gửi lại request quá 5 phút -> phải bị từ chối 401.
   * Kiểm tra Tampered Body: Thay đổi 1 byte trong body nhưng giữ nguyên header Signature/Digest -> phải bị từ chối 401.
3. **Audit JSON-LD DoS:**
   * Kiểm tra giới hạn body size: Request > 256KB phải bị Fastify từ chối 413 Payload Too Large.
   * Kiểm tra timeout kết nối ra ngoài: Server chậm không được làm treo worker thread.

### 8.3. Nhiệm vụ cho `qa-tester` (Task `t_8aa55201`)
Xây dựng test suite tự động hoàn chỉnh `activitypub-federation.test.mjs` với `node:test` và `node:assert/strict`:
1. **WebFinger Tests:**
   * Query hợp lệ (`acct:alice@localhost:3000`) -> 200 OK, `application/jrd+json`, rel `self`.
   * Query không tồn tại (`acct:ghost@localhost:3000`) -> 404 Not Found.
   * Query domain lạ (`acct:alice@evil.com`) -> 404 Not Found.
   * Query thiếu tham số -> 400 Bad Request.
2. **Actor Profile Tests:**
   * GET `/users/alice` với header `Accept: application/activity+json` -> 200 OK, JSON-LD chứa `publicKey`.
   * GET `/actor` -> 200 OK, type `Application`.
3. **HTTP Signature Verification Tests:**
   * Mock remote actor gửi inbound request hợp lệ được ký bằng RSA 2048 -> 200/202 Accepted.
   * Request với chữ ký sai -> 401 Unauthorized.
   * Request với Date quá 5 phút -> 401 Unauthorized.
   * Request với Digest sai lệch với body -> 401 Unauthorized.
4. **End-to-End Activity Flow Tests:**
   * Inbound `Follow` -> Hệ thống lưu `FederatedFollow`, tự động tạo `Accept` activity job trong DB.
   * Inbound `Create Note` -> Bài viết xuất hiện trong feed của local followers.
   * Outbox Delivery Queue: Kiểm tra worker pick job, gửi thành công và chuyển trạng thái `COMPLETED`.

---

## 9. DANH MỤC NGUỒN TRÍCH DẪN XÁC THỰC (GROUNDED CITATIONS)

1. W3C Recommendation: ActivityPub - https://www.w3.org/TR/activitypub
2. W3C Recommendation: ActivityStreams 2.0 Core - https://www.w3.org/TR/activitystreams-core
3. IETF RFC 7033: WebFinger - https://datatracker.ietf.org/doc/html/rfc7033
4. IETF Internet-Draft: Signing HTTP Messages (draft-cavage-http-signatures-12) - https://datatracker.ietf.org/doc/html/draft-cavage-http-signatures-12
5. Mastodon Documentation: Security and HTTP Signatures Specification - https://github.com/mastodon/documentation/blob/main/content/en/spec/security.md
6. W3C Social Web Incubator Community Group: ActivityPub and WebFinger Final Report (2024) - https://www.w3.org/community/reports/socialcg/CG-FINAL-apwf-20240608

## Sources

[1] https://www.w3.org/TR/activitypub — W3C ActivityPub Recommendation (2018)
[2] https://www.w3.org/TR/activitystreams-core — W3C ActivityStreams 2.0 Core Specification
[3] https://datatracker.ietf.org/doc/html/rfc7033 — RFC 7033: WebFinger (IETF)
[4] https://datatracker.ietf.org/doc/html/draft-cavage-http-signatures-12 — IETF Draft: Signing HTTP Messages (draft-cavage-12)
[5] https://github.com/mastodon/documentation/blob/main/content/en/spec/security.md — Mastodon Documentation: Security and HTTP Signatures
[6] https://www.w3.org/community/reports/socialcg/CG-FINAL-apwf-20240608 — W3C SWICG: ActivityPub and WebFinger Final Report (2024)

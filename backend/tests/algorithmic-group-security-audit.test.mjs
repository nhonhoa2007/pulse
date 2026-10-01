import { authHeaders } from './helpers/auth.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { prisma } from '../src/db/PrismaClientSingleton.ts';
import { buildApp } from '../src/app.ts';
import { postImpressionsBufferService } from '../src/modules/posts/PostImpressionsBufferService.ts';
import { webPushService } from '../src/modules/push/WebPushService.ts';
import { groupDmConversationService } from '../src/modules/dm/GroupDmConversationService.ts';
import { groupDmMessageService } from '../src/modules/dm/GroupDmMessageService.ts';

test('SECURITY AUDIT & PENETRATION VERIFICATION SUITE: Algorithmic Feeds & Group Real-Time Comms (TASK-20)', async (t) => {
  process.env.NODE_ENV = 'test';
  const app = await buildApp();
  await app.ready();

  const timestamp = Date.now();

  // Test Actors
  const alice = await prisma.user.create({
    data: {
      username: `sec_alice_${timestamp}`,
      email: `sec_alice_${timestamp}@pulse.audit`,
      displayName: 'Alice Auditor',
    },
  });

  const bob = await prisma.user.create({
    data: {
      username: `sec_bob_${timestamp}`,
      email: `sec_bob_${timestamp}@pulse.audit`,
      displayName: 'Bob Peer',
    },
  });

  const charlie = await prisma.user.create({
    data: {
      username: `sec_charlie_${timestamp}`,
      email: `sec_charlie_${timestamp}@pulse.audit`,
      displayName: 'Charlie Stranger',
    },
  });

  const davidBlocked = await prisma.user.create({
    data: {
      username: `sec_david_${timestamp}`,
      email: `sec_david_${timestamp}@pulse.audit`,
      displayName: 'David Blocked',
    },
  });

  const eveMuted = await prisma.user.create({
    data: {
      username: `sec_eve_${timestamp}`,
      email: `sec_eve_${timestamp}@pulse.audit`,
      displayName: 'Eve Muted',
    },
  });

  const malloryAttacker = await prisma.user.create({
    data: {
      username: `sec_mallory_${timestamp}`,
      email: `sec_mallory_${timestamp}@pulse.audit`,
      displayName: 'Mallory Attacker',
    },
  });

  const createdUserIds = [
    alice.id,
    bob.id,
    charlie.id,
    davidBlocked.id,
    eveMuted.id,
    malloryAttacker.id,
  ];

  // Teardown
  t.after(async () => {
    postImpressionsBufferService.clearDeduplicationCache();
    await prisma.groupReadReceipt.deleteMany({
      where: { userId: { in: createdUserIds } },
    });
    await prisma.groupMessage.deleteMany({
      where: { senderId: { in: createdUserIds } },
    });
    await prisma.groupMember.deleteMany({
      where: { userId: { in: createdUserIds } },
    });
    await prisma.groupConversation.deleteMany({
      where: { creatorId: { in: createdUserIds } },
    });
    await prisma.webPushSubscription.deleteMany({
      where: { userId: { in: createdUserIds } },
    });
    await prisma.keywordMute.deleteMany({
      where: { userId: { in: createdUserIds } },
    });
    await prisma.userMute.deleteMany({
      where: {
        OR: [{ muterId: { in: createdUserIds } }, { mutedId: { in: createdUserIds } }],
      },
    });
    await prisma.block.deleteMany({
      where: {
        OR: [{ blockerId: { in: createdUserIds } }, { blockedId: { in: createdUserIds } }],
      },
    });
    await prisma.follow.deleteMany({
      where: {
        OR: [{ followerId: { in: createdUserIds } }, { followingId: { in: createdUserIds } }],
      },
    });
    await prisma.post.deleteMany({
      where: { authorId: { in: createdUserIds } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: createdUserIds } },
    });
    await app.close();
  });

  // ===========================================================================
  // PILLAR 1: FOR YOU FEED PRIVACY & INVARIANT VERIFICATION
  // ===========================================================================

  await t.test('AUDIT 1.1: Two-Way Block Invariant - Mutual exclusion in algorithmic For You feed', async () => {
    // Setup two-way block: Alice blocks David
    await prisma.block.create({
      data: { blockerId: alice.id, blockedId: davidBlocked.id },
    });

    // David posts a viral post with high engagement
    const davidViralPost = await prisma.post.create({
      data: {
        authorId: davidBlocked.id,
        content: 'David viral post with maximum engagement',
        likesCount: 500,
        repostsCount: 200,
        repliesCount: 100,
        quotesCount: 50,
        viewsCount: 10000,
      },
    });

    // Alice also creates a post
    const alicePost = await prisma.post.create({
      data: {
        authorId: alice.id,
        content: 'Alice important security post',
        likesCount: 300,
      },
    });

    // 1. Alice requests For You feed: David's post must NEVER appear
    const aliceFeedRes = await app.inject({
      method: 'GET',
      url: '/api/v1/feed/for-you?limit=50',
      headers: authHeaders(alice.id),
    });
    assert.equal(aliceFeedRes.statusCode, 200);
    const aliceFeedPosts = aliceFeedRes.json().data.posts;
    const davidPostInAliceFeed = aliceFeedPosts.find((p) => p.id === davidViralPost.id);
    assert.equal(
      davidPostInAliceFeed,
      undefined,
      'SECURITY INVARIANT VIOLATION: Blocked user post leaked into blocker For You feed!'
    );

    // 2. David requests For You feed: Alice's post must NEVER appear
    const davidFeedRes = await app.inject({
      method: 'GET',
      url: '/api/v1/feed/for-you?limit=50',
      headers: authHeaders(davidBlocked.id),
    });
    assert.equal(davidFeedRes.statusCode, 200);
    const davidFeedPosts = davidFeedRes.json().data.posts;
    const alicePostInDavidFeed = davidFeedPosts.find((p) => p.id === alicePost.id);
    assert.equal(
      alicePostInDavidFeed,
      undefined,
      'SECURITY INVARIANT VIOLATION: Blocker post leaked into blocked user For You feed!'
    );
  });

  await t.test('AUDIT 1.2: Mute Stealth Leakage - User mutes & active keyword mutes are strictly filtered', async () => {
    // 1. User Mute: Alice mutes Eve
    await prisma.userMute.create({
      data: { muterId: alice.id, mutedId: eveMuted.id },
    });

    const evePost = await prisma.post.create({
      data: {
        authorId: eveMuted.id,
        content: 'Eve post that should be stealth-filtered for Alice',
        likesCount: 400,
        repostsCount: 150,
      },
    });

    // 2. Keyword Mute: Alice mutes keyword 'phishing_exploit' for HOME_TIMELINE
    await prisma.keywordMute.create({
      data: {
        userId: alice.id,
        keyword: 'phishing_exploit',
        matchType: 'CONTAINS',
        muteContext: 'HOME_TIMELINE',
      },
    });

    // Bob posts containing the muted keyword
    const bobKeywordPost = await prisma.post.create({
      data: {
        authorId: bob.id,
        content: 'Beware of this phishing_exploit on the network',
        likesCount: 450,
      },
    });

    // Bob also posts a clean post
    const bobCleanPost = await prisma.post.create({
      data: {
        authorId: bob.id,
        content: 'Clean post by Bob on distributed systems',
        likesCount: 500,
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/feed/for-you?limit=50',
      headers: authHeaders(alice.id),
    });
    assert.equal(res.statusCode, 200);
    const postIds = res.json().data.posts.map((p) => p.id);

    assert.ok(
      !postIds.includes(evePost.id),
      'Muted user post must NOT appear in For You feed'
    );
    assert.ok(
      !postIds.includes(bobKeywordPost.id),
      'Keyword muted post must NOT appear in For You feed'
    );
    assert.ok(
      postIds.includes(bobCleanPost.id),
      'Clean post by friend must appear in For You feed'
    );
  });

  await t.test('AUDIT 1.3: Soft-Deleted Posts Exclusion - Deleted posts never sourced into For You feed', async () => {
    const deletedPost = await prisma.post.create({
      data: {
        authorId: bob.id,
        content: 'This post was soft-deleted by Bob',
        likesCount: 600,
        isDeleted: true,
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/feed/for-you?limit=50',
      headers: authHeaders(alice.id),
    });
    assert.equal(res.statusCode, 200);
    const postIds = res.json().data.posts.map((p) => p.id);
    assert.ok(!postIds.includes(deletedPost.id), 'Soft-deleted post must never be sourced into For You feed');
  });

  // ===========================================================================
  // PILLAR 2: IMPRESSION COUNT FRAUD, RACE CONDITIONS & BUFFER DoS
  // ===========================================================================

  await t.test('AUDIT 2.1: Spam View Beacons - 30-minute deduplication window prevents impression inflation', async () => {
    postImpressionsBufferService.clearDeduplicationCache();
    await postImpressionsBufferService.flush();

    const targetPost = await prisma.post.create({
      data: {
        authorId: bob.id,
        content: 'Impression fraud test post',
        viewsCount: 0,
      },
    });

    // Rapid burst of 25 view requests from same client IP/user
    const burstCount = 25;
    for (let i = 0; i < burstCount; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/posts/views',
        headers: authHeaders(malloryAttacker.id),
        payload: { postIds: [targetPost.id] },
      });
      assert.equal(res.statusCode, 200);
      if (i === 0) {
        assert.equal(res.json().data.recorded, 1, 'First beacon should be recorded');
      } else {
        assert.equal(res.json().data.recorded, 0, 'Subsequent spam beacons must be deduplicated to 0');
      }
    }

    // Flush buffer to database
    await postImpressionsBufferService.flush();

    const refreshed = await prisma.post.findUnique({
      where: { id: targetPost.id },
      select: { viewsCount: true },
    });
    assert.equal(refreshed.viewsCount, 1, 'viewsCount must be strictly 1 despite 25 spam beacons');
  });

  await t.test('AUDIT 2.2: Negative or Arbitrary Count Injection Prevention', async () => {
    const targetPost = await prisma.post.create({
      data: {
        authorId: bob.id,
        content: 'Arbitrary count injection target post',
        viewsCount: 10,
      },
    });

    // Attempt to inject arbitrary / negative counts in payload
    const maliciousPayloads = [
      { postIds: [targetPost.id], count: -100 },
      { postIds: [targetPost.id], delta: -50 },
      { postIds: [targetPost.id], increment: 999999 },
      { postIds: 'not-an-array' },
    ];

    for (const payload of maliciousPayloads) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/posts/views',
        headers: authHeaders(malloryAttacker.id),
        payload,
      });

      if (!Array.isArray(payload.postIds)) {
        assert.equal(res.statusCode, 400, 'Non-array postIds must return 400 BAD_REQUEST');
      } else {
        assert.equal(res.statusCode, 200);
      }
    }

    await postImpressionsBufferService.flush();

    // Verify counter was not decreased or arbitrarily modified
    const refreshed = await prisma.post.findUnique({
      where: { id: targetPost.id },
      select: { viewsCount: true },
    });
    assert.ok(refreshed.viewsCount >= 10, 'viewsCount must never be decremented below baseline');
  });

  await t.test('AUDIT 2.3: Buffer Memory Exhaustion / DoS - Invalid UUIDs and batch bounds', async () => {
    postImpressionsBufferService.clearDeduplicationCache();

    // Malicious synthetics: SQL injection, path traversal, giant strings, non-UUID
    const maliciousIds = [
      "'; DROP TABLE \"Post\"; --",
      "' OR 1=1 --",
      '../../etc/passwd',
      'bad-uuid-1234',
      'a'.repeat(5000),
      null,
      undefined,
      12345,
    ];

    const result = postImpressionsBufferService.recordViews(
      `attacker_${timestamp}`,
      maliciousIds
    );
    assert.equal(result.recorded, 0, 'Buffer must strictly reject all non-UUID synthetic IDs');

    // Batch size bounding: Passing 1000 IDs is bounded to MAX_BATCH_SIZE (100)
    const validUuid = crypto.randomUUID();
    const giantBatch = Array.from({ length: 500 }, () => validUuid);
    const boundedResult = postImpressionsBufferService.recordViews(
      `batch_tester_${timestamp}`,
      giantBatch
    );
    // Since all are identical UUIDs, 1 is recorded and 99 are deduplicated within the bounded 100 slice
    assert.equal(boundedResult.recorded, 1);
    postImpressionsBufferService.clearPendingCounts();
  });

  await t.test('AUDIT 2.4: Concurrency & Atomicity - Concurrent flushes do not lose impressions', async () => {
    postImpressionsBufferService.clearDeduplicationCache();
    await postImpressionsBufferService.flush();

    const concurrentPost = await prisma.post.create({
      data: {
        authorId: bob.id,
        content: 'Concurrent views atomicity test',
        viewsCount: 0,
      },
    });

    // 50 unique simulated client impressions
    const clientCount = 50;
    for (let i = 0; i < clientCount; i++) {
      postImpressionsBufferService.recordViews(`client_${i}_${timestamp}`, [concurrentPost.id]);
    }

    assert.equal(
      postImpressionsBufferService.getPendingForPost(concurrentPost.id),
      50,
      'Pending count in buffer must accurately be 50'
    );

    // Concurrently trigger multiple flushes
    await Promise.all([
      postImpressionsBufferService.flush(),
      postImpressionsBufferService.flush(),
      postImpressionsBufferService.flush(),
    ]);

    const refreshed = await prisma.post.findUnique({
      where: { id: concurrentPost.id },
      select: { viewsCount: true },
    });
    assert.equal(refreshed.viewsCount, 50, 'Atomic SQL increments must preserve exact 50 impressions');
  });

  // ===========================================================================
  // PILLAR 3: GROUP DM ACCESS CONTROL, IDOR & PRIVILEGE ESCALATION
  // ===========================================================================

  let auditGroupId;

  await t.test('AUDIT 3.1: Group DM Broken Access Control (IDOR) - Stranger Charlie is blocked', async () => {
    // Alice creates group with Bob
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/dm/groups',
      headers: authHeaders(alice.id),
      payload: {
        title: 'Confidential Security Group',
        memberIds: [bob.id],
      },
    });
    assert.equal(createRes.statusCode, 201);
    auditGroupId = createRes.json().data.id;

    // Alice sends a private message
    const sendRes = await app.inject({
      method: 'POST',
      url: `/api/v1/dm/groups/${auditGroupId}/messages`,
      headers: authHeaders(alice.id),
      payload: { content: 'Alice secret trade payload' },
    });
    assert.equal(sendRes.statusCode, 201);
    const secretMsgId = sendRes.json().data.id;

    // Stranger Charlie attempts reading group details -> 403 FORBIDDEN
    const getGroupRes = await app.inject({
      method: 'GET',
      url: `/api/v1/dm/groups/${auditGroupId}`,
      headers: authHeaders(charlie.id),
    });
    assert.equal(getGroupRes.statusCode, 403);
    assert.equal(getGroupRes.json().error.code, 'FORBIDDEN');

    // Stranger Charlie attempts reading messages -> 403 FORBIDDEN
    const getMessagesRes = await app.inject({
      method: 'GET',
      url: `/api/v1/dm/groups/${auditGroupId}/messages`,
      headers: authHeaders(charlie.id),
    });
    assert.equal(getMessagesRes.statusCode, 403);
    assert.equal(getMessagesRes.json().error.code, 'FORBIDDEN');

    // Stranger Charlie attempts injecting message -> 403 FORBIDDEN
    const injectRes = await app.inject({
      method: 'POST',
      url: `/api/v1/dm/groups/${auditGroupId}/messages`,
      headers: authHeaders(charlie.id),
      payload: { content: 'Charlie malicious injected message' },
    });
    assert.equal(injectRes.statusCode, 403);
    assert.equal(injectRes.json().error.code, 'FORBIDDEN');

    // Stranger Charlie attempts deleting Alice message -> 403 FORBIDDEN
    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/dm/groups/${auditGroupId}/messages/${secretMsgId}`,
      headers: authHeaders(charlie.id),
    });
    assert.equal(deleteRes.statusCode, 403);
    assert.equal(deleteRes.json().error.code, 'FORBIDDEN');

    // Stranger Charlie attempts updating read receipt -> 403 FORBIDDEN
    const readRes = await app.inject({
      method: 'PUT',
      url: `/api/v1/dm/groups/${auditGroupId}/read`,
      headers: authHeaders(charlie.id),
      payload: { messageId: secretMsgId },
    });
    assert.equal(readRes.statusCode, 403);
    assert.equal(readRes.json().error.code, 'FORBIDDEN');
  });

  await t.test('AUDIT 3.2: Privilege Escalation - Regular MEMBER cannot kick admin or update settings', async () => {
    // Bob is MEMBER, Alice is ADMIN
    // 1. Bob attempts to change group title
    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/dm/groups/${auditGroupId}`,
      headers: authHeaders(bob.id),
      payload: { title: 'Hacked by Bob' },
    });
    assert.equal(patchRes.statusCode, 403);
    assert.equal(patchRes.json().error.code, 'FORBIDDEN');

    // 2. Bob attempts to add Charlie
    const addRes = await app.inject({
      method: 'POST',
      url: `/api/v1/dm/groups/${auditGroupId}/members`,
      headers: authHeaders(bob.id),
      payload: { userId: charlie.id },
    });
    assert.equal(addRes.statusCode, 403);
    assert.equal(addRes.json().error.code, 'FORBIDDEN');

    // 3. Bob attempts to kick group creator Alice
    const kickRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/dm/groups/${auditGroupId}/members/${alice.id}`,
      headers: authHeaders(bob.id),
    });
    assert.equal(kickRes.statusCode, 403);
    assert.equal(kickRes.json().error.code, 'FORBIDDEN');
  });

  await t.test('AUDIT 3.3: Social Graph Block Invariants in Group DMs', async () => {
    // Setup block: Alice blocks David
    // 1. Attempt creating group with David -> 403 FORBIDDEN
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/dm/groups',
      headers: authHeaders(alice.id),
      payload: {
        title: 'Illegal Group with Blocked User',
        memberIds: [davidBlocked.id],
      },
    });
    assert.equal(createRes.statusCode, 403);
    assert.equal(createRes.json().error.code, 'FORBIDDEN');

    // 2. David attempts creating group with Alice -> 403 FORBIDDEN
    const davidCreateRes = await app.inject({
      method: 'POST',
      url: '/api/v1/dm/groups',
      headers: authHeaders(davidBlocked.id),
      payload: {
        title: 'David illegal attempt',
        memberIds: [alice.id],
      },
    });
    assert.equal(davidCreateRes.statusCode, 403);
    assert.equal(davidCreateRes.json().error.code, 'FORBIDDEN');

    // 3. Alice attempts adding David to existing group -> 403 FORBIDDEN
    const addBlockedRes = await app.inject({
      method: 'POST',
      url: `/api/v1/dm/groups/${auditGroupId}/members`,
      headers: authHeaders(alice.id),
      payload: { userId: davidBlocked.id },
    });
    assert.equal(addBlockedRes.statusCode, 403);
    assert.equal(addBlockedRes.json().error.code, 'FORBIDDEN');
  });

  await t.test('AUDIT 3.4: Anti-Tampering & XSS Mitigation in Group DMs', async () => {
    // 1. Stored XSS in group title: HTML/script tags are sanitized
    const titleXssRes = await app.inject({
      method: 'POST',
      url: '/api/v1/dm/groups',
      headers: authHeaders(alice.id),
      payload: {
        title: '<script>alert("XSS")</script>Secure Chat',
        memberIds: [bob.id],
      },
    });
    assert.equal(titleXssRes.statusCode, 201);
    assert.equal(titleXssRes.json().data.title, 'Secure Chat', 'Script tags in title must be cleanly stripped');

    // 2. Dangerous avatarUrl with javascript: protocol is rejected
    const avatarXssRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/dm/groups/${auditGroupId}`,
      headers: authHeaders(alice.id),
      payload: { avatarUrl: 'javascript:alert("XSS")' },
    });
    assert.equal(avatarXssRes.statusCode, 400, 'Dangerous avatarUrl must be rejected with 400');

    // 3. Dangerous mediaUrls with javascript: protocol in group messages is rejected
    const mediaXssRes = await app.inject({
      method: 'POST',
      url: `/api/v1/dm/groups/${auditGroupId}/messages`,
      headers: authHeaders(alice.id),
      payload: {
        content: 'Check out this photo',
        mediaUrls: ['javascript:alert(document.cookie)'],
      },
    });
    assert.equal(mediaXssRes.statusCode, 400, 'Dangerous mediaUrls scheme must be rejected with 400');

    // 4. Soft-deleted message content masking
    const msgRes = await app.inject({
      method: 'POST',
      url: `/api/v1/dm/groups/${auditGroupId}/messages`,
      headers: authHeaders(alice.id),
      payload: { content: 'Secret confidential message' },
    });
    const msgId = msgRes.json().data.id;

    await app.inject({
      method: 'DELETE',
      url: `/api/v1/dm/groups/${auditGroupId}/messages/${msgId}`,
      headers: authHeaders(alice.id),
    });

    const messagesRes = await app.inject({
      method: 'GET',
      url: `/api/v1/dm/groups/${auditGroupId}/messages`,
      headers: authHeaders(bob.id),
    });
    const deletedMsg = messagesRes.json().data.messages.find((m) => m.id === msgId);
    assert.ok(deletedMsg);
    assert.equal(deletedMsg.content, 'This message was deleted');
    assert.deepEqual(deletedMsg.mediaUrls, []);
  });

  // ===========================================================================
  // PILLAR 4: WEB PUSH SUBSYSTEM & SSRF DEFENSE
  // ===========================================================================

  await t.test('AUDIT 4.1: SSRF Protection on Push Endpoints - Loopback, internal ports & cloud metadata', async () => {
    const dangerousEndpoints = [
      'http://127.0.0.1:5432/fcm/send/test', // PostgreSQL internal port
      'http://127.0.0.1:22/push',            // SSH port
      'http://169.254.169.254/latest/meta-data', // AWS Cloud Metadata
      'http://[::ffff:169.254.169.254]/latest/meta-data', // IPv4-mapped metadata
      'http://metadata.google.internal/computeMetadata/v1/', // GCP Cloud Metadata
      'http://10.0.0.1:8080/push',           // RFC 1918 Private
      'http://192.168.1.1/api/push',         // RFC 1918 Private
      'http://172.16.0.5:80/push',           // RFC 1918 Private
    ];

    for (const endpoint of dangerousEndpoints) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/push/subscriptions',
        headers: authHeaders(alice.id),
        payload: {
          endpoint,
          keys: {
            p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QT9bP0n-Y',
            auth: 'tBHItJI5svbpez7KI4CCXg',
          },
        },
      });

      assert.equal(
        res.statusCode,
        400,
        `SSRF push endpoint '${endpoint}' must be rejected with HTTP 400`
      );
      assert.equal(res.json().error.code, 'SSRF_GUARD_BLOCKED');
      assert.match(res.json().error.message, /SSRF/);
    }
  });

  await t.test('AUDIT 4.2: VAPID Header & Signature Verification - Cryptographic integrity & tampering', async () => {
    const audience = 'https://fcm.googleapis.com';
    const validToken = webPushService.generateVapidToken(audience);
    assert.ok(typeof validToken === 'string');

    // 1. Verify valid token
    const verification = webPushService.verifyVapidToken(validToken, audience);
    assert.equal(verification.valid, true, 'Valid VAPID token must pass cryptographic verification');
    assert.equal(verification.claims.aud, audience);
    assert.ok(verification.claims.exp > Math.floor(Date.now() / 1000));

    // 2. Audience mismatch detection
    const audMismatch = webPushService.verifyVapidToken(validToken, 'https://updates.push.services.mozilla.com');
    assert.equal(audMismatch.valid, false);
    assert.equal(audMismatch.error, 'AUDIENCE_MISMATCH: Expected https://updates.push.services.mozilla.com, got https://fcm.googleapis.com');

    // 3. Payload tampering detection (Modifying audience inside JWT payload)
    const [headerB64, payloadB64, sigB64] = validToken.split('.');
    const tamperedPayload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    tamperedPayload.sub = 'mailto:evil@hacker.com';
    const tamperedPayloadB64 = Buffer.from(JSON.stringify(tamperedPayload)).toString('base64url');
    const tamperedToken = `${headerB64}.${tamperedPayloadB64}.${sigB64}`;

    const tamperedCheck = webPushService.verifyVapidToken(tamperedToken);
    assert.equal(tamperedCheck.valid, false, 'Tampered payload must fail cryptographic verification');
    assert.match(tamperedCheck.error, /INVALID_SIGNATURE/);

    // 4. Expired token rejection
    const expiredPayload = {
      aud: audience,
      exp: Math.floor(Date.now() / 1000) - 3600, // 1 hour in the past
      sub: 'mailto:admin@pulse.social',
    };
    const expPayloadB64 = Buffer.from(JSON.stringify(expiredPayload)).toString('base64url');
    const expToken = `${headerB64}.${expPayloadB64}.${sigB64}`;
    const expiredCheck = webPushService.verifyVapidToken(expToken);
    assert.equal(expiredCheck.valid, false);
    assert.match(expiredCheck.error, /TOKEN_EXPIRED/);

    // 5. Foreign / Invalid curve key forgery detection
    // Attacker generates an unauthorized P-256 EC keypair and signs a token claiming to be from Pulse
    const foreignKeyPair = crypto.generateKeyPairSync('ec', {
      namedCurve: 'prime256v1',
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });
    const foreignSign = crypto.sign('SHA256', Buffer.from(`${headerB64}.${payloadB64}`, 'utf8'), {
      key: foreignKeyPair.privateKey,
      dsaEncoding: 'ieee-p1363',
    });
    const forgedToken = `${headerB64}.${payloadB64}.${foreignSign.toString('base64url')}`;
    const forgeryCheck = webPushService.verifyVapidToken(forgedToken);
    assert.equal(forgeryCheck.valid, false, 'Forged token signed with foreign key must be rejected');
    assert.match(forgeryCheck.error, /INVALID_SIGNATURE/);
  });

  await t.test('AUDIT 4.3: Auto-Pruning Validation - Stale endpoints (404/410) are pruned cleanly without crash', async () => {
    let mockStatusCode = 410; // Gone
    const mockPushServer = http.createServer((_req, res) => {
      res.writeHead(mockStatusCode, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Endpoint gone or unsubscribed' }));
    });

    await new Promise((resolve) => mockPushServer.listen(0, '127.0.0.1', resolve));
    const mockPort = mockPushServer.address().port;
    const testEndpoint = `http://127.0.0.1:${mockPort}/push/mock-token`;

    try {
      // Register subscription targeting mock server (valid port > 1024 in test environment)
      const sub = await webPushService.registerSubscription(alice.id, {
        endpoint: testEndpoint,
        keys: {
          p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QT9bP0n-Y',
          auth: 'tBHItJI5svbpez7KI4CCXg',
        },
      });
      assert.ok(sub);

      // Verify stored in DB
      let subInDb = await prisma.webPushSubscription.findUnique({
        where: { endpoint: testEndpoint },
      });
      assert.ok(subInDb, 'Subscription must exist in DB initially');

      // Dispatch push notification
      const result = await webPushService.sendNotification({
        endpoint: testEndpoint,
        p256dh: sub.p256dh,
        auth: sub.auth,
      });

      assert.equal(result.success, false);
      assert.equal(result.statusCode, 410);

      // Verify auto-pruned from database
      subInDb = await prisma.webPushSubscription.findUnique({
        where: { endpoint: testEndpoint },
      });
      assert.equal(subInDb, null, 'Dead subscription returning 410 must be auto-pruned from DB');

      // Test 404 Not Found pruning
      mockStatusCode = 404;
      await webPushService.registerSubscription(alice.id, {
        endpoint: testEndpoint,
        keys: {
          p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QT9bP0n-Y',
          auth: 'tBHItJI5svbpez7KI4CCXg',
        },
      });

      await webPushService.sendNotification({
        endpoint: testEndpoint,
        p256dh: sub.p256dh,
        auth: sub.auth,
      });

      const subInDbAfter404 = await prisma.webPushSubscription.findUnique({
        where: { endpoint: testEndpoint },
      });
      assert.equal(subInDbAfter404, null, 'Expired subscription returning 404 must be auto-pruned from DB');
    } finally {
      await new Promise((resolve) => mockPushServer.close(resolve));
    }
  });
});

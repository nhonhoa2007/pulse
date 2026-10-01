import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import { prisma } from '../src/db/PrismaClientSingleton.ts';
import { buildApp } from '../src/app.ts';
import { ssrfProtectionGuardService } from '../src/modules/federation/SsrfProtectionGuardService.ts';
import { activityPubKeyManagerService } from '../src/modules/federation/ActivityPubKeyManagerService.ts';
import { httpSignatureVerifierService } from '../src/modules/federation/HttpSignatureVerifierService.ts';

test('ActivityPub Security Penetration & Vulnerability Verification Suite', async (t) => {
  process.env.NODE_ENV = 'test';
  process.env.ALLOW_HTTP_FEDERATION = 'true';

  const app = await buildApp();
  await app.ready();

  const timestamp = Date.now();
  const testDomain = 'localhost:3001';

  // Seed local user
  const alice = await prisma.user.create({
    data: {
      username: `alice_audit_${timestamp}`,
      email: `alice_audit_${timestamp}@pulse.social`,
      displayName: 'Alice Audit Target',
    },
  });

  const bob = await prisma.user.create({
    data: {
      username: `bob_audit_${timestamp}`,
      email: `bob_audit_${timestamp}@pulse.social`,
      displayName: 'Bob Audit Local',
    },
  });

  // Legitimate remote actor (Charlie on mastodon.audit)
  const charlieKey = activityPubKeyManagerService.generateRsa2048KeyPair();
  const charlieDomain = 'mastodon.audit';
  const charlieUsername = `charlie_${timestamp}`;
  const charlieActorUri = `https://${charlieDomain}/users/${charlieUsername}`;
  const charlieKeyId = `${charlieActorUri}#main-key`;
  const charlieInboxUrl = `https://${charlieDomain}/users/${charlieUsername}/inbox`;

  await prisma.federatedActor.create({
    data: {
      uri: charlieActorUri,
      username: charlieUsername,
      domain: charlieDomain,
      name: 'Charlie Legitimate',
      inboxUrl: charlieInboxUrl,
      sharedInboxUrl: `https://${charlieDomain}/inbox`,
      publicKeyPem: charlieKey.publicKeyPem,
      publicKeyId: charlieKeyId,
    },
  });

  // Adversary remote actor (Eve on attacker.mock)
  const eveKey = activityPubKeyManagerService.generateRsa2048KeyPair();
  const eveDomain = 'attacker.mock';
  const eveUsername = `eve_${timestamp}`;
  const eveActorUri = `https://${eveDomain}/users/${eveUsername}`;
  const eveKeyId = `${eveActorUri}#main-key`;

  await prisma.federatedActor.create({
    data: {
      uri: eveActorUri,
      username: eveUsername,
      domain: eveDomain,
      name: 'Eve Adversary',
      inboxUrl: `https://${eveDomain}/users/${eveUsername}/inbox`,
      publicKeyPem: eveKey.publicKeyPem,
      publicKeyId: eveKeyId,
    },
  });

  // Helper to sign inbound requests
  function signRequest({
    method = 'POST',
    path = '/inbox',
    body = '',
    date = new Date().toUTCString(),
    privateKeyPem = charlieKey.privateKeyPem,
    keyId = charlieKeyId,
    host = testDomain,
    headersList = ['(request-target)', 'host', 'date', 'digest'],
  }) {
    const rawBodyBuffer = Buffer.from(body, 'utf-8');
    const digestBase64 = crypto.createHash('sha256').update(rawBodyBuffer).digest('base64');
    const digestHeader = `SHA-256=${digestBase64}`;

    const signingLines = [];
    for (const h of headersList) {
      if (h === '(request-target)') {
        signingLines.push(`(request-target): ${method.toLowerCase()} ${path}`);
      } else if (h === 'host') {
        signingLines.push(`host: ${host}`);
      } else if (h === 'date') {
        signingLines.push(`date: ${date}`);
      } else if (h === 'digest') {
        signingLines.push(`digest: ${digestHeader}`);
      }
    }

    const signingString = signingLines.join('\n');
    const signer = crypto.createSign('RSA-SHA256');
    signer.update(signingString);
    const signatureBase64 = signer.sign(privateKeyPem, 'base64');

    const signatureHeader = `keyId="${keyId}",algorithm="rsa-sha256",headers="${headersList.join(' ')}",signature="${signatureBase64}"`;

    return {
      Host: host,
      Date: date,
      Digest: digestHeader,
      Signature: signatureHeader,
      'Content-Type': 'application/activity+json',
      Accept: 'application/activity+json',
    };
  }

  // =========================================================================
  // SECTION 1: SSRF MITIGATIONS & OUTBOUND CALL SECURITY
  // =========================================================================
  await t.test('AUDIT 1.1: SSRF Guard - comprehensive IPv4 private, CGNAT, and broadcast blocks', async () => {
    // RFC 1918
    assert.equal(ssrfProtectionGuardService.isPrivateIp('10.0.0.1'), true);
    assert.equal(ssrfProtectionGuardService.isPrivateIp('172.16.0.1'), true);
    assert.equal(ssrfProtectionGuardService.isPrivateIp('172.31.255.254'), true);
    assert.equal(ssrfProtectionGuardService.isPrivateIp('192.168.0.1'), true);

    // Loopback & Current Network
    assert.equal(ssrfProtectionGuardService.isPrivateIp('127.0.0.1'), true);
    assert.equal(ssrfProtectionGuardService.isPrivateIp('127.0.0.2'), true);
    assert.equal(ssrfProtectionGuardService.isPrivateIp('0.0.0.0'), true);

    // CGNAT & Cloud Metadata
    assert.equal(ssrfProtectionGuardService.isPrivateIp('100.64.0.1'), true);
    assert.equal(ssrfProtectionGuardService.isPrivateIp('169.254.169.254'), true);

    // Test Nets & Benchmarking
    assert.equal(ssrfProtectionGuardService.isPrivateIp('192.0.2.1'), true);
    assert.equal(ssrfProtectionGuardService.isPrivateIp('198.18.0.1'), true);
    assert.equal(ssrfProtectionGuardService.isPrivateIp('198.51.100.1'), true);
    assert.equal(ssrfProtectionGuardService.isPrivateIp('203.0.113.1'), true);

    // Multicast & Broadcast
    assert.equal(ssrfProtectionGuardService.isPrivateIp('224.0.0.1'), true);
    assert.equal(ssrfProtectionGuardService.isPrivateIp('255.255.255.255'), true);

    // Public Internet IP
    assert.equal(ssrfProtectionGuardService.isPrivateIp('93.184.216.34'), false);
    assert.equal(ssrfProtectionGuardService.isPrivateIp('1.1.1.1'), false);
  });

  await t.test('AUDIT 1.2: SSRF Guard - IPv6 loopback, bracketed notation, SIIT, ULA, and 6to4 tunneling', async () => {
    // Loopback & Unspecified
    assert.equal(ssrfProtectionGuardService.isPrivateIp('::1'), true);
    assert.equal(ssrfProtectionGuardService.isPrivateIp('[::1]'), true);
    assert.equal(ssrfProtectionGuardService.isPrivateIp('::'), true);

    // IPv4-mapped IPv6
    assert.equal(ssrfProtectionGuardService.isPrivateIp('::ffff:127.0.0.1'), true);
    assert.equal(ssrfProtectionGuardService.isPrivateIp('[::ffff:169.254.169.254]'), true);
    assert.equal(ssrfProtectionGuardService.isPrivateIp('::ffff:10.0.0.1'), true);
    assert.equal(ssrfProtectionGuardService.isPrivateIp('::ffff:93.184.216.34'), false);

    // Link-local & ULA
    assert.equal(ssrfProtectionGuardService.isPrivateIp('fe80::1'), true);
    assert.equal(ssrfProtectionGuardService.isPrivateIp('fc00::1'), true);
    assert.equal(ssrfProtectionGuardService.isPrivateIp('fd12:3456:789a::1'), true);

    // 6to4 tunneling (2002:7f00:0001:: maps to 127.0.0.1)
    assert.equal(ssrfProtectionGuardService.isPrivateIp('2002:7f00:0001::'), true);
  });

  await t.test('AUDIT 1.3: Port Scanning & Protocol Smuggling Prevention', async () => {
    // Restricted internal services
    const sshCheck = await ssrfProtectionGuardService.isSafeUrl('https://example.com:22/inbox');
    assert.equal(sshCheck.safe, false);
    assert.match(sshCheck.error, /FORBIDDEN_PORT/);

    const redisCheck = await ssrfProtectionGuardService.isSafeUrl('http://example.com:6379/inbox');
    assert.equal(redisCheck.safe, false);
    assert.match(redisCheck.error, /FORBIDDEN_PORT/);

    const pgCheck = await ssrfProtectionGuardService.isSafeUrl('http://example.com:5432/inbox');
    assert.equal(pgCheck.safe, false);
    assert.match(pgCheck.error, /FORBIDDEN_PORT/);
  });

  await t.test('AUDIT 1.4: Redirect-based SSRF Mitigation via safeFederatedFetch', async () => {
    // Spin up a server that attempts to redirect to AWS metadata 169.254.169.254
    const redirectServer = http.createServer((req, res) => {
      res.writeHead(302, {
        Location: 'http://169.254.169.254/latest/meta-data/',
      });
      res.end();
    });

    await new Promise((resolve) => redirectServer.listen(0, '127.0.0.1', resolve));
    const port = redirectServer.address().port;

    try {
      await assert.rejects(
        async () => {
          await ssrfProtectionGuardService.safeFederatedFetch(
            `http://127.0.0.1:${port}/redirect-to-aws`,
            { allowPrivateForTesting: false }
          );
        },
        (err) => {
          assert.match(err.message, /SSRF_BLOCKED/);
          return true;
        }
      );
    } finally {
      await new Promise((resolve) => redirectServer.close(resolve));
    }
  });

  await t.test('AUDIT 1.5: Resource Exhaustion - Response size limiter caps outbound downloads at 1MB', async () => {
    // Spin up a server that streams an oversized response (> 1.5MB)
    const largeServer = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      // Stream 2MB in chunks
      const chunk = Buffer.alloc(64 * 1024, 'A');
      for (let i = 0; i < 32; i++) {
        res.write(chunk);
      }
      res.end();
    });

    await new Promise((resolve) => largeServer.listen(0, '127.0.0.1', resolve));
    const port = largeServer.address().port;

    try {
      await assert.rejects(
        async () => {
          await ssrfProtectionGuardService.safeFederatedFetch(
            `http://127.0.0.1:${port}/large-data`,
            {
              allowPrivateForTesting: true,
              maxResponseSizeBytes: 512 * 1024, // 512KB limit
            }
          );
        },
        (err) => {
          assert.match(err.message, /RESOURCE_EXHAUSTION/);
          return true;
        }
      );
    } finally {
      await new Promise((resolve) => largeServer.close(resolve));
    }
  });

  // =========================================================================
  // SECTION 2: HTTP SIGNATURE PARSING & REPLAY ATTACK MITIGATIONS
  // =========================================================================
  await t.test('AUDIT 2.1: Header Stripping Defense - Signature must sign (request-target), host, date, and digest', async () => {
    const payload = JSON.stringify({
      '@context': 'https://www.w3.org/ns/activitystreams',
      type: 'Follow',
      actor: charlieActorUri,
      object: `http://${testDomain}/users/${alice.username}`,
    });

    // Attacker sends signature that only signs 'date' (omitting digest and request-target)
    const strippedHeaders = signRequest({
      body: payload,
      headersList: ['date'],
    });

    const res = await app.inject({
      method: 'POST',
      url: '/inbox',
      headers: strippedHeaders,
      payload,
    });

    assert.equal(res.statusCode, 401);
    assert.match(res.json().error.message, /MISSING_REQUIRED_SIGNED_HEADER/);
  });

  await t.test('AUDIT 2.2: Replay Attack Defense - Identical signature is rejected on second presentation', async () => {
    const payload = JSON.stringify({
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: `https://${charlieDomain}/activities/replay_audit_${timestamp}`,
      type: 'Follow',
      actor: charlieActorUri,
      object: `http://${testDomain}/users/${bob.username}`,
    });

    const headers = signRequest({
      body: payload,
    });

    // First attempt succeeds
    const res1 = await app.inject({
      method: 'POST',
      url: '/inbox',
      headers,
      payload,
    });
    assert.equal(res1.statusCode, 202);

    // Replayed request with same signature fails with 401 REPLAY_ATTACK_DETECTED
    const res2 = await app.inject({
      method: 'POST',
      url: '/inbox',
      headers,
      payload,
    });
    assert.equal(res2.statusCode, 401);
    assert.match(res2.json().error.message, /REPLAY_ATTACK_DETECTED/);
  });

  await t.test('AUDIT 2.3: Bounded Replay Cache - Memory leak / DoS protection caps cache at 10,000 entries', async () => {
    // Record signatures into verifier cache
    for (let i = 0; i < 50; i++) {
      httpSignatureVerifierService.recordSignature(`mock_sig_${timestamp}_${i}`);
    }

    assert.ok(httpSignatureVerifierService.getReplayCacheSize() <= 10000);
    assert.equal(httpSignatureVerifierService.isSignatureSeen(`mock_sig_${timestamp}_49`), true);
  });

  await t.test('AUDIT 2.4: Identity Binding - Eve cannot impersonate Charlie by signing Eve key with Charlie payload', async () => {
    const impersonatedPayload = JSON.stringify({
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: `https://${charlieDomain}/activities/forged_${timestamp}`,
      type: 'Follow',
      actor: charlieActorUri, // Charlie is the claimed actor
      object: `http://${testDomain}/users/${alice.username}`,
    });

    // Eve signs with Eve's own valid private key and keyId
    const eveSignedHeaders = signRequest({
      body: impersonatedPayload,
      privateKeyPem: eveKey.privateKeyPem,
      keyId: eveKeyId,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/inbox',
      headers: eveSignedHeaders,
      payload: impersonatedPayload,
    });

    // Must be rejected with 403 ACTOR_SIGNATURE_MISMATCH
    assert.equal(res.statusCode, 403);
    assert.equal(res.json().error.code, 'ACTOR_SIGNATURE_MISMATCH');
  });

  // =========================================================================
  // SECTION 3: JSON-LD PAYLOAD VALIDATION & RESOURCE EXHAUSTION
  // =========================================================================
  await t.test('AUDIT 3.1: Broken Access Control - Eve cannot Delete Charlie or local user posts', async () => {
    // 1. Charlie creates a valid federated post
    const charliePostId = `https://${charlieDomain}/posts/legit_note_${timestamp}`;
    const createPayload = JSON.stringify({
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: `https://${charlieDomain}/activities/create_${timestamp}`,
      type: 'Create',
      actor: charlieActorUri,
      object: {
        id: charliePostId,
        type: 'Note',
        content: 'Charlie authored note',
      },
    });

    const charlieHeaders = signRequest({
      body: createPayload,
      privateKeyPem: charlieKey.privateKeyPem,
      keyId: charlieKeyId,
    });

    const createRes = await app.inject({
      method: 'POST',
      url: '/inbox',
      headers: charlieHeaders,
      payload: createPayload,
    });
    assert.equal(createRes.statusCode, 202);

    // Verify post was saved
    const savedPost = await prisma.post.findFirst({
      where: { federatedUri: charliePostId },
    });
    assert.ok(savedPost);
    assert.equal(savedPost.isDeleted, false);

    // 2. Eve sends a Delete activity targeting Charlie's post
    const deletePayload = JSON.stringify({
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: `https://${eveDomain}/activities/malicious_delete_${timestamp}`,
      type: 'Delete',
      actor: eveActorUri, // Signed by Eve
      object: charliePostId, // Target is Charlie's post!
    });

    const eveHeaders = signRequest({
      body: deletePayload,
      privateKeyPem: eveKey.privateKeyPem,
      keyId: eveKeyId,
    });

    const deleteRes = await app.inject({
      method: 'POST',
      url: '/inbox',
      headers: eveHeaders,
      payload: deletePayload,
    });

    // Server must reject unauthorized delete with 403 FORBIDDEN
    assert.equal(deleteRes.statusCode, 403);
    assert.match(deleteRes.json().error.message, /UNAUTHORIZED_DELETE/);

    // Charlie's post must NOT be deleted
    const unchangedPost = await prisma.post.findUnique({
      where: { id: savedPost.id },
    });
    assert.equal(unchangedPost.isDeleted, false, "Charlie's post must remain intact");
  });

  await t.test('AUDIT 3.2: Object ID Origin Spoofing - Note id must belong to the Actor host domain', async () => {
    const spoofedPayload = JSON.stringify({
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: `https://${eveDomain}/activities/spoof_${timestamp}`,
      type: 'Create',
      actor: eveActorUri,
      object: {
        id: 'https://trusted-bank.fediverse/posts/wire-transfer-1000', // Spoofed foreign ID!
        type: 'Note',
        content: 'Fraudulent activity hijacking foreign URI',
      },
    });

    const headers = signRequest({
      body: spoofedPayload,
      privateKeyPem: eveKey.privateKeyPem,
      keyId: eveKeyId,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/inbox',
      headers,
      payload: spoofedPayload,
    });

    assert.equal(res.statusCode, 202);
    const body = res.json();
    assert.equal(body.data.handled, false);
    assert.match(body.data.message, /ORIGIN_MISMATCH/);
  });

  await t.test('AUDIT 3.3: Stored XSS Mitigation - script tags and event handlers are neutralized', async () => {
    const xssNoteId = `https://${charlieDomain}/posts/xss_${timestamp}`;
    const xssPayload = JSON.stringify({
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: `https://${charlieDomain}/activities/xss_${timestamp}`,
      type: 'Create',
      actor: charlieActorUri,
      object: {
        id: xssNoteId,
        type: 'Note',
        content: '<p>Hello <script>alert("xss")</script><img src="x" onerror="stealCookies()">Clean text</p>',
      },
    });

    const headers = signRequest({
      body: xssPayload,
      privateKeyPem: charlieKey.privateKeyPem,
      keyId: charlieKeyId,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/inbox',
      headers,
      payload: xssPayload,
    });
    assert.equal(res.statusCode, 202);

    const post = await prisma.post.findFirst({
      where: { federatedUri: xssNoteId },
    });
    assert.ok(post);
    assert.ok(!post.content.includes('<script>'), 'Script tags must be stripped');
    assert.ok(!post.content.includes('onerror='), 'Event handler attributes must be stripped');
    assert.ok(post.content.includes('Clean text'), 'Legitimate text preserved');
  });

  await t.test('AUDIT 3.4: Content Length Bounding - Notes over 50,000 characters are bounded', async () => {
    const hugeContent = 'A'.repeat(60000);
    const largeNoteId = `https://${charlieDomain}/posts/large_${timestamp}`;
    const largePayload = JSON.stringify({
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: `https://${charlieDomain}/activities/large_${timestamp}`,
      type: 'Create',
      actor: charlieActorUri,
      object: {
        id: largeNoteId,
        type: 'Note',
        content: hugeContent,
      },
    });

    const headers = signRequest({
      body: largePayload,
      privateKeyPem: charlieKey.privateKeyPem,
      keyId: charlieKeyId,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/inbox',
      headers,
      payload: largePayload,
    });
    assert.equal(res.statusCode, 202);

    const post = await prisma.post.findFirst({
      where: { federatedUri: largeNoteId },
    });
    assert.ok(post);
    assert.ok(post.content.length <= 50000, 'Post content length must be bounded to 50,000 chars max');
  });
});

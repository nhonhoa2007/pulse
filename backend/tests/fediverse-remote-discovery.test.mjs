import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { prisma } from '../src/db/PrismaClientSingleton.ts';
import { buildApp } from '../src/app.ts';
import { activityPubKeyManagerService } from '../src/modules/federation/ActivityPubKeyManagerService.ts';
import { resolveRemoteActorService } from '../src/modules/federation/ResolveRemoteActorService.ts';
import { ssrfProtectionGuardService } from '../src/modules/federation/SsrfProtectionGuardService.ts';

test('TASK-19: Federated Remote Discovery Suite (WebFinger, Actor Resolution, Cache & SSRF Defense)', async (t) => {
  process.env.NODE_ENV = 'test';
  process.env.ALLOW_HTTP_FEDERATION = 'true';

  const app = await buildApp();
  await app.ready();

  const timestamp = Date.now();

  // Generate a mock RSA keypair for remote instance
  const mockKeyPair = activityPubKeyManagerService.generateRsa2048KeyPair();

  // Track mock server hits to verify caching behavior
  let mockServerHitCount = 0;
  let lastRequestedPath = '';

  // Setup mock remote HTTP server simulating a Mastodon/Fediverse instance
  const mockServer = http.createServer((req, res) => {
    mockServerHitCount++;
    lastRequestedPath = req.url || '';

    const parsedUrl = new URL(req.url, `http://127.0.0.1:${mockPort}`);

    // 1. WebFinger discovery endpoint
    if (parsedUrl.pathname === '/.well-known/webfinger') {
      const resource = parsedUrl.searchParams.get('resource');
      if (
        resource === `acct:alice_remote@127.0.0.1:${mockPort}` ||
        resource === `alice_remote@127.0.0.1:${mockPort}`
      ) {
        res.writeHead(200, {
          'Content-Type': 'application/jrd+json; charset=utf-8',
        });
        res.end(
          JSON.stringify({
            subject: `acct:alice_remote@127.0.0.1:${mockPort}`,
            aliases: [`http://127.0.0.1:${mockPort}/users/alice_remote`],
            links: [
              {
                rel: 'http://webfinger.net/rel/profile-page',
                type: 'text/html',
                href: `http://127.0.0.1:${mockPort}/@alice_remote`,
              },
              {
                rel: 'self',
                type: 'application/activity+json',
                href: `http://127.0.0.1:${mockPort}/users/alice_remote`,
              },
            ],
          })
        );
        return;
      }

      // Non-existent user on remote instance
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'User not found' }));
      return;
    }

    // 2. ActivityPub Person Actor document endpoint
    if (parsedUrl.pathname === '/users/alice_remote') {
      res.writeHead(200, {
        'Content-Type': 'application/activity+json; charset=utf-8',
      });
      res.end(
        JSON.stringify({
          '@context': [
            'https://www.w3.org/ns/activitystreams',
            'https://w3id.org/security/v1',
          ],
          id: `http://127.0.0.1:${mockPort}/users/alice_remote`,
          type: 'Person',
          preferredUsername: 'alice_remote',
          name: 'Alice In Fediverse',
          summary:
            '<p>Exploring decentralized networks & WebFinger <script>alert("XSS")</script></p>',
          icon: {
            type: 'Image',
            url: `http://127.0.0.1:${mockPort}/avatars/alice.png`,
          },
          inbox: `http://127.0.0.1:${mockPort}/users/alice_remote/inbox`,
          sharedInbox: `http://127.0.0.1:${mockPort}/inbox`,
          publicKey: {
            id: `http://127.0.0.1:${mockPort}/users/alice_remote#main-key`,
            owner: `http://127.0.0.1:${mockPort}/users/alice_remote`,
            publicKeyPem: mockKeyPair.publicKeyPem,
          },
        })
      );
      return;
    }

    res.writeHead(404);
    res.end();
  });

  await new Promise((resolve) => mockServer.listen(0, '127.0.0.1', resolve));
  const mockPort = mockServer.address().port;
  const remoteDomain = `127.0.0.1:${mockPort}`;
  const remoteActorUri = `http://${remoteDomain}/users/alice_remote`;

  // Helper local user for follow status checks
  const localUser = await prisma.user.create({
    data: {
      username: `local_discoverer_${timestamp}`,
      email: `local_discoverer_${timestamp}@pulse.social`,
      displayName: 'Local Discoverer',
    },
  });

  try {
    // -------------------------------------------------------------------------
    // 1. WebFinger & Remote Actor Resolution via ResolveRemoteActorService
    // -------------------------------------------------------------------------
    await t.test('1a. resolves remote fediverse handle @user@domain and creates shadow User and FederatedActor', async () => {
      const handle = `@alice_remote@${remoteDomain}`;
      const initialHits = mockServerHitCount;

      const result = await resolveRemoteActorService.resolveActor(
        handle,
        localUser.id,
        { allowPrivateForTesting: true }
      );

      // Server should have received 2 requests: 1 WebFinger + 1 Actor JSON-LD
      assert.equal(mockServerHitCount >= initialHits + 2, true);

      // Verify returned data structure
      assert.ok(result.user, 'Result must contain user object');
      assert.ok(result.actor, 'Result must contain actor object');
      assert.equal(result.user.isRemote, true);
      assert.equal(result.user.displayName, 'Alice In Fediverse');
      assert.equal(result.user.domain, remoteDomain);
      assert.equal(result.user.actorUri, remoteActorUri);
      assert.equal(result.user.isFollowing, false);
      assert.equal(result.actor.uri, remoteActorUri);
      assert.equal(result.actor.username, 'alice_remote');
      assert.equal(result.actor.domain, remoteDomain);
      assert.equal(result.actor.inboxUrl, `http://${remoteDomain}/users/alice_remote/inbox`);
      assert.equal(result.actor.sharedInboxUrl, `http://${remoteDomain}/inbox`);

      // Verify XSS neutralization in bio
      assert.equal(result.user.bio.includes('<script>'), false);
      assert.equal(result.user.bio.includes('</script>'), false);

      // Verify database records in PostgreSQL
      const dbActor = await prisma.federatedActor.findUnique({
        where: { uri: remoteActorUri },
        include: { shadowUser: true },
      });
      assert.ok(dbActor, 'FederatedActor must be persisted in database');
      assert.equal(dbActor.username, 'alice_remote');
      assert.equal(dbActor.domain, remoteDomain);
      assert.ok(dbActor.shadowUser, 'Shadow user must be associated with FederatedActor');
      assert.equal(dbActor.shadowUser.isRemote, true);
      assert.equal(dbActor.shadowUser.displayName, 'Alice In Fediverse');
      assert.equal(dbActor.shadowUser.avatarUrl, `http://${remoteDomain}/avatars/alice.png`);
    });

    // -------------------------------------------------------------------------
    // 2. Database Cache Lookup Optimization
    // -------------------------------------------------------------------------
    await t.test('2a. subsequent lookups of the same handle return from DB cache without making HTTP calls', async () => {
      const handle = `@alice_remote@${remoteDomain}`;
      const hitsBefore = mockServerHitCount;

      const cachedResult = await resolveRemoteActorService.resolveActor(
        handle,
        localUser.id,
        { allowPrivateForTesting: true }
      );

      // Verify no additional HTTP requests were made to remote instance
      assert.equal(
        mockServerHitCount,
        hitsBefore,
        'Database cache must serve the actor without making remote HTTP calls'
      );
      assert.equal(cachedResult.user.actorUri, remoteActorUri);
      assert.equal(cachedResult.user.displayName, 'Alice In Fediverse');
      assert.equal(cachedResult.user.isRemote, true);
    });

    await t.test('2b. resolves direct Actor URL (https://domain/users/username) using DB cache', async () => {
      const hitsBefore = mockServerHitCount;

      const result = await resolveRemoteActorService.resolveActor(
        remoteActorUri,
        localUser.id,
        { allowPrivateForTesting: true }
      );

      assert.equal(mockServerHitCount, hitsBefore);
      assert.equal(result.user.actorUri, remoteActorUri);
      assert.equal(result.actor.uri, remoteActorUri);
    });

    // -------------------------------------------------------------------------
    // 3. SSRF Guard Protection
    // -------------------------------------------------------------------------
    await t.test('3a. SSRF Guard strictly blocks AWS/GCP/Azure Cloud Metadata endpoints under all conditions', async () => {
      const metadataHandles = [
        '@attacker@169.254.169.254',
        '@attacker@metadata.google.internal',
        '@attacker@metadata.internal',
        '@attacker@169.254.170.2',
      ];

      for (const h of metadataHandles) {
        await assert.rejects(
          async () => {
            await resolveRemoteActorService.resolveActor(h, null);
          },
          (err) => {
            assert.equal(err.code, 'SSRF_GUARD_BLOCKED');
            return true;
          }
        );
      }
    });

    await t.test('3b. SSRF Guard rejects RFC 1918 private IPs, loopback, and forbidden ports when allowPrivateForTesting=false', async () => {
      const dangerousTargets = [
        'http://127.0.0.1:8080',
        'http://10.0.0.1:443',
        'http://192.168.1.1:80',
        'http://172.16.0.1:443',
        'http://100.64.0.1:80',
        'http://localhost:5432',
      ];

      for (const target of dangerousTargets) {
        const check = await ssrfProtectionGuardService.isSafeUrl(target, {
          allowPrivateForTesting: false,
        });
        assert.equal(check.safe, false, `Expected ${target} to be blocked by SSRF guard`);
        assert.ok(
          check.error.includes('SSRF_BLOCKED') ||
            check.error.includes('FORBIDDEN_PORT') ||
            check.error.includes('INSECURE_PROTOCOL')
        );
      }
    });

    await t.test('3c. SSRF Guard blocks non-HTTP/HTTPS protocols and invalid port numbers', async () => {
      const invalidProtocols = [
        'gopher://127.0.0.1:70/search',
        'file:///etc/passwd',
        'ftp://anonymous@ftp.example.org',
      ];

      for (const uri of invalidProtocols) {
        const check = await ssrfProtectionGuardService.isSafeUrl(uri);
        assert.equal(check.safe, false);
        assert.ok(check.error.includes('UNSUPPORTED_PROTOCOL'));
      }
    });

    // -------------------------------------------------------------------------
    // 4. REST Endpoint: POST /api/v1/federation/resolve
    // -------------------------------------------------------------------------
    await t.test('4a. POST /api/v1/federation/resolve succeeds with 200 for valid remote handle', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/federation/resolve',
        payload: {
          handle: `@alice_remote@${remoteDomain}`,
        },
      });

      assert.equal(res.statusCode, 200);
      const body = res.json();
      assert.equal(body.success, true);
      assert.ok(body.data?.user);
      assert.ok(body.data?.actor);
      assert.equal(body.data.user.actorUri, remoteActorUri);
      assert.equal(body.data.user.displayName, 'Alice In Fediverse');
    });

    await t.test('4b. POST /api/v1/federation/resolve rejects missing or empty handle with 400 INVALID_HANDLE', async () => {
      const emptyPayloads = [{}, { handle: '' }, { handle: '   ' }, { handle: null }];

      for (const payload of emptyPayloads) {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/federation/resolve',
          payload,
        });

        assert.equal(res.statusCode, 400);
        const body = res.json();
        assert.equal(body.success, false);
        assert.equal(body.error?.code, 'INVALID_HANDLE');
      }
    });

    await t.test('4c. POST /api/v1/federation/resolve returns 404 REMOTE_ACTOR_NOT_FOUND for non-existent remote actor', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/federation/resolve',
        payload: {
          handle: `@unknown_user_999@${remoteDomain}`,
        },
      });

      assert.equal(res.statusCode, 404);
      const body = res.json();
      assert.equal(body.success, false);
      assert.equal(body.error?.code, 'REMOTE_ACTOR_NOT_FOUND');
    });

    await t.test('4d. POST /api/v1/federation/resolve rejects cloud metadata SSRF attempts with 400 SSRF_GUARD_BLOCKED', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/federation/resolve',
        payload: {
          handle: '@attacker@169.254.169.254',
        },
      });

      assert.equal(res.statusCode, 400);
      const body = res.json();
      assert.equal(body.success, false);
      assert.equal(body.error?.code, 'SSRF_GUARD_BLOCKED');
    });

    await t.test('4e. POST /api/v1/federation/resolve gracefully resolves local user handles without remote fetch', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/federation/resolve',
        payload: {
          handle: `@${localUser.username}`,
        },
      });

      assert.equal(res.statusCode, 200);
      const body = res.json();
      assert.equal(body.success, true);
      assert.equal(body.data.user.id, localUser.id);
      assert.equal(body.data.user.isRemote, false);
    });

    // -------------------------------------------------------------------------
    // 5. Search Integration: GET /api/v1/search?q=@user@domain
    // -------------------------------------------------------------------------
    await t.test('5a. GET /api/v1/search?q=@user@domain populates federatedResult in unified search', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/search?q=${encodeURIComponent(`@alice_remote@${remoteDomain}`)}`,
      });

      assert.equal(res.statusCode, 200);
      const body = res.json();
      assert.ok(body.data);
      assert.ok(body.data.federatedResult, 'federatedResult must be populated in search response');
      assert.equal(body.data.federatedResult.actorUri, remoteActorUri);
      assert.equal(body.data.federatedResult.username, 'alice_remote');
      assert.equal(body.data.federatedResult.displayName, 'Alice In Fediverse');
      assert.equal(body.data.federatedResult.domain, remoteDomain);
      assert.equal(body.data.federatedResult.isRemote, true);
    });

    await t.test('5b. GET /api/v1/search with normal keyword query returns federatedResult: null', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/search?q=decentralized+systems',
      });

      assert.equal(res.statusCode, 200);
      const body = res.json();
      assert.equal(body.data?.federatedResult, null);
    });

    await t.test('5c. GET /api/v1/search handles non-existent remote handle gracefully with federatedResult: null and no 500 error', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/search?q=${encodeURIComponent(`@nonexistent_user@${remoteDomain}`)}`,
      });

      assert.equal(res.statusCode, 200);
      const body = res.json();
      assert.equal(body.data?.federatedResult, null);
    });
  } finally {
    // Teardown mock server and database entities
    await new Promise((resolve) => mockServer.close(resolve));

    const shadow = await prisma.user.findFirst({
      where: { federatedActor: { uri: remoteActorUri } },
    });
    if (shadow) {
      await prisma.user.delete({ where: { id: shadow.id } });
    }

    await prisma.federatedActor.deleteMany({
      where: { uri: remoteActorUri },
    });

    await prisma.user.deleteMany({
      where: { id: localUser.id },
    });
  }
});

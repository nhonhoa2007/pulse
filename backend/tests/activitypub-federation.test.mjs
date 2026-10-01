import { authHeaders } from './helpers/auth.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import { prisma } from '../src/db/PrismaClientSingleton.ts';
import { buildApp } from '../src/app.ts';
import { ssrfProtectionGuardService } from '../src/modules/federation/SsrfProtectionGuardService.ts';
import { activityPubKeyManagerService } from '../src/modules/federation/ActivityPubKeyManagerService.ts';
import { httpSignatureSignerService } from '../src/modules/federation/HttpSignatureSignerService.ts';
import { httpSignatureVerifierService } from '../src/modules/federation/HttpSignatureVerifierService.ts';
import { activityDeliveryWorkerService } from '../src/modules/federation/ActivityDeliveryWorkerService.ts';
import { resolveWebFingerQueryService } from '../src/modules/federation/ResolveWebFingerQueryService.ts';
import { processInboundActivityService } from '../src/modules/federation/ProcessInboundActivityService.ts';

test('ActivityPub & Fediverse Comprehensive Suite: WebFinger, Dual Actor, HTTP Signatures, SSRF Guard, Outbox Retries, and E2E Flows', async (t) => {
  process.env.NODE_ENV = 'test';
  process.env.ALLOW_HTTP_FEDERATION = 'true';

  const app = await buildApp();
  await app.ready();

  const timestamp = Date.now();
  const testDomain = 'localhost:3001';

  // Clean up any stale delivery jobs from previous test runs to prevent ECONNREFUSED on dead mock ports
  await prisma.activityDeliveryJob.deleteMany({});

  // -------------------------------------------------------------
  // Test Data Setup: Local Users
  // -------------------------------------------------------------
  const alice = await prisma.user.create({
    data: {
      username: `alice_fed_${timestamp}`,
      email: `alice_fed_${timestamp}@test.pulse.social`,
      displayName: 'Alice Fediverse',
      bio: 'Fediverse explorer on Pulse Social',
    },
  });

  const bob = await prisma.user.create({
    data: {
      username: `bob_fed_${timestamp}`,
      email: `bob_fed_${timestamp}@test.pulse.social`,
      displayName: 'Bob Fediverse',
    },
  });

  const dave = await prisma.user.create({
    data: {
      username: `dave_fed_${timestamp}`,
      email: `dave_fed_${timestamp}@test.pulse.social`,
      displayName: 'Dave Fediverse (Non-follower)',
    },
  });

  // Mock remote actor credentials (Mastodon / Threads instance)
  const remoteKeyPair = activityPubKeyManagerService.generateRsa2048KeyPair();
  const remoteDomain = 'mastodon.mock';
  const remoteUsername = `charlie_${timestamp}`;
  const remoteActorUri = `https://${remoteDomain}/users/${remoteUsername}`;
  const remoteKeyId = `${remoteActorUri}#main-key`;
  const remoteInboxUrl = `https://${remoteDomain}/users/${remoteUsername}/inbox`;
  const remoteSharedInboxUrl = `https://${remoteDomain}/inbox`;

  // Pre-seed remote actor in DB to simulate cached Fediverse actor
  const remoteActor = await prisma.federatedActor.create({
    data: {
      uri: remoteActorUri,
      username: remoteUsername,
      domain: remoteDomain,
      name: 'Charlie Mastodon',
      inboxUrl: remoteInboxUrl,
      sharedInboxUrl: remoteSharedInboxUrl,
      publicKeyPem: remoteKeyPair.publicKeyPem,
      publicKeyId: remoteKeyId,
    },
  });

  // Helper to generate signed headers for mock remote requests
  function signMockInboundRequest({
    method = 'POST',
    path = '/inbox',
    body = '',
    date = new Date().toUTCString(),
    privateKeyPem = remoteKeyPair.privateKeyPem,
    keyId = remoteKeyId,
    host = testDomain,
    tamperSignature = false,
    headersList = ['(request-target)', 'host', 'date', 'digest'],
    omitDigestHeader = false,
    customDigest = null,
    customSignatureHeader = null,
    useAuthHeader = false,
  }) {
    let digestHeader = '';
    if (!omitDigestHeader) {
      if (customDigest !== null) {
        digestHeader = customDigest;
      } else {
        const rawBodyBuffer = Buffer.from(body, 'utf-8');
        const digestBase64 = crypto.createHash('sha256').update(rawBodyBuffer).digest('base64');
        digestHeader = `SHA-256=${digestBase64}`;
      }
    }

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

    let signatureBase64 = '';
    if (tamperSignature) {
      signatureBase64 = Buffer.from('corrupted_signature_payload_bytes').toString('base64');
    } else {
      const signer = crypto.createSign('RSA-SHA256');
      signer.update(signingString);
      signatureBase64 = signer.sign(privateKeyPem, 'base64');
    }

    const signatureValue =
      customSignatureHeader !== null
        ? customSignatureHeader
        : `keyId="${keyId}",algorithm="rsa-sha256",headers="${headersList.join(' ')}",signature="${signatureBase64}"`;

    const headers = {
      Host: host,
      'Content-Type': 'application/activity+json',
      Accept: 'application/activity+json',
    };

    if (date !== null) {
      headers['Date'] = date;
    }

    if (!omitDigestHeader && digestHeader) {
      headers['Digest'] = digestHeader;
    }

    if (useAuthHeader) {
      headers['Authorization'] = `Signature ${signatureValue}`;
    } else if (signatureValue !== null) {
      headers['Signature'] = signatureValue;
    }

    return headers;
  }

  // =========================================================================
  // 1. WEBFINGER DISCOVERY & ERROR CASES (RFC 7033)
  // =========================================================================
  await t.test('1a. WebFinger: resolves fediverse handle acct:username@domain (RFC 7033)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/.well-known/webfinger?resource=acct:${alice.username}@${testDomain}`,
      headers: { host: testDomain },
    });

    assert.equal(res.statusCode, 200);
    assert.match(res.headers['content-type'], /application\/jrd\+json/);
    assert.equal(res.headers['access-control-allow-origin'], '*');
    assert.match(res.headers['cache-control'], /max-age=3600/);

    const body = res.json();
    assert.equal(body.subject, `acct:${alice.username}@${testDomain}`);
    assert.ok(Array.isArray(body.aliases));
    assert.ok(body.aliases.some((a) => a.includes(`/@${alice.username}`)));

    const selfLink = body.links.find((l) => l.rel === 'self');
    assert.ok(selfLink, 'Link with rel=self must exist');
    assert.equal(selfLink.type, 'application/activity+json');
    assert.ok(selfLink.href.includes(`/users/${alice.username}`));

    const profileLink = body.links.find((l) => l.rel === 'http://webfinger.net/rel/profile-page');
    assert.ok(profileLink, 'Link with rel=profile-page must exist');
    assert.equal(profileLink.type, 'text/html');
  });

  await t.test('1b. WebFinger: accepts acct:username without domain, @username@domain, and URL formats', async () => {
    // 1. acct:username without domain
    const resNoDomain = await app.inject({
      method: 'GET',
      url: `/.well-known/webfinger?resource=acct:${alice.username}`,
      headers: { host: testDomain },
    });
    assert.equal(resNoDomain.statusCode, 200);
    assert.equal(resNoDomain.json().subject, `acct:${alice.username}@${testDomain}`);

    // 2. @username@domain format
    const resAtFormat = await app.inject({
      method: 'GET',
      url: `/.well-known/webfinger?resource=@${alice.username}@${testDomain}`,
      headers: { host: testDomain },
    });
    assert.equal(resAtFormat.statusCode, 200);

    // 3. https://domain/users/username URL format
    const resUrlFormat = await app.inject({
      method: 'GET',
      url: `/.well-known/webfinger?resource=http://${testDomain}/users/${alice.username}`,
      headers: { host: testDomain },
    });
    assert.equal(resUrlFormat.statusCode, 200);

    // 4. https://domain/@username format
    const resAtUrlFormat = await app.inject({
      method: 'GET',
      url: `/.well-known/webfinger?resource=http://${testDomain}/@${alice.username}`,
      headers: { host: testDomain },
    });
    assert.equal(resAtUrlFormat.statusCode, 200);

    // 5. Bare username without prefix
    const resBare = await app.inject({
      method: 'GET',
      url: `/.well-known/webfinger?resource=${alice.username}`,
      headers: { host: testDomain },
    });
    assert.equal(resBare.statusCode, 200);
  });

  await t.test('1c. WebFinger: case-insensitive query resolution', async () => {
    const uppercaseResource = `acct:${alice.username.toUpperCase()}@${testDomain}`;
    const res = await app.inject({
      method: 'GET',
      url: `/.well-known/webfinger?resource=${uppercaseResource}`,
      headers: { host: testDomain },
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.json().subject, `acct:${alice.username}@${testDomain}`);
  });

  await t.test('1d. WebFinger: URL-encoded special characters handling', async () => {
    const encodedResource = `acct:${encodeURIComponent(alice.username)}@${testDomain}`;
    const res = await app.inject({
      method: 'GET',
      url: `/.well-known/webfinger?resource=${encodedResource}`,
      headers: { host: testDomain },
    });
    assert.equal(res.statusCode, 200);
  });

  await t.test('1e. WebFinger: rejects remote Fediverse shadow users (isRemote: false invariant)', async () => {
    // Create a shadow remote user
    const shadowUser = await prisma.user.create({
      data: {
        username: `shadow_user_${timestamp}`,
        email: `shadow_${timestamp}@remote.test`,
        displayName: 'Remote Shadow',
        isRemote: true,
        federatedActorId: remoteActor.id,
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/.well-known/webfinger?resource=acct:${shadowUser.username}@${testDomain}`,
      headers: { host: testDomain },
    });

    assert.equal(res.statusCode, 404, 'Shadow remote users must NOT be exposed via WebFinger');
    assert.equal(res.json().error.code, 'USER_NOT_FOUND');
  });

  await t.test('1f. WebFinger: comprehensive error handling (missing, empty, whitespace, malformed, mismatch)', async () => {
    // 1. Missing resource parameter
    const resMissing = await app.inject({
      method: 'GET',
      url: '/.well-known/webfinger',
      headers: { host: testDomain },
    });
    assert.equal(resMissing.statusCode, 400);
    assert.equal(resMissing.json().error.code, 'MISSING_RESOURCE');

    // 2. Empty string resource
    const resEmpty = await app.inject({
      method: 'GET',
      url: '/.well-known/webfinger?resource=',
      headers: { host: testDomain },
    });
    assert.equal(resEmpty.statusCode, 400);
    assert.equal(resEmpty.json().error.code, 'MISSING_RESOURCE');

    // 3. Whitespace-only resource
    const resWhitespace = await app.inject({
      method: 'GET',
      url: '/.well-known/webfinger?resource=%20%20%20',
      headers: { host: testDomain },
    });
    assert.equal(resWhitespace.statusCode, 400);
    assert.equal(resWhitespace.json().error.code, 'MISSING_RESOURCE');

    // 4. Nonexistent user
    const resNonExistent = await app.inject({
      method: 'GET',
      url: `/.well-known/webfinger?resource=acct:ghost_phantom_${timestamp}@${testDomain}`,
      headers: { host: testDomain },
    });
    assert.equal(resNonExistent.statusCode, 404);
    assert.equal(resNonExistent.json().error.code, 'USER_NOT_FOUND');

    // 5. Foreign domain mismatch
    const resMismatch = await app.inject({
      method: 'GET',
      url: `/.well-known/webfinger?resource=acct:${alice.username}@threads.net`,
      headers: { host: testDomain },
    });
    assert.equal(resMismatch.statusCode, 404);
    assert.equal(resMismatch.json().error.code, 'DOMAIN_MISMATCH');
  });

  await t.test('1g. WebFinger: CORS and caching headers on discovery endpoints', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/.well-known/webfinger?resource=acct:${alice.username}@${testDomain}`,
      headers: { host: testDomain },
    });

    assert.equal(res.headers['access-control-allow-origin'], '*');
    assert.match(res.headers['access-control-allow-methods'], /GET/);
    assert.match(res.headers['cache-control'], /max-age=3600/);
    assert.match(res.headers['content-type'], /application\/jrd\+json/);
  });

  // =========================================================================
  // 2. DUAL ACTOR PROFILE ENDPOINTS
  // =========================================================================
  await t.test('2a. Actor: GET /actor returns Instance Actor (Application) with publicKey', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/actor',
      headers: { host: testDomain },
    });

    assert.equal(res.statusCode, 200);
    assert.match(res.headers['content-type'], /application\/activity\+json/);

    const body = res.json();
    assert.equal(body.type, 'Application');
    assert.ok(body.id.endsWith('/actor'));
    assert.ok(body.inbox.endsWith('/inbox'));
    assert.ok(body.outbox.endsWith('/actor/outbox'));
    assert.ok(body.publicKey, 'Instance Actor must provide publicKey');
    assert.ok(body.publicKey.id.endsWith('/actor#main-key'));
    assert.ok(body.publicKey.publicKeyPem.includes('BEGIN PUBLIC KEY'));
  });

  await t.test('2b. Actor: GET /users/:username with ActivityPub Accept header returns Person JSON-LD', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/users/${alice.username}`,
      headers: {
        host: testDomain,
        Accept: 'application/activity+json',
      },
    });

    assert.equal(res.statusCode, 200);
    assert.match(res.headers['content-type'], /application\/activity\+json/);

    const body = res.json();
    assert.equal(body.type, 'Person');
    assert.equal(body.preferredUsername, alice.username);
    assert.equal(body.name, alice.displayName);
    assert.ok(body.inbox.includes(`/users/${alice.username}/inbox`));
    assert.ok(body.outbox.includes(`/users/${alice.username}/outbox`));
    assert.ok(body.sharedInbox.endsWith('/inbox'));
    assert.ok(body.endpoints?.sharedInbox.endsWith('/inbox'));
    assert.ok(body.publicKey, 'User Actor must have publicKey');
    assert.ok(body.publicKey.publicKeyPem.includes('BEGIN PUBLIC KEY'));
  });

  await t.test('2c. Actor: GET /users/:username content negotiation (REST profile when Accept is not activity+json)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/users/${alice.username}`,
      headers: {
        host: testDomain,
        Accept: 'application/json',
      },
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.username, alice.username);
    assert.equal(body.data.displayName, alice.displayName);
  });

  // =========================================================================
  // 3. SSRF PROTECTION & HTTP SIGNATURE SECURITY
  // =========================================================================
  await t.test('3a. SSRF Guard: blocks RFC 1918, Loopback, Link-Local, and AWS Metadata', async () => {
    assert.equal(ssrfProtectionGuardService.isPrivateIp('127.0.0.1'), true, 'Loopback 127.0.0.1');
    assert.equal(ssrfProtectionGuardService.isPrivateIp('10.0.0.1'), true, 'RFC 1918 10.0.0.1');
    assert.equal(ssrfProtectionGuardService.isPrivateIp('172.16.0.1'), true, 'RFC 1918 172.16.0.1');
    assert.equal(ssrfProtectionGuardService.isPrivateIp('192.168.1.1'), true, 'RFC 1918 192.168.1.1');
    assert.equal(ssrfProtectionGuardService.isPrivateIp('169.254.169.254'), true, 'AWS Metadata 169.254.169.254');
    assert.equal(ssrfProtectionGuardService.isPrivateIp('::1'), true, 'IPv6 Loopback ::1');

    // Safe public IPs
    assert.equal(ssrfProtectionGuardService.isPrivateIp('8.8.8.8'), false, 'Public IP 8.8.8.8');
    assert.equal(ssrfProtectionGuardService.isPrivateIp('1.1.1.1'), false, 'Public IP 1.1.1.1');

    // Strict URL validation rejecting private IPs
    const awsCheck = await ssrfProtectionGuardService.isSafeUrl('http://169.254.169.254/latest/meta-data', {
      allowPrivateForTesting: false,
    });
    assert.equal(awsCheck.safe, false, 'AWS metadata URL must be rejected in strict mode');

    const loopbackCheck = await ssrfProtectionGuardService.isSafeUrl('http://127.0.0.1:3000/inbox', {
      allowPrivateForTesting: false,
    });
    assert.equal(loopbackCheck.safe, false, 'Loopback IP must be rejected in strict mode');
  });

  await t.test('3b. HTTP Signature: rejects requests with missing or tampered signature', async () => {
    const payload = JSON.stringify({
      '@context': 'https://www.w3.org/ns/activitystreams',
      type: 'Follow',
      actor: remoteActorUri,
      object: `http://${testDomain}/users/${alice.username}`,
    });

    // 1. Missing Signature header
    const resNoSig = await app.inject({
      method: 'POST',
      url: '/inbox',
      headers: {
        host: testDomain,
        'content-type': 'application/activity+json',
      },
      payload,
    });
    assert.equal(resNoSig.statusCode, 401);

    // 2. Tampered signature
    const tamperedHeaders = signMockInboundRequest({
      body: payload,
      tamperSignature: true,
    });

    const resTampered = await app.inject({
      method: 'POST',
      url: '/inbox',
      headers: tamperedHeaders,
      payload,
    });
    assert.equal(resTampered.statusCode, 401);
  });

  await t.test('3c. HTTP Signature: rejects requests exceeding 300s clock skew in past and future', async () => {
    const payload = JSON.stringify({
      '@context': 'https://www.w3.org/ns/activitystreams',
      type: 'Follow',
      actor: remoteActorUri,
      object: `http://${testDomain}/users/${alice.username}`,
    });

    // 1. Past: 10 minutes ago (> 300s)
    const stalePastDate = new Date(Date.now() - 600_000).toUTCString();
    const stalePastHeaders = signMockInboundRequest({
      body: payload,
      date: stalePastDate,
    });

    const resPast = await app.inject({
      method: 'POST',
      url: '/inbox',
      headers: stalePastHeaders,
      payload,
    });
    assert.equal(resPast.statusCode, 401);
    assert.match(resPast.json().error.message, /CLOCK_SKEW_EXCEEDED/);

    // 2. Future: 10 minutes in future (> +300s)
    const futureDate = new Date(Date.now() + 600_000).toUTCString();
    const futureHeaders = signMockInboundRequest({
      body: payload,
      date: futureDate,
    });

    const resFuture = await app.inject({
      method: 'POST',
      url: '/inbox',
      headers: futureHeaders,
      payload,
    });
    assert.equal(resFuture.statusCode, 401);
    assert.match(resFuture.json().error.message, /(CLOCK_SKEW_EXCEEDED|FUTURE_DATE_EXCEEDED)/);
  });

  await t.test('3d. HTTP Signature: rejects requests with missing or invalid Date header', async () => {
    const payload = JSON.stringify({
      '@context': 'https://www.w3.org/ns/activitystreams',
      type: 'Follow',
      actor: remoteActorUri,
      object: `http://${testDomain}/users/${alice.username}`,
    });

    // 1. Missing Date header
    const headersNoDate = signMockInboundRequest({
      body: payload,
      date: null,
    });
    delete headersNoDate['Date'];

    const resNoDate = await app.inject({
      method: 'POST',
      url: '/inbox',
      headers: headersNoDate,
      payload,
    });
    assert.equal(resNoDate.statusCode, 401);
    assert.match(resNoDate.json().error.message, /MISSING_DATE_HEADER/);

    // 2. Invalid Date header
    const headersInvalidDate = signMockInboundRequest({
      body: payload,
      date: 'not_a_valid_date_at_all',
    });
    headersInvalidDate['Date'] = 'not_a_valid_date_at_all';

    const resInvalidDate = await app.inject({
      method: 'POST',
      url: '/inbox',
      headers: headersInvalidDate,
      payload,
    });
    assert.equal(resInvalidDate.statusCode, 401);
    assert.match(resInvalidDate.json().error.message, /INVALID_DATE_HEADER/);
  });

  await t.test('3e. HTTP Signature: Digest verification (missing, wrong algorithm, tampered payload)', async () => {
    const originalPayload = JSON.stringify({
      '@context': 'https://www.w3.org/ns/activitystreams',
      type: 'Follow',
      actor: remoteActorUri,
      object: `http://${testDomain}/users/${alice.username}`,
    });

    // 1. Missing Digest header on POST
    const headersNoDigest = signMockInboundRequest({
      body: originalPayload,
      omitDigestHeader: true,
      headersList: ['(request-target)', 'host', 'date'],
    });

    const resNoDigest = await app.inject({
      method: 'POST',
      url: '/inbox',
      headers: headersNoDigest,
      payload: originalPayload,
    });
    assert.equal(resNoDigest.statusCode, 401);
    assert.match(resNoDigest.json().error.message, /MISSING_DIGEST_HEADER/);

    // 2. Unsupported Digest algorithm (e.g. MD5)
    const headersMd5 = signMockInboundRequest({
      body: originalPayload,
      customDigest: 'MD5=1b2m2Y8AsgTpgAmY7PhCfg==',
      headersList: ['(request-target)', 'host', 'date', 'digest'],
    });

    const resMd5 = await app.inject({
      method: 'POST',
      url: '/inbox',
      headers: headersMd5,
      payload: originalPayload,
    });
    assert.equal(resMd5.statusCode, 401);
    assert.match(resMd5.json().error.message, /UNSUPPORTED_DIGEST_ALGORITHM/);

    // 3. Tampered payload / Digest mismatch
    const validHeaders = signMockInboundRequest({
      body: originalPayload,
    });
    const tamperedPayload = JSON.stringify({
      '@context': 'https://www.w3.org/ns/activitystreams',
      type: 'Follow',
      actor: remoteActorUri,
      object: `http://${testDomain}/users/${bob.username}`, // Altered destination
    });

    const resMismatch = await app.inject({
      method: 'POST',
      url: '/inbox',
      headers: validHeaders,
      payload: tamperedPayload,
    });
    assert.equal(resMismatch.statusCode, 401);
    assert.match(resMismatch.json().error.message, /DIGEST_MISMATCH/);
  });

  await t.test('3f. HTTP Signature: malformed header syntax rejection', async () => {
    const payload = JSON.stringify({
      '@context': 'https://www.w3.org/ns/activitystreams',
      type: 'Follow',
      actor: remoteActorUri,
      object: `http://${testDomain}/users/${alice.username}`,
    });

    // 1. Missing keyId in Signature
    const headersNoKeyId = signMockInboundRequest({
      body: payload,
      customSignatureHeader: 'algorithm="rsa-sha256",headers="(request-target) host date digest",signature="AAAA"',
    });
    const resNoKeyId = await app.inject({
      method: 'POST',
      url: '/inbox',
      headers: headersNoKeyId,
      payload,
    });
    assert.equal(resNoKeyId.statusCode, 401);
    assert.match(resNoKeyId.json().error.message, /MALFORMED_SIGNATURE_HEADER/);

    // 2. Missing signature parameter
    const headersNoSig = signMockInboundRequest({
      body: payload,
      customSignatureHeader: `keyId="${remoteKeyId}",algorithm="rsa-sha256",headers="(request-target) host date digest"`,
    });
    const resNoSig = await app.inject({
      method: 'POST',
      url: '/inbox',
      headers: headersNoSig,
      payload,
    });
    assert.equal(resNoSig.statusCode, 401);
    assert.match(resNoSig.json().error.message, /MALFORMED_SIGNATURE_HEADER/);
  });

  await t.test('3g. HTTP Signature: rejects when header listed in signature is omitted from request', async () => {
    const payload = JSON.stringify({
      '@context': 'https://www.w3.org/ns/activitystreams',
      type: 'Follow',
      actor: remoteActorUri,
      object: `http://${testDomain}/users/${alice.username}`,
    });

    // List 'x-required-custom' in headersList but do not send it
    const headers = signMockInboundRequest({
      body: payload,
      headersList: ['(request-target)', 'host', 'date', 'digest'],
      customSignatureHeader: `keyId="${remoteKeyId}",algorithm="rsa-sha256",headers="(request-target) host date digest x-required-custom",signature="validformat"`,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/inbox',
      headers,
      payload,
    });
    assert.equal(res.statusCode, 401);
    assert.match(res.json().error.message, /MISSING_HEADER_IN_REQUEST/);
  });

  await t.test('3h. HTTP Signature: prevents replay attacks of identical valid signature within 5 minutes', async () => {
    const payload = JSON.stringify({
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: `https://${remoteDomain}/activities/replay_prevention_${timestamp}`,
      type: 'Follow',
      actor: remoteActorUri,
      object: `http://${testDomain}/users/${bob.username}`,
    });

    const headers = signMockInboundRequest({
      body: payload,
    });

    // First attempt -> succeeds (202)
    const firstRes = await app.inject({
      method: 'POST',
      url: '/inbox',
      headers,
      payload,
    });
    assert.equal(firstRes.statusCode, 202);

    // Replay attempt with exact same signature header -> must be rejected (401)
    const replayRes = await app.inject({
      method: 'POST',
      url: '/inbox',
      headers,
      payload,
    });
    assert.equal(replayRes.statusCode, 401);
    assert.match(replayRes.json().error.message, /REPLAY_ATTACK_DETECTED/);
  });

  await t.test('3i. HTTP Signature: accepts signature in Authorization header (Authorization: Signature ...)', async () => {
    const payload = JSON.stringify({
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: `https://${remoteDomain}/activities/auth_header_test_${timestamp}`,
      type: 'Follow',
      actor: remoteActorUri,
      object: `http://${testDomain}/users/${alice.username}`,
    });

    const headers = signMockInboundRequest({
      body: payload,
      useAuthHeader: true,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/inbox',
      headers,
      payload,
    });
    assert.equal(res.statusCode, 202);
  });

  await t.test('3j. HTTP Signature: cryptographic rejection when signed with wrong keypair', async () => {
    // Generate an unrelated third-party keypair
    const wrongKeyPair = activityPubKeyManagerService.generateRsa2048KeyPair();

    const payload = JSON.stringify({
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: `https://${remoteDomain}/activities/wrong_key_${timestamp}`,
      type: 'Follow',
      actor: remoteActorUri,
      object: `http://${testDomain}/users/${alice.username}`,
    });

    // Sign with wrong private key while claiming remoteKeyId
    const headers = signMockInboundRequest({
      body: payload,
      privateKeyPem: wrongKeyPair.privateKeyPem,
      keyId: remoteKeyId,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/inbox',
      headers,
      payload,
    });
    assert.equal(res.statusCode, 401);
    assert.match(res.json().error.message, /SIGNATURE_INVALID/);
  });

  await t.test('3k. HTTP Signature: dynamic remote actor key resolution via mock HTTP server', async () => {
    // Spin up a mock HTTP server representing an unknown remote instance (e.g. Threads)
    const dynamicKeyPair = activityPubKeyManagerService.generateRsa2048KeyPair();
    let dynamicServerReceivedGet = false;

    const dynamicServer = http.createServer((req, res) => {
      if (req.method === 'GET') {
        dynamicServerReceivedGet = true;
        const actorDoc = {
          '@context': [
            'https://www.w3.org/ns/activitystreams',
            'https://w3id.org/security/v1',
          ],
          id: `http://127.0.0.1:${dynamicPort}/actors/threads_user`,
          type: 'Person',
          preferredUsername: 'threads_user',
          name: 'Dynamic Threads User',
          inbox: `http://127.0.0.1:${dynamicPort}/actors/threads_user/inbox`,
          publicKey: {
            id: `http://127.0.0.1:${dynamicPort}/actors/threads_user#main-key`,
            owner: `http://127.0.0.1:${dynamicPort}/actors/threads_user`,
            publicKeyPem: dynamicKeyPair.publicKeyPem,
          },
        };
        res.writeHead(200, { 'Content-Type': 'application/activity+json' });
        res.end(JSON.stringify(actorDoc));
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    await new Promise((resolve) => dynamicServer.listen(0, '127.0.0.1', resolve));
    const dynamicPort = dynamicServer.address().port;
    const dynamicActorUri = `http://127.0.0.1:${dynamicPort}/actors/threads_user`;
    const dynamicKeyId = `${dynamicActorUri}#main-key`;

    try {
      const payload = JSON.stringify({
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: `http://127.0.0.1:${dynamicPort}/activities/dynamic_follow_${timestamp}`,
        type: 'Follow',
        actor: dynamicActorUri,
        object: `http://${testDomain}/users/${dave.username}`,
      });

      const headers = signMockInboundRequest({
        body: payload,
        privateKeyPem: dynamicKeyPair.privateKeyPem,
        keyId: dynamicKeyId,
      });

      const res = await app.inject({
        method: 'POST',
        url: '/inbox',
        headers,
        payload,
      });

      assert.equal(res.statusCode, 202);
      assert.equal(dynamicServerReceivedGet, true, 'Pulse verifier must have dynamically fetched the remote key');

      // Verify remote actor was saved to DB cache
      const cached = await prisma.federatedActor.findUnique({
        where: { uri: dynamicActorUri },
      });
      assert.ok(cached, 'Dynamic remote actor must be cached in database');
      assert.equal(cached.publicKeyId, dynamicKeyId);
    } finally {
      await new Promise((resolve) => dynamicServer.close(resolve));
    }
  });

  await t.test('3l. HTTP Signature: SSRF guard blocks keyId resolution on dangerous IPs', async () => {
    const prevFederation = process.env.ALLOW_HTTP_FEDERATION;
    const prevNodeEnv = process.env.NODE_ENV;
    process.env.ALLOW_HTTP_FEDERATION = 'false';
    process.env.NODE_ENV = 'production';

    try {
      const payload = JSON.stringify({
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: `http://169.254.169.254/activities/bad_key_${timestamp}`,
        type: 'Follow',
        actor: 'http://169.254.169.254/actor',
        object: `http://${testDomain}/users/${alice.username}`,
      });

      const headers = signMockInboundRequest({
        body: payload,
        keyId: 'http://169.254.169.254/actor#main-key',
      });

      const res = await app.inject({
        method: 'POST',
        url: '/inbox',
        headers,
        payload,
      });

      assert.equal(res.statusCode, 401);
      assert.match(res.json().error.message, /(KEY_RESOLUTION_ERROR|SSRF_BLOCKED|SSRF_GUARD_BLOCKED)/);
    } finally {
      process.env.ALLOW_HTTP_FEDERATION = prevFederation;
      process.env.NODE_ENV = prevNodeEnv;
    }
  });

  // =========================================================================
  // 4. INBOUND ACTIVITY STATE MACHINE & E2E FLOWS
  // =========================================================================
  await t.test('4a. Inbound Follow: creates FederatedFollow, increments followersCount, enqueues Accept, creates Notification', async () => {
    const followActivityId = `https://${remoteDomain}/activities/follow_primary_${timestamp}`;
    const followPayload = JSON.stringify({
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: followActivityId,
      type: 'Follow',
      actor: remoteActorUri,
      object: `http://${testDomain}/users/${alice.username}`,
    });

    const headers = signMockInboundRequest({
      path: `/users/${alice.username}/inbox`,
      body: followPayload,
      date: new Date(Date.now() + 1000).toUTCString(),
    });

    const res = await app.inject({
      method: 'POST',
      url: `/users/${alice.username}/inbox`,
      headers,
      payload: followPayload,
    });

    assert.equal(res.statusCode, 202);
    assert.equal(res.json().success, true);

    // 1. Verify followersCount incremented
    const updatedAlice = await prisma.user.findUnique({ where: { id: alice.id } });
    assert.equal(updatedAlice.followersCount, 1, 'followersCount should be incremented');

    // 2. Verify FederatedFollow record
    const followRecord = await prisma.federatedFollow.findFirst({
      where: {
        localUserId: alice.id,
        remoteActorId: remoteActor.id,
        direction: 'INBOUND',
      },
    });
    assert.ok(followRecord, 'FederatedFollow record must exist');
    assert.equal(followRecord.status, 'ACCEPTED');

    // 3. Verify outbound Accept job queued
    const acceptJob = await prisma.activityDeliveryJob.findFirst({
      where: {
        activityType: 'Accept',
        targetInboxUrl: remoteActor.inboxUrl,
      },
    });
    assert.ok(acceptJob, 'Outbound Accept delivery job must be enqueued');
    assert.equal(acceptJob.status, 'PENDING');

    // 4. Verify Notification created for Alice
    const notification = await prisma.notification.findFirst({
      where: {
        recipientId: alice.id,
        verb: 'FOLLOW',
      },
    });
    assert.ok(notification, 'Notification of FOLLOW must be created for local user');
  });

  await t.test('4b. Inbound Follow: idempotency defense (duplicate follow does not duplicate counters or records)', async () => {
    const followActivityId = `https://${remoteDomain}/activities/follow_duplicate_${timestamp}`;
    const followPayload = JSON.stringify({
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: followActivityId,
      type: 'Follow',
      actor: remoteActorUri,
      object: `http://${testDomain}/users/${alice.username}`,
    });

    const headers = signMockInboundRequest({
      path: `/users/${alice.username}/inbox`,
      body: followPayload,
      date: new Date(Date.now() + 1500).toUTCString(),
    });

    // Send duplicate follow request
    const res = await app.inject({
      method: 'POST',
      url: `/users/${alice.username}/inbox`,
      headers,
      payload: followPayload,
    });
    assert.equal(res.statusCode, 202);

    // Verify followersCount remained 1 (NOT incremented to 2)
    const updatedAlice = await prisma.user.findUnique({ where: { id: alice.id } });
    assert.equal(updatedAlice.followersCount, 1, 'Duplicate follow must not increment followersCount again');

    // Verify exactly 1 follow record exists
    const followCount = await prisma.federatedFollow.count({
      where: {
        localUserId: alice.id,
        remoteActorId: remoteActor.id,
        direction: 'INBOUND',
      },
    });
    assert.equal(followCount, 1, 'Exactly one FederatedFollow record must exist');
  });

  await t.test('4c. Inbound Undo: removes follow and safely decrements local followersCount', async () => {
    const undoPayload = JSON.stringify({
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: `https://${remoteDomain}/activities/undo_follow_${timestamp}`,
      type: 'Undo',
      actor: remoteActorUri,
      object: {
        type: 'Follow',
        actor: remoteActorUri,
        object: `http://${testDomain}/users/${alice.username}`,
      },
    });

    const headers = signMockInboundRequest({
      path: `/users/${alice.username}/inbox`,
      body: undoPayload,
      date: new Date(Date.now() + 2000).toUTCString(),
    });

    const res = await app.inject({
      method: 'POST',
      url: `/users/${alice.username}/inbox`,
      headers,
      payload: undoPayload,
    });
    assert.equal(res.statusCode, 202);

    // Follow record deleted
    const followRecord = await prisma.federatedFollow.findFirst({
      where: {
        localUserId: alice.id,
        remoteActorId: remoteActor.id,
        direction: 'INBOUND',
      },
    });
    assert.equal(followRecord, null, 'FederatedFollow record must be deleted');

    // Followers count decremented back to 0
    const updatedAlice = await prisma.user.findUnique({ where: { id: alice.id } });
    assert.equal(updatedAlice.followersCount, 0, 'Alice followersCount should be decremented back to 0');
  });

  await t.test('4d. Inbound Undo: counter safety (followersCount never drops below 0)', async () => {
    // Alice currently has 0 followers. Receive another Undo.
    const redundantUndoPayload = JSON.stringify({
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: `https://${remoteDomain}/activities/redundant_undo_${timestamp}`,
      type: 'Undo',
      actor: remoteActorUri,
      object: {
        type: 'Follow',
        actor: remoteActorUri,
        object: `http://${testDomain}/users/${alice.username}`,
      },
    });

    const headers = signMockInboundRequest({
      path: `/users/${alice.username}/inbox`,
      body: redundantUndoPayload,
      date: new Date(Date.now() + 2500).toUTCString(),
    });

    const res = await app.inject({
      method: 'POST',
      url: `/users/${alice.username}/inbox`,
      headers,
      payload: redundantUndoPayload,
    });
    assert.equal(res.statusCode, 202);

    const updatedAlice = await prisma.user.findUnique({ where: { id: alice.id } });
    assert.equal(updatedAlice.followersCount, 0, 'followersCount must never drop below 0');
  });

  await t.test('4e. Outbound Follow & Inbound Accept: two-way handshake updates followingCount', async () => {
    // 1. Simulate local user Bob requesting to follow remote actor Charlie
    const outboundFollow = await prisma.federatedFollow.create({
      data: {
        localUserId: bob.id,
        remoteActorId: remoteActor.id,
        direction: 'OUTBOUND',
        status: 'PENDING',
      },
    });

    const bobBefore = await prisma.user.findUnique({ where: { id: bob.id } });
    assert.equal(bobBefore.followingCount, 0);

    // 2. Charlie sends Accept activity to Pulse /inbox
    const acceptPayload = JSON.stringify({
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: `https://${remoteDomain}/activities/accept_${timestamp}`,
      type: 'Accept',
      actor: remoteActorUri,
      object: {
        type: 'Follow',
        actor: `http://${testDomain}/users/${bob.username}`,
        object: remoteActorUri,
      },
    });

    const headers = signMockInboundRequest({
      path: '/inbox',
      body: acceptPayload,
      date: new Date(Date.now() + 3000).toUTCString(),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/inbox',
      headers,
      payload: acceptPayload,
    });
    assert.equal(res.statusCode, 202);

    // 3. Verify status updated to ACCEPTED and Bob followingCount incremented
    const updatedFollow = await prisma.federatedFollow.findUnique({
      where: { id: outboundFollow.id },
    });
    assert.equal(updatedFollow.status, 'ACCEPTED');

    const bobAfter = await prisma.user.findUnique({ where: { id: bob.id } });
    assert.equal(bobAfter.followingCount, 1, 'Bob followingCount should be incremented upon Accept');
  });

  await t.test('4f. Inbound Create Note: inserts Post (isRemote=true) and selective fan-out to followers', async () => {
    const noteId = `https://${remoteDomain}/posts/note_fanout_${timestamp}`;
    const createPayload = JSON.stringify({
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: `https://${remoteDomain}/activities/create_note_${timestamp}`,
      type: 'Create',
      actor: remoteActorUri,
      published: new Date().toISOString(),
      object: {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: noteId,
        type: 'Note',
        attributedTo: remoteActorUri,
        content: 'Selective distribution test from Mastodon!',
        published: new Date().toISOString(),
      },
    });

    const headers = signMockInboundRequest({
      body: createPayload,
      date: new Date(Date.now() + 3500).toUTCString(),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/inbox',
      headers,
      payload: createPayload,
    });
    assert.equal(res.statusCode, 202);

    // 1. Post inserted with isRemote = true
    const post = await prisma.post.findFirst({
      where: { federatedUri: noteId },
    });
    assert.ok(post, 'Federated post must be saved');
    assert.equal(post.isRemote, true);
    assert.equal(post.content, 'Selective distribution test from Mastodon!');

    // 2. Fan-out: Bob (who follows Charlie) receives post in TimelineInbox
    const bobInbox = await prisma.timelineInbox.findFirst({
      where: {
        userId: bob.id,
        postId: post.id,
      },
    });
    assert.ok(bobInbox, "Follower Bob's timeline inbox must receive the post");

    // 3. Fan-out: Dave (who does NOT follow Charlie) must NOT receive post
    const daveInbox = await prisma.timelineInbox.findFirst({
      where: {
        userId: dave.id,
        postId: post.id,
      },
    });
    assert.equal(daveInbox, null, "Non-follower Dave's timeline inbox must NOT receive the post");
  });

  await t.test('4g. Inbound Create Note: duplicate Note idempotency (does not duplicate posts)', async () => {
    const noteId = `https://${remoteDomain}/posts/note_fanout_${timestamp}`;
    const duplicatePayload = JSON.stringify({
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: `https://${remoteDomain}/activities/create_note_duplicate_${timestamp}`,
      type: 'Create',
      actor: remoteActorUri,
      published: new Date().toISOString(),
      object: {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: noteId,
        type: 'Note',
        attributedTo: remoteActorUri,
        content: 'Selective distribution test from Mastodon!',
      },
    });

    const headers = signMockInboundRequest({
      body: duplicatePayload,
      date: new Date(Date.now() + 4000).toUTCString(),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/inbox',
      headers,
      payload: duplicatePayload,
    });
    assert.equal(res.statusCode, 202);

    const postCount = await prisma.post.count({
      where: { federatedUri: noteId },
    });
    assert.equal(postCount, 1, 'Duplicate Note must not create duplicate post in DB');
  });

  await t.test('4h. Inbound Reply Flow: remote Note replies to local post with notification', async () => {
    // 1. Alice creates a local post
    const localPost = await prisma.post.create({
      data: {
        authorId: alice.id,
        content: `Alice's local post to be replied to #${timestamp}`,
      },
    });

    // 2. Charlie sends an inbound Note replying to Alice's post
    const replyNoteId = `https://${remoteDomain}/posts/reply_note_${timestamp}`;
    const replyPayload = JSON.stringify({
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: `https://${remoteDomain}/activities/reply_act_${timestamp}`,
      type: 'Create',
      actor: remoteActorUri,
      object: {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: replyNoteId,
        type: 'Note',
        attributedTo: remoteActorUri,
        inReplyTo: `http://${testDomain}/posts/${localPost.id}`,
        content: 'Great insight Alice! Fediverse reply here.',
        published: new Date().toISOString(),
      },
    });

    const headers = signMockInboundRequest({
      body: replyPayload,
      date: new Date(Date.now() + 4500).toUTCString(),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/inbox',
      headers,
      payload: replyPayload,
    });
    assert.equal(res.statusCode, 202);

    // 3. Verify reply post created and linked
    const replyPost = await prisma.post.findFirst({
      where: { federatedUri: replyNoteId },
    });
    assert.ok(replyPost);
    assert.equal(replyPost.replyToId, localPost.id);
    assert.equal(replyPost.rootPostId, localPost.id);

    // 4. Verify repliesCount on parent post
    const updatedLocalPost = await prisma.post.findUnique({
      where: { id: localPost.id },
    });
    assert.equal(updatedLocalPost.repliesCount, 1);

    // 5. Verify Notification created for Alice
    const replyNotif = await prisma.notification.findFirst({
      where: {
        recipientId: alice.id,
        verb: 'REPLY',
        targetId: replyPost.id,
      },
    });
    assert.ok(replyNotif, 'Reply notification must be delivered to Alice');
  });

  await t.test('4i. Inbound Delete: soft-deletes federated post', async () => {
    const noteId = `https://${remoteDomain}/posts/note_fanout_${timestamp}`;

    const deletePayload = JSON.stringify({
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: `https://${remoteDomain}/activities/delete_${timestamp}`,
      type: 'Delete',
      actor: remoteActorUri,
      object: noteId,
    });

    const headers = signMockInboundRequest({
      body: deletePayload,
      date: new Date(Date.now() + 5000).toUTCString(),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/inbox',
      headers,
      payload: deletePayload,
    });
    assert.equal(res.statusCode, 202);

    const post = await prisma.post.findFirst({ where: { federatedUri: noteId } });
    assert.ok(post, 'Post should exist');
    assert.equal(post.isDeleted, true, 'Post should be marked isDeleted = true');
  });

  await t.test('4j. Inbound Delete: acknowledges unknown post deletion gracefully', async () => {
    const unknownDeletePayload = JSON.stringify({
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: `https://${remoteDomain}/activities/delete_unknown_${timestamp}`,
      type: 'Delete',
      actor: remoteActorUri,
      object: `https://${remoteDomain}/posts/nonexistent_note_${timestamp}`,
    });

    const headers = signMockInboundRequest({
      body: unknownDeletePayload,
      date: new Date(Date.now() + 5500).toUTCString(),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/inbox',
      headers,
      payload: unknownDeletePayload,
    });
    assert.equal(res.statusCode, 202);
  });

  // =========================================================================
  // 5. OUTBOX & ASYNCHRONOUS DELIVERY WORKER (SHARED INBOX, RETRIES, BACKOFF)
  // =========================================================================
  await t.test('5a. Outbox: GET /users/:username/outbox returns OrderedCollection and paginated Note objects', async () => {
    // Create a post for Alice
    const newPostRes = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: authHeaders(alice.id),
      payload: {
        content: `Hello fediverse world! #activitypub_${timestamp}`,
      },
    });
    assert.equal(newPostRes.statusCode, 201);

    // 1. Get outbox summary
    const summaryRes = await app.inject({
      method: 'GET',
      url: `/users/${alice.username}/outbox`,
      headers: { host: testDomain },
    });
    assert.equal(summaryRes.statusCode, 200);
    assert.match(summaryRes.headers['content-type'], /application\/activity\+json/);
    const summaryBody = summaryRes.json();
    assert.equal(summaryBody.type, 'OrderedCollection');
    assert.ok(summaryBody.totalItems >= 1);
    assert.ok(summaryBody.first.includes('page=true'));

    // 2. Get outbox page
    const pageRes = await app.inject({
      method: 'GET',
      url: `/users/${alice.username}/outbox?page=true`,
      headers: { host: testDomain },
    });
    assert.equal(pageRes.statusCode, 200);
    const pageBody = pageRes.json();
    assert.equal(pageBody.type, 'OrderedCollectionPage');
    assert.ok(Array.isArray(pageBody.orderedItems));
    assert.ok(pageBody.orderedItems.length >= 1);

    const firstItem = pageBody.orderedItems[0];
    assert.equal(firstItem.type, 'Create');
    assert.equal(firstItem.object.type, 'Note');
    assert.ok(firstItem.object.content.includes(`Hello fediverse world!`));

    // 3. Instance actor outbox
    const instanceOutboxRes = await app.inject({
      method: 'GET',
      url: '/actor/outbox',
      headers: { host: testDomain },
    });
    assert.equal(instanceOutboxRes.statusCode, 200);
    assert.equal(instanceOutboxRes.json().type, 'OrderedCollection');
  });

  await t.test('5b. Outbox Delivery: post creation enqueues jobs for remote followers, worker processes delivery', async () => {
    let receivedDelivery = null;
    let receivedHeaders = null;

    const mockServer = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        receivedHeaders = req.headers;
        receivedDelivery = JSON.parse(body);
        res.writeHead(202, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      });
    });

    await new Promise((resolve) => mockServer.listen(0, '127.0.0.1', resolve));
    const mockPort = mockServer.address().port;
    const mockInboxUrl = `http://127.0.0.1:${mockPort}/mock-inbox`;

    try {
      const localMockActor = await prisma.federatedActor.create({
        data: {
          uri: `http://127.0.0.1:${mockPort}/actors/tester_${timestamp}`,
          username: `mock_tester_${timestamp}`,
          domain: `127.0.0.1:${mockPort}`,
          inboxUrl: mockInboxUrl,
          sharedInboxUrl: mockInboxUrl,
          publicKeyPem: remoteKeyPair.publicKeyPem,
          publicKeyId: `http://127.0.0.1:${mockPort}/actors/tester_${timestamp}#main-key`,
        },
      });

      // Local mock actor follows Alice
      await prisma.federatedFollow.create({
        data: {
          localUserId: alice.id,
          remoteActorId: localMockActor.id,
          direction: 'INBOUND',
          status: 'ACCEPTED',
        },
      });

      // Alice publishes a new post
      const postRes = await app.inject({
        method: 'POST',
        url: '/api/v1/posts',
        headers: authHeaders(alice.id),
        payload: {
          content: `Broadcast post to fediverse subscribers! #broadcast_${timestamp}`,
        },
      });
      assert.equal(postRes.statusCode, 201);

      // Check delivery job enqueued
      const pendingJobs = await prisma.activityDeliveryJob.findMany({
        where: {
          targetInboxUrl: mockInboxUrl,
          status: 'PENDING',
        },
      });
      assert.ok(pendingJobs.length >= 1, 'Delivery job must be enqueued for remote follower');

      // Process batch now using worker
      const batchResult = await activityDeliveryWorkerService.processBatchNow(10);
      assert.ok(batchResult.processed >= 1, 'Worker should process the pending job');
      assert.ok(batchResult.completed >= 1, 'Job delivery should be completed');

      // Verify mock server received the HTTP request with draft-cavage-12 headers
      assert.ok(receivedDelivery, 'Mock server must have received the delivery payload');
      assert.equal(receivedDelivery.type, 'Create');
      assert.equal(receivedDelivery.object.type, 'Note');
      assert.ok(receivedHeaders['signature'], 'Request must have Signature header');
      assert.ok(receivedHeaders['digest'], 'Request must have Digest header');
      assert.ok(receivedHeaders['date'], 'Request must have Date header');
      assert.match(receivedHeaders['signature'], /keyId=/);
      assert.match(receivedHeaders['signature'], /algorithm="rsa-sha256"/);

      // Verify job marked COMPLETED in database
      const completedJob = await prisma.activityDeliveryJob.findUnique({
        where: { id: pendingJobs[0].id },
      });
      assert.equal(completedJob.status, 'COMPLETED');
    } finally {
      await new Promise((resolve) => mockServer.close(resolve));
    }
  });

  await t.test('5c. Outbox Queue: SharedInbox deduplication optimization across multiple followers', async () => {
    // Create a local author with 3 remote followers on 2 remote instances:
    // Follower A1: mastodon.mock -> sharedInboxUrl: https://mastodon.mock/inbox
    // Follower A2: mastodon.mock -> sharedInboxUrl: https://mastodon.mock/inbox
    // Follower B1: threads.mock -> sharedInboxUrl: https://threads.mock/inbox
    const authorUser = await prisma.user.create({
      data: {
        username: `dedup_author_${timestamp}`,
        email: `dedup_${timestamp}@test.pulse.social`,
        displayName: 'Dedup Author',
      },
    });

    const followerA1 = await prisma.federatedActor.create({
      data: {
        uri: `https://mastodon.mock/users/user_a1_${timestamp}`,
        username: `user_a1_${timestamp}`,
        domain: 'mastodon.mock',
        inboxUrl: `https://mastodon.mock/users/user_a1_${timestamp}/inbox`,
        sharedInboxUrl: `https://mastodon.mock/inbox`,
        publicKeyPem: remoteKeyPair.publicKeyPem,
        publicKeyId: `https://mastodon.mock/users/user_a1_${timestamp}#main-key`,
      },
    });

    const followerA2 = await prisma.federatedActor.create({
      data: {
        uri: `https://mastodon.mock/users/user_a2_${timestamp}`,
        username: `user_a2_${timestamp}`,
        domain: 'mastodon.mock',
        inboxUrl: `https://mastodon.mock/users/user_a2_${timestamp}/inbox`,
        sharedInboxUrl: `https://mastodon.mock/inbox`,
        publicKeyPem: remoteKeyPair.publicKeyPem,
        publicKeyId: `https://mastodon.mock/users/user_a2_${timestamp}#main-key`,
      },
    });

    const followerB1 = await prisma.federatedActor.create({
      data: {
        uri: `https://threads.mock/users/user_b1_${timestamp}`,
        username: `user_b1_${timestamp}`,
        domain: 'threads.mock',
        inboxUrl: `https://threads.mock/users/user_b1_${timestamp}/inbox`,
        sharedInboxUrl: `https://threads.mock/inbox`,
        publicKeyPem: remoteKeyPair.publicKeyPem,
        publicKeyId: `https://threads.mock/users/user_b1_${timestamp}#main-key`,
      },
    });

    // All 3 follow authorUser
    for (const actor of [followerA1, followerA2, followerB1]) {
      await prisma.federatedFollow.create({
        data: {
          localUserId: authorUser.id,
          remoteActorId: actor.id,
          direction: 'INBOUND',
          status: 'ACCEPTED',
        },
      });
    }

    // Publish post
    const postRes = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: authHeaders(authorUser.id),
      payload: {
        content: `SharedInbox optimization test content #${timestamp}`,
      },
    });
    assert.equal(postRes.statusCode, 201);
    const createdPostId = postRes.json().data?.id || postRes.json().id;
    assert.ok(createdPostId, 'Post ID must exist');

    // Verify delivery jobs created: exactly 2 jobs (one for mastodon.mock/inbox, one for threads.mock/inbox)
    const jobs = await prisma.activityDeliveryJob.findMany({
      where: {
        activityId: { contains: createdPostId },
      },
    });

    assert.equal(jobs.length, 2, 'Must create exactly 2 delivery jobs due to sharedInbox deduplication, NOT 3');
    const targetUrls = jobs.map((j) => j.targetInboxUrl);
    assert.ok(targetUrls.includes('https://mastodon.mock/inbox'), 'mastodon.mock/inbox must be present');
    assert.ok(targetUrls.includes('https://threads.mock/inbox'), 'threads.mock/inbox must be present');
  });

  await t.test('5d. Outbox Delivery: retry behavior and exponential backoff on HTTP 500 error', async () => {
    // Mock server returning HTTP 500
    const failServer = http.createServer((req, res) => {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Remote Mastodon Server Error 500');
    });

    await new Promise((resolve) => failServer.listen(0, '127.0.0.1', resolve));
    const failPort = failServer.address().port;
    const failInboxUrl = `http://127.0.0.1:${failPort}/failing-inbox`;

    try {
      // Clean up any stale pending jobs from previous suites so processBatchNow reliably picks this job
      await prisma.activityDeliveryJob.deleteMany({ where: { status: 'PENDING' } });

      const jobId = await activityDeliveryWorkerService.queueDelivery({
        activityId: `http://${testDomain}/activities/test_retry_${timestamp}`,
        activityType: 'Create',
        actorUri: `http://${testDomain}/users/${alice.username}`,
        targetInboxUrl: failInboxUrl,
        payload: { type: 'Create' },
        maxAttempts: 3,
      });

      // 1. First worker sweep
      const sweep1 = await activityDeliveryWorkerService.processBatchNow(10);
      assert.ok(sweep1.processed >= 1);
      assert.ok(sweep1.failed >= 1);

      // Verify job state: status remains PENDING, attempts = 1, nextRunAt scheduled in future
      const jobAfter1 = await prisma.activityDeliveryJob.findUnique({
        where: { id: jobId },
      });
      assert.equal(jobAfter1.status, 'PENDING');
      assert.equal(jobAfter1.attempts, 1);
      assert.match(jobAfter1.lastError, /HTTP 500/);
      // Exponential backoff: 2^1 * 5000ms = 10000ms
      assert.ok(jobAfter1.nextRunAt.getTime() > Date.now() + 3000, 'nextRunAt must be set in future with backoff');

      // 2. Simulate next scheduled run by moving nextRunAt to past and advancing attempts to maxAttempts - 1 (2)
      await prisma.activityDeliveryJob.update({
        where: { id: jobId },
        data: {
          attempts: 2,
          nextRunAt: new Date(Date.now() - 1000),
        },
      });

      // 3. Second worker sweep (attempts: 2 -> 3 = maxAttempts)
      const sweep2 = await activityDeliveryWorkerService.processBatchNow(10);
      assert.ok(sweep2.processed >= 1);

      const jobFinal = await prisma.activityDeliveryJob.findUnique({
        where: { id: jobId },
      });
      assert.equal(jobFinal.status, 'FAILED', 'Job must transition to FAILED upon max attempts');
      assert.equal(jobFinal.attempts, 3);
      assert.match(jobFinal.lastError, /HTTP 500/);

      // 4. Third sweep: worker must NOT pick up FAILED job
      const sweep3 = await activityDeliveryWorkerService.processBatchNow(10);
      const jobStillFailed = await prisma.activityDeliveryJob.findUnique({
        where: { id: jobId },
      });
      assert.equal(jobStillFailed.status, 'FAILED');
    } finally {
      await new Promise((resolve) => failServer.close(resolve));
    }
  });

  await t.test('5e. Outbox Delivery: retry behavior on network connection failure (closed port)', async () => {
    // Unused closed port
    const deadInboxUrl = 'http://127.0.0.1:59998/dead-inbox';

    const jobId = await activityDeliveryWorkerService.queueDelivery({
      activityId: `http://${testDomain}/activities/test_net_fail_${timestamp}`,
      activityType: 'Create',
      actorUri: `http://${testDomain}/users/${alice.username}`,
      targetInboxUrl: deadInboxUrl,
      payload: { type: 'Create' },
      maxAttempts: 5,
    });

    const sweep = await activityDeliveryWorkerService.processBatchNow(10);
    assert.ok(sweep.processed >= 1);

    const job = await prisma.activityDeliveryJob.findUnique({
      where: { id: jobId },
    });
    assert.equal(job.status, 'PENDING');
    assert.equal(job.attempts, 1);
    assert.match(job.lastError, /NETWORK_ERROR/);
    assert.ok(job.nextRunAt.getTime() > Date.now() + 3000);
  });

  await t.test('5f. Outbox Collection: OrderedCollectionPage pagination, ordering, and soft-delete filtering', async () => {
    const freshUser = await prisma.user.create({
      data: {
        username: `outbox_filter_${timestamp}`,
        email: `outbox_filter_${timestamp}@test.pulse.social`,
        displayName: 'Outbox Filter User',
      },
    });

    // Create 3 posts: Post 1, Post 2, Post 3
    const p1 = await prisma.post.create({
      data: { authorId: freshUser.id, content: 'First post' },
    });
    const p2 = await prisma.post.create({
      data: { authorId: freshUser.id, content: 'Second post' },
    });
    const p3 = await prisma.post.create({
      data: { authorId: freshUser.id, content: 'Third post' },
    });

    // Soft-delete Post 2
    await prisma.post.update({
      where: { id: p2.id },
      data: { isDeleted: true },
    });

    // Fetch outbox summary
    const summaryRes = await app.inject({
      method: 'GET',
      url: `/users/${freshUser.username}/outbox`,
      headers: { host: testDomain },
    });
    assert.equal(summaryRes.statusCode, 200);
    assert.equal(summaryRes.json().totalItems, 2, 'totalItems must exclude soft-deleted posts');

    // Fetch outbox page
    const pageRes = await app.inject({
      method: 'GET',
      url: `/users/${freshUser.username}/outbox?page=true`,
      headers: { host: testDomain },
    });
    assert.equal(pageRes.statusCode, 200);
    const page = pageRes.json();
    assert.equal(page.orderedItems.length, 2);

    const postIds = page.orderedItems.map((item) => item.object.id);
    assert.ok(postIds.some((id) => id.includes(p3.id)), 'Active Post 3 must be present');
    assert.ok(postIds.some((id) => id.includes(p1.id)), 'Active Post 1 must be present');
    assert.ok(!postIds.some((id) => id.includes(p2.id)), 'Soft-deleted Post 2 must be excluded');

    // Nonexistent user returns 404
    const res404 = await app.inject({
      method: 'GET',
      url: `/users/ghost_outbox_${timestamp}/outbox`,
      headers: { host: testDomain },
    });
    assert.equal(res404.statusCode, 404);
  });

  await t.test('5g. Outbox Delivery: SSRF guard blocks delivery to private metadata IPs', async () => {
    const prevFederation = process.env.ALLOW_HTTP_FEDERATION;
    const prevNodeEnv = process.env.NODE_ENV;
    process.env.ALLOW_HTTP_FEDERATION = 'false';
    process.env.NODE_ENV = 'production';

    try {
      const jobId = await activityDeliveryWorkerService.queueDelivery({
        activityId: `http://${testDomain}/activities/test_ssrf_outbox_${timestamp}`,
        activityType: 'Create',
        actorUri: `http://${testDomain}/users/${alice.username}`,
        targetInboxUrl: 'http://169.254.169.254/latest/meta-data',
        payload: { type: 'Create' },
      });

      const sweep = await activityDeliveryWorkerService.processBatchNow(10);
      assert.ok(sweep.failed >= 1);

      const job = await prisma.activityDeliveryJob.findUnique({ where: { id: jobId } });
      assert.equal(job.status, 'FAILED');
      assert.match(job.lastError, /SSRF_GUARD_BLOCKED/);
    } finally {
      process.env.ALLOW_HTTP_FEDERATION = prevFederation;
      process.env.NODE_ENV = prevNodeEnv;
    }
  });

  // Cleanup background scheduler timers
  activityDeliveryWorkerService.stop();
});

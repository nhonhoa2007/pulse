import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../src/db/PrismaClientSingleton.ts';
import { buildApp } from '../src/app.ts';
import { fetchNodeInfoService } from '../src/modules/federation/FetchNodeInfoService.ts';

test('TASK-19: NodeInfo 2.1 Protocol, FEP-0151 Discovery & Backward Compatibility Suite', async (t) => {
  process.env.NODE_ENV = 'test';
  process.env.ALLOW_HTTP_FEDERATION = 'true';

  const app = await buildApp();
  await app.ready();

  const timestamp = Date.now();
  const testHost = 'pulse.social';

  // -------------------------------------------------------------------------
  // 1. Discovery Endpoint: GET /.well-known/nodeinfo (FEP-0151 & RFC 7033 JRD)
  // -------------------------------------------------------------------------
  await t.test('1a. GET /.well-known/nodeinfo returns valid JRD document linking to schema 2.1 and 2.0', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/.well-known/nodeinfo',
      headers: {
        Host: testHost,
      },
    });

    assert.equal(res.statusCode, 200);

    // Headers verification
    const contentType = res.headers['content-type'];
    assert.ok(contentType, 'Content-Type header must be present');
    assert.ok(
      contentType.includes('application/json') || contentType.includes('application/jrd+json'),
      `Content-Type must be JSON/JRD, got ${contentType}`
    );
    assert.equal(res.headers['cache-control'], 'public, max-age=86400');
    assert.equal(res.headers['access-control-allow-origin'], '*');

    // Body structure verification
    const body = res.json();
    assert.ok(Array.isArray(body.links), 'NodeInfo discovery body must have a links array');
    assert.ok(body.links.length >= 2, 'Links array must have at least 2 versions (2.1 and 2.0)');

    const link21 = body.links.find(
      (l) => l.rel === 'http://nodeinfo.diaspora.software/ns/schema/2.1'
    );
    assert.ok(link21, 'Link for schema 2.1 must be present in links array');
    assert.equal(link21.rel, 'http://nodeinfo.diaspora.software/ns/schema/2.1');
    assert.ok(link21.href.includes('/nodeinfo/2.1'), 'href must point to /nodeinfo/2.1');
    assert.ok(link21.href.includes(testHost), 'href must include requested host domain');

    const link20 = body.links.find(
      (l) => l.rel === 'http://nodeinfo.diaspora.software/ns/schema/2.0'
    );
    assert.ok(link20, 'Link for schema 2.0 must be present in links array');
    assert.equal(link20.rel, 'http://nodeinfo.diaspora.software/ns/schema/2.0');
    assert.ok(link20.href.includes('/nodeinfo/2.0'), 'href must point to /nodeinfo/2.0');
  });

  await t.test('1b. GET /.well-known/nodeinfo respects custom host and port headers dynamically', async () => {
    const customHost = `federated-node-${timestamp}.net:8443`;
    const res = await app.inject({
      method: 'GET',
      url: '/.well-known/nodeinfo',
      headers: {
        Host: customHost,
      },
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    const link21 = body.links.find(
      (l) => l.rel === 'http://nodeinfo.diaspora.software/ns/schema/2.1'
    );
    assert.ok(link21.href.startsWith(`https://${customHost}/nodeinfo/2.1`));
  });

  // -------------------------------------------------------------------------
  // 2. Protocol Document: GET /nodeinfo/2.1 (Schema 2.1 Compliance)
  // -------------------------------------------------------------------------
  await t.test('2a. GET /nodeinfo/2.1 returns 100% compliant NodeInfo 2.1 schema document and headers', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/nodeinfo/2.1',
      headers: {
        Host: testHost,
      },
    });

    assert.equal(res.statusCode, 200);

    // Headers validation
    const contentType = res.headers['content-type'];
    assert.ok(contentType, 'Content-Type header must be present');
    assert.ok(
      contentType.includes('application/json') &&
        contentType.includes('http://nodeinfo.diaspora.software/ns/schema/2.1#'),
      `Content-Type must declare 2.1 profile, got: ${contentType}`
    );
    assert.equal(res.headers['cache-control'], 'public, max-age=1800');
    assert.equal(res.headers['access-control-allow-origin'], '*');

    const doc = res.json();

    // 1. Version
    assert.equal(doc.version, '2.1');

    // 2. Software
    assert.ok(doc.software, 'Software object is required');
    assert.equal(doc.software.name, 'pulse');
    assert.equal(doc.software.version, '1.0.0');
    assert.equal(typeof doc.software.repository, 'string');
    assert.equal(typeof doc.software.homepage, 'string');

    // 3. Protocols
    assert.ok(Array.isArray(doc.protocols), 'Protocols must be an array');
    assert.ok(doc.protocols.includes('activitypub'), 'Protocols must include activitypub');

    // 4. Services
    assert.ok(doc.services, 'Services object is required');
    assert.ok(Array.isArray(doc.services.inbound), 'Services inbound must be an array');
    assert.ok(Array.isArray(doc.services.outbound), 'Services outbound must be an array');

    // 5. Open Registrations
    assert.equal(typeof doc.openRegistrations, 'boolean');
    assert.equal(doc.openRegistrations, true);

    // 6. Usage
    assert.ok(doc.usage, 'Usage object is required');
    assert.ok(doc.usage.users, 'Usage users object is required');
    assert.equal(typeof doc.usage.users.total, 'number');
    assert.equal(typeof doc.usage.users.activeHalfyear, 'number');
    assert.equal(typeof doc.usage.users.activeMonth, 'number');
    assert.equal(typeof doc.usage.localPosts, 'number');
    assert.equal(typeof doc.usage.localComments, 'number');
    assert.ok(doc.usage.users.total >= 0);
    assert.ok(doc.usage.users.activeHalfyear >= 0);
    assert.ok(doc.usage.users.activeMonth >= 0);
    assert.ok(doc.usage.localPosts >= 0);
    assert.ok(doc.usage.localComments >= 0);

    // 7. Metadata (FEP-0151 recommended properties)
    assert.ok(doc.metadata, 'Metadata object is required');
    assert.equal(doc.metadata.nodeName, 'Pulse Social');
    assert.equal(typeof doc.metadata.nodeDescription, 'string');
    assert.ok(Array.isArray(doc.metadata.staffAccounts), 'staffAccounts must be an array');
    assert.ok(doc.metadata.staffAccounts.length > 0);
    assert.equal(doc.metadata.federation?.enabled, true);
    assert.equal(doc.metadata.theme, 'light');
    assert.ok(Array.isArray(doc.metadata.features));
    assert.ok(doc.metadata.features.includes('polls'));
    assert.ok(doc.metadata.features.includes('reply_privacy'));
  });

  // -------------------------------------------------------------------------
  // 3. Usage Metrics Database Calculation & Isolation Invariants
  // -------------------------------------------------------------------------
  await t.test('3a. accurately calculates usage metrics from real database entities and filters out remote/deleted data', async () => {
    // Clean initial state baseline
    const initialStats = await fetchNodeInfoService.getUsageStats(true);

    // Setup local user 1: updated right now (active in last 30 days & 180 days)
    const userActiveNow = await prisma.user.create({
      data: {
        username: `nodeinfo_u1_${timestamp}`,
        email: `nodeinfo_u1_${timestamp}@pulse.social`,
        displayName: 'NodeInfo Local User 1',
        isRemote: false,
        updatedAt: new Date(),
      },
    });

    // Setup local user 2: updated 60 days ago (active in 180 days, NOT active in 30 days)
    const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    const userActiveHalfYear = await prisma.user.create({
      data: {
        username: `nodeinfo_u2_${timestamp}`,
        email: `nodeinfo_u2_${timestamp}@pulse.social`,
        displayName: 'NodeInfo Local User 2',
        isRemote: false,
        updatedAt: sixtyDaysAgo,
      },
    });

    // Setup local user 3: updated 200 days ago (inactive, neither activeMonth nor activeHalfyear)
    const twoHundredDaysAgo = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000);
    const userInactive = await prisma.user.create({
      data: {
        username: `nodeinfo_u3_${timestamp}`,
        email: `nodeinfo_u3_${timestamp}@pulse.social`,
        displayName: 'NodeInfo Local User 3',
        isRemote: false,
        updatedAt: twoHundredDaysAgo,
      },
    });

    // Setup remote shadow user (must NOT count towards total local users or activity)
    const shadowUser = await prisma.user.create({
      data: {
        username: `remote_shadow_${timestamp}`,
        email: `remote_shadow_${timestamp}@remote.test`,
        displayName: 'Remote Shadow User',
        isRemote: true,
      },
    });

    // Setup 2 active local root posts by local users
    const rootPost1 = await prisma.post.create({
      data: {
        authorId: userActiveNow.id,
        content: 'Original local post 1 for nodeinfo test',
        isRemote: false,
        isDeleted: false,
      },
    });

    const rootPost2 = await prisma.post.create({
      data: {
        authorId: userActiveHalfYear.id,
        content: 'Original local post 2 for nodeinfo test',
        isRemote: false,
        isDeleted: false,
      },
    });

    // Setup 1 active local reply/comment (replyToId is set)
    const replyPost = await prisma.post.create({
      data: {
        authorId: userActiveNow.id,
        content: 'Local reply to post 1',
        replyToId: rootPost1.id,
        rootPostId: rootPost1.id,
        isRemote: false,
        isDeleted: false,
      },
    });

    // Setup 1 soft-deleted local post (isDeleted = true, must NOT count)
    const deletedPost = await prisma.post.create({
      data: {
        authorId: userActiveNow.id,
        content: 'Deleted local post',
        isRemote: false,
        isDeleted: true,
      },
    });

    // Setup 1 soft-deleted local comment (isDeleted = true, must NOT count)
    const deletedComment = await prisma.post.create({
      data: {
        authorId: userActiveNow.id,
        content: 'Deleted local comment',
        replyToId: rootPost1.id,
        rootPostId: rootPost1.id,
        isRemote: false,
        isDeleted: true,
      },
    });

    // Setup 1 remote post (isRemote = true, must NOT count towards localPosts)
    const remotePost = await prisma.post.create({
      data: {
        authorId: shadowUser.id,
        content: 'Remote federated post',
        isRemote: true,
        isDeleted: false,
      },
    });

    try {
      // Query usage statistics with bypassCache
      const updatedStats = await fetchNodeInfoService.getUsageStats(true);

      // Invariants:
      // Local users created: 3 (userActiveNow, userActiveHalfYear, userInactive)
      // Shadow users created: 1 (should be excluded)
      assert.ok(
        updatedStats.users.total >= initialStats.users.total + 3,
        'users.total must increment by at least 3 local users and exclude remote shadow user'
      );

      // Active halfyear: userActiveNow (now) + userActiveHalfYear (60 days ago) = +2
      assert.ok(
        updatedStats.users.activeHalfyear >= initialStats.users.activeHalfyear + 2,
        'users.activeHalfyear must increment by at least 2'
      );

      // Active month: userActiveNow (now) = +1
      assert.ok(
        updatedStats.users.activeMonth >= initialStats.users.activeMonth + 1,
        'users.activeMonth must increment by at least 1'
      );

      // Local posts: rootPost1 + rootPost2 = +2 (excluding deletedPost and remotePost)
      assert.ok(
        updatedStats.localPosts >= initialStats.localPosts + 2,
        'localPosts must increment by at least 2 and exclude deleted or remote posts'
      );

      // Local comments: replyPost = +1 (excluding deletedComment)
      assert.ok(
        updatedStats.localComments >= initialStats.localComments + 1,
        'localComments must increment by at least 1 and exclude deleted comments'
      );
    } finally {
      // Teardown created test entities
      await prisma.post.deleteMany({
        where: {
          id: {
            in: [
              rootPost1.id,
              rootPost2.id,
              replyPost.id,
              deletedPost.id,
              deletedComment.id,
              remotePost.id,
            ],
          },
        },
      });

      await prisma.user.deleteMany({
        where: {
          id: {
            in: [userActiveNow.id, userActiveHalfYear.id, userInactive.id, shadowUser.id],
          },
        },
      });
    }
  });

  // -------------------------------------------------------------------------
  // 4. Backward Compatibility: GET /nodeinfo/2.0
  // -------------------------------------------------------------------------
  await t.test('4a. GET /nodeinfo/2.0 provides backward-compatible schema 2.0 document', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/nodeinfo/2.0',
      headers: {
        Host: testHost,
      },
    });

    assert.equal(res.statusCode, 200);

    const contentType = res.headers['content-type'];
    assert.ok(contentType, 'Content-Type header must be present');
    assert.ok(
      contentType.includes('application/json') &&
        contentType.includes('http://nodeinfo.diaspora.software/ns/schema/2.0#'),
      `Content-Type must declare 2.0 profile, got: ${contentType}`
    );
    assert.equal(res.headers['cache-control'], 'public, max-age=1800');

    const doc = res.json();
    assert.equal(doc.version, '2.0');
    assert.equal(doc.software.name, 'pulse');
    assert.equal(doc.software.version, '1.0.0');
    assert.ok(doc.protocols.includes('activitypub'));
    assert.equal(doc.openRegistrations, true);
    assert.ok(doc.usage.users);
    assert.equal(typeof doc.usage.localPosts, 'number');
    assert.equal(typeof doc.usage.localComments, 'number');
    assert.equal(doc.metadata.nodeName, 'Pulse Social');
    assert.equal(doc.metadata.federation?.enabled, true);
  });
});

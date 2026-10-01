import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { prisma } from '../src/db/PrismaClientSingleton.ts';
import { buildApp } from '../src/app.ts';
import { activityPubKeyManagerService } from '../src/modules/federation/ActivityPubKeyManagerService.ts';
import { toggleLikeService } from '../src/modules/posts/ToggleLikeService.ts';
import { repostService } from '../src/modules/posts/RepostService.ts';

test('TASK-19: Outbound & Inbound ActivityPub Like and Announce Federation Suite', async (t) => {
  process.env.NODE_ENV = 'test';
  process.env.ALLOW_HTTP_FEDERATION = 'true';

  const app = await buildApp();
  await app.ready();

  const timestamp = Date.now();
  const testHost = 'pulse.social';

  // Helper for generating signed headers for mock inbound requests
  function signMockInboundRequest({
    method = 'POST',
    path = '/inbox',
    body = '',
    date = new Date().toUTCString(),
    privateKeyPem,
    keyId,
    host = testHost,
  }) {
    const rawBodyBuffer = Buffer.from(body, 'utf-8');
    const digestBase64 = crypto.createHash('sha256').update(rawBodyBuffer).digest('base64');
    const digestHeader = `SHA-256=${digestBase64}`;

    const headersList = ['(request-target)', 'host', 'date', 'digest'];
    const signingLines = [
      `(request-target): ${method.toLowerCase()} ${path}`,
      `host: ${host}`,
      `date: ${date}`,
      `digest: ${digestHeader}`,
    ];
    const signingString = signingLines.join('\n');

    const signer = crypto.createSign('RSA-SHA256');
    signer.update(signingString);
    const signatureBase64 = signer.sign(privateKeyPem, 'base64');

    const signatureValue = `keyId="${keyId}",algorithm="rsa-sha256",headers="${headersList.join(' ')}",signature="${signatureBase64}"`;

    return {
      Host: host,
      'Content-Type': 'application/activity+json',
      Accept: 'application/activity+json',
      Date: date,
      Digest: digestHeader,
      Signature: signatureValue,
    };
  }

  // -------------------------------------------------------------------------
  // Test Fixtures: Local Users, Remote Actors & Remote Followers
  // -------------------------------------------------------------------------
  const localAuthor = await prisma.user.create({
    data: {
      username: `author_loc_${timestamp}`,
      email: `author_loc_${timestamp}@pulse.social`,
      displayName: 'Local Post Author',
    },
  });

  const localActor = await prisma.user.create({
    data: {
      username: `actor_loc_${timestamp}`,
      email: `actor_loc_${timestamp}@pulse.social`,
      displayName: 'Local Interacting User',
    },
  });

  // Remote Actor A (Author of a remote post that local user will Like / Repost)
  const remoteActorKeyA = activityPubKeyManagerService.generateRsa2048KeyPair();
  const remoteDomainA = `mastodon.remote-a-${timestamp}.org`;
  const remoteActorUriA = `https://${remoteDomainA}/users/remote_bob`;
  const remoteKeyIdA = `${remoteActorUriA}#main-key`;
  const remoteInboxA = `https://${remoteDomainA}/users/remote_bob/inbox`;

  const dbRemoteActorA = await prisma.federatedActor.create({
    data: {
      uri: remoteActorUriA,
      username: 'remote_bob',
      domain: remoteDomainA,
      name: 'Remote Bob',
      inboxUrl: remoteInboxA,
      publicKeyPem: remoteActorKeyA.publicKeyPem,
      publicKeyId: remoteKeyIdA,
    },
  });

  const shadowUserA = await prisma.user.create({
    data: {
      username: `remote_bob_${timestamp}`,
      email: `remote_bob_${timestamp}@shadow.fediverse`,
      displayName: 'Remote Bob Shadow',
      isRemote: true,
      federatedActorId: dbRemoteActorA.id,
    },
  });

  const remotePostUri = `https://${remoteDomainA}/posts/post_12345`;
  const remotePost = await prisma.post.create({
    data: {
      authorId: shadowUserA.id,
      content: 'Federated post authored by remote Bob on instance A',
      isRemote: true,
      federatedUri: remotePostUri,
      likesCount: 0,
      repostsCount: 0,
    },
  });

  // Remote Actor B (Follower of localActor to verify outbound Announce delivery fan-out)
  const remoteActorKeyB = activityPubKeyManagerService.generateRsa2048KeyPair();
  const remoteDomainB = `threads.remote-b-${timestamp}.net`;
  const remoteActorUriB = `https://${remoteDomainB}/users/remote_follower`;
  const remoteKeyIdB = `${remoteActorUriB}#main-key`;
  const remoteInboxB = `https://${remoteDomainB}/users/remote_follower/inbox`;

  const dbRemoteActorB = await prisma.federatedActor.create({
    data: {
      uri: remoteActorUriB,
      username: 'remote_follower',
      domain: remoteDomainB,
      name: 'Remote Follower',
      inboxUrl: remoteInboxB,
      sharedInboxUrl: `https://${remoteDomainB}/inbox`,
      publicKeyPem: remoteActorKeyB.publicKeyPem,
      publicKeyId: remoteKeyIdB,
    },
  });

  // Follow relationship: Remote Actor B follows localActor (INBOUND follow accepted)
  await prisma.federatedFollow.create({
    data: {
      localUserId: localActor.id,
      remoteActorId: dbRemoteActorB.id,
      direction: 'INBOUND',
      status: 'ACCEPTED',
    },
  });

  // Remote Actor C (Inbound actor who will Like & Repost a local post)
  const remoteActorKeyC = activityPubKeyManagerService.generateRsa2048KeyPair();
  const remoteDomainC = `pixelfed.remote-c-${timestamp}.social`;
  const remoteActorUriC = `https://${remoteDomainC}/users/remote_charlie`;
  const remoteKeyIdC = `${remoteActorUriC}#main-key`;
  const remoteInboxC = `https://${remoteDomainC}/users/remote_charlie/inbox`;

  const dbRemoteActorC = await prisma.federatedActor.create({
    data: {
      uri: remoteActorUriC,
      username: 'remote_charlie',
      domain: remoteDomainC,
      name: 'Charlie Pixelfed',
      inboxUrl: remoteInboxC,
      publicKeyPem: remoteActorKeyC.publicKeyPem,
      publicKeyId: remoteKeyIdC,
    },
  });

  // Local root post authored by localAuthor (target of inbound Like & Announce)
  const localPost = await prisma.post.create({
    data: {
      authorId: localAuthor.id,
      content: 'Local post waiting for Fediverse engagement',
      isRemote: false,
      likesCount: 0,
      repostsCount: 0,
    },
  });

  try {
    // -------------------------------------------------------------------------
    // 1. Outbound Like Federation
    // -------------------------------------------------------------------------
    await t.test('1a. Outbound Like: local user likes remote post, increments counter, and queues ActivityPub Like job', async () => {
      // Clear existing delivery jobs
      await prisma.activityDeliveryJob.deleteMany({});

      // Local user likes remote post
      const result = await toggleLikeService.toggleLike(localActor.id, remotePost.id);
      assert.equal(result.liked, true);
      assert.equal(result.likesCount, 1);

      // Verify DB Like record
      const likeRecord = await prisma.like.findUnique({
        where: {
          userId_postId: {
            userId: localActor.id,
            postId: remotePost.id,
          },
        },
      });
      assert.ok(likeRecord, 'Like record must be persisted in database');

      // Verify delivery job in queue
      const jobs = await prisma.activityDeliveryJob.findMany({
        where: {
          activityType: 'Like',
          targetInboxUrl: remoteInboxA,
        },
      });
      assert.equal(jobs.length, 1, 'Exactly one delivery job for remote author inbox must be enqueued');

      const job = jobs[0];
      const payload = JSON.parse(job.payloadJson);
      assert.equal(payload['@context'], 'https://www.w3.org/ns/activitystreams');
      assert.equal(payload.type, 'Like');
      assert.equal(payload.object, remotePostUri);
      assert.ok(payload.actor.includes(`/users/${localActor.username}`));
    });

    // -------------------------------------------------------------------------
    // 2. Outbound Unlike Federation (Undo Activity)
    // -------------------------------------------------------------------------
    await t.test('2a. Outbound Unlike: local user unlikes remote post, decrements counter, and queues Undo(Like) job', async () => {
      await prisma.activityDeliveryJob.deleteMany({});

      // Local user toggles like again (unlike)
      const result = await toggleLikeService.toggleLike(localActor.id, remotePost.id);
      assert.equal(result.liked, false);
      assert.equal(result.likesCount, 0);

      // Verify Like record deleted from DB
      const likeRecord = await prisma.like.findUnique({
        where: {
          userId_postId: {
            userId: localActor.id,
            postId: remotePost.id,
          },
        },
      });
      assert.equal(likeRecord, null, 'Like record must be deleted upon unlike');

      // Verify Undo job enqueued
      const undoJobs = await prisma.activityDeliveryJob.findMany({
        where: {
          activityType: 'Undo',
          targetInboxUrl: remoteInboxA,
        },
      });
      assert.equal(undoJobs.length, 1, 'Exactly one Undo delivery job must be enqueued');

      const undoPayload = JSON.parse(undoJobs[0].payloadJson);
      assert.equal(undoPayload.type, 'Undo');
      assert.equal(undoPayload.object.type, 'Like');
      assert.equal(undoPayload.object.object, remotePostUri);
    });

    // -------------------------------------------------------------------------
    // 3. Outbound Repost / Announce Federation
    // -------------------------------------------------------------------------
    await t.test('3a. Outbound Repost: local user reposts remote post, queues Announce to remote author and remote followers', async () => {
      await prisma.activityDeliveryJob.deleteMany({});

      // Local user reposts remote post
      const result = await repostService.toggleRepost(localActor.id, remotePost.id);
      assert.equal(result.reposted, true);
      assert.equal(result.repostsCount, 1);

      // Verify Repost record in DB
      const repostRecord = await prisma.repost.findUnique({
        where: {
          userId_postId: {
            userId: localActor.id,
            postId: remotePost.id,
          },
        },
      });
      assert.ok(repostRecord, 'Repost record must be created in database');

      // Verify delivery jobs: 1 for remote author inbox, 1 for remote follower sharedInbox
      const jobs = await prisma.activityDeliveryJob.findMany({
        where: {
          activityType: 'Announce',
        },
      });
      assert.ok(jobs.length >= 2, 'Must queue Announce to both remote author and remote followers');

      const inboxes = jobs.map((j) => j.targetInboxUrl);
      assert.ok(inboxes.includes(remoteInboxA), 'Must deliver to remote author inbox');
      assert.ok(
        inboxes.includes(`https://${remoteDomainB}/inbox`) || inboxes.includes(remoteInboxB),
        'Must deliver to remote follower inbox'
      );

      const payload = JSON.parse(jobs[0].payloadJson);
      assert.equal(payload.type, 'Announce');
      assert.equal(payload.object, remotePostUri);
      assert.ok(payload.to.includes('https://www.w3.org/ns/activitystreams#Public'));
    });

    // -------------------------------------------------------------------------
    // 4. Outbound Unrepost (Undo Announce)
    // -------------------------------------------------------------------------
    await t.test('4a. Outbound Unrepost: local user un-reposts remote post, decrements counter, and queues Undo(Announce) job', async () => {
      await prisma.activityDeliveryJob.deleteMany({});

      // Local user toggles repost again (unrepost)
      const result = await repostService.toggleRepost(localActor.id, remotePost.id);
      assert.equal(result.reposted, false);
      assert.equal(result.repostsCount, 0);

      // Verify Repost record removed
      const repostRecord = await prisma.repost.findUnique({
        where: {
          userId_postId: {
            userId: localActor.id,
            postId: remotePost.id,
          },
        },
      });
      assert.equal(repostRecord, null, 'Repost record must be deleted upon unrepost');

      // Verify Undo jobs enqueued
      const undoJobs = await prisma.activityDeliveryJob.findMany({
        where: {
          activityType: 'Undo',
        },
      });
      assert.ok(undoJobs.length >= 1, 'Must queue Undo delivery job');

      const undoPayload = JSON.parse(undoJobs[0].payloadJson);
      assert.equal(undoPayload.type, 'Undo');
      assert.equal(undoPayload.object.type, 'Announce');
      assert.equal(undoPayload.object.object, remotePostUri);
    });

    // -------------------------------------------------------------------------
    // 5. Inbound Like Activity via POST /inbox
    // -------------------------------------------------------------------------
    await t.test('5a. Inbound Like: remote actor likes local post with valid HTTP signature, increments counter and notifies author', async () => {
      const localPostUri = `http://${testHost}/posts/${localPost.id}`;
      const likeActivityId = `https://${remoteDomainC}/activities/like_${timestamp}`;

      const inboundLikePayload = JSON.stringify({
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: likeActivityId,
        type: 'Like',
        actor: remoteActorUriC,
        object: localPostUri,
      });

      const signedHeaders = signMockInboundRequest({
        method: 'POST',
        path: '/inbox',
        body: inboundLikePayload,
        privateKeyPem: remoteActorKeyC.privateKeyPem,
        keyId: remoteKeyIdC,
      });

      const res = await app.inject({
        method: 'POST',
        url: '/inbox',
        headers: signedHeaders,
        payload: inboundLikePayload,
      });

      assert.equal(res.statusCode, 202);
      const resBody = res.json();
      assert.equal(resBody.success, true);
      assert.equal(resBody.data?.handled, true);
      assert.equal(resBody.data?.type, 'Like');

      // Verify local post likesCount incremented
      const updatedPost = await prisma.post.findUnique({
        where: { id: localPost.id },
      });
      assert.equal(updatedPost.likesCount, 1);

      // Verify shadow user and Like record created
      const shadowC = await prisma.user.findFirst({
        where: { federatedActorId: dbRemoteActorC.id },
      });
      assert.ok(shadowC, 'Shadow user must be created for remote actor C');

      const likeRecord = await prisma.like.findUnique({
        where: {
          userId_postId: {
            userId: shadowC.id,
            postId: localPost.id,
          },
        },
      });
      assert.ok(likeRecord, 'Like record must be created for shadow user and local post');

      // Verify Notification sent to local post author
      const notification = await prisma.notification.findFirst({
        where: {
          recipientId: localAuthor.id,
          targetId: localPost.id,
          verb: 'LIKE',
        },
      });
      assert.ok(notification, 'Notification must be recorded for local post author');
    });

    await t.test('5b. Inbound Like Idempotency: duplicate Like activity does not double increment counter or fail', async () => {
      const localPostUri = `http://${testHost}/posts/${localPost.id}`;
      const duplicateLikeId = `https://${remoteDomainC}/activities/like_duplicate_${timestamp}`;

      const payload = JSON.stringify({
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: duplicateLikeId,
        type: 'Like',
        actor: remoteActorUriC,
        object: localPostUri,
      });

      const signedHeaders = signMockInboundRequest({
        method: 'POST',
        path: '/inbox',
        body: payload,
        privateKeyPem: remoteActorKeyC.privateKeyPem,
        keyId: remoteKeyIdC,
      });

      // Send duplicate like
      const res = await app.inject({
        method: 'POST',
        url: '/inbox',
        headers: signedHeaders,
        payload,
      });

      assert.equal(res.statusCode, 202);

      // Counter must remain 1
      const post = await prisma.post.findUnique({ where: { id: localPost.id } });
      assert.equal(post.likesCount, 1, 'Duplicate like must not increment likesCount again');
    });

    // -------------------------------------------------------------------------
    // 6. Inbound Undo(Like) via POST /inbox
    // -------------------------------------------------------------------------
    await t.test('6a. Inbound Undo(Like): remote actor unlikes local post, decrements counter, removes Like record', async () => {
      const localPostUri = `http://${testHost}/posts/${localPost.id}`;
      const undoLikeId = `https://${remoteDomainC}/activities/undo_like_${timestamp}`;

      const undoPayload = JSON.stringify({
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: undoLikeId,
        type: 'Undo',
        actor: remoteActorUriC,
        object: {
          id: `https://${remoteDomainC}/activities/like_${timestamp}`,
          type: 'Like',
          actor: remoteActorUriC,
          object: localPostUri,
        },
      });

      const signedHeaders = signMockInboundRequest({
        method: 'POST',
        path: '/inbox',
        body: undoPayload,
        privateKeyPem: remoteActorKeyC.privateKeyPem,
        keyId: remoteKeyIdC,
      });

      const res = await app.inject({
        method: 'POST',
        url: '/inbox',
        headers: signedHeaders,
        payload: undoPayload,
      });

      assert.equal(res.statusCode, 202);

      // Verify counter decremented back to 0
      const post = await prisma.post.findUnique({ where: { id: localPost.id } });
      assert.equal(post.likesCount, 0);

      // Verify Like record removed
      const shadowC = await prisma.user.findFirst({
        where: { federatedActorId: dbRemoteActorC.id },
      });
      const likeRecord = await prisma.like.findUnique({
        where: {
          userId_postId: {
            userId: shadowC.id,
            postId: localPost.id,
          },
        },
      });
      assert.equal(likeRecord, null);
    });

    // -------------------------------------------------------------------------
    // 7. Inbound Announce Activity via POST /inbox
    // -------------------------------------------------------------------------
    await t.test('7a. Inbound Announce: remote actor reposts local post, increments counter and notifies author', async () => {
      const localPostUri = `http://${testHost}/posts/${localPost.id}`;
      const announceId = `https://${remoteDomainC}/activities/announce_${timestamp}`;

      const announcePayload = JSON.stringify({
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: announceId,
        type: 'Announce',
        actor: remoteActorUriC,
        object: localPostUri,
      });

      const signedHeaders = signMockInboundRequest({
        method: 'POST',
        path: '/inbox',
        body: announcePayload,
        privateKeyPem: remoteActorKeyC.privateKeyPem,
        keyId: remoteKeyIdC,
      });

      const res = await app.inject({
        method: 'POST',
        url: '/inbox',
        headers: signedHeaders,
        payload: announcePayload,
      });

      assert.equal(res.statusCode, 202);
      const resBody = res.json();
      assert.equal(resBody.success, true);
      assert.equal(resBody.data?.handled, true);
      assert.equal(resBody.data?.type, 'Announce');

      // Verify repostsCount incremented
      const post = await prisma.post.findUnique({ where: { id: localPost.id } });
      assert.equal(post.repostsCount, 1);

      // Verify Repost record created
      const shadowC = await prisma.user.findFirst({
        where: { federatedActorId: dbRemoteActorC.id },
      });
      const repostRecord = await prisma.repost.findUnique({
        where: {
          userId_postId: {
            userId: shadowC.id,
            postId: localPost.id,
          },
        },
      });
      assert.ok(repostRecord, 'Repost record must be created for shadow user');

      // Verify Notification recorded
      const notification = await prisma.notification.findFirst({
        where: {
          recipientId: localAuthor.id,
          targetId: localPost.id,
          verb: 'REPOST',
        },
      });
      assert.ok(notification, 'Notification must be recorded for local post author');
    });

    await t.test('7b. Inbound Announce Idempotency: duplicate Announce activity does not double increment', async () => {
      const localPostUri = `http://${testHost}/posts/${localPost.id}`;
      const announceId = `https://${remoteDomainC}/activities/announce_dup_${timestamp}`;

      const announcePayload = JSON.stringify({
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: announceId,
        type: 'Announce',
        actor: remoteActorUriC,
        object: localPostUri,
      });

      const signedHeaders = signMockInboundRequest({
        method: 'POST',
        path: '/inbox',
        body: announcePayload,
        privateKeyPem: remoteActorKeyC.privateKeyPem,
        keyId: remoteKeyIdC,
      });

      const res = await app.inject({
        method: 'POST',
        url: '/inbox',
        headers: signedHeaders,
        payload: announcePayload,
      });

      assert.equal(res.statusCode, 202);

      // Counter must remain 1
      const post = await prisma.post.findUnique({ where: { id: localPost.id } });
      assert.equal(post.repostsCount, 1);
    });

    // -------------------------------------------------------------------------
    // 8. Inbound Undo(Announce) via POST /inbox
    // -------------------------------------------------------------------------
    await t.test('8a. Inbound Undo(Announce): remote actor unreposts local post, decrements counter, removes Repost record', async () => {
      const localPostUri = `http://${testHost}/posts/${localPost.id}`;
      const undoAnnounceId = `https://${remoteDomainC}/activities/undo_announce_${timestamp}`;

      const undoPayload = JSON.stringify({
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: undoAnnounceId,
        type: 'Undo',
        actor: remoteActorUriC,
        object: {
          id: `https://${remoteDomainC}/activities/announce_${timestamp}`,
          type: 'Announce',
          actor: remoteActorUriC,
          object: localPostUri,
        },
      });

      const signedHeaders = signMockInboundRequest({
        method: 'POST',
        path: '/inbox',
        body: undoPayload,
        privateKeyPem: remoteActorKeyC.privateKeyPem,
        keyId: remoteKeyIdC,
      });

      const res = await app.inject({
        method: 'POST',
        url: '/inbox',
        headers: signedHeaders,
        payload: undoPayload,
      });

      assert.equal(res.statusCode, 202);

      // Counter must decrement to 0
      const post = await prisma.post.findUnique({ where: { id: localPost.id } });
      assert.equal(post.repostsCount, 0);

      // Repost record removed
      const shadowC = await prisma.user.findFirst({
        where: { federatedActorId: dbRemoteActorC.id },
      });
      const repostRecord = await prisma.repost.findUnique({
        where: {
          userId_postId: {
            userId: shadowC.id,
            postId: localPost.id,
          },
        },
      });
      assert.equal(repostRecord, null);
    });
  } finally {
    // Teardown test entities
    await prisma.activityDeliveryJob.deleteMany({});
    await prisma.notification.deleteMany({
      where: {
        recipientId: { in: [localAuthor.id, localActor.id] },
      },
    });
    await prisma.like.deleteMany({
      where: {
        postId: { in: [localPost.id, remotePost.id] },
      },
    });
    await prisma.repost.deleteMany({
      where: {
        postId: { in: [localPost.id, remotePost.id] },
      },
    });
    await prisma.federatedFollow.deleteMany({
      where: {
        localUserId: { in: [localAuthor.id, localActor.id] },
      },
    });
    await prisma.post.deleteMany({
      where: {
        id: { in: [localPost.id, remotePost.id] },
      },
    });

    const shadows = await prisma.user.findMany({
      where: {
        federatedActorId: { in: [dbRemoteActorA.id, dbRemoteActorB.id, dbRemoteActorC.id] },
      },
    });
    if (shadows.length > 0) {
      await prisma.user.deleteMany({
        where: { id: { in: shadows.map((s) => s.id) } },
      });
    }

    await prisma.federatedActor.deleteMany({
      where: {
        id: { in: [dbRemoteActorA.id, dbRemoteActorB.id, dbRemoteActorC.id] },
      },
    });

    await prisma.user.deleteMany({
      where: {
        id: { in: [localAuthor.id, localActor.id, shadowUserA.id] },
      },
    });
  }
});

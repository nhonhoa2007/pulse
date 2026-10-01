import test, { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { app } from '../src/app.ts';
import { prisma } from '../src/db/PrismaClientSingleton.ts';

describe('TASK-21: Private Accounts & Follow Requests Finite State Machine (FSM) Suite', () => {
  const timestamp = Date.now();

  // Test users
  let alice = null;    // Private account owner
  let aliceToken = null;
  let bob = null;      // Public account owner
  let bobToken = null;
  let charlie = null;  // Requester user (will be accepted)
  let charlieToken = null;
  let david = null;    // Requester user (will be rejected / canceled)
  let davidToken = null;
  let eve = null;      // Stranger / attacker user for IDOR checks
  let eveToken = null;

  let alicePost1 = null;
  let alicePost2 = null;
  let followRequestId = null;

  const createdUserIds = new Set();

  after(async () => {
    if (createdUserIds.size > 0) {
      const ids = Array.from(createdUserIds);
      await prisma.timelineInbox.deleteMany({ where: { userId: { in: ids } } });
      await prisma.notification.deleteMany({
        where: { OR: [{ recipientId: { in: ids } }, { actorId: { in: ids } }] },
      });
      await prisma.followRequest.deleteMany({
        where: { OR: [{ requesterId: { in: ids } }, { targetUserId: { in: ids } }] },
      });
      await prisma.follow.deleteMany({
        where: { OR: [{ followerId: { in: ids } }, { followingId: { in: ids } }] },
      });
      await prisma.block.deleteMany({
        where: { OR: [{ blockerId: { in: ids } }, { blockedId: { in: ids } }] },
      });
      await prisma.post.deleteMany({ where: { authorId: { in: ids } } });
      await prisma.refreshToken.deleteMany({ where: { userId: { in: ids } } });
      await prisma.revokedToken.deleteMany({ where: { userId: { in: ids } } });
      await prisma.user.deleteMany({ where: { id: { in: ids } } });
    }
  });

  // Helper to register a test user
  async function registerUser(prefix, displayName) {
    const username = `${prefix}_${timestamp}`;
    const email = `${prefix}_${timestamp}@pulse.social`;
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        username,
        email,
        password: 'Password123!',
        displayName,
      },
    });
    assert.equal(res.statusCode, 201, `Failed to register ${prefix}`);
    const body = res.json();
    createdUserIds.add(body.data.user.id);
    return {
      user: body.data.user,
      token: body.data.accessToken,
    };
  }

  // =========================================================================
  // SETUP: INITIALIZE ACTORS
  // =========================================================================
  before(async () => {
    const uAlice = await registerUser('fsm_alice', 'Alice Private');
    alice = uAlice.user;
    aliceToken = uAlice.token;

    const uBob = await registerUser('fsm_bob', 'Bob Public');
    bob = uBob.user;
    bobToken = uBob.token;

    const uCharlie = await registerUser('fsm_charlie', 'Charlie Requester');
    charlie = uCharlie.user;
    charlieToken = uCharlie.token;

    const uDavid = await registerUser('fsm_david', 'David RejectionTarget');
    david = uDavid.user;
    davidToken = uDavid.token;

    const uEve = await registerUser('fsm_eve', 'Eve IDORAttacker');
    eve = uEve.user;
    eveToken = uEve.token;
  });

  // =========================================================================
  // PILLAR 1: ACCOUNT PRIVACY TOGGLE & VALIDATION
  // =========================================================================
  describe('Pillar 1: Account Privacy Toggle & Input Validation', () => {
    it('1.1 Newly registered users have default isPrivate: false', () => {
      assert.equal(alice.isPrivate, false);
      assert.equal(bob.isPrivate, false);
      assert.equal(charlie.isPrivate, false);
    });

    it('1.2 PATCH /api/v1/users/profile: toggles isPrivate to true and persists in PostgreSQL', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/v1/users/profile',
        headers: { authorization: `Bearer ${aliceToken}` },
        payload: { isPrivate: true },
      });

      assert.equal(res.statusCode, 200);
      const body = res.json();
      assert.equal(body.success, true);
      assert.equal(body.data.isPrivate, true, 'isPrivate must be updated to true');

      // Verify in DB
      const userInDb = await prisma.user.findUnique({ where: { id: alice.id } });
      assert.equal(userInDb.isPrivate, true);
      alice.isPrivate = true;
    });

    it('1.3 PATCH /api/v1/users/profile: rejects non-boolean isPrivate values with 400 INVALID_IS_PRIVATE', async () => {
      const invalidValues = ['true', 'false', 1, 0, null, {}, []];

      for (const val of invalidValues) {
        const res = await app.inject({
          method: 'PATCH',
          url: '/api/v1/users/profile',
          headers: { authorization: `Bearer ${aliceToken}` },
          payload: { isPrivate: val },
        });

        assert.equal(res.statusCode, 400, `Value ${JSON.stringify(val)} must return 400`);
        const body = res.json();
        assert.equal(body.success, false);
        assert.equal(body.error.code, 'INVALID_IS_PRIVATE');
      }
    });

    it('1.4 PATCH /api/v1/users/profile: rejects unauthenticated requests with 401', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/v1/users/profile',
        payload: { isPrivate: true },
      });

      assert.equal(res.statusCode, 401);
    });

    it('1.5 Alice creates posts while private for content shield testing', async () => {
      const p1Res = await app.inject({
        method: 'POST',
        url: '/api/v1/posts',
        headers: { authorization: `Bearer ${aliceToken}` },
        payload: { content: 'Alice Private Secret Post #private #exclusive' },
      });
      assert.equal(p1Res.statusCode, 201);
      alicePost1 = p1Res.json().data;

      const p2Res = await app.inject({
        method: 'POST',
        url: '/api/v1/posts',
        headers: { authorization: `Bearer ${aliceToken}` },
        payload: { content: 'Alice Second Secret Note for Followers Only' },
      });
      assert.equal(p2Res.statusCode, 201);
      alicePost2 = p2Res.json().data;
    });
  });

  // =========================================================================
  // PILLAR 2: PUBLIC VS PRIVATE FOLLOW INITIATION FSM
  // =========================================================================
  describe('Pillar 2: Public vs Private Follow Initiation FSM', () => {
    it('2.1 Following a Public User (Bob): creates Follow immediately, increments counts, returns FOLLOWING', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/users/${bob.id}/follow`,
        headers: { authorization: `Bearer ${charlieToken}` },
      });

      assert.equal(res.statusCode, 200);
      const body = res.json();
      assert.equal(body.success, true);
      assert.equal(body.data.status, 'FOLLOWING');
      assert.equal(body.data.isFollowing, true);
      assert.equal(body.data.hasPendingFollowRequest, false);
      assert.equal(body.data.followRequest, null);

      // Verify Follow record exists in PostgreSQL
      const followInDb = await prisma.follow.findUnique({
        where: {
          followerId_followingId: {
            followerId: charlie.id,
            followingId: bob.id,
          },
        },
      });
      assert.ok(followInDb, 'Follow record must be created immediately for public account');

      // Verify follower and following counts incremented
      const [bobDb, charlieDb] = await Promise.all([
        prisma.user.findUnique({ where: { id: bob.id } }),
        prisma.user.findUnique({ where: { id: charlie.id } }),
      ]);
      assert.equal(bobDb.followersCount, 1);
      assert.equal(charlieDb.followingCount, 1);
    });

    it('2.2 Following a Private User (Alice): creates FollowRequest (PENDING), returns REQUESTED, NO Follow record', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/users/${alice.id}/follow`,
        headers: { authorization: `Bearer ${charlieToken}` },
      });

      assert.equal(res.statusCode, 200);
      const body = res.json();
      assert.equal(body.success, true);
      assert.equal(body.data.status, 'REQUESTED');
      assert.equal(body.data.isFollowing, false);
      assert.equal(body.data.hasPendingFollowRequest, true);
      assert.ok(body.data.followRequest);
      assert.equal(body.data.followRequest.status, 'PENDING');
      assert.equal(body.data.followRequest.requesterId, charlie.id);
      assert.equal(body.data.followRequest.targetUserId, alice.id);

      followRequestId = body.data.followRequest.id;

      // Invariant: Follow record must NOT exist
      const followInDb = await prisma.follow.findUnique({
        where: {
          followerId_followingId: {
            followerId: charlie.id,
            followingId: alice.id,
          },
        },
      });
      assert.equal(followInDb, null, 'Follow record must NOT exist while request is PENDING');

      // Invariant: Followers count must NOT increment
      const aliceDb = await prisma.user.findUnique({ where: { id: alice.id } });
      assert.equal(aliceDb.followersCount, 0, 'Private account followersCount must remain 0');

      // Notification check: Alice receives notification verb FOLLOW_REQUEST
      const notif = await prisma.notification.findFirst({
        where: {
          recipientId: alice.id,
          actorId: charlie.id,
          verb: 'FOLLOW_REQUEST',
        },
      });
      assert.ok(notif, 'Alice must receive FOLLOW_REQUEST notification');
    });

    it('2.3 Idempotency: Re-calling follow on private account while PENDING returns existing request without duplicates', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/users/${alice.id}/follow`,
        headers: { authorization: `Bearer ${charlieToken}` },
      });

      assert.equal(res.statusCode, 200);
      const body = res.json();
      assert.equal(body.data.status, 'REQUESTED');
      assert.equal(body.data.hasPendingFollowRequest, true);
      assert.equal(body.data.followRequest.id, followRequestId, 'Must return the same existing request ID');

      // Verify only 1 request exists in DB
      const reqCount = await prisma.followRequest.count({
        where: { requesterId: charlie.id, targetUserId: alice.id },
      });
      assert.equal(reqCount, 1, 'Must not duplicate FollowRequest records');
    });

    it('2.4 Self-follow rejection: User cannot follow themselves (400 CANNOT_FOLLOW_SELF)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/users/${alice.id}/follow`,
        headers: { authorization: `Bearer ${aliceToken}` },
      });

      assert.equal(res.statusCode, 400);
      const body = res.json();
      assert.equal(body.success, false);
      assert.equal(body.error.code, 'CANNOT_FOLLOW_SELF');
    });

    it('2.5 Target not found: Following a non-existent user returns 404 USER_NOT_FOUND', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/users/00000000-0000-0000-0000-000000000000/follow',
        headers: { authorization: `Bearer ${charlieToken}` },
      });

      assert.equal(res.statusCode, 404);
      assert.equal(res.json().error.code, 'USER_NOT_FOUND');
    });
  });

  // =========================================================================
  // PILLAR 3: PENDING FOLLOW REQUESTS INBOX & CANCELLATION
  // =========================================================================
  describe('Pillar 3: Pending Follow Requests Inbox & Cancellation Flow', () => {
    it('3.1 GET /api/v1/users/follow-requests: Alice sees pending request with requester profile metadata', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/users/follow-requests',
        headers: { authorization: `Bearer ${aliceToken}` },
      });

      assert.equal(res.statusCode, 200);
      const body = res.json();
      assert.equal(body.success, true);
      assert.ok(Array.isArray(body.data));
      assert.ok(body.data.length >= 1);

      const targetReq = body.data.find((r) => r.id === followRequestId);
      assert.ok(targetReq);
      assert.equal(targetReq.status, 'PENDING');
      assert.equal(targetReq.requester.username, charlie.username);
      assert.equal(targetReq.requester.displayName, charlie.displayName);
    });

    it('3.2 GET /api/v1/users/follow-requests: Charlie and Eve see empty list (strict user isolation)', async () => {
      const [charlieRes, eveRes] = await Promise.all([
        app.inject({
          method: 'GET',
          url: '/api/v1/users/follow-requests',
          headers: { authorization: `Bearer ${charlieToken}` },
        }),
        app.inject({
          method: 'GET',
          url: '/api/v1/users/follow-requests',
          headers: { authorization: `Bearer ${eveToken}` },
        }),
      ]);

      assert.equal(charlieRes.statusCode, 200);
      assert.equal(charlieRes.json().data.length, 0);

      assert.equal(eveRes.statusCode, 200);
      assert.equal(eveRes.json().data.length, 0);
    });

    it('3.3 GET /api/v1/users/follow-requests: rejects unauthenticated requests with 401', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/users/follow-requests',
      });
      assert.equal(res.statusCode, 401);
    });

    it('3.4 Cancellation Flow: David sends follow request to Alice, then cancels it via DELETE endpoint', async () => {
      // 1. David follows Alice
      const sendRes = await app.inject({
        method: 'POST',
        url: `/api/v1/users/${alice.id}/follow`,
        headers: { authorization: `Bearer ${davidToken}` },
      });
      assert.equal(sendRes.statusCode, 200);
      assert.equal(sendRes.json().data.status, 'REQUESTED');
      const davidReqId = sendRes.json().data.followRequest.id;

      // Verify request exists in DB
      let reqInDb = await prisma.followRequest.findUnique({ where: { id: davidReqId } });
      assert.ok(reqInDb);
      assert.equal(reqInDb.status, 'PENDING');

      // 2. David cancels request via DELETE /api/v1/users/:targetUserId/follow-request
      const cancelRes = await app.inject({
        method: 'DELETE',
        url: `/api/v1/users/${alice.id}/follow-request`,
        headers: { authorization: `Bearer ${davidToken}` },
      });

      assert.equal(cancelRes.statusCode, 200);
      assert.equal(cancelRes.json().success, true);

      // Verify request is deleted from PostgreSQL
      reqInDb = await prisma.followRequest.findUnique({ where: { id: davidReqId } });
      assert.equal(reqInDb, null, 'Pending follow request must be deleted upon cancellation');

      // Verify David profile check on Alice shows no pending request
      const profRes = await app.inject({
        method: 'GET',
        url: `/api/v1/users/${alice.username}`,
        headers: { authorization: `Bearer ${davidToken}` },
      });
      assert.equal(profRes.json().data.hasPendingFollowRequest, false);
    });
  });

  // =========================================================================
  // PILLAR 4: FOLLOW REQUEST APPROVAL FSM & TIMELINE FAN-OUT
  // =========================================================================
  describe('Pillar 4: Follow Request Approval FSM & Timeline Fan-Out', () => {
    it('4.1 IDOR Defense: Attacker Eve cannot accept Charlie follow request to Alice (403 FORBIDDEN)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/users/follow-requests/${followRequestId}/accept`,
        headers: { authorization: `Bearer ${eveToken}` },
      });

      assert.equal(res.statusCode, 403);
      const body = res.json();
      assert.equal(body.success, false);
      assert.equal(body.error.code, 'FORBIDDEN');
    });

    it('4.2 Target Alice accepts Charlie follow request: updates status, inserts Follow, increments counters & fans out posts', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/users/follow-requests/${followRequestId}/accept`,
        headers: { authorization: `Bearer ${aliceToken}` },
      });

      assert.equal(res.statusCode, 200);
      const body = res.json();
      assert.equal(body.success, true);
      assert.equal(body.data.status, 'ACCEPTED');

      // Verify Follow record exists in PostgreSQL
      const followInDb = await prisma.follow.findUnique({
        where: {
          followerId_followingId: {
            followerId: charlie.id,
            followingId: alice.id,
          },
        },
      });
      assert.ok(followInDb, 'Follow record must be inserted in DB upon approval');

      // Verify counter increments
      const [aliceDb, charlieDb] = await Promise.all([
        prisma.user.findUnique({ where: { id: alice.id } }),
        prisma.user.findUnique({ where: { id: charlie.id } }),
      ]);
      assert.equal(aliceDb.followersCount, 1, 'Alice followersCount must be incremented to 1');
      assert.equal(charlieDb.followingCount, 2, 'Charlie followingCount must be incremented to 2 (Bob + Alice)');

      // Verify Timeline Fan-Out: Alice's posts backfilled into Charlie's TimelineInbox
      const charlieInbox = await prisma.timelineInbox.findMany({
        where: { userId: charlie.id, authorId: alice.id },
      });
      assert.ok(charlieInbox.length >= 2, 'Alice existing posts must be backfilled into Charlie timelineInbox');

      // Verify Notification: Charlie receives FOLLOW_ACCEPT
      const notif = await prisma.notification.findFirst({
        where: {
          recipientId: charlie.id,
          actorId: alice.id,
          verb: 'FOLLOW_ACCEPT',
        },
      });
      assert.ok(notif, 'Charlie must receive FOLLOW_ACCEPT notification');
    });

    it('4.3 Idempotency: Repeating accept call on already-accepted request returns 200 with ACCEPTED status and does NOT duplicate counts', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/users/follow-requests/${followRequestId}/accept`,
        headers: { authorization: `Bearer ${aliceToken}` },
      });

      assert.equal(res.statusCode, 200);
      assert.equal(res.json().data.status, 'ACCEPTED');

      // Verify counters did NOT double increment
      const aliceDb = await prisma.user.findUnique({ where: { id: alice.id } });
      assert.equal(aliceDb.followersCount, 1, 'Followers count must remain 1');
    });
  });

  // =========================================================================
  // PILLAR 5: FOLLOW REQUEST REJECTION FSM & RE-REQUEST
  // =========================================================================
  describe('Pillar 5: Follow Request Rejection FSM & Re-Request Dynamics', () => {
    let rejectionReqId = null;

    before(async () => {
      // David requests to follow Alice
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/users/${alice.id}/follow`,
        headers: { authorization: `Bearer ${davidToken}` },
      });
      assert.equal(res.statusCode, 200);
      rejectionReqId = res.json().data.followRequest.id;
    });

    it('5.1 IDOR Defense: Attacker Eve cannot reject David request to Alice (403 FORBIDDEN)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/users/follow-requests/${rejectionReqId}/reject`,
        headers: { authorization: `Bearer ${eveToken}` },
      });

      assert.equal(res.statusCode, 403);
      assert.equal(res.json().error.code, 'FORBIDDEN');
    });

    it('5.2 Target Alice rejects David follow request: status becomes REJECTED, NO Follow record created', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/users/follow-requests/${rejectionReqId}/reject`,
        headers: { authorization: `Bearer ${aliceToken}` },
      });

      assert.equal(res.statusCode, 200);
      const body = res.json();
      assert.equal(body.success, true);
      assert.equal(body.data.status, 'REJECTED');

      // Verify NO Follow record exists
      const followInDb = await prisma.follow.findUnique({
        where: {
          followerId_followingId: {
            followerId: david.id,
            followingId: alice.id,
          },
        },
      });
      assert.equal(followInDb, null, 'Follow record must NOT be created on rejection');

      // Alice followersCount must still be 1 (only Charlie)
      const aliceDb = await prisma.user.findUnique({ where: { id: alice.id } });
      assert.equal(aliceDb.followersCount, 1);
    });

    it('5.3 Re-request after rejection: David sends follow request again, updates status from REJECTED back to PENDING', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/users/${alice.id}/follow`,
        headers: { authorization: `Bearer ${davidToken}` },
      });

      assert.equal(res.statusCode, 200);
      const body = res.json();
      assert.equal(body.data.status, 'REQUESTED');
      assert.equal(body.data.hasPendingFollowRequest, true);
      assert.equal(body.data.followRequest.status, 'PENDING');

      // Cleanup: David cancels this request
      await app.inject({
        method: 'DELETE',
        url: `/api/v1/users/${alice.id}/follow-request`,
        headers: { authorization: `Bearer ${davidToken}` },
      });
    });
  });

  // =========================================================================
  // PILLAR 6: PRIVACY GATES & ZERO CONTENT LEAKAGE
  // =========================================================================
  describe('Pillar 6: Privacy Gates & Content Shield Lockdown', () => {
    it('6.1 Profile View: Stranger Eve sees isLocked: true and hasPendingFollowRequest: false', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/users/${alice.username}`,
        headers: { authorization: `Bearer ${eveToken}` },
      });

      assert.equal(res.statusCode, 200);
      const profile = res.json().data;
      assert.equal(profile.isPrivate, true);
      assert.equal(profile.isLocked, true, 'isLocked must be true for unapproved stranger');
      assert.equal(profile.isFollowing, false);
      assert.equal(profile.hasPendingFollowRequest, false);
    });

    it('6.2 Profile View: Approved follower Charlie sees isLocked: false and isFollowing: true', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/users/${alice.username}`,
        headers: { authorization: `Bearer ${charlieToken}` },
      });

      assert.equal(res.statusCode, 200);
      const profile = res.json().data;
      assert.equal(profile.isPrivate, true);
      assert.equal(profile.isLocked, false);
      assert.equal(profile.isFollowing, true);
    });

    it('6.3 Profile View: Author Alice viewing her own profile sees isLocked: false (Author bypass)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/users/${alice.username}`,
        headers: { authorization: `Bearer ${aliceToken}` },
      });

      assert.equal(res.statusCode, 200);
      const profile = res.json().data;
      assert.equal(profile.isLocked, false, 'Author must bypass profile lock');
    });

    it('6.4 Content Shield: Stranger Eve viewing GET /users/:username/posts receives posts: [] and isLocked: true (ZERO LEAKAGE)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/users/${alice.username}/posts`,
        headers: { authorization: `Bearer ${eveToken}` },
      });

      assert.equal(res.statusCode, 200);
      const body = res.json();
      assert.equal(body.data.isLocked, true);
      assert.deepEqual(body.data.posts, [], 'Must return strictly empty posts array for unapproved viewer');
    });

    it('6.5 Content Shield: Approved follower Charlie viewing GET /users/:username/posts receives full posts list', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/users/${alice.username}/posts`,
        headers: { authorization: `Bearer ${charlieToken}` },
      });

      assert.equal(res.statusCode, 200);
      const body = res.json();
      assert.equal(body.data.isLocked, undefined);
      assert.ok(body.data.posts.length >= 2, 'Approved follower can view private posts');
      const postIds = body.data.posts.map((p) => p.id);
      assert.ok(postIds.includes(alicePost1.id));
      assert.ok(postIds.includes(alicePost2.id));
    });

    it('6.6 Followers List Privacy Gate: Stranger Eve cannot view followers of private user (403 ACCOUNT_LOCKED)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/users/${alice.username}/followers`,
        headers: { authorization: `Bearer ${eveToken}` },
      });

      assert.equal(res.statusCode, 403);
      assert.equal(res.json().error.code, 'ACCOUNT_LOCKED');
    });

    it('6.7 Following List Privacy Gate: Stranger Eve cannot view following list of private user (403 ACCOUNT_LOCKED)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/users/${alice.username}/following`,
        headers: { authorization: `Bearer ${eveToken}` },
      });

      assert.equal(res.statusCode, 403);
      assert.equal(res.json().error.code, 'ACCOUNT_LOCKED');
    });

    it('6.8 Approved Follower Charlie can view Alice followers and following lists (200 OK)', async () => {
      const [followersRes, followingRes] = await Promise.all([
        app.inject({
          method: 'GET',
          url: `/api/v1/users/${alice.username}/followers`,
          headers: { authorization: `Bearer ${charlieToken}` },
        }),
        app.inject({
          method: 'GET',
          url: `/api/v1/users/${alice.username}/following`,
          headers: { authorization: `Bearer ${charlieToken}` },
        }),
      ]);

      assert.equal(followersRes.statusCode, 200);
      assert.equal(followingRes.statusCode, 200);
    });

    it('6.9 Single Post Detail Gate: Stranger Eve attempting to read GET /posts/:id gets 404 POST_NOT_FOUND', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/posts/${alicePost1.id}`,
        headers: { authorization: `Bearer ${eveToken}` },
      });

      assert.equal(res.statusCode, 404);
      assert.equal(res.json().error.code, 'POST_NOT_FOUND');
    });

    it('6.10 Single Post Detail Gate: Approved follower Charlie can read GET /posts/:id (200 OK)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/posts/${alicePost1.id}`,
        headers: { authorization: `Bearer ${charlieToken}` },
      });

      assert.equal(res.statusCode, 200);
      assert.equal(res.json().data.id, alicePost1.id);
    });

    it('6.11 Conversation Thread Gate: Stranger Eve attempting to read GET /posts/:id/thread gets 404 THREAD_NOT_FOUND', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/posts/${alicePost1.id}/thread`,
        headers: { authorization: `Bearer ${eveToken}` },
      });

      assert.equal(res.statusCode, 404);
      assert.equal(res.json().error.code, 'THREAD_NOT_FOUND');
    });

    it('6.12 Conversation Thread Gate: Approved follower Charlie can read GET /posts/:id/thread (200 OK)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/posts/${alicePost1.id}/thread`,
        headers: { authorization: `Bearer ${charlieToken}` },
      });

      assert.equal(res.statusCode, 200);
      assert.ok(res.json().data.rootPost);
      assert.equal(res.json().data.rootPost.id, alicePost1.id);
    });

    it('6.13 ActivityPub Outbox Lockdown: GET /users/:username/outbox returns empty OrderedCollection for private accounts', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/users/${alice.username}/outbox`,
        headers: { accept: 'application/activity+json' },
      });

      assert.equal(res.statusCode, 200);
      const outbox = res.json();
      assert.equal(outbox.totalItems, 0, 'Private account outbox must report 0 items to prevent Fediverse data leakage');
      assert.equal(outbox.type, 'OrderedCollection');

      // Verify page query returns empty orderedItems
      const pageRes = await app.inject({
        method: 'GET',
        url: `/users/${alice.username}/outbox?page=true`,
        headers: { accept: 'application/activity+json' },
      });
      assert.equal(pageRes.statusCode, 200);
      const pageData = pageRes.json();
      assert.equal(pageData.totalItems, 0);
      assert.deepEqual(pageData.orderedItems, []);
    });

    it('6.14 Algorithmic For-You Feed Gate: Alice private posts never appear in For-You feed for stranger Eve', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/feed/for-you',
        headers: { authorization: `Bearer ${eveToken}` },
      });

      assert.equal(res.statusCode, 200);
      const feedItems = res.json().data.items || [];
      const leaked = feedItems.filter((item) => item.authorId === alice.id);
      assert.equal(leaked.length, 0, 'No posts from private account should leak into For-You feed of stranger');
    });

    it('6.15 Search Gate: Alice private posts never appear in search results for stranger Eve', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/search?q=Secret',
        headers: { authorization: `Bearer ${eveToken}` },
      });

      assert.equal(res.statusCode, 200);
      const posts = res.json().data.posts || [];
      const leaked = posts.filter((p) => p.authorId === alice.id);
      assert.equal(leaked.length, 0, 'No posts from private account should appear in search for non-follower');
    });
  });

  // =========================================================================
  // PILLAR 7: TWO-WAY SOCIAL GRAPH BLOCK INVARIANTS
  // =========================================================================
  describe('Pillar 7: Two-Way Social Graph Block Invariants', () => {
    it('7.1 Blocking wipes pending follow requests and forbids new requests with 403 USER_BLOCKED', async () => {
      // 1. Eve requests to follow Alice
      const reqRes = await app.inject({
        method: 'POST',
        url: `/api/v1/users/${alice.id}/follow`,
        headers: { authorization: `Bearer ${eveToken}` },
      });
      assert.equal(reqRes.statusCode, 200);
      assert.equal(reqRes.json().data.status, 'REQUESTED');

      // 2. Alice blocks Eve
      const blockRes = await app.inject({
        method: 'POST',
        url: '/api/v1/graph/block',
        headers: { authorization: `Bearer ${aliceToken}` },
        payload: { targetUserId: eve.id },
      });
      assert.equal(blockRes.statusCode, 200);

      // Verify pending request between Alice and Eve was completely purged
      const reqsInDb = await prisma.followRequest.findMany({
        where: {
          OR: [
            { requesterId: eve.id, targetUserId: alice.id },
            { requesterId: alice.id, targetUserId: eve.id },
          ],
        },
      });
      assert.equal(reqsInDb.length, 0, 'Block must purge all follow requests both ways');

      // 3. Blocked user Eve cannot send follow request to Alice (403 USER_BLOCKED)
      const blockedFollow = await app.inject({
        method: 'POST',
        url: `/api/v1/users/${alice.id}/follow`,
        headers: { authorization: `Bearer ${eveToken}` },
      });
      assert.equal(blockedFollow.statusCode, 403);
      assert.equal(blockedFollow.json().error.code, 'USER_BLOCKED');

      // 4. Blocker Alice cannot send follow request to blocked user Eve (403 USER_BLOCKED)
      const blockerFollow = await app.inject({
        method: 'POST',
        url: `/api/v1/users/${eve.id}/follow`,
        headers: { authorization: `Bearer ${aliceToken}` },
      });
      assert.equal(blockerFollow.statusCode, 403);
      assert.equal(blockerFollow.json().error.code, 'USER_BLOCKED');
    });
  });

  // =========================================================================
  // PILLAR 8: UNFOLLOW DYNAMICS & IMMEDIATE RE-LOCKING
  // =========================================================================
  describe('Pillar 8: Unfollow Dynamics & Immediate Re-Locking', () => {
    it('8.1 Unfollowing a private account removes relationship, decrements counts, and immediately re-locks content', async () => {
      // Charlie was approved and following Alice
      const unfollowRes = await app.inject({
        method: 'POST',
        url: `/api/v1/users/${alice.id}/unfollow`,
        headers: { authorization: `Bearer ${charlieToken}` },
      });

      assert.equal(unfollowRes.statusCode, 200);
      assert.equal(unfollowRes.json().data.unfollowed, true);

      // Verify Follow record is deleted
      const followInDb = await prisma.follow.findUnique({
        where: {
          followerId_followingId: {
            followerId: charlie.id,
            followingId: alice.id,
          },
        },
      });
      assert.equal(followInDb, null, 'Follow record must be removed');

      // Verify counter decremented
      const aliceDb = await prisma.user.findUnique({ where: { id: alice.id } });
      assert.equal(aliceDb.followersCount, 0, 'Alice followersCount must drop back to 0');

      // Verify Charlie is immediately blocked from viewing posts (Immediate Re-Locking)
      const postsRes = await app.inject({
        method: 'GET',
        url: `/api/v1/users/${alice.username}/posts`,
        headers: { authorization: `Bearer ${charlieToken}` },
      });
      assert.equal(postsRes.statusCode, 200);
      assert.equal(postsRes.json().data.isLocked, true, 'Content must immediately re-lock upon unfollow');
      assert.deepEqual(postsRes.json().data.posts, []);
    });
  });
});

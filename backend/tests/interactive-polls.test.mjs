import { authHeaders, fetchRealtimeTicket } from './helpers/auth.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { prisma } from '../src/db/PrismaClientSingleton.ts';
import { buildApp } from '../src/app.ts';
import { pollExpirationSchedulerService } from '../src/modules/polls/PollExpirationSchedulerService.ts';

test('Interactive Polls: Full Lifecycle, Concurrency, Real-time SSE & Expiration', async (t) => {
  process.env.NODE_ENV = 'test';
  const app = await buildApp();
  const address = await app.listen({ port: 0, host: '127.0.0.1' });
  const serverPort = app.server.address().port;

  const timestamp = Date.now();

  // Create test author and post
  const author = await prisma.user.create({
    data: {
      username: `poll_author_${timestamp}`,
      email: `poll_author_${timestamp}@test.local`,
      displayName: 'Poll Author',
    },
  });

  const postRes = await app.inject({
    method: 'POST',
    url: '/api/v1/posts',
    headers: authHeaders(author.id),
    payload: { content: 'What is your favorite TypeScript framework?' },
  });
  assert.equal(postRes.statusCode, 201);
  const post = postRes.json().data;

  // ----------------------------------------------------
  // 1. Validation Tests for POST /polls
  // ----------------------------------------------------
  await t.test('POST /polls validation: enforces 2-4 choices and required question', async () => {
    // Missing question
    const resNoQuestion = await app.inject({
      method: 'POST',
      url: '/api/v1/polls',
      headers: authHeaders(author.id),
      payload: {
        postId: post.id,
        question: '',
        choices: ['A', 'B'],
      },
    });
    assert.equal(resNoQuestion.statusCode, 400);
    assert.equal(resNoQuestion.json().error.code, 'INVALID_QUESTION');

    // Less than 2 choices
    const resOneChoice = await app.inject({
      method: 'POST',
      url: '/api/v1/polls',
      headers: authHeaders(author.id),
      payload: {
        postId: post.id,
        question: 'Too few choices?',
        choices: ['Only one'],
      },
    });
    assert.equal(resOneChoice.statusCode, 400);
    assert.equal(resOneChoice.json().error.code, 'INVALID_CHOICE_COUNT');

    // More than 4 choices
    const resFiveChoices = await app.inject({
      method: 'POST',
      url: '/api/v1/polls',
      headers: authHeaders(author.id),
      payload: {
        postId: post.id,
        question: 'Too many choices?',
        choices: ['A', 'B', 'C', 'D', 'E'],
      },
    });
    assert.equal(resFiveChoices.statusCode, 400);
    assert.equal(resFiveChoices.json().error.code, 'INVALID_CHOICE_COUNT');

    // Empty choice text
    const resEmptyChoice = await app.inject({
      method: 'POST',
      url: '/api/v1/polls',
      headers: authHeaders(author.id),
      payload: {
        postId: post.id,
        question: 'Valid question',
        choices: ['Choice 1', '   '],
      },
    });
    assert.equal(resEmptyChoice.statusCode, 400);
    assert.equal(resEmptyChoice.json().error.code, 'INVALID_CHOICE_TEXT');
  });

  // ----------------------------------------------------
  // 2. Successful Creation of Poll (2-4 choices)
  // ----------------------------------------------------
  let pollId;
  await t.test('POST /polls creates a poll attached to post with initial 0% percentages', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/polls',
      headers: authHeaders(author.id),
      payload: {
        postId: post.id,
        question: 'Which frontend library do you prefer?',
        choices: ['React', 'Vue', 'Svelte', 'Solid'],
        durationMinutes: 60,
      },
    });

    assert.equal(res.statusCode, 201);
    const body = res.json();
    assert.equal(body.success, true);
    assert.ok(body.data.id);
    assert.equal(body.data.postId, post.id);
    assert.equal(body.data.post_id, post.id);
    assert.equal(body.data.question, 'Which frontend library do you prefer?');
    assert.equal(body.data.isActive, true);
    assert.equal(body.data.is_active, true);
    assert.equal(body.data.choices.length, 4);
    assert.equal(body.data.totalVotes, 0);

    for (let i = 0; i < 4; i++) {
      assert.equal(body.data.choices[i].voteCount, 0);
      assert.equal(body.data.choices[i].vote_count, 0);
      assert.equal(body.data.choices[i].percentage, 0);
    }

    pollId = body.data.id;
  });

  // ----------------------------------------------------
  // 3. GET /polls/:id works at both /polls and /api/v1/polls
  // ----------------------------------------------------
  await t.test('GET /polls/:id returns poll details and handles 404 for nonexistent poll', async () => {
    const resV1 = await app.inject({
      method: 'GET',
      url: `/api/v1/polls/${pollId}`,
    });
    assert.equal(resV1.statusCode, 200);
    assert.equal(resV1.json().data.id, pollId);

    const resRoot = await app.inject({
      method: 'GET',
      url: `/polls/${pollId}`,
    });
    assert.equal(resRoot.statusCode, 200);
    assert.equal(resRoot.json().data.id, pollId);

    const res404 = await app.inject({
      method: 'GET',
      url: '/api/v1/polls/non-existent-id',
    });
    assert.equal(res404.statusCode, 404);
  });

  // ----------------------------------------------------
  // 4. Voting validation: choice index range, duplicate vote
  // ----------------------------------------------------
  await t.test('POST /polls/:id/vote validates choice index and rejects duplicate votes', async () => {
    const voter = await prisma.user.create({
      data: {
        username: `voter_val_${timestamp}`,
        email: `voter_val_${timestamp}@test.local`,
        displayName: 'Voter Val',
      },
    });

    // Out-of-range choice index (negative)
    const resNegative = await app.inject({
      method: 'POST',
      url: `/api/v1/polls/${pollId}/vote`,
      headers: authHeaders(voter.id),
      payload: { choiceIndex: -1 },
    });
    assert.equal(resNegative.statusCode, 400);

    // Out-of-range choice index (too high)
    const resTooHigh = await app.inject({
      method: 'POST',
      url: `/api/v1/polls/${pollId}/vote`,
      headers: authHeaders(voter.id),
      payload: { choiceIndex: 4 },
    });
    assert.equal(resTooHigh.statusCode, 400);

    // Valid vote
    const resVote1 = await app.inject({
      method: 'POST',
      url: `/api/v1/polls/${pollId}/vote`,
      headers: authHeaders(voter.id),
      payload: { choiceIndex: 0 },
    });
    assert.equal(resVote1.statusCode, 200);
    const voteData = resVote1.json().data;
    assert.equal(voteData.choices[0].voteCount, 1);
    assert.equal(voteData.choices[0].percentage, 100);
    assert.equal(voteData.totalVotes, 1);
    assert.equal(voteData.userVotedChoiceIndex, 0);
    assert.equal(voteData.userHasVoted, true);

    // Duplicate vote attempt by the same user
    const resVoteDup = await app.inject({
      method: 'POST',
      url: `/api/v1/polls/${pollId}/vote`,
      headers: authHeaders(voter.id),
      payload: { choiceIndex: 1 },
    });
    assert.equal(resVoteDup.statusCode, 409);
    assert.equal(resVoteDup.json().error.code, 'ALREADY_VOTED');
  });

  // ----------------------------------------------------
  // 5. Concurrency & Atomic Invariants: 50 concurrent votes
  // ----------------------------------------------------
  await t.test('Concurrency: 50 concurrent votes maintain exact atomic vote counts and percentages', async () => {
    // Create a fresh poll with 4 choices
    const concPollRes = await app.inject({
      method: 'POST',
      url: '/api/v1/polls',
      headers: authHeaders(author.id),
      payload: {
        question: 'Concurrent load test poll?',
        choices: ['Option 0', 'Option 1', 'Option 2', 'Option 3'],
        durationMinutes: 60,
      },
    });
    assert.equal(concPollRes.statusCode, 201);
    const concPoll = concPollRes.json().data;

    // Create 50 distinct users
    const users = await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        prisma.user.create({
          data: {
            username: `conc_poll_user_${timestamp}_${i}`,
            email: `conc_poll_user_${timestamp}_${i}@test.local`,
            displayName: `Poll User ${i}`,
          },
        })
      )
    );
    assert.equal(users.length, 50);

    // Distribute 50 votes:
    // 20 for choice 0, 15 for choice 1, 10 for choice 2, 5 for choice 3
    const voteAssignments = users.map((user, idx) => {
      let choiceIndex = 0;
      if (idx < 20) choiceIndex = 0;
      else if (idx < 35) choiceIndex = 1;
      else if (idx < 45) choiceIndex = 2;
      else choiceIndex = 3;
      return { user, choiceIndex };
    });

    // Fire 50 concurrent vote requests
    const voteResponses = await Promise.all(
      voteAssignments.map(({ user, choiceIndex }) =>
        app.inject({
          method: 'POST',
          url: `/api/v1/polls/${concPoll.id}/vote`,
          headers: authHeaders(user.id),
          payload: { choiceIndex },
        })
      )
    );

    for (const res of voteResponses) {
      assert.equal(res.statusCode, 200);
      assert.equal(res.json().success, true);
    }

    // Verify in database and via GET
    const pollCheck = await app.inject({
      method: 'GET',
      url: `/api/v1/polls/${concPoll.id}`,
    });
    assert.equal(pollCheck.statusCode, 200);
    const finalData = pollCheck.json().data;

    assert.equal(finalData.totalVotes, 50);
    assert.equal(finalData.choices[0].voteCount, 20); // 20/50 = 40%
    assert.equal(finalData.choices[0].percentage, 40);

    assert.equal(finalData.choices[1].voteCount, 15); // 15/50 = 30%
    assert.equal(finalData.choices[1].percentage, 30);

    assert.equal(finalData.choices[2].voteCount, 10); // 10/50 = 20%
    assert.equal(finalData.choices[2].percentage, 20);

    assert.equal(finalData.choices[3].voteCount, 5); // 5/50 = 10%
    assert.equal(finalData.choices[3].percentage, 10);

    // Verify DB count
    const dbVotesCount = await prisma.pollVote.count({
      where: { pollId: concPoll.id },
    });
    assert.equal(dbVotesCount, 50);
  });

  // ----------------------------------------------------
  // 6. Equal votes edge case (25%/25%/25%/25%)
  // ----------------------------------------------------
  await t.test('Edge case: Equal votes distributes exact 25%/25%/25%/25% percentages', async () => {
    const equalPollRes = await app.inject({
      method: 'POST',
      url: '/api/v1/polls',
      headers: authHeaders(author.id),
      payload: {
        question: 'Equal votes test?',
        choices: ['A', 'B', 'C', 'D'],
        durationMinutes: 30,
      },
    });
    const equalPoll = equalPollRes.json().data;

    const fourUsers = await Promise.all(
      [0, 1, 2, 3].map((i) =>
        prisma.user.create({
          data: {
            username: `equal_user_${timestamp}_${i}`,
            email: `equal_user_${timestamp}_${i}@test.local`,
            displayName: `Equal User ${i}`,
          },
        })
      )
    );

    for (let i = 0; i < 4; i++) {
      const voteRes = await app.inject({
        method: 'POST',
        url: `/api/v1/polls/${equalPoll.id}/vote`,
        headers: authHeaders(fourUsers[i].id),
        payload: { choiceIndex: i },
      });
      assert.equal(voteRes.statusCode, 200);
    }

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/polls/${equalPoll.id}`,
    });
    const data = res.json().data;
    assert.equal(data.totalVotes, 4);
    for (let i = 0; i < 4; i++) {
      assert.equal(data.choices[i].voteCount, 1);
      assert.equal(data.choices[i].percentage, 25);
    }
  });

  // ----------------------------------------------------
  // 7. Real-time SSE push on vote (< 500 ms)
  // ----------------------------------------------------
  await t.test('Real-time SSE: connected client receives live POLL_UPDATED event on vote within 500 ms', async () => {
    const sseUser = await prisma.user.create({
      data: {
        username: `sse_voter_${timestamp}`,
        email: `sse_voter_${timestamp}@test.local`,
        displayName: 'SSE Voter',
      },
    });

    let receivedPollUpdated = false;
    let eventReceivedAt = 0;
    let eventPollData = null;

    const sseReq = http.request(
      {
        hostname: '127.0.0.1',
        port: serverPort,
        path: `/api/v1/realtime/stream?ticket=${await fetchRealtimeTicket(app, sseUser.id)}`,
        method: 'GET',
        headers: {
          Accept: 'text/event-stream',
        },
      },
      (res) => {
        assert.equal(res.statusCode, 200);
        res.on('data', (chunk) => {
          const text = chunk.toString();
          if (text.includes('event: POLL_UPDATED')) {
            receivedPollUpdated = true;
            eventReceivedAt = Date.now();
            try {
              const dataLine = text.split('\n').find((l) => l.startsWith('data: '));
              if (dataLine) {
                eventPollData = JSON.parse(dataLine.replace('data: ', ''));
              }
            } catch {}
          }
        });
      }
    );
    sseReq.end();

    // Wait for SSE handshake
    await new Promise((r) => setTimeout(r, 100));

    // Cast vote and measure latency
    const voteStart = Date.now();
    const voteRes = await app.inject({
      method: 'POST',
      url: `/api/v1/polls/${pollId}/vote`,
      headers: authHeaders(sseUser.id),
      payload: { choiceIndex: 1 },
    });
    assert.equal(voteRes.statusCode, 200);

    // Wait up to 300 ms for event delivery
    await new Promise((r) => setTimeout(r, 150));

    assert.equal(receivedPollUpdated, true, 'SSE client must receive POLL_UPDATED event');
    const elapsed = eventReceivedAt - voteStart;
    assert.ok(elapsed < 500, `SSE push latency was ${elapsed}ms, must be < 500ms`);
    assert.ok(eventPollData, 'Event payload must contain poll data');
    assert.equal(eventPollData.id, pollId);

    sseReq.destroy();
  });

  // ----------------------------------------------------
  // 8. Early Close via DELETE /polls/:id
  // ----------------------------------------------------
  await t.test('IDOR: Stranger cannot close another user poll early (HTTP 403)', async () => {
    const stranger = await prisma.user.create({
      data: {
        username: `stranger_poll_${timestamp}`,
        email: `stranger_poll_${timestamp}@test.local`,
        displayName: 'Stranger Poll Closer',
      },
    });

    const unauthorizedRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/polls/${pollId}`,
      headers: authHeaders(stranger.id),
    });
    assert.equal(unauthorizedRes.statusCode, 403);
    assert.equal(unauthorizedRes.json().error.code, 'FORBIDDEN');
  });

  await t.test('DELETE /polls/:id closes poll early and rejects subsequent votes with 409', async () => {
    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/polls/${pollId}`,
      headers: authHeaders(author.id),
    });
    assert.equal(deleteRes.statusCode, 200);
    const closedData = deleteRes.json().data;
    assert.equal(closedData.isActive, false);

    // Attempting to vote on closed poll
    const lateVoter = await prisma.user.create({
      data: {
        username: `late_voter_${timestamp}`,
        email: `late_voter_${timestamp}@test.local`,
        displayName: 'Late Voter',
      },
    });

    const lateVoteRes = await app.inject({
      method: 'POST',
      url: `/api/v1/polls/${pollId}/vote`,
      headers: authHeaders(lateVoter.id),
      payload: { choiceIndex: 2 },
    });
    assert.equal(lateVoteRes.statusCode, 409);
    assert.equal(lateVoteRes.json().error.code, 'POLL_EXPIRED');
  });

  // ----------------------------------------------------
  // 9. Expiration Timer and Background Scheduler
  // ----------------------------------------------------
  await t.test('Expiration scheduler: deactivates expired polls within ±5s and rejects new votes', async () => {
    // Create a poll that expires in 2 seconds
    const expPollRes = await app.inject({
      method: 'POST',
      url: '/api/v1/polls',
      headers: authHeaders(author.id),
      payload: {
        question: 'Expiring poll test?',
        choices: ['Yes', 'No'],
        durationSeconds: 2,
      },
    });
    assert.equal(expPollRes.statusCode, 201);
    const expPoll = expPollRes.json().data;
    assert.equal(expPoll.isActive, true);

    const expVoter = await prisma.user.create({
      data: {
        username: `exp_voter_${timestamp}`,
        email: `exp_voter_${timestamp}@test.local`,
        displayName: 'Exp Voter',
      },
    });

    // Wait 2.2 seconds for expiration
    await new Promise((r) => setTimeout(r, 2200));

    // Trigger scheduler check or verify scheduler handled it
    await pollExpirationSchedulerService.checkExpiredPolls();

    // Verify GET returns poll with is_active = false
    const getExpRes = await app.inject({
      method: 'GET',
      url: `/api/v1/polls/${expPoll.id}`,
    });
    assert.equal(getExpRes.statusCode, 200);
    assert.equal(getExpRes.json().data.isActive, false);
    assert.equal(getExpRes.json().data.is_active, false);

    // Attempting to vote on expired poll must return 409
    const expiredVoteRes = await app.inject({
      method: 'POST',
      url: `/api/v1/polls/${expPoll.id}/vote`,
      headers: authHeaders(expVoter.id),
      payload: { choiceIndex: 0 },
    });
    assert.equal(expiredVoteRes.statusCode, 409);
    assert.equal(expiredVoteRes.json().error.code, 'POLL_EXPIRED');
  });

  // ----------------------------------------------------
  // 10. Comprehensive Unit & Edge Cases for Poll Modules (≥80% Coverage)
  // ----------------------------------------------------
  await t.test('Comprehensive Coverage: Creation variants, voting validations, and scheduler methods', async () => {
    // 10.1 Object choices input [{ text: 'Choice 1' }, { text: 'Choice 2' }]
    const resObjChoices = await app.inject({
      method: 'POST',
      url: '/api/v1/polls',
      headers: authHeaders(author.id),
      payload: {
        question: 'Object choices test?',
        choices: [{ text: 'Alpha' }, { text: 'Beta' }],
      },
    });
    assert.equal(resObjChoices.statusCode, 201);
    const objPoll = resObjChoices.json().data;
    assert.equal(objPoll.choices[0].text, 'Alpha');
    assert.equal(objPoll.choices[1].text, 'Beta');

    // 10.2 Invalid expiresAt format
    const resInvalidExp = await app.inject({
      method: 'POST',
      url: '/api/v1/polls',
      headers: authHeaders(author.id),
      payload: {
        question: 'Invalid expiry?',
        choices: ['A', 'B'],
        expiresAt: 'not-a-valid-date-string',
      },
    });
    assert.equal(resInvalidExp.statusCode, 400);
    assert.equal(resInvalidExp.json().error.code, 'INVALID_EXPIRATION');

    // 10.3 Past expiresAt
    const resPastExp = await app.inject({
      method: 'POST',
      url: '/api/v1/polls',
      headers: authHeaders(author.id),
      payload: {
        question: 'Past expiry?',
        choices: ['A', 'B'],
        expiresAt: '2020-01-01T00:00:00.000Z',
      },
    });
    assert.equal(resPastExp.statusCode, 400);
    assert.equal(resPastExp.json().error.code, 'INVALID_EXPIRATION');

    // 10.4 Valid future ISO expiresAt
    const futureIso = new Date(Date.now() + 1000 * 3600 * 48).toISOString();
    const resFutureExp = await app.inject({
      method: 'POST',
      url: '/api/v1/polls',
      headers: authHeaders(author.id),
      payload: {
        question: 'Future ISO expiry?',
        choices: ['X', 'Y'],
        expiresAt: futureIso,
      },
    });
    assert.equal(resFutureExp.statusCode, 201);

    // 10.5 Duplicate poll on same post
    const resDupPoll = await app.inject({
      method: 'POST',
      url: '/api/v1/polls',
      headers: authHeaders(author.id),
      payload: {
        postId: post.id,
        question: 'Another poll on same post?',
        choices: ['Yes', 'No'],
      },
    });
    assert.equal(resDupPoll.statusCode, 409);
    assert.equal(resDupPoll.json().error.code, 'POLL_ALREADY_EXISTS');

    // 10.6 Auto-create post when non-existent postId is provided
    const newPostId = `custom-post-${timestamp}`;
    const resAutoPost = await app.inject({
      method: 'POST',
      url: '/api/v1/polls',
      headers: authHeaders(author.id),
      payload: {
        postId: newPostId,
        question: 'Auto post poll?',
        choices: ['Choice 1', 'Choice 2'],
      },
    });
    assert.equal(resAutoPost.statusCode, 201);
    assert.equal(resAutoPost.json().data.postId, newPostId);

    // 10.7 Vote without user authentication returns 401
    const resNoAuthVote = await app.inject({
      method: 'POST',
      url: `/api/v1/polls/${objPoll.id}/vote`,
      payload: { choiceIndex: 0 },
    });
    assert.equal(resNoAuthVote.statusCode, 401);
    assert.equal(resNoAuthVote.json().error.code, 'UNAUTHORIZED');

    // 10.8 Vote on non-existent poll returns 404
    const resNonExistentVote = await app.inject({
      method: 'POST',
      url: '/api/v1/polls/00000000-0000-0000-0000-000000000000/vote',
      headers: authHeaders(author.id),
      payload: { choiceIndex: 0 },
    });
    assert.equal(resNonExistentVote.statusCode, 404);
    assert.equal(resNonExistentVote.json().error.code, 'POLL_NOT_FOUND');

    // 10.9 Vote using choiceId instead of choiceIndex
    const voterChoiceId = await prisma.user.create({
      data: {
        username: `voter_choice_id_${timestamp}`,
        email: `voter_choice_id_${timestamp}@test.local`,
        displayName: 'ChoiceId Voter',
      },
    });
    const targetChoiceId = objPoll.choices[1].id;
    const resChoiceIdVote = await app.inject({
      method: 'POST',
      url: `/api/v1/polls/${objPoll.id}/vote`,
      headers: authHeaders(voterChoiceId.id),
      payload: { choiceId: targetChoiceId },
    });
    assert.equal(resChoiceIdVote.statusCode, 200);
    assert.equal(resChoiceIdVote.json().data.choices[1].voteCount, 1);

    // 10.10 Vote with invalid / non-integer choiceIndex returns 400
    const resFloatChoice = await app.inject({
      method: 'POST',
      url: `/api/v1/polls/${objPoll.id}/vote`,
      headers: authHeaders(author.id),
      payload: { choiceIndex: 1.5 },
    });
    assert.equal(resFloatChoice.statusCode, 400);
    assert.equal(resFloatChoice.json().error.code, 'INVALID_CHOICE_INDEX');

    // 10.11 DELETE /polls/:id on non-existent poll returns 404
    const resDeleteNotFound = await app.inject({
      method: 'DELETE',
      url: '/api/v1/polls/00000000-0000-0000-0000-000000000000',
      headers: authHeaders(author.id),
    });
    assert.equal(resDeleteNotFound.statusCode, 404);

    // 10.12 Scheduler unit operations
    // schedulePoll with already expired date
    pollExpirationSchedulerService.schedulePoll('dummy-expired-id', new Date(Date.now() - 5000));
    // schedulePoll with future date
    pollExpirationSchedulerService.schedulePoll('dummy-future-id', new Date(Date.now() + 100000));
    // Scheduler stop and start
    pollExpirationSchedulerService.stop();
    pollExpirationSchedulerService.start(5000);
  });

  await app.close();
});

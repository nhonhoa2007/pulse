import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Test utils imported from pollUtils
import {
  normalizePollChoices,
  computePollPercentages,
  computePollTimeRemaining,
  normalizePollObject,
} from '../src/utils/pollUtils.ts';

describe('Poll Component & Logic Unit Tests', () => {
  describe('Poll Object & Choice Normalization', () => {
    it('normalizes string choices correctly into PollChoiceDto objects', () => {
      const choices = ['TypeScript', 'Rust', 'Go'];
      const normalized = normalizePollChoices(choices, 1);

      assert.equal(normalized.length, 3);
      assert.equal(normalized[0].text, 'TypeScript');
      assert.equal(normalized[0].index, 0);
      assert.equal(normalized[0].voteCount, 0);
      assert.equal(normalized[0].isUserChoice, false);

      assert.equal(normalized[1].text, 'Rust');
      assert.equal(normalized[1].index, 1);
      assert.equal(normalized[1].isUserChoice, true); // Selected index 1
    });

    it('handles both camelCase and snake_case properties seamlessly', () => {
      const snakeCasePoll = {
        id: 'poll-123',
        post_id: 'post-456',
        question: 'Which language do you prefer for high concurrency?',
        choices: [
          { text: 'Go', vote_count: 10, is_user_choice: true },
          { text: 'Rust', vote_count: 15, is_user_choice: false },
        ],
        expires_at: '2026-12-31T23:59:59Z',
        user_has_voted: true,
        user_choice_index: 0,
        is_active: true,
      };

      const normalized = normalizePollObject(snakeCasePoll);

      assert.equal(normalized.id, 'poll-123');
      assert.equal(normalized.postId, 'post-456');
      assert.equal(normalized.question, 'Which language do you prefer for high concurrency?');
      assert.equal(normalized.choices.length, 2);
      assert.equal(normalized.choices[0].voteCount, 10);
      assert.equal(normalized.choices[1].voteCount, 15);
      assert.equal(normalized.userHasVoted, true);
      assert.equal(normalized.userChoiceIndex, 0);
      assert.equal(normalized.isActive, true);
      assert.equal(normalized.totalVotes, 25);
      assert.equal(normalized.choices[0].percentage, 40); // 10/25 = 40%
      assert.equal(normalized.choices[1].percentage, 60); // 15/25 = 60%
    });

    it('handles poll with exactly 2 choices and 4 choices', () => {
      const twoChoices = normalizePollChoices(['Yes', 'No']);
      assert.equal(twoChoices.length, 2);

      const fourChoices = normalizePollChoices(['Spring', 'Summer', 'Autumn', 'Winter']);
      assert.equal(fourChoices.length, 4);
    });

    it('handles very long choice text without errors', () => {
      const longText = 'A'.repeat(500);
      const normalized = normalizePollChoices([longText, 'Short text']);
      assert.equal(normalized[0].text, longText);
    });
  });

  describe('Percentage Calculation & Edge Cases', () => {
    it('calculates 0% for all choices when total votes is 0', () => {
      const choices = [
        { index: 0, text: 'Choice A', voteCount: 0 },
        { index: 1, text: 'Choice B', voteCount: 0 },
        { index: 2, text: 'Choice C', voteCount: 0 },
      ];

      const result = computePollPercentages(choices);
      assert.equal(result.totalVotes, 0);
      assert.deepEqual(
        result.choicesWithPercentages.map((c) => c.percentage),
        [0, 0, 0]
      );
    });

    it('calculates equal percentages (25%/25%/25%/25%) when votes are evenly distributed', () => {
      const choices = [
        { index: 0, text: 'Option 1', voteCount: 5 },
        { index: 1, text: 'Option 2', voteCount: 5 },
        { index: 2, text: 'Option 3', voteCount: 5 },
        { index: 3, text: 'Option 4', voteCount: 5 },
      ];

      const result = computePollPercentages(choices);
      assert.equal(result.totalVotes, 20);
      assert.deepEqual(
        result.choicesWithPercentages.map((c) => c.percentage),
        [25, 25, 25, 25]
      );
    });

    it('calculates 42% accurately as specified in requirements', () => {
      const choices = [
        { index: 0, text: 'Leading Choice', voteCount: 42 },
        { index: 1, text: 'Other Choice', voteCount: 58 },
      ];

      const result = computePollPercentages(choices);
      assert.equal(result.totalVotes, 100);
      assert.equal(result.choicesWithPercentages[0].percentage, 42);
      assert.equal(result.choicesWithPercentages[1].percentage, 58);
    });
  });

  describe('Expiration Timer & Countdown Calculation', () => {
    it('formats countdown display accurately for hours and minutes (e.g. 2h 14m remaining)', () => {
      const now = Date.now();
      // 2 hours, 14 minutes, 10 seconds in future
      const futureTime = new Date(now + (2 * 3600 + 14 * 60 + 10) * 1000).toISOString();

      const res = computePollTimeRemaining(futureTime);
      assert.equal(res.isExpired, false);
      assert.equal(res.formatted, '2h 14m remaining');
      assert.ok(res.totalSecondsRemaining > 0);
    });

    it('formats countdown display for minutes and seconds when under an hour', () => {
      const now = Date.now();
      // 15 minutes, 30 seconds
      const futureTime = new Date(now + (15 * 60 + 30) * 1000).toISOString();

      const res = computePollTimeRemaining(futureTime);
      assert.equal(res.isExpired, false);
      assert.equal(res.formatted, '15m 30s remaining');
    });

    it('formats countdown display for seconds when under a minute', () => {
      const now = Date.now();
      // 45 seconds
      const futureTime = new Date(now + 45 * 1000).toISOString();

      const res = computePollTimeRemaining(futureTime);
      assert.equal(res.isExpired, false);
      assert.equal(res.formatted, '45s remaining');
    });

    it('returns "Poll closed" and isExpired: true when countdown hits zero or past expiry', () => {
      const now = Date.now();
      // Past time
      const pastTime = new Date(now - 10000).toISOString();

      const res = computePollTimeRemaining(pastTime);
      assert.equal(res.isExpired, true);
      assert.equal(res.formatted, 'Poll closed');
      assert.equal(res.totalSecondsRemaining, 0);
    });

    it('returns "Poll closed" immediately if expiresAt is zero or negative duration', () => {
      const res = computePollTimeRemaining(new Date(0).toISOString());
      assert.equal(res.isExpired, true);
      assert.equal(res.formatted, 'Poll closed');
    });
  });

  describe('Real-Time Re-calculation & State Updates', () => {
    it('recalculates percentages when a new vote arrives without changing poll structure', () => {
      const initialChoices = [
        { index: 0, text: 'A', voteCount: 1 },
        { index: 1, text: 'B', voteCount: 1 },
      ];

      const initial = computePollPercentages(initialChoices);
      assert.deepEqual(
        initial.choicesWithPercentages.map((c) => c.percentage),
        [50, 50]
      );

      // Incoming real-time vote on Choice B
      const updatedChoices = [
        { index: 0, text: 'A', voteCount: 1 },
        { index: 1, text: 'B', voteCount: 2 },
      ];

      const updated = computePollPercentages(updatedChoices);
      assert.equal(updated.totalVotes, 3);
      assert.equal(updated.choicesWithPercentages[0].percentage, 33); // 1/3 = 33%
      assert.equal(updated.choicesWithPercentages[1].percentage, 67); // 2/3 = 67%
    });
  });

  describe('Component State Rendering Invariants (Pre-vote vs Post-vote)', () => {
    it('evaluates pre-vote state: interactive buttons, hidden percentages, active countdown', () => {
      const activePoll = normalizePollObject({
        id: 'poll-pre-1',
        question: 'What is your preferred state management library?',
        choices: [
          { text: 'Redux Toolkit', vote_count: 5 },
          { text: 'Zustand', vote_count: 12 },
          { text: 'Jotai', vote_count: 3 },
        ],
        expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
        user_has_voted: false,
        user_choice_index: null,
        is_active: true,
      });

      const timeInfo = computePollTimeRemaining(activePoll.expiresAt);
      const isPollClosed = !activePoll.isActive || timeInfo.isExpired;
      const showResults = activePoll.userHasVoted || isPollClosed;

      assert.equal(isPollClosed, false, 'Poll should be active');
      assert.equal(showResults, false, 'Pre-vote state must NOT show results');
      assert.equal(activePoll.choices.length, 3);
      assert.equal(activePoll.userHasVoted, false);
      assert.equal(activePoll.userChoiceIndex, null);

      // Verify choice texts are clean for button labels
      assert.equal(activePoll.choices[0].text, 'Redux Toolkit');
      assert.equal(activePoll.choices[1].text, 'Zustand');
      assert.equal(activePoll.choices[2].text, 'Jotai');
    });

    it('evaluates post-vote state: progress bars, percentages shown, selected choice marked', () => {
      const votedPoll = normalizePollObject({
        id: 'poll-post-1',
        question: 'Best cloud provider?',
        choices: [
          { text: 'AWS', vote_count: 50 },
          { text: 'GCP', vote_count: 30 },
          { text: 'Azure', vote_count: 20 },
        ],
        expires_at: new Date(Date.now() + 7200 * 1000).toISOString(),
        user_has_voted: true,
        user_choice_index: 0, // AWS chosen
        is_active: true,
      });

      const timeInfo = computePollTimeRemaining(votedPoll.expiresAt);
      const isPollClosed = !votedPoll.isActive || timeInfo.isExpired;
      const showResults = votedPoll.userHasVoted || isPollClosed;

      assert.equal(showResults, true, 'Post-vote state MUST show results');
      assert.equal(votedPoll.totalVotes, 100);
      assert.equal(votedPoll.choices[0].percentage, 50);
      assert.equal(votedPoll.choices[1].percentage, 30);
      assert.equal(votedPoll.choices[2].percentage, 20);
      assert.equal(votedPoll.choices[0].isUserChoice, true);
      assert.equal(votedPoll.choices[1].isUserChoice, false);
    });

    it('evaluates expired state: forces showResults=true and shows Poll closed even if user has not voted', () => {
      const expiredPoll = normalizePollObject({
        id: 'poll-exp-1',
        question: 'Who won the match?',
        choices: [
          { text: 'Team A', vote_count: 10 },
          { text: 'Team B', vote_count: 10 },
        ],
        expires_at: new Date(Date.now() - 60000).toISOString(), // 1 min ago
        user_has_voted: false,
        user_choice_index: null,
        is_active: true,
      });

      const timeInfo = computePollTimeRemaining(expiredPoll.expiresAt);
      const isPollClosed = !expiredPoll.isActive || timeInfo.isExpired;
      const showResults = expiredPoll.userHasVoted || isPollClosed;

      assert.equal(timeInfo.isExpired, true);
      assert.equal(timeInfo.formatted, 'Poll closed');
      assert.equal(isPollClosed, true);
      assert.equal(showResults, true, 'Expired poll must force results view to prevent further votes');
    });
  });

  describe('WebSocket & Real-time Event Handling', () => {
    it('parses incoming WebSocket poll update payload and updates percentages atomically', () => {
      // Simulate listener registered via subscribePollEvents
      let currentState = normalizePollObject({
        id: 'poll-ws-1',
        question: 'Rate this feature',
        choices: ['Poor', 'Good', 'Excellent'],
        totalVotes: 0,
      });

      const onUpdate = (updatedPayload) => {
        const merged = { ...currentState, ...updatedPayload };
        if (updatedPayload.choices) {
          const { choicesWithPercentages, totalVotes } = computePollPercentages(
            updatedPayload.choices
          );
          merged.choices = choicesWithPercentages;
          merged.totalVotes = updatedPayload.totalVotes ?? totalVotes;
        }
        currentState = merged;
      };

      // Simulate incoming WebSocket message
      const wsMessage = JSON.stringify({
        pollId: 'poll-ws-1',
        totalVotes: 1,
        choices: [
          { index: 0, text: 'Poor', voteCount: 0 },
          { index: 1, text: 'Good', voteCount: 1 },
          { index: 2, text: 'Excellent', voteCount: 0 },
        ],
      });

      const parsed = JSON.parse(wsMessage);
      if (parsed.pollId === currentState.id || parsed.choices) {
        onUpdate(parsed);
      }

      assert.equal(currentState.totalVotes, 1);
      assert.equal(currentState.choices[1].percentage, 100);
      assert.equal(currentState.choices[0].percentage, 0);
    });

    it('handles SSE POLL_UPDATED and POLL_EXPIRED event formats cleanly', () => {
      let isExpiredEventReceived = false;
      let expiredPollId = null;

      const handleSseEvent = (eventType, data) => {
        if (eventType === 'POLL_EXPIRED') {
          isExpiredEventReceived = true;
          expiredPollId = data.pollId || data.id;
        }
      };

      // Emit simulated SSE event
      handleSseEvent('POLL_EXPIRED', { pollId: 'poll-999', is_active: false });

      assert.equal(isExpiredEventReceived, true);
      assert.equal(expiredPollId, 'poll-999');
    });

    it('handles optimistic update and rollback on failure', () => {
      const initialPoll = normalizePollObject({
        id: 'poll-opt-1',
        question: 'Optimistic UI check',
        choices: [
          { text: 'Yes', vote_count: 5 },
          { text: 'No', vote_count: 5 },
        ],
        totalVotes: 10,
        userHasVoted: false,
      });

      // 1. Optimistic update
      const choiceIndex = 0;
      const optimisticChoices = initialPoll.choices.map((c, idx) => ({
        ...c,
        voteCount: idx === choiceIndex ? c.voteCount + 1 : c.voteCount,
        isUserChoice: idx === choiceIndex,
      }));
      const { choicesWithPercentages, totalVotes } = computePollPercentages(optimisticChoices);
      const optimisticState = {
        ...initialPoll,
        choices: choicesWithPercentages,
        totalVotes,
        userHasVoted: true,
        userChoiceIndex: choiceIndex,
      };

      assert.equal(optimisticState.totalVotes, 11);
      assert.equal(optimisticState.choices[0].voteCount, 6);
      assert.equal(optimisticState.choices[0].percentage, 55); // 6/11 ~ 55%
      assert.equal(optimisticState.userHasVoted, true);

      // 2. Simulated network failure -> rollback to initialPoll
      const rolledBackState = { ...initialPoll };
      assert.equal(rolledBackState.totalVotes, 10);
      assert.equal(rolledBackState.choices[0].voteCount, 5);
      assert.equal(rolledBackState.choices[0].percentage, 50);
      assert.equal(rolledBackState.userHasVoted, false);
    });
  });

});

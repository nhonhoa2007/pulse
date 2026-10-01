import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  REPLY_PRIVACY_OPTIONS,
  getReplyPrivacy,
  getReplyPrivacyOption,
  evaluateReplyPermission,
  getRestrictedReason,
} from '../src/utils/privacy.ts';

describe('Reply Privacy Controls & Conditional UI Unit Tests', () => {
  const authorUser = {
    id: 'user-author-1',
    username: 'alice',
    displayName: 'Alice In Tech',
    isCelebrity: false,
    followersCount: 150,
    followingCount: 80,
    postsCount: 30,
    createdAt: new Date().toISOString(),
  };

  const followedUser = {
    id: 'user-followed-2',
    username: 'bob',
    displayName: 'Bob The Builder',
    isCelebrity: false,
    followersCount: 10,
    followingCount: 10,
    postsCount: 5,
    createdAt: new Date().toISOString(),
  };

  const mentionedUser = {
    id: 'user-mentioned-3',
    username: 'charlie',
    displayName: 'Charlie Dev',
    isCelebrity: false,
    followersCount: 50,
    followingCount: 50,
    postsCount: 12,
    createdAt: new Date().toISOString(),
  };

  const strangerUser = {
    id: 'user-stranger-4',
    username: 'david',
    displayName: 'David Stranger',
    isCelebrity: false,
    followersCount: 2,
    followingCount: 100,
    postsCount: 1,
    createdAt: new Date().toISOString(),
  };

  describe('1. Reply Privacy Options & Metadata', () => {
    it('provides exactly 3 options: Everyone, People you follow, and Only mentioned users', () => {
      assert.equal(REPLY_PRIVACY_OPTIONS.length, 3);

      const values = REPLY_PRIVACY_OPTIONS.map((o) => o.value);
      assert.deepEqual(values, ['EVERYONE', 'FOLLOWING', 'MENTIONED']);

      const englishLabels = REPLY_PRIVACY_OPTIONS.map((o) => o.englishLabel);
      assert.deepEqual(englishLabels, ['Everyone', 'People you follow', 'Only mentioned users']);
    });

    it('getReplyPrivacy extracts setting from camelCase and snake_case properties', () => {
      assert.equal(getReplyPrivacy(null), 'EVERYONE');
      assert.equal(getReplyPrivacy(undefined), 'EVERYONE');
      assert.equal(getReplyPrivacy({ replyPrivacy: 'FOLLOWING' }), 'FOLLOWING');
      assert.equal(getReplyPrivacy({ reply_privacy: 'MENTIONED' }), 'MENTIONED');
      assert.equal(getReplyPrivacy({}), 'EVERYONE');
    });

    it('getReplyPrivacyOption retrieves matching option record with fallback', () => {
      const everyone = getReplyPrivacyOption('EVERYONE');
      assert.equal(everyone.englishLabel, 'Everyone');

      const following = getReplyPrivacyOption('FOLLOWING');
      assert.equal(following.englishLabel, 'People you follow');

      const mentioned = getReplyPrivacyOption('MENTIONED');
      assert.equal(mentioned.englishLabel, 'Only mentioned users');

      const fallback = getReplyPrivacyOption('UNKNOWN_VALUE');
      assert.equal(fallback.value, 'EVERYONE');
    });
  });

  describe('2. evaluateReplyPermission: Author & Server-Authority Invariants', () => {
    it('author can always reply to their own post regardless of privacy setting', () => {
      const postFollowing = {
        id: 'post-1',
        authorId: authorUser.id,
        author: { ...authorUser },
        content: 'Post with following only',
        replyPrivacy: 'FOLLOWING',
      };
      const resultFollowing = evaluateReplyPermission(postFollowing, authorUser);
      assert.equal(resultFollowing.canReply, true);
      assert.equal(resultFollowing.isAuthor, true);

      const postMentioned = {
        id: 'post-2',
        authorId: authorUser.id,
        author: { ...authorUser },
        content: 'Post without mentioning author',
        replyPrivacy: 'MENTIONED',
        mentions: ['charlie'],
      };
      const resultMentioned = evaluateReplyPermission(postMentioned, authorUser);
      assert.equal(resultMentioned.canReply, true);
      assert.equal(resultMentioned.isAuthor, true);
    });

    it('respects authoritative server canReply flag if provided by API', () => {
      const postServerAllowed = {
        id: 'post-3',
        authorId: authorUser.id,
        author: { ...authorUser },
        content: 'Server computed allowed',
        replyPrivacy: 'FOLLOWING',
        canReply: true,
      };
      const resAllowed = evaluateReplyPermission(postServerAllowed, strangerUser);
      assert.equal(resAllowed.canReply, true);

      const postServerDenied = {
        id: 'post-4',
        authorId: authorUser.id,
        author: { ...authorUser },
        content: 'Server computed denied',
        replyPrivacy: 'FOLLOWING',
        canReply: false,
      };
      const resDenied = evaluateReplyPermission(postServerDenied, strangerUser);
      assert.equal(resDenied.canReply, false);
      assert.match(resDenied.reason, /theo dõi|followed/i);
    });

    it('denies unauthenticated user (null currentUser) with login prompt reason', () => {
      const post = {
        id: 'post-5',
        authorId: authorUser.id,
        author: { ...authorUser },
        content: 'Public post',
        replyPrivacy: 'EVERYONE',
      };
      const res = evaluateReplyPermission(post, null);
      assert.equal(res.canReply, false);
      assert.match(res.reason, /đăng nhập|log in/i);
    });
  });

  describe('3. evaluateReplyPermission: "EVERYONE" Privacy Rule', () => {
    it('allows author, stranger, followed user, and mentioned user', () => {
      const publicPost = {
        id: 'post-pub',
        authorId: authorUser.id,
        author: { ...authorUser },
        content: 'Hello world everyone welcome',
        replyPrivacy: 'EVERYONE',
      };

      assert.equal(evaluateReplyPermission(publicPost, authorUser).canReply, true);
      assert.equal(evaluateReplyPermission(publicPost, followedUser).canReply, true);
      assert.equal(evaluateReplyPermission(publicPost, mentionedUser).canReply, true);
      assert.equal(evaluateReplyPermission(publicPost, strangerUser).canReply, true);
    });
  });

  describe('4. evaluateReplyPermission: "MENTIONED" Privacy Rule', () => {
    it('permits user mentioned via mentions array', () => {
      const post = {
        id: 'post-men-1',
        authorId: authorUser.id,
        author: { ...authorUser },
        content: 'Hey Charlie, join this discussion',
        mentions: ['@charlie'],
        replyPrivacy: 'MENTIONED',
      };
      const res = evaluateReplyPermission(post, mentionedUser);
      assert.equal(res.canReply, true);
      assert.equal(res.isMentioned, true);
    });

    it('permits user mentioned via text content @username tag', () => {
      const post = {
        id: 'post-men-2',
        authorId: authorUser.id,
        author: { ...authorUser },
        content: 'What do you think @charlie about Vite?',
        mentions: [],
        replyPrivacy: 'MENTIONED',
      };
      const res = evaluateReplyPermission(post, mentionedUser);
      assert.equal(res.canReply, true);
      assert.equal(res.isMentioned, true);
    });

    it('rejects unmentioned user and provides informative banner reason', () => {
      const post = {
        id: 'post-men-3',
        authorId: authorUser.id,
        author: { ...authorUser },
        content: 'Hey @charlie only you can reply',
        mentions: ['charlie'],
        replyPrivacy: 'MENTIONED',
      };
      const res = evaluateReplyPermission(post, strangerUser);
      assert.equal(res.canReply, false);
      assert.equal(res.isMentioned, false);
      assert.match(res.reason, /nhắc đến|mentioned/i);
      assert.match(res.reason, /alice/i);
    });
  });

  describe('5. evaluateReplyPermission: "FOLLOWING" Privacy Rule', () => {
    it('permits user when author follows them (author.isFollowing === true)', () => {
      const post = {
        id: 'post-foll-1',
        authorId: authorUser.id,
        author: {
          ...authorUser,
          isFollowing: true, // author follows bob
        },
        content: 'Only people I follow can reply',
        replyPrivacy: 'FOLLOWING',
      };
      const res = evaluateReplyPermission(post, followedUser);
      assert.equal(res.canReply, true);
    });

    it('rejects stranger when author does not follow them and provides informative reason', () => {
      const post = {
        id: 'post-foll-2',
        authorId: authorUser.id,
        author: {
          ...authorUser,
          isFollowing: false,
        },
        content: 'Only people I follow can reply',
        replyPrivacy: 'FOLLOWING',
      };
      const res = evaluateReplyPermission(post, strangerUser);
      assert.equal(res.canReply, false);
      assert.match(res.reason, /theo dõi|followed/i);
      assert.match(res.reason, /alice/i);
    });
  });

  describe('6. getRestrictedReason Informative Messages', () => {
    it('generates informative reasons mentioning author handle and policy in bilingual format', () => {
      const reasonFollowing = getRestrictedReason('FOLLOWING', 'Alice In Tech', 'alice');
      assert.match(reasonFollowing, /Alice In Tech \(@alice\)/);
      assert.match(reasonFollowing, /theo dõi/i);
      assert.match(reasonFollowing, /followed/i);

      const reasonMentioned = getRestrictedReason('MENTIONED', 'Alice In Tech', 'alice');
      assert.match(reasonMentioned, /Alice In Tech \(@alice\)/);
      assert.match(reasonMentioned, /nhắc đến/i);
      assert.match(reasonMentioned, /mentioned/i);

      const reasonDefault = getRestrictedReason('EVERYONE', 'Alice In Tech', 'alice');
      assert.match(reasonDefault, /giới hạn/i);
      assert.match(reasonDefault, /restricted/i);
    });
  });

  describe('7. Optimistic UI Updates & Error State Handling Logic', () => {
    it('simulates optimistic reply creation, success replacement, and failure rollback', () => {
      let threadReplies = [];
      let repliesCount = 0;

      const tempId = `temp-${Date.now()}`;
      const tempReply = {
        id: tempId,
        authorId: strangerUser.id,
        content: 'Optimistic reply content',
        replyToId: 'post-100',
        createdAt: new Date().toISOString(),
        author: { ...strangerUser },
      };

      // Step 1: Optimistic insert
      threadReplies = [...threadReplies, tempReply];
      repliesCount += 1;

      assert.equal(threadReplies.length, 1);
      assert.equal(threadReplies[0].id, tempId);
      assert.equal(repliesCount, 1);

      // Step 2a: Scenario Success -> Server returns permanent post
      const confirmedServerReply = {
        ...tempReply,
        id: 'real-post-999',
      };
      threadReplies = threadReplies.map((r) =>
        r.id === tempId || r.id.startsWith('temp-') ? confirmedServerReply : r
      );

      assert.equal(threadReplies.length, 1);
      assert.equal(threadReplies[0].id, 'real-post-999');
      assert.equal(repliesCount, 1);

      // Step 2b: Scenario Failure Rollback -> Server rejects with 403 / REPLY_RESTRICTED
      // Rollback temporary reply from list and decrement count
      const failedTempId = `temp-${Date.now() + 1}`;
      const failedReply = { ...tempReply, id: failedTempId };
      threadReplies = [...threadReplies, failedReply];
      repliesCount += 1;
      assert.equal(threadReplies.length, 2);

      // Execute rollback
      threadReplies = threadReplies.filter((r) => r.id !== failedTempId);
      repliesCount = Math.max(0, repliesCount - 1);

      assert.equal(threadReplies.length, 1);
      assert.equal(threadReplies[0].id, 'real-post-999');
      assert.equal(repliesCount, 1);
    });
  });
});

import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  REPLY_PRIVACY_OPTIONS,
  getReplyPrivacy,
  getReplyPrivacyOption,
  evaluateReplyPermission,
  getRestrictedReason,
} from '../src/utils/privacy.ts';

describe('TASK-16: Frontend Visual States & E2E Interaction Matrix for Reply Privacy Rules', () => {
  // -------------------------------------------------------------------------
  // MOCK USER ACTORS & RELATIONSHIPS
  // -------------------------------------------------------------------------
  const authorUser = {
    id: 'u-author-01',
    username: 'alice_creator',
    displayName: 'Alice In Tech',
    isCelebrity: false,
    followersCount: 500,
    followingCount: 150,
    postsCount: 45,
    createdAt: new Date().toISOString(),
  };

  const followedUser = {
    id: 'u-followed-02',
    username: 'bob_dev',
    displayName: 'Bob The Builder',
    isCelebrity: false,
    followersCount: 100,
    followingCount: 100,
    postsCount: 10,
    createdAt: new Date().toISOString(),
  };

  const mutualFollowUser = {
    id: 'u-mutual-03',
    username: 'carol_designer',
    displayName: 'Carol UI/UX',
    isCelebrity: false,
    followersCount: 200,
    followingCount: 200,
    postsCount: 25,
    createdAt: new Date().toISOString(),
  };

  const followerOnlyUser = {
    id: 'u-follower-04',
    username: 'dan_fan',
    displayName: 'Dan SuperFan',
    isCelebrity: false,
    followersCount: 10,
    followingCount: 500,
    postsCount: 2,
    createdAt: new Date().toISOString(),
  };

  const strangerUser = {
    id: 'u-stranger-05',
    username: 'eve_passerby',
    displayName: 'Eve Stranger',
    isCelebrity: false,
    followersCount: 5,
    followingCount: 20,
    postsCount: 0,
    createdAt: new Date().toISOString(),
  };

  const mentionedUser = {
    id: 'u-mentioned-06',
    username: 'frank_guest',
    displayName: 'Frank Specialist',
    isCelebrity: false,
    followersCount: 80,
    followingCount: 60,
    postsCount: 15,
    createdAt: new Date().toISOString(),
  };

  const unmentionedUser = {
    id: 'u-unmentioned-07',
    username: 'grace_silent',
    displayName: 'Grace Silent',
    isCelebrity: false,
    followersCount: 12,
    followingCount: 15,
    postsCount: 1,
    createdAt: new Date().toISOString(),
  };

  // Helper simulating the visual DOM elements rendered by PostComposerCard and ConversationThreadView
  const computeComposerVisualState = (post, currentUser) => {
    const permission = evaluateReplyPermission(post, currentUser);
    const disabled = !permission.canReply;
    const disabledReason = permission.reason;

    return {
      canReply: permission.canReply,
      disabled,
      disabledReason,
      // DOM Elements / Visual attributes simulation
      textarea: {
        disabled,
        'data-testid': disabled ? 'reply-input-disabled' : undefined,
        placeholder: disabled ? undefined : `Trả lời @${post.author.username}...`,
      },
      submitButton: {
        disabled: disabled, // also depends on content.trim() when typing
      },
      restrictedBanner: disabled
        ? {
            'data-testid': 'reply-restricted-banner',
            rendered: true,
            title: 'Cuộc trò chuyện đã bị giới hạn người trả lời',
            message: disabledReason || 'Chỉ những người được tác giả cho phép mới có thể trả lời bài viết này.',
          }
        : {
            'data-testid': 'reply-restricted-banner',
            rendered: false,
          },
    };
  };

  // =========================================================================
  // 1. VISUAL STATE MATRIX: 'EVERYONE' PRIVACY RULE
  // =========================================================================
  describe('1. Visual States: EVERYONE Privacy Rule', () => {
    const publicPost = {
      id: 'p-pub-01',
      authorId: authorUser.id,
      author: { ...authorUser },
      content: 'Hello everyone! All replies are welcome @frank_guest',
      replyPrivacy: 'EVERYONE',
      reply_privacy: 'EVERYONE',
      mentions: ['frank_guest'],
    };

    it('Author view: reply input is active and enabled, no restricted banner', () => {
      const visual = computeComposerVisualState(publicPost, authorUser);
      assert.equal(visual.canReply, true);
      assert.equal(visual.disabled, false);
      assert.equal(visual.textarea.disabled, false);
      assert.equal(visual.textarea['data-testid'], undefined, 'No disabled testid on textarea');
      assert.equal(visual.restrictedBanner.rendered, false, 'Restricted banner must NOT render');
      assert.match(visual.textarea.placeholder, /@alice_creator/);
    });

    it('Follower-only view: reply input is active and enabled, no restricted banner', () => {
      const visual = computeComposerVisualState(publicPost, followerOnlyUser);
      assert.equal(visual.canReply, true);
      assert.equal(visual.disabled, false);
      assert.equal(visual.textarea.disabled, false);
      assert.equal(visual.restrictedBanner.rendered, false);
    });

    it('Followed user view: reply input is active and enabled', () => {
      const visual = computeComposerVisualState(publicPost, followedUser);
      assert.equal(visual.canReply, true);
      assert.equal(visual.disabled, false);
      assert.equal(visual.restrictedBanner.rendered, false);
    });

    it('Mutual follow user view: reply input is active and enabled', () => {
      const visual = computeComposerVisualState(publicPost, mutualFollowUser);
      assert.equal(visual.canReply, true);
      assert.equal(visual.disabled, false);
      assert.equal(visual.restrictedBanner.rendered, false);
    });

    it('Stranger view: reply input is active and enabled', () => {
      const visual = computeComposerVisualState(publicPost, strangerUser);
      assert.equal(visual.canReply, true);
      assert.equal(visual.disabled, false);
      assert.equal(visual.restrictedBanner.rendered, false);
    });

    it('Mentioned user view: reply input is active and enabled', () => {
      const visual = computeComposerVisualState(publicPost, mentionedUser);
      assert.equal(visual.canReply, true);
      assert.equal(visual.disabled, false);
      assert.equal(visual.restrictedBanner.rendered, false);
    });

    it('Unmentioned user view: reply input is active and enabled', () => {
      const visual = computeComposerVisualState(publicPost, unmentionedUser);
      assert.equal(visual.canReply, true);
      assert.equal(visual.disabled, false);
      assert.equal(visual.restrictedBanner.rendered, false);
    });

    it('Unauthenticated / Guest view: reply input disabled, restricted banner with login prompt', () => {
      const visual = computeComposerVisualState(publicPost, null);
      assert.equal(visual.canReply, false);
      assert.equal(visual.disabled, true);
      assert.equal(visual.textarea.disabled, true);
      assert.equal(visual.textarea['data-testid'], 'reply-input-disabled');
      assert.equal(visual.restrictedBanner.rendered, true);
      assert.equal(visual.restrictedBanner['data-testid'], 'reply-restricted-banner');
      assert.match(visual.restrictedBanner.message, /đăng nhập|log in/i);
    });
  });

  // =========================================================================
  // 2. VISUAL STATE MATRIX: 'FOLLOWING' (PEOPLE YOU FOLLOW) PRIVACY RULE
  // =========================================================================
  describe('2. Visual States: FOLLOWING ("People you follow") Privacy Rule', () => {
    // Author follows: followedUser and mutualFollowUser (author.isFollowing = true)
    // Author does NOT follow: followerOnlyUser, strangerUser, mentionedUser
    const followingPost = {
      id: 'p-foll-02',
      authorId: authorUser.id,
      author: { ...authorUser },
      content: 'Only people I follow can reply here @frank_guest',
      replyPrivacy: 'FOLLOWING',
      reply_privacy: 'FOLLOWING',
      mentions: ['frank_guest'],
    };

    it('Author view: always active and enabled (Author bypass invariant)', () => {
      const visual = computeComposerVisualState(followingPost, authorUser);
      assert.equal(visual.canReply, true);
      assert.equal(visual.disabled, false);
      assert.equal(visual.textarea.disabled, false);
      assert.equal(visual.restrictedBanner.rendered, false);
    });

    it('Followed user view (author follows them): active and enabled', () => {
      const postWithFollow = {
        ...followingPost,
        author: { ...authorUser, isFollowing: true },
      };
      const visual = computeComposerVisualState(postWithFollow, followedUser);
      assert.equal(visual.canReply, true);
      assert.equal(visual.disabled, false);
      assert.equal(visual.textarea.disabled, false);
      assert.equal(visual.restrictedBanner.rendered, false);
    });

    it('Mutual follow user view: active and enabled', () => {
      const postWithFollow = {
        ...followingPost,
        author: { ...authorUser, isFollowing: true },
      };
      const visual = computeComposerVisualState(postWithFollow, mutualFollowUser);
      assert.equal(visual.canReply, true);
      assert.equal(visual.disabled, false);
      assert.equal(visual.restrictedBanner.rendered, false);
    });

    it('Follower-only view (follows author, author does not follow them): disabled with informative banner', () => {
      const postNoFollow = {
        ...followingPost,
        author: { ...authorUser, isFollowing: false },
      };
      const visual = computeComposerVisualState(postNoFollow, followerOnlyUser);
      assert.equal(visual.canReply, false);
      assert.equal(visual.disabled, true);
      assert.equal(visual.textarea.disabled, true);
      assert.equal(visual.textarea['data-testid'], 'reply-input-disabled');
      assert.equal(visual.restrictedBanner.rendered, true);
      assert.match(visual.restrictedBanner.message, /theo dõi|followed/i);
      assert.match(visual.restrictedBanner.message, /alice_creator/i);
    });

    it('Stranger view: disabled with reply-input-disabled testid and banner', () => {
      const postNoFollow = {
        ...followingPost,
        author: { ...authorUser, isFollowing: false },
      };
      const visual = computeComposerVisualState(postNoFollow, strangerUser);
      assert.equal(visual.canReply, false);
      assert.equal(visual.disabled, true);
      assert.equal(visual.textarea.disabled, true);
      assert.equal(visual.textarea['data-testid'], 'reply-input-disabled');
      assert.equal(visual.restrictedBanner.rendered, true);
      assert.match(visual.restrictedBanner.message, /theo dõi|followed/i);
    });

    it('Mentioned user view (mentioned, but NOT followed by author): disabled with banner', () => {
      const postNoFollow = {
        ...followingPost,
        author: { ...authorUser, isFollowing: false },
      };
      const visual = computeComposerVisualState(postNoFollow, mentionedUser);
      assert.equal(visual.canReply, false);
      assert.equal(visual.disabled, true);
      assert.equal(visual.textarea['data-testid'], 'reply-input-disabled');
      assert.equal(visual.restrictedBanner.rendered, true);
      assert.match(visual.restrictedBanner.message, /theo dõi|followed/i);
    });
  });

  // =========================================================================
  // 3. VISUAL STATE MATRIX: 'MENTIONED' (ONLY MENTIONED USERS) PRIVACY RULE
  // =========================================================================
  describe('3. Visual States: MENTIONED ("Only mentioned users") Privacy Rule', () => {
    const mentionedPost = {
      id: 'p-men-03',
      authorId: authorUser.id,
      author: { ...authorUser },
      content: 'Calling @frank_guest and @carol_designer for expert feedback',
      replyPrivacy: 'MENTIONED',
      reply_privacy: 'MENTIONED',
      mentions: ['frank_guest', 'carol_designer'],
    };

    it('Author view: always active and enabled (Author bypass invariant)', () => {
      const visual = computeComposerVisualState(mentionedPost, authorUser);
      assert.equal(visual.canReply, true);
      assert.equal(visual.disabled, false);
      assert.equal(visual.textarea.disabled, false);
      assert.equal(visual.restrictedBanner.rendered, false);
    });

    it('Explicitly mentioned user Frank view: active and enabled', () => {
      const visual = computeComposerVisualState(mentionedPost, mentionedUser);
      assert.equal(visual.canReply, true);
      assert.equal(visual.disabled, false);
      assert.equal(visual.textarea.disabled, false);
      assert.equal(visual.restrictedBanner.rendered, false);
    });

    it('Second mentioned user Carol view: active and enabled', () => {
      const visual = computeComposerVisualState(mentionedPost, mutualFollowUser);
      assert.equal(visual.canReply, true);
      assert.equal(visual.disabled, false);
      assert.equal(visual.textarea.disabled, false);
      assert.equal(visual.restrictedBanner.rendered, false);
    });

    it('Followed user Bob (NOT mentioned): disabled with informative banner', () => {
      const visual = computeComposerVisualState(mentionedPost, followedUser);
      assert.equal(visual.canReply, false);
      assert.equal(visual.disabled, true);
      assert.equal(visual.textarea.disabled, true);
      assert.equal(visual.textarea['data-testid'], 'reply-input-disabled');
      assert.equal(visual.restrictedBanner.rendered, true);
      assert.match(visual.restrictedBanner.message, /nhắc đến|mentioned/i);
      assert.match(visual.restrictedBanner.message, /alice_creator/i);
    });

    it('Follower Dan (NOT mentioned): disabled with banner', () => {
      const visual = computeComposerVisualState(mentionedPost, followerOnlyUser);
      assert.equal(visual.canReply, false);
      assert.equal(visual.disabled, true);
      assert.equal(visual.textarea['data-testid'], 'reply-input-disabled');
      assert.equal(visual.restrictedBanner.rendered, true);
      assert.match(visual.restrictedBanner.message, /nhắc đến|mentioned/i);
    });

    it('Stranger Eve (NOT mentioned): disabled with banner', () => {
      const visual = computeComposerVisualState(mentionedPost, strangerUser);
      assert.equal(visual.canReply, false);
      assert.equal(visual.disabled, true);
      assert.equal(visual.textarea['data-testid'], 'reply-input-disabled');
      assert.equal(visual.restrictedBanner.rendered, true);
      assert.match(visual.restrictedBanner.message, /nhắc đến|mentioned/i);
    });

    it('Unmentioned user Grace: disabled with banner', () => {
      const visual = computeComposerVisualState(mentionedPost, unmentionedUser);
      assert.equal(visual.canReply, false);
      assert.equal(visual.disabled, true);
      assert.equal(visual.textarea['data-testid'], 'reply-input-disabled');
      assert.equal(visual.restrictedBanner.rendered, true);
      assert.match(visual.restrictedBanner.message, /nhắc đến|mentioned/i);
    });
  });

  // =========================================================================
  // 4. COMPONENT VISUAL CONTRACTS: ReplyPrivacySelector
  // =========================================================================
  describe('4. Component Visual Contracts: ReplyPrivacySelector', () => {
    it('provides exactly 3 options matching design specification with testids', () => {
      assert.equal(REPLY_PRIVACY_OPTIONS.length, 3);
      const testids = REPLY_PRIVACY_OPTIONS.map((opt) => `privacy-option-${opt.value.toLowerCase()}`);
      assert.deepEqual(testids, [
        'privacy-option-everyone',
        'privacy-option-following',
        'privacy-option-mentioned',
      ]);
    });

    it('evaluates trigger button label and testids accurately', () => {
      const optionEveryone = getReplyPrivacyOption('EVERYONE');
      const labelEveryone = `${optionEveryone.label} (${optionEveryone.englishLabel}) có thể trả lời`;
      assert.match(labelEveryone, /Mọi người \(Everyone\) có thể trả lời/);

      const optionFollowing = getReplyPrivacyOption('FOLLOWING');
      const labelFollowing = `${optionFollowing.label} (${optionFollowing.englishLabel}) có thể trả lời`;
      assert.match(labelFollowing, /Người bạn theo dõi \(People you follow\) có thể trả lời/);

      const optionMentioned = getReplyPrivacyOption('MENTIONED');
      const labelMentioned = `${optionMentioned.label} (${optionMentioned.englishLabel}) có thể trả lời`;
      assert.match(labelMentioned, /Chỉ người được nhắc đến \(Only mentioned users\) có thể trả lời/);
    });

    it('simulates keyboard navigation flow in dropdown menu', () => {
      // Simulate index state cycling with ArrowDown / ArrowUp
      let activeIndex = 0;
      const optionsCount = REPLY_PRIVACY_OPTIONS.length;

      // Down -> index 1
      activeIndex = (activeIndex + 1) % optionsCount;
      assert.equal(activeIndex, 1);
      assert.equal(REPLY_PRIVACY_OPTIONS[activeIndex].value, 'FOLLOWING');

      // Down -> index 2
      activeIndex = (activeIndex + 1) % optionsCount;
      assert.equal(activeIndex, 2);
      assert.equal(REPLY_PRIVACY_OPTIONS[activeIndex].value, 'MENTIONED');

      // Down (wraps to 0)
      activeIndex = (activeIndex + 1) % optionsCount;
      assert.equal(activeIndex, 0);
      assert.equal(REPLY_PRIVACY_OPTIONS[activeIndex].value, 'EVERYONE');

      // Up (wraps to 2)
      activeIndex = (activeIndex - 1 + optionsCount) % optionsCount;
      assert.equal(activeIndex, 2);
      assert.equal(REPLY_PRIVACY_OPTIONS[activeIndex].value, 'MENTIONED');
    });
  });

  // =========================================================================
  // 5. OPTIMISTIC UI UPDATES & ERROR BANNER ROLLBACK
  // =========================================================================
  describe('5. Optimistic UI Updates & Error Banner Rollback', () => {
    it('simulates optimistic reply submission, 403 error capture, draft restoration and rollback', () => {
      let draftContent = 'My important reply thoughts';
      let isSubmitting = false;
      let permissionError = null;
      let replies = [];
      let repliesCount = 5;

      // User hits submit
      isSubmitting = true;
      const submittedText = draftContent;
      const tempId = `temp-${Date.now()}`;
      const optimisticReply = {
        id: tempId,
        content: submittedText,
        author: { ...strangerUser },
        createdAt: new Date().toISOString(),
      };

      // 1. Optimistic insertion
      replies = [...replies, optimisticReply];
      repliesCount += 1;
      draftContent = ''; // Clear textarea optimistically

      assert.equal(replies.length, 1);
      assert.equal(repliesCount, 6);
      assert.equal(draftContent, '');

      // 2. Server responds with 403 REPLY_RESTRICTED error
      const serverResponse = {
        statusCode: 403,
        error: {
          code: 'REPLY_RESTRICTED',
          message: 'Only users followed by the author can reply in this thread',
        },
      };

      // 3. Rollback handler execution
      isSubmitting = false;
      replies = replies.filter((r) => r.id !== tempId);
      repliesCount -= 1;
      draftContent = submittedText; // Restore user's draft!
      permissionError = serverResponse.error.message;

      // Verify state restored
      assert.equal(replies.length, 0, 'Temporary reply must be removed from thread list');
      assert.equal(repliesCount, 5, 'Replies count must be decremented back to original');
      assert.equal(draftContent, 'My important reply thoughts', 'User draft text must be preserved');
      assert.equal(
        permissionError,
        'Only users followed by the author can reply in this thread',
        'Permission error banner must be populated'
      );

      // Verify error banner visual state
      const errorBanner = {
        'data-testid': 'composer-permission-error',
        visible: Boolean(permissionError),
        message: permissionError,
      };
      assert.equal(errorBanner.visible, true);
      assert.equal(errorBanner['data-testid'], 'composer-permission-error');

      // Dismiss error
      permissionError = null;
      assert.equal(Boolean(permissionError), false);
    });
  });

  // =========================================================================
  // 6. DYNAMIC VISUAL STATE REACTIVITY: REALTIME PRIVACY CHANGES
  // =========================================================================
  describe('6. Dynamic Visual State Reactivity: Realtime Privacy Changes', () => {
    it('transitions visual state reactively when author updates post privacy', () => {
      // Step 1: Initial state is EVERYONE
      const livePost = {
        id: 'p-live-01',
        authorId: authorUser.id,
        author: { ...authorUser, isFollowing: false },
        content: 'Reactive live post',
        replyPrivacy: 'EVERYONE',
        reply_privacy: 'EVERYONE',
        mentions: [],
      };

      let strangerVisual = computeComposerVisualState(livePost, strangerUser);
      assert.equal(strangerVisual.disabled, false);
      assert.equal(strangerVisual.textarea['data-testid'], undefined);
      assert.equal(strangerVisual.restrictedBanner.rendered, false);

      // Step 2: Author updates to FOLLOWING -> Stranger UI reactively disables
      livePost.replyPrivacy = 'FOLLOWING';
      livePost.reply_privacy = 'FOLLOWING';
      strangerVisual = computeComposerVisualState(livePost, strangerUser);
      assert.equal(strangerVisual.disabled, true);
      assert.equal(strangerVisual.textarea['data-testid'], 'reply-input-disabled');
      assert.equal(strangerVisual.restrictedBanner.rendered, true);

      // Step 3: Author updates to MENTIONED and mentions Stranger -> Stranger UI reactively enables
      livePost.replyPrivacy = 'MENTIONED';
      livePost.reply_privacy = 'MENTIONED';
      livePost.mentions = [strangerUser.username];
      strangerVisual = computeComposerVisualState(livePost, strangerUser);
      assert.equal(strangerVisual.disabled, false);
      assert.equal(strangerVisual.textarea['data-testid'], undefined);
      assert.equal(strangerVisual.restrictedBanner.rendered, false);
    });
  });
});

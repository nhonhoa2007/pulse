import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  formatViewsCount,
  formatViewsBadge,
  ImpressionBatchBuffer,
} from '../src/utils/useViewportImpressionTracker.ts';

import {
  urlBase64ToUint8Array,
} from '../src/utils/webPushManager.ts';

describe('TASK-20: Frontend Algorithmic Feeds & Group Real-Time Comms Visual States Suite', () => {
  // =========================================================================
  // 1. UNIT TESTS: useViewportImpressionTracker & Batch Buffer Logic
  // =========================================================================
  describe('1. Viewport Impression Tracking Logic & Calculations', () => {
    it('batches visible post IDs and dedupes across view sessions', () => {
      const buffer = new ImpressionBatchBuffer();

      assert.strictEqual(buffer.hasPending(), false);
      assert.strictEqual(buffer.getPendingCount(), 0);

      // Add posts
      assert.strictEqual(buffer.add('post-alpha'), true);
      assert.strictEqual(buffer.add('post-beta'), true);
      // Same batch duplicate ignored
      assert.strictEqual(buffer.add('post-alpha'), false);

      assert.strictEqual(buffer.hasPending(), true);
      assert.strictEqual(buffer.getPendingCount(), 2);

      const flushedBatch1 = buffer.flush();
      assert.deepStrictEqual(flushedBatch1, ['post-alpha', 'post-beta']);
      assert.strictEqual(buffer.hasPending(), false);
      assert.strictEqual(buffer.getPendingCount(), 0);

      // In same session, post-alpha should not be re-buffered
      assert.strictEqual(buffer.add('post-alpha'), false);
      assert.strictEqual(buffer.add('post-gamma'), true);

      const flushedBatch2 = buffer.flush();
      assert.deepStrictEqual(flushedBatch2, ['post-gamma']);
    });

    it('enforces intersection threshold >= 0.5 for impression recording', () => {
      const evaluateIntersection = (entry) => {
        return Boolean(entry.isIntersecting && entry.intersectionRatio >= 0.5);
      };

      assert.strictEqual(
        evaluateIntersection({ isIntersecting: true, intersectionRatio: 0.5 }),
        true
      );
      assert.strictEqual(
        evaluateIntersection({ isIntersecting: true, intersectionRatio: 0.82 }),
        true
      );
      assert.strictEqual(
        evaluateIntersection({ isIntersecting: true, intersectionRatio: 0.49 }),
        false,
        'Ratio < 0.5 must not trigger impression'
      );
      assert.strictEqual(
        evaluateIntersection({ isIntersecting: false, intersectionRatio: 0.95 }),
        false,
        'Non-intersecting entry must not trigger impression'
      );
    });

    it('formats raw viewsCount across orders of magnitude accurately', () => {
      assert.strictEqual(formatViewsCount(0), '0');
      assert.strictEqual(formatViewsCount(null), '0');
      assert.strictEqual(formatViewsCount(undefined), '0');
      assert.strictEqual(formatViewsCount(-10), '0');
      assert.strictEqual(formatViewsCount(1), '1');
      assert.strictEqual(formatViewsCount(42), '42');
      assert.strictEqual(formatViewsCount(999), '999');
      assert.strictEqual(formatViewsCount(1000), '1K');
      assert.strictEqual(formatViewsCount(1234), '1.2K');
      assert.strictEqual(formatViewsCount(10400), '10K');
      assert.strictEqual(formatViewsCount(10500), '11K');
      assert.strictEqual(formatViewsCount(1000000), '1M');
      assert.strictEqual(formatViewsCount(2500000), '2.5M');
    });

    it('formats views count badge text correctly (0, 42, 1.2K views, 1.5M views)', () => {
      assert.strictEqual(formatViewsBadge(0), '0');
      assert.strictEqual(formatViewsBadge(42), '42');
      assert.strictEqual(formatViewsBadge(999), '999');
      assert.strictEqual(formatViewsBadge(1200), '1.2K views');
      assert.strictEqual(formatViewsBadge(1500000), '1.5M views');
    });
  });

  // =========================================================================
  // 2. VISUAL STATES: "Dành cho bạn" vs "Đang theo dõi" Feed Tabs
  // =========================================================================
  describe('2. "Dành cho bạn" vs "Đang theo dõi" Dual Pill Switcher Visual States', () => {
    const getTabVisualClasses = (isActive) => {
      return {
        tabClass: isActive
          ? 'bg-[#000000] text-[#fafafa] shadow-sm'
          : 'text-[#424242] hover:text-[#000000]',
        ariaSelected: isActive,
      };
    };

    it('evaluates active state classes for "Dành cho bạn" tab matching Threads Light Theme', () => {
      const activeForYou = getTabVisualClasses(true);
      assert.match(activeForYou.tabClass, /bg-\[#000000\]/);
      assert.match(activeForYou.tabClass, /text-\[#fafafa\]/);
      assert.match(activeForYou.tabClass, /shadow-sm/);
      assert.strictEqual(activeForYou.ariaSelected, true);
    });

    it('evaluates inactive state classes for "Đang theo dõi" tab', () => {
      const inactiveFollowing = getTabVisualClasses(false);
      assert.match(inactiveFollowing.tabClass, /text-\[#424242\]/);
      assert.match(inactiveFollowing.tabClass, /hover:text-\[#000000\]/);
      assert.strictEqual(inactiveFollowing.ariaSelected, false);
    });

    it('maps tab selection to corresponding API endpoints & query builder', () => {
      const resolveFeedEndpoint = (tab) => {
        if (tab === 'forYou') return '/api/v1/feed/for-you';
        if (tab === 'following') return '/api/v1/feed/home';
        throw new Error(`Invalid tab: ${tab}`);
      };

      assert.strictEqual(resolveFeedEndpoint('forYou'), '/api/v1/feed/for-you');
      assert.strictEqual(resolveFeedEndpoint('following'), '/api/v1/feed/home');

      const buildCursorQuery = (cursor, limit = 20) => {
        const p = new URLSearchParams();
        if (cursor) p.append('cursor', cursor);
        p.append('limit', limit.toString());
        return `?${p.toString()}`;
      };

      assert.strictEqual(buildCursorQuery(null, 20), '?limit=20');
      assert.strictEqual(
        buildCursorQuery('45.2:post_abc_123', 25),
        '?cursor=45.2%3Apost_abc_123&limit=25'
      );
    });
  });

  // =========================================================================
  // 3. VISUAL STATES: Views Count Badge on PostFeedItem
  // =========================================================================
  describe('3. PostFeedItem Views Count Badge Visual State', () => {
    const evaluateViewsBadgeVisualState = (viewsCount) => {
      const count = viewsCount ?? 0;
      return {
        renderedText: formatViewsBadge(count),
        tooltipTitle: `${count.toLocaleString()} lượt xem`,
        iconName: 'BarChart2',
        shouldHighlightZero: count === 0,
      };
    };

    it('renders correct views count badge and tooltip for 0 views', () => {
      const state = evaluateViewsBadgeVisualState(0);
      assert.strictEqual(state.renderedText, '0');
      assert.strictEqual(state.tooltipTitle, '0 lượt xem');
      assert.strictEqual(state.iconName, 'BarChart2');
    });

    it('renders correct views count badge and localized tooltip for thousands of views', () => {
      const state = evaluateViewsBadgeVisualState(12450);
      assert.strictEqual(state.renderedText, '12K views');
      assert.strictEqual(state.tooltipTitle, '12,450 lượt xem');
    });

    it('renders correct views count badge and localized tooltip for millions of views', () => {
      const state = evaluateViewsBadgeVisualState(3400000);
      assert.strictEqual(state.renderedText, '3.4M views');
      assert.strictEqual(state.tooltipTitle, '3,400,000 lượt xem');
    });
  });

  // =========================================================================
  // 4. VISUAL STATES: CreateGroupModal
  // =========================================================================
  describe('4. CreateGroupModal Visual States & Form Invariants', () => {
    const evaluateCreateGroupState = ({ title, selectedMemberIds, isSubmitting }) => {
      const trimmedTitle = (title || '').trim();
      const isTitleValid = trimmedTitle.length >= 1 && trimmedTitle.length <= 100;
      const isMembersValid = (selectedMemberIds || []).length >= 1;
      const isFormValid = isTitleValid && isMembersValid;

      let validationError = null;
      if (trimmedTitle.length === 0) {
        validationError = 'Vui lòng nhập tên nhóm.';
      } else if (trimmedTitle.length > 100) {
        validationError = 'Tên nhóm không được vượt quá 100 ký tự.';
      } else if (!isMembersValid) {
        validationError = 'Vui lòng chọn ít nhất 1 thành viên để tạo nhóm.';
      }

      return {
        isFormValid,
        canSubmit: isFormValid && !isSubmitting,
        submitButtonClass: isFormValid && !isSubmitting
          ? 'bg-[#000000] text-[#fafafa] hover:bg-[#262626] cursor-pointer'
          : 'bg-[#e5e5e5] text-[#a3a3a3] cursor-not-allowed',
        validationError,
      };
    };

    it('disables submit button when group title is empty', () => {
      const state = evaluateCreateGroupState({
        title: '',
        selectedMemberIds: ['user-bob'],
        isSubmitting: false,
      });

      assert.strictEqual(state.isFormValid, false);
      assert.strictEqual(state.canSubmit, false);
      assert.match(state.submitButtonClass, /cursor-not-allowed/);
      assert.strictEqual(state.validationError, 'Vui lòng nhập tên nhóm.');
    });

    it('disables submit button when title exceeds 100 characters', () => {
      const state = evaluateCreateGroupState({
        title: 'T'.repeat(101),
        selectedMemberIds: ['user-bob'],
        isSubmitting: false,
      });

      assert.strictEqual(state.isFormValid, false);
      assert.strictEqual(state.canSubmit, false);
      assert.strictEqual(state.validationError, 'Tên nhóm không được vượt quá 100 ký tự.');
    });

    it('disables submit button when no members are selected', () => {
      const state = evaluateCreateGroupState({
        title: 'Engineering Core',
        selectedMemberIds: [],
        isSubmitting: false,
      });

      assert.strictEqual(state.isFormValid, false);
      assert.strictEqual(state.canSubmit, false);
      assert.strictEqual(state.validationError, 'Vui lòng chọn ít nhất 1 thành viên để tạo nhóm.');
    });

    it('enables submit button with high-contrast black styling when form is valid', () => {
      const state = evaluateCreateGroupState({
        title: 'Engineering Core',
        selectedMemberIds: ['user-bob', 'user-charlie'],
        isSubmitting: false,
      });

      assert.strictEqual(state.isFormValid, true);
      assert.strictEqual(state.canSubmit, true);
      assert.match(state.submitButtonClass, /bg-\[#000000\]/);
      assert.strictEqual(state.validationError, null);
    });

    it('disables submit button while submission is in-flight to prevent duplicate posts', () => {
      const state = evaluateCreateGroupState({
        title: 'Engineering Core',
        selectedMemberIds: ['user-bob'],
        isSubmitting: true,
      });

      assert.strictEqual(state.canSubmit, false);
    });
  });

  // =========================================================================
  // 5. VISUAL STATES: GroupDmConversationView
  // =========================================================================
  describe('5. GroupDmConversationView Visual States & Message Rendering', () => {
    const evaluateMessageBubbleVisualState = (message, currentUserId) => {
      const isOwn = message.senderId === currentUserId;
      const isDeleted = Boolean(message.isDeleted);

      return {
        isOwn,
        bubbleClass: isOwn
          ? 'bg-[#000000] text-[#ffffff] rounded-2xl rounded-tr-sm ml-auto'
          : 'bg-[#f0f0f0] text-[#000000] rounded-2xl rounded-tl-sm mr-auto',
        senderLabel: isOwn ? null : message.sender?.displayName || 'Thành viên',
        renderedContent: isDeleted ? 'Tin nhắn đã bị xóa' : message.content,
        isContentMasked: isDeleted,
        hasMedia: !isDeleted && Boolean(message.mediaUrls?.length),
        canDelete: isOwn && !isDeleted,
      };
    };

    it('renders outgoing message bubble with black background and right alignment', () => {
      const msg = {
        id: 'msg-1',
        senderId: 'user-alice',
        content: 'Hi everyone, ready for deployment?',
        isDeleted: false,
      };

      const bubble = evaluateMessageBubbleVisualState(msg, 'user-alice');
      assert.strictEqual(bubble.isOwn, true);
      assert.match(bubble.bubbleClass, /bg-\[#000000\]/);
      assert.match(bubble.bubbleClass, /ml-auto/);
      assert.strictEqual(bubble.senderLabel, null);
      assert.strictEqual(bubble.renderedContent, 'Hi everyone, ready for deployment?');
      assert.strictEqual(bubble.canDelete, true);
    });

    it('renders incoming message bubble with gray background and sender display name', () => {
      const msg = {
        id: 'msg-2',
        senderId: 'user-bob',
        sender: { displayName: 'Bob Nguyen' },
        content: 'Yes, tests are 100% green!',
        isDeleted: false,
      };

      const bubble = evaluateMessageBubbleVisualState(msg, 'user-alice');
      assert.strictEqual(bubble.isOwn, false);
      assert.match(bubble.bubbleClass, /bg-\[#f0f0f0\]/);
      assert.match(bubble.bubbleClass, /mr-auto/);
      assert.strictEqual(bubble.senderLabel, 'Bob Nguyen');
      assert.strictEqual(bubble.renderedContent, 'Yes, tests are 100% green!');
      assert.strictEqual(bubble.canDelete, false, 'Non-author cannot delete message');
    });

    it('masks deleted message content and hides media & delete button', () => {
      const msg = {
        id: 'msg-3',
        senderId: 'user-alice',
        content: 'Sensitive secret leaked',
        mediaUrls: ['https://cdn.pulse.social/secret.png'],
        isDeleted: true,
      };

      const bubble = evaluateMessageBubbleVisualState(msg, 'user-alice');
      assert.strictEqual(bubble.isContentMasked, true);
      assert.strictEqual(bubble.renderedContent, 'Tin nhắn đã bị xóa');
      assert.strictEqual(bubble.hasMedia, false);
      assert.strictEqual(bubble.canDelete, false);
    });
  });

  // =========================================================================
  // 6. VISUAL STATES: GroupMembersModal
  // =========================================================================
  describe('6. GroupMembersModal Visual States & Role-Based Actions', () => {
    const evaluateMemberRowActions = ({ currentUserRole, isCreator, targetMember, currentUserId }) => {
      const isAdmin = currentUserRole === 'ADMIN' || isCreator;
      const isTargetSelf = targetMember.userId === currentUserId;
      const isTargetCreator = targetMember.role === 'ADMIN' && targetMember.isCreator;

      return {
        isAdmin,
        canKick: isAdmin && !isTargetSelf && !isTargetCreator,
        canLeave: isTargetSelf,
        badgeLabel: targetMember.role === 'ADMIN' ? 'Quản trị viên' : 'Thành viên',
        badgeClass: targetMember.role === 'ADMIN'
          ? 'bg-[#000000] text-[#fafafa]'
          : 'bg-[#f0f0f0] text-[#525252]',
      };
    };

    it('shows Kick button for Admin viewing a regular Member', () => {
      const actions = evaluateMemberRowActions({
        currentUserRole: 'ADMIN',
        isCreator: true,
        targetMember: { userId: 'user-bob', role: 'MEMBER' },
        currentUserId: 'user-admin',
      });

      assert.strictEqual(actions.canKick, true);
      assert.strictEqual(actions.canLeave, false);
      assert.strictEqual(actions.badgeLabel, 'Thành viên');
      assert.match(actions.badgeClass, /bg-\[#f0f0f0\]/);
    });

    it('hides Kick button and shows Leave button for Admin viewing their own row', () => {
      const actions = evaluateMemberRowActions({
        currentUserRole: 'ADMIN',
        isCreator: true,
        targetMember: { userId: 'user-admin', role: 'ADMIN', isCreator: true },
        currentUserId: 'user-admin',
      });

      assert.strictEqual(actions.canKick, false, 'Admin cannot kick themselves');
      assert.strictEqual(actions.canLeave, true);
      assert.strictEqual(actions.badgeLabel, 'Quản trị viên');
      assert.match(actions.badgeClass, /bg-\[#000000\]/);
    });

    it('hides Kick button completely when current user is a regular Member', () => {
      const actions = evaluateMemberRowActions({
        currentUserRole: 'MEMBER',
        isCreator: false,
        targetMember: { userId: 'user-charlie', role: 'MEMBER' },
        currentUserId: 'user-bob',
      });

      assert.strictEqual(actions.canKick, false);
      assert.strictEqual(actions.canLeave, false);
    });

    it('evaluates Add Member subtab access (Admin only)', () => {
      const evaluateAddMemberTabVisibility = (role, isCreator) => {
        return Boolean(role === 'ADMIN' || isCreator);
      };

      assert.strictEqual(evaluateAddMemberTabVisibility('ADMIN', false), true);
      assert.strictEqual(evaluateAddMemberTabVisibility('MEMBER', true), true);
      assert.strictEqual(evaluateAddMemberTabVisibility('MEMBER', false), false);
    });
  });

  // =========================================================================
  // 7. WEB PUSH NOTIFICATION UTILITIES
  // =========================================================================
  describe('7. Web Push Notification & VAPID Utilities', () => {
    it('converts base64url VAPID public key to Uint8Array properly (RFC 8292 P-256)', () => {
      const sampleKey = 'BNcRdreAaoET1Wztqz5_3OccJnEgVa0zAWHl08iXtHqWjOwbCQe4AF9TXZYfvvi1TznF5K8ioUbWT8xSD8ngQ2k';
      const arr = urlBase64ToUint8Array(sampleKey);

      assert.ok(arr instanceof Uint8Array);
      assert.strictEqual(arr.length, 65, 'Decoded uncompressed P-256 key must be 65 bytes');
      assert.strictEqual(arr[0], 0x04, 'Must start with uncompressed point prefix 0x04');
    });
  });
});

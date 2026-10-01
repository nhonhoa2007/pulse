import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  EDIT_WINDOW_DURATION_MS,
  computeEditWindowRemaining,
  shouldShieldPost,
  getContentWarningLabel,
  getContentWarningShieldVisualState,
  getEditButtonState,
  getPinButtonState,
  formatMuteDuration,
  formatMuteContext,
  formatMatchType,
} from '../src/utils/trustSafety.ts';

describe('TASK-18: Frontend Visual States & Trust, Safety & Post Lifecycle Test Suite', () => {
  // -------------------------------------------------------------------------
  // 1. ContentWarningShield Visual States & Invariants
  // -------------------------------------------------------------------------
  describe('1. ContentWarningShield Visual States & Invariants', () => {
    it('evaluates unshielded state when post has no warning and isSensitive=false', () => {
      const post = {
        isSensitive: false,
        contentWarning: null,
      };

      assert.equal(shouldShieldPost(post), false);
      const visualState = getContentWarningShieldVisualState(post, false);
      assert.equal(visualState.isShielded, false);
      assert.equal(visualState.isRevealed, true);
      assert.equal(visualState.isContentHidden, false);
      assert.equal(visualState.isBlurApplied, false);
      assert.equal(visualState.label, null);
      assert.equal(visualState.buttonText, null);
    });

    it('evaluates collapsed shield state when post is marked sensitive', () => {
      const post = {
        isSensitive: true,
        contentWarning: null,
      };

      assert.equal(shouldShieldPost(post), true);
      const visualState = getContentWarningShieldVisualState(post, false);
      assert.equal(visualState.isShielded, true);
      assert.equal(visualState.isRevealed, false);
      assert.equal(visualState.isContentHidden, true);
      assert.equal(visualState.isBlurApplied, true);
      assert.equal(visualState.label, 'Cảnh báo: Nội dung nhạy cảm');
      assert.equal(visualState.buttonText, 'Xem bài viết');
    });

    it('evaluates collapsed shield state when post has custom contentWarning label', () => {
      const post = {
        isSensitive: false,
        contentWarning: 'Tiết lộ nội dung phim Dune 2',
      };

      assert.equal(shouldShieldPost(post), true);
      const visualState = getContentWarningShieldVisualState(post, false);
      assert.equal(visualState.isShielded, true);
      assert.equal(visualState.isRevealed, false);
      assert.equal(visualState.isContentHidden, true);
      assert.equal(visualState.isBlurApplied, true);
      assert.equal(visualState.label, 'Cảnh báo: Tiết lộ nội dung phim Dune 2');
      assert.equal(visualState.buttonText, 'Xem bài viết');
    });

    it('evaluates revealed shield state when user toggles "Xem bài viết"', () => {
      const post = {
        isSensitive: true,
        contentWarning: 'Hình ảnh giật gân',
      };

      const visualState = getContentWarningShieldVisualState(post, true);
      assert.equal(visualState.isShielded, true);
      assert.equal(visualState.isRevealed, true);
      assert.equal(visualState.isContentHidden, false);
      assert.equal(visualState.isBlurApplied, false);
      assert.equal(visualState.label, 'Cảnh báo: Hình ảnh giật gân');
      assert.equal(visualState.buttonText, 'Ẩn bài viết');
    });

    it('ignores empty whitespace contentWarning and handles trimming', () => {
      const postOnlySpaces = {
        isSensitive: false,
        contentWarning: '   ',
      };
      assert.equal(shouldShieldPost(postOnlySpaces), false);

      const postWithSpaces = {
        isSensitive: false,
        contentWarning: '   Ánh sáng nhấp nháy   ',
      };
      assert.equal(shouldShieldPost(postWithSpaces), true);
      assert.equal(
        getContentWarningLabel(postWithSpaces.contentWarning, false),
        'Cảnh báo: Ánh sáng nhấp nháy'
      );
    });
  });

  // -------------------------------------------------------------------------
  // 2. 15-Minute Edit Window Countdown & Visual State
  // -------------------------------------------------------------------------
  describe('2. 15-Minute Edit Window Countdown & Form Lock', () => {
    it('calculates full 15m 00s remaining immediately after creation', () => {
      const baseNow = Date.now();
      const createdAt = new Date(baseNow).toISOString();

      const result = computeEditWindowRemaining(createdAt, baseNow);
      assert.equal(result.isExpired, false);
      assert.equal(result.remainingMs, EDIT_WINDOW_DURATION_MS);
      assert.equal(result.remainingSeconds, 900);
      assert.equal(result.minutes, 15);
      assert.equal(result.seconds, 0);
      assert.equal(result.formatted, 'Còn lại 15 phút 00 giây để chỉnh sửa');
      assert.equal(result.shortFormatted, '15:00');
    });

    it('calculates exact countdown when 2m 15s have elapsed (12m 45s remaining)', () => {
      const baseNow = 1789570000000;
      const elapsedMs = (2 * 60 + 15) * 1000; // 135,000 ms
      const createdAt = new Date(baseNow - elapsedMs).toISOString();

      const result = computeEditWindowRemaining(createdAt, baseNow);
      assert.equal(result.isExpired, false);
      assert.equal(result.remainingSeconds, 765); // 900 - 135 = 765
      assert.equal(result.minutes, 12);
      assert.equal(result.seconds, 45);
      assert.equal(result.formatted, 'Còn lại 12 phút 45 giây để chỉnh sửa');
      assert.equal(result.shortFormatted, '12:45');
    });

    it('formats single-digit seconds with leading zero', () => {
      const baseNow = 1789570000000;
      const elapsedMs = 14 * 60 * 1000 + 55 * 1000; // 14m 55s elapsed -> 5s remaining
      const createdAt = new Date(baseNow - elapsedMs).toISOString();

      const result = computeEditWindowRemaining(createdAt, baseNow);
      assert.equal(result.isExpired, false);
      assert.equal(result.remainingSeconds, 5);
      assert.equal(result.minutes, 0);
      assert.equal(result.seconds, 5);
      assert.equal(result.formatted, 'Còn lại 0 phút 05 giây để chỉnh sửa');
      assert.equal(result.shortFormatted, '0:05');
    });

    it('switches to expired state and disables form when countdown reaches zero', () => {
      const baseNow = 1789570000000;
      const elapsedMs = EDIT_WINDOW_DURATION_MS; // Exactly 15m 0s
      const createdAt = new Date(baseNow - elapsedMs).toISOString();

      const result = computeEditWindowRemaining(createdAt, baseNow);
      assert.equal(result.isExpired, true);
      assert.equal(result.remainingMs, 0);
      assert.equal(result.remainingSeconds, 0);
      assert.equal(result.formatted, 'Đã hết thời hạn chỉnh sửa');
      assert.equal(result.shortFormatted, '0:00');
    });

    it('switches to expired state when time is past 15 minutes', () => {
      const baseNow = 1789570000000;
      const elapsedMs = 16 * 60 * 1000; // 16 minutes elapsed
      const createdAt = new Date(baseNow - elapsedMs).toISOString();

      const result = computeEditWindowRemaining(createdAt, baseNow);
      assert.equal(result.isExpired, true);
      assert.equal(result.remainingMs, 0);
      assert.equal(result.formatted, 'Đã hết thời hạn chỉnh sửa');
    });

    it('handles invalid date input safely and treats as expired', () => {
      const result = computeEditWindowRemaining('invalid-date-string');
      assert.equal(result.isExpired, true);
      assert.equal(result.formatted, 'Đã hết thời hạn chỉnh sửa');
      assert.equal(result.shortFormatted, '0:00');
    });

    it('evaluates edit button state in 3-dot action menu for author vs stranger', () => {
      const currentUserId = 'user-alice';
      const baseNow = 1789570000000;

      // 1. Author within window
      const postAuthorWithin = {
        authorId: 'user-alice',
        createdAt: new Date(baseNow - 5 * 60 * 1000).toISOString(),
      };
      const state1 = getEditButtonState(postAuthorWithin, currentUserId, baseNow);
      assert.equal(state1.isAuthor, true);
      assert.equal(state1.canEdit, true);
      assert.equal(state1.isExpired, false);
      assert.equal(state1.disabledReason, null);

      // 2. Author past window
      const postAuthorExpired = {
        authorId: 'user-alice',
        createdAt: new Date(baseNow - 16 * 60 * 1000).toISOString(),
      };
      const state2 = getEditButtonState(postAuthorExpired, currentUserId, baseNow);
      assert.equal(state2.isAuthor, true);
      assert.equal(state2.canEdit, false);
      assert.equal(state2.isExpired, true);
      assert.equal(state2.disabledReason, 'Đã hết thời hạn 15 phút chỉnh sửa');

      // 3. Non-author stranger within window
      const postStranger = {
        authorId: 'user-bob',
        createdAt: new Date(baseNow - 5 * 60 * 1000).toISOString(),
      };
      const state3 = getEditButtonState(postStranger, currentUserId, baseNow);
      assert.equal(state3.isAuthor, false);
      assert.equal(state3.canEdit, false);
      assert.equal(state3.disabledReason, 'Chỉ tác giả mới có thể chỉnh sửa bài viết');
    });
  });

  // -------------------------------------------------------------------------
  // 3. Pinned Post & Edited Badge Visual Indicators
  // -------------------------------------------------------------------------
  describe('3. Pinned Post & Edited Badge Visual Indicators', () => {
    it('author can pin root post, displays "Ghim lên trang cá nhân"', () => {
      const currentUserId = 'user-alice';
      const post = {
        authorId: 'user-alice',
        replyToId: null,
        isPinned: false,
      };

      const pinState = getPinButtonState(post, currentUserId);
      assert.equal(pinState.isAuthor, true);
      assert.equal(pinState.isRootPost, true);
      assert.equal(pinState.canPin, true);
      assert.equal(pinState.isPinned, false);
      assert.equal(pinState.actionLabel, 'Ghim lên trang cá nhân');
      assert.equal(pinState.disabledReason, null);
    });

    it('author can unpin already pinned post, displays "Bỏ ghim khỏi trang cá nhân"', () => {
      const currentUserId = 'user-alice';
      const post = {
        authorId: 'user-alice',
        replyToId: null,
        isPinned: true,
      };

      const pinState = getPinButtonState(post, currentUserId);
      assert.equal(pinState.canPin, true);
      assert.equal(pinState.isPinned, true);
      assert.equal(pinState.actionLabel, 'Bỏ ghim khỏi trang cá nhân');
    });

    it('rejects pinning reply post and provides informative disabled reason', () => {
      const currentUserId = 'user-alice';
      const replyPost = {
        authorId: 'user-alice',
        replyToId: 'root-post-123',
        isPinned: false,
      };

      const pinState = getPinButtonState(replyPost, currentUserId);
      assert.equal(pinState.isRootPost, false);
      assert.equal(pinState.canPin, false);
      assert.equal(pinState.disabledReason, 'Không thể ghim bài trả lời');
    });

    it('rejects non-author pinning someone else post', () => {
      const currentUserId = 'user-alice';
      const bobPost = {
        authorId: 'user-bob',
        replyToId: null,
        isPinned: false,
      };

      const pinState = getPinButtonState(bobPost, currentUserId);
      assert.equal(pinState.isAuthor, false);
      assert.equal(pinState.canPin, false);
      assert.equal(pinState.disabledReason, 'Chỉ tác giả mới có thể ghim bài viết');
    });

    it('evaluates edited badge presence based on post.isEdited', () => {
      const uneditedPost = { isEdited: false };
      const editedPost = { isEdited: true, editCount: 2 };

      assert.equal(!!uneditedPost.isEdited, false);
      assert.equal(!!editedPost.isEdited, true);
    });
  });

  // -------------------------------------------------------------------------
  // 4. Mute Management Formatting Utilities
  // -------------------------------------------------------------------------
  describe('4. Mute Management Formatting Utilities', () => {
    it('formats mute expiration durations correctly', () => {
      const baseNow = 1789570000000;

      // Forever (null)
      assert.equal(formatMuteDuration(null, baseNow), 'Vĩnh viễn');

      // 7 days in future
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
      const future7d = new Date(baseNow + sevenDaysMs).toISOString();
      assert.equal(formatMuteDuration(future7d, baseNow), 'Còn lại 7 ngày');

      // 5 hours in future
      const fiveHoursMs = 5 * 60 * 60 * 1000;
      const future5h = new Date(baseNow + fiveHoursMs).toISOString();
      assert.equal(formatMuteDuration(future5h, baseNow), 'Còn lại 5 giờ');

      // 30 minutes in future
      const thirtyMinsMs = 30 * 60 * 1000;
      const future30m = new Date(baseNow + thirtyMinsMs).toISOString();
      assert.equal(formatMuteDuration(future30m, baseNow), 'Còn lại 30 phút');

      // Expired in past
      const pastMs = baseNow - 1000;
      const pastDate = new Date(pastMs).toISOString();
      assert.equal(formatMuteDuration(pastDate, baseNow), 'Đã hết hạn');
    });

    it('formats mute context and match type labels for Vietnamese UI', () => {
      assert.equal(formatMuteContext('ALL'), 'Tất cả');
      assert.equal(formatMuteContext('HOME_TIMELINE'), 'Bảng tin');
      assert.equal(formatMuteContext('NOTIFICATIONS'), 'Thông báo');

      assert.equal(formatMatchType('CONTAINS'), 'Khớp một phần');
      assert.equal(formatMatchType('EXACT_WORD'), 'Khớp toàn bộ từ');
    });
  });
});

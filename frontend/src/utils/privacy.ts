import type { PostDto, UserDto, ReplyPrivacy } from '../types/PulseTypes';

export interface ReplyPrivacyOption {
  value: ReplyPrivacy;
  label: string;
  englishLabel: string;
  description: string;
  englishDescription: string;
}

export const REPLY_PRIVACY_OPTIONS: ReplyPrivacyOption[] = [
  {
    value: 'EVERYONE',
    label: 'Mọi người',
    englishLabel: 'Everyone',
    description: 'Bất kỳ ai cũng có thể trả lời',
    englishDescription: 'Anyone can reply',
  },
  {
    value: 'FOLLOWING',
    label: 'Người bạn theo dõi',
    englishLabel: 'People you follow',
    description: 'Chỉ những người bạn theo dõi mới có thể trả lời',
    englishDescription: 'Only people you follow can reply',
  },
  {
    value: 'MENTIONED',
    label: 'Chỉ người được nhắc đến',
    englishLabel: 'Only mentioned users',
    description: 'Chỉ những người được gắn thẻ (@) mới có thể trả lời',
    englishDescription: 'Only users mentioned in this post can reply',
  },
];

export function getReplyPrivacy(post: PostDto | null | undefined): ReplyPrivacy {
  if (!post) return 'EVERYONE';
  return post.replyPrivacy || post.reply_privacy || 'EVERYONE';
}

export function getReplyPrivacyOption(value: ReplyPrivacy): ReplyPrivacyOption {
  return (
    REPLY_PRIVACY_OPTIONS.find((opt) => opt.value === value) ||
    REPLY_PRIVACY_OPTIONS[0]
  );
}

export interface ReplyPermissionResult {
  canReply: boolean;
  reason?: string;
  privacy: ReplyPrivacy;
  isAuthor: boolean;
  isMentioned: boolean;
}

/**
 * Evaluates whether the current active user has permission to reply to a given post.
 * Checks:
 * 1. Author status (author can always reply to own post)
 * 2. Authoritative server `canReply` / `can_reply` flag if provided
 * 3. Fallback privacy checks (EVERYONE, MENTIONED, FOLLOWING)
 */
export function evaluateReplyPermission(
  post: PostDto | null | undefined,
  currentUser: UserDto | null | undefined
): ReplyPermissionResult {
  if (!post) {
    return {
      canReply: true,
      privacy: 'EVERYONE',
      isAuthor: false,
      isMentioned: false,
    };
  }

  const privacy = getReplyPrivacy(post);
  const authorName = post.author?.displayName || post.author?.username || 'tác giả';
  const authorUsername = post.author?.username || 'author';

  // Determine author status
  const isAuthor = Boolean(
    currentUser &&
      (currentUser.id === post.authorId ||
        currentUser.id === post.author?.id ||
        (currentUser.username &&
          post.author?.username &&
          currentUser.username.toLowerCase() === post.author.username.toLowerCase()))
  );

  // Author is always permitted to reply to their own post
  if (isAuthor) {
    return {
      canReply: true,
      privacy,
      isAuthor: true,
      isMentioned: false,
    };
  }

  // Determine mention status
  let isMentioned = false;
  if (currentUser?.username) {
    const target = currentUser.username.toLowerCase();
    if (Array.isArray(post.mentions)) {
      isMentioned = post.mentions.some(
        (m) => m.toLowerCase().replace(/^@/, '') === target
      );
    }
    if (!isMentioned && post.content) {
      const mentionRegex = new RegExp(`@${target}\\b`, 'i');
      isMentioned = mentionRegex.test(post.content);
    }
  }

  // Authoritative server response check (respects exact backend validation)
  if (typeof post.canReply === 'boolean') {
    if (post.canReply) {
      return { canReply: true, privacy, isAuthor, isMentioned };
    }
    return {
      canReply: false,
      reason: getRestrictedReason(privacy, authorName, authorUsername),
      privacy,
      isAuthor,
      isMentioned,
    };
  }

  if (typeof post.can_reply === 'boolean') {
    if (post.can_reply) {
      return { canReply: true, privacy, isAuthor, isMentioned };
    }
    return {
      canReply: false,
      reason: getRestrictedReason(privacy, authorName, authorUsername),
      privacy,
      isAuthor,
      isMentioned,
    };
  }

  // Unauthenticated user cannot reply
  if (!currentUser) {
    return {
      canReply: false,
      reason: 'Vui lòng đăng nhập để trả lời bài viết này. (Please log in to reply)',
      privacy,
      isAuthor: false,
      isMentioned: false,
    };
  }

  // Fallback client-side permission evaluation
  if (privacy === 'EVERYONE') {
    return { canReply: true, privacy, isAuthor, isMentioned };
  }

  if (privacy === 'MENTIONED') {
    if (isMentioned) {
      return { canReply: true, privacy, isAuthor, isMentioned: true };
    }
    return {
      canReply: false,
      reason: getRestrictedReason(privacy, authorName, authorUsername),
      privacy,
      isAuthor: false,
      isMentioned: false,
    };
  }

  if (privacy === 'FOLLOWING') {
    // If author is confirmed to follow current user
    if (post.author && (post.author as any).isFollowing === true) {
      return { canReply: true, privacy, isAuthor, isMentioned };
    }
    // For FOLLOWING, only users followed by the post author can reply
    return {
      canReply: false,
      reason: getRestrictedReason(privacy, authorName, authorUsername),
      privacy,
      isAuthor,
      isMentioned,
    };
  }

  return { canReply: true, privacy, isAuthor, isMentioned };
}

export function getRestrictedReason(
  privacy: ReplyPrivacy,
  authorName: string,
  authorUsername: string
): string {
  const authorDisplay = authorName && authorName !== authorUsername ? `${authorName} (@${authorUsername})` : `@${authorUsername}`;
  switch (privacy) {
    case 'FOLLOWING':
      return `Chỉ những người được ${authorDisplay} theo dõi mới có thể trả lời bài viết này. (Only people followed by ${authorDisplay} can reply)`;
    case 'MENTIONED':
      return `Chỉ những người được ${authorDisplay} nhắc đến (@) trong bài viết mới có thể trả lời. (Only users mentioned by ${authorDisplay} can reply)`;
    default:
      return 'Cuộc trò chuyện này đã bị giới hạn người trả lời. (Replies to this conversation are restricted)';
  }
}

// ============================================================================
// TASK-21: PRIVATE ACCOUNT INVARIANTS & FOLLOW BUTTON STATE HELPERS
// ============================================================================

/**
 * Checks whether the profile view should render the locked private account shield.
 * Invariant: Target user is private AND current user is not following them AND not self.
 */
export function isAccountLocked(
  targetUser: Partial<UserDto> | null | undefined,
  currentUserId: string | null | undefined
): boolean {
  if (!targetUser) return false;
  // Author bypass invariant: cannot lock oneself out of own profile
  if (targetUser.id && currentUserId && targetUser.id === currentUserId) {
    return false;
  }
  // If already following, account is unlocked
  if (targetUser.isFollowing) {
    return false;
  }
  // Locked if explicitly private or server marked as locked
  return Boolean(targetUser.isPrivate || targetUser.isLocked);
}

export type FollowButtonState = 'FOLLOW' | 'REQUEST_FOLLOW' | 'REQUESTED' | 'FOLLOWING';

export interface FollowButtonVisualInfo {
  state: FollowButtonState;
  label: string;
  isRequested: boolean;
  isFollowing: boolean;
  canCancel: boolean;
  ariaLabel: string;
}

/**
 * Evaluates the visual state and label of the Follow button for a given user profile.
 */
export function getFollowButtonVisualInfo(
  targetUser: Partial<UserDto> | null | undefined,
  isHoveringRequested = false
): FollowButtonVisualInfo {
  if (targetUser?.isFollowing) {
    return {
      state: 'FOLLOWING',
      label: 'Đang theo dõi',
      isRequested: false,
      isFollowing: true,
      canCancel: false,
      ariaLabel: 'Đang theo dõi',
    };
  }

  if (targetUser?.hasPendingFollowRequest) {
    return {
      state: 'REQUESTED',
      label: isHoveringRequested ? 'Hủy yêu cầu' : 'Đã yêu cầu',
      isRequested: true,
      isFollowing: false,
      canCancel: true,
      ariaLabel: isHoveringRequested ? 'Hủy yêu cầu theo dõi' : 'Đã gửi yêu cầu theo dõi',
    };
  }

  if (targetUser?.isPrivate) {
    return {
      state: 'REQUEST_FOLLOW',
      label: 'Theo dõi',
      isRequested: false,
      isFollowing: false,
      canCancel: false,
      ariaLabel: 'Yêu cầu theo dõi tài khoản riêng tư',
    };
  }

  return {
    state: 'FOLLOW',
    label: 'Theo dõi',
    isRequested: false,
    isFollowing: false,
    canCancel: false,
    ariaLabel: 'Theo dõi tài khoản',
  };
}


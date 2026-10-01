import type { MuteContext, MuteMatchType } from '../types/PulseTypes';

export const EDIT_WINDOW_DURATION_MS = 15 * 60 * 1000; // 15 minutes = 900,000 ms

export interface EditWindowRemainingResult {
  isExpired: boolean;
  remainingMs: number;
  remainingSeconds: number;
  minutes: number;
  seconds: number;
  formatted: string;
  shortFormatted: string;
}

/**
 * Calculates remaining time in the 15-minute post edit window.
 * Accurate down to the second with live countdown formatting.
 */
export function computeEditWindowRemaining(
  createdAt: string | Date | number,
  nowMs: number = Date.now()
): EditWindowRemainingResult {
  const createdMs =
    typeof createdAt === 'number'
      ? createdAt
      : createdAt instanceof Date
      ? createdAt.getTime()
      : new Date(createdAt).getTime();

  if (isNaN(createdMs)) {
    return {
      isExpired: true,
      remainingMs: 0,
      remainingSeconds: 0,
      minutes: 0,
      seconds: 0,
      formatted: 'Đã hết thời hạn chỉnh sửa',
      shortFormatted: '0:00',
    };
  }

  const expiresAtMs = createdMs + EDIT_WINDOW_DURATION_MS;
  const remainingMs = Math.max(0, expiresAtMs - nowMs);
  const remainingSeconds = Math.floor(remainingMs / 1000);
  const isExpired = remainingMs <= 0;

  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  const formattedSeconds = seconds < 10 ? `0${seconds}` : `${seconds}`;

  const formatted = isExpired
    ? 'Đã hết thời hạn chỉnh sửa'
    : `Còn lại ${minutes} phút ${formattedSeconds} giây để chỉnh sửa`;

  const shortFormatted = `${minutes}:${formattedSeconds}`;

  return {
    isExpired,
    remainingMs,
    remainingSeconds,
    minutes,
    seconds,
    formatted,
    shortFormatted,
  };
}

/**
 * Determines whether a post requires a Content Warning Shield.
 */
export function shouldShieldPost(post: {
  isSensitive?: boolean;
  contentWarning?: string | null;
}): boolean {
  if (post.isSensitive) return true;
  if (post.contentWarning && post.contentWarning.trim().length > 0) return true;
  return false;
}

/**
 * Formats user-facing label for Content Warning.
 */
export function getContentWarningLabel(
  contentWarning?: string | null,
  isSensitive?: boolean
): string | null {
  if (contentWarning && contentWarning.trim().length > 0) {
    return `Cảnh báo: ${contentWarning.trim()}`;
  }
  if (isSensitive) {
    return 'Cảnh báo: Nội dung nhạy cảm';
  }
  return null;
}

export interface ContentWarningVisualState {
  isShielded: boolean;
  isRevealed: boolean;
  isContentHidden: boolean;
  isBlurApplied: boolean;
  label: string | null;
  buttonText: string | null;
}

/**
 * Evaluates the visual presentation state of a ContentWarningShield.
 */
export function getContentWarningShieldVisualState(
  post: { isSensitive?: boolean; contentWarning?: string | null },
  isRevealed: boolean = false
): ContentWarningVisualState {
  const isShielded = shouldShieldPost(post);
  if (!isShielded) {
    return {
      isShielded: false,
      isRevealed: true,
      isContentHidden: false,
      isBlurApplied: false,
      label: null,
      buttonText: null,
    };
  }

  const label = getContentWarningLabel(post.contentWarning, post.isSensitive);

  if (!isRevealed) {
    return {
      isShielded: true,
      isRevealed: false,
      isContentHidden: true,
      isBlurApplied: true,
      label,
      buttonText: 'Xem bài viết',
    };
  }

  return {
    isShielded: true,
    isRevealed: true,
    isContentHidden: false,
    isBlurApplied: false,
    label,
    buttonText: 'Ẩn bài viết',
  };
}

export interface EditButtonVisualState {
  isAuthor: boolean;
  canEdit: boolean;
  isExpired: boolean;
  remainingFormatted: string;
  disabledReason: string | null;
}

/**
 * Evaluates the visual & operational state of post edit button in 3-dot menu.
 */
export function getEditButtonState(
  post: { authorId: string; createdAt: string | Date | number },
  currentUserId: string,
  nowMs: number = Date.now()
): EditButtonVisualState {
  const isAuthor = post.authorId === currentUserId;
  const editWindow = computeEditWindowRemaining(post.createdAt, nowMs);

  const canEdit = isAuthor && !editWindow.isExpired;
  let disabledReason: string | null = null;

  if (!isAuthor) {
    disabledReason = 'Chỉ tác giả mới có thể chỉnh sửa bài viết';
  } else if (editWindow.isExpired) {
    disabledReason = 'Đã hết thời hạn 15 phút chỉnh sửa';
  }

  return {
    isAuthor,
    canEdit,
    isExpired: editWindow.isExpired,
    remainingFormatted: editWindow.formatted,
    disabledReason,
  };
}

export interface PinButtonVisualState {
  isAuthor: boolean;
  isRootPost: boolean;
  canPin: boolean;
  isPinned: boolean;
  actionLabel: string;
  disabledReason: string | null;
}

/**
 * Evaluates the visual & operational state of post pin button in 3-dot menu.
 */
export function getPinButtonState(
  post: { authorId: string; replyToId?: string | null; isPinned?: boolean },
  currentUserId: string
): PinButtonVisualState {
  const isAuthor = post.authorId === currentUserId;
  const isRootPost = !post.replyToId;
  const canPin = isAuthor && isRootPost;
  const isPinned = !!post.isPinned;

  const actionLabel = isPinned ? 'Bỏ ghim khỏi trang cá nhân' : 'Ghim lên trang cá nhân';
  let disabledReason: string | null = null;

  if (!isAuthor) {
    disabledReason = 'Chỉ tác giả mới có thể ghim bài viết';
  } else if (!isRootPost) {
    disabledReason = 'Không thể ghim bài trả lời';
  }

  return {
    isAuthor,
    isRootPost,
    canPin,
    isPinned,
    actionLabel,
    disabledReason,
  };
}

/**
 * Formats keyword mute expiration for UI display.
 */
export function formatMuteDuration(expiresAt: string | null, nowMs: number = Date.now()): string {
  if (!expiresAt) {
    return 'Vĩnh viễn';
  }
  const expMs = new Date(expiresAt).getTime();
  if (isNaN(expMs)) return 'Vĩnh viễn';

  const diffMs = expMs - nowMs;
  if (diffMs <= 0) return 'Đã hết hạn';

  const days = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  const hours = Math.floor((diffMs % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));

  if (days > 0) {
    return `Còn lại ${days} ngày`;
  }
  if (hours > 0) {
    return `Còn lại ${hours} giờ`;
  }
  const mins = Math.max(1, Math.floor(diffMs / (60 * 1000)));
  return `Còn lại ${mins} phút`;
}

/**
 * Human-readable label for Mute Context.
 */
export function formatMuteContext(context: MuteContext): string {
  switch (context) {
    case 'ALL':
      return 'Tất cả';
    case 'HOME_TIMELINE':
      return 'Bảng tin';
    case 'NOTIFICATIONS':
      return 'Thông báo';
    default:
      return context;
  }
}

/**
 * Human-readable label for Mute Match Type.
 */
export function formatMatchType(matchType: MuteMatchType): string {
  switch (matchType) {
    case 'CONTAINS':
      return 'Khớp một phần';
    case 'EXACT_WORD':
      return 'Khớp toàn bộ từ';
    default:
      return matchType;
  }
}

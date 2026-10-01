import type { UserDto, NotificationDto } from '../types/PulseTypes.ts';
import { isAccountLocked, getFollowButtonVisualInfo } from './privacy.ts';
import type { FollowButtonState, FollowButtonVisualInfo } from './privacy.ts';

export { isAccountLocked, getFollowButtonVisualInfo };
export type { FollowButtonState, FollowButtonVisualInfo };

export interface PrivateAccountShieldInfo {
  isLocked: boolean;
  title: string;
  description: string;
  iconName: 'Lock';
}

/**
 * Returns visual representation details for the Private Account Lock Shield.
 */
export function getPrivateAccountShieldInfo(
  targetUser: Partial<UserDto> | null | undefined,
  currentUserId: string | null | undefined
): PrivateAccountShieldInfo {
  const locked = isAccountLocked(targetUser, currentUserId);
  return {
    isLocked: locked,
    title: 'Tài khoản này ở chế độ riêng tư',
    description: 'Hãy theo dõi để xem bài viết của họ.',
    iconName: 'Lock',
  };
}

/**
 * Returns CSS classes for the Follow / Requested / Following button matching Threads Light Theme.
 */
export function getFollowButtonClasses(state: FollowButtonState): string {
  switch (state) {
    case 'FOLLOWING':
      return 'border border-cloud hover:border-ink text-ink hover:bg-mist';
    case 'REQUESTED':
      return 'border border-cloud hover:border-ink text-graphite hover:text-ink hover:bg-mist';
    case 'REQUEST_FOLLOW':
    case 'FOLLOW':
    default:
      return 'bg-ink hover:bg-ink/85 text-paper';
  }
}

/**
 * Formats notification text and details for Follow Request activities.
 */
export function getFollowRequestNotificationDetails(verb: NotificationDto['verb']): {
  text: string;
  badgeColor: string;
  isActionable: boolean;
} {
  switch (verb) {
    case 'FOLLOW_REQUEST':
      return {
        text: 'đã gửi yêu cầu theo dõi bạn',
        badgeColor: 'text-meta',
        isActionable: true,
      };
    case 'FOLLOW_ACCEPT':
      return {
        text: 'đã chấp nhận yêu cầu theo dõi của bạn',
        badgeColor: 'text-meta',
        isActionable: false,
      };
    default:
      return {
        text: 'đã tương tác với bạn',
        badgeColor: 'text-graphite',
        isActionable: false,
      };
  }
}

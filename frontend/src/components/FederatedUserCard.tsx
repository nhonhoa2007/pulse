import React, { useState, useEffect } from 'react';
import { UserDto, RemoteActorDiscoveryResult } from '../types/PulseTypes';
import { usePulse } from '../context/PulseContext';
import { api } from '../api/PulseApiClient';
import { formatCount } from '../utils/formatters';
import { formatFediverseHandle, sanitizeFederatedBio } from '../utils/federatedUtils';
import { Globe, Loader2, ExternalLink } from 'lucide-react';

export interface FederatedUserCardProps {
  user?: UserDto | null;
  actor?: RemoteActorDiscoveryResult | null;
  onFollowChange?: (nextFollowing: boolean) => void;
  onClick?: () => void;
  className?: string;
  hideBorder?: boolean;
}

/**
 * FederatedUserCard - Displays a remote Fediverse user with Threads Light Theme specs.
 * Supports avatar fallback, verified/fediverse badges, clean sanitized bio,
 * follower/following metrics, and optimistic real-time follow/unfollow interactions.
 */
export const FederatedUserCard: React.FC<FederatedUserCardProps> = ({
  user,
  actor,
  onFollowChange,
  onClick,
  className = '',
  hideBorder = false,
}) => {
  const { currentUser, navigateTo, addToast, refreshUsers } = usePulse();

  if (!user && !actor) {
    return null;
  }

  const shadowUserId = user?.id || actor?.shadowUserId || '';
  const isMe = !!(shadowUserId && currentUser?.id === shadowUserId);

  const displayName =
    user?.displayName || actor?.displayName || actor?.username || 'Fediverse User';
  const domain = user?.domain || actor?.domain || '';
  const rawUsername =
    actor?.username ||
    (user?.domain && user?.username.includes('_')
      ? user.username.split('_')[0]
      : user?.username) ||
    '';
  const fediverseHandle = formatFediverseHandle(rawUsername, domain);
  const rawAvatar = user?.avatarUrl || actor?.avatarUrl || null;
  const cleanBio = sanitizeFederatedBio(user?.bio || actor?.bio);
  const rawFollowersCount = user?.followersCount ?? 0;
  const followingCount = user?.followingCount ?? 0;
  const actorUri = user?.actorUri || actor?.actorUri || null;

  // Optimistic UI state
  const [isFollowing, setIsFollowing] = useState<boolean>(
    !!(user?.isFollowing ?? actor?.isFollowing)
  );
  const [followersCount, setFollowersCount] = useState<number>(rawFollowersCount);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [imgError, setImgError] = useState<boolean>(false);

  // Sync state if props change externally
  useEffect(() => {
    setIsFollowing(!!(user?.isFollowing ?? actor?.isFollowing));
  }, [user?.isFollowing, actor?.isFollowing]);

  useEffect(() => {
    setFollowersCount(user?.followersCount ?? 0);
  }, [user?.followersCount]);

  const handleToggleFollow = async (e: React.MouseEvent) => {
    e.stopPropagation();

    if (!shadowUserId) {
      addToast('Không thể xác định mã tài khoản liên hợp để theo dõi', 'error');
      return;
    }

    const prevFollowing = isFollowing;
    const nextFollowing = !prevFollowing;
    const prevCount = followersCount;
    const nextCount = nextFollowing ? prevCount + 1 : Math.max(0, prevCount - 1);

    // Optimistic UI update
    setIsFollowing(nextFollowing);
    setFollowersCount(nextCount);
    setIsLoading(true);

    try {
      if (prevFollowing) {
        await api.unfollowUser(shadowUserId);
        addToast(`Đã bỏ theo dõi ${fediverseHandle || displayName}`, 'info');
      } else {
        await api.followUser(shadowUserId);
        addToast(`Đã theo dõi ${fediverseHandle || displayName}`, 'success');
      }
      onFollowChange?.(nextFollowing);
      refreshUsers();
    } catch (err: any) {
      // Rollback optimistic state
      setIsFollowing(prevFollowing);
      setFollowersCount(prevCount);
      addToast(
        err?.message || 'Không thể thay đổi trạng thái theo dõi tài khoản liên hợp',
        'error'
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleCardClick = () => {
    if (onClick) {
      onClick();
      return;
    }
    if (user?.username) {
      navigateTo('profile', { username: user.username });
    }
  };

  return (
    <div
      onClick={handleCardClick}
      data-testid="federated-user-card"
      className={`p-4 bg-paper hover:bg-mist/40 transition-colors cursor-pointer ${
        hideBorder ? '' : 'border-b border-cloud'
      } ${className}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          {/* Circular Avatar (40px, rounded-full, with fallback) */}
          {rawAvatar && !imgError ? (
            <img
              src={rawAvatar}
              alt={displayName}
              onError={() => setImgError(true)}
              className="w-10 h-10 rounded-full object-cover shrink-0 border border-cloud"
              data-testid="federated-avatar-img"
            />
          ) : (
            <div
              className="w-10 h-10 rounded-full bg-mist border border-cloud flex items-center justify-center text-meta shrink-0"
              data-testid="federated-avatar-fallback"
              title={displayName}
            >
              <Globe className="w-5 h-5" />
            </div>
          )}

          <div className="min-w-0 flex-1">
            {/* Display name (15px/600) + Fediverse Badge */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[15px] font-semibold text-ink hover:underline truncate">
                {displayName}
              </span>

              {/* Fediverse decentralized network badge */}
              <span
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-mist text-graphite border border-cloud select-none"
                data-testid="fediverse-badge"
                title="Tài khoản liên hợp Fediverse"
              >
                <Globe className="w-3 h-3 text-meta" />
                <span>Fediverse</span>
              </span>
            </div>

            {/* Fediverse Handle dạng @user@domain (Graphite #737373, 13px) */}
            <div className="flex items-center gap-1 text-[13px] font-normal text-ash mt-0.5">
              <span className="truncate" data-testid="federated-handle">
                {fediverseHandle}
              </span>
            </div>

            {/* Bio của người dùng từ xa (an toàn XSS, sạch sẽ) */}
            {cleanBio && (
              <p
                className="text-[14px] text-ink mt-1.5 line-clamp-2 leading-[1.4] break-words"
                data-testid="federated-bio"
              >
                {cleanBio}
              </p>
            )}

            {/* Số lượng follower và following & domain tag */}
            <div className="flex items-center gap-3 text-[13px] text-ash mt-1.5 font-normal flex-wrap">
              <span>
                <strong className="font-semibold text-ink">
                  {formatCount(followersCount) || '0'}
                </strong>{' '}
                người theo dõi
              </span>
              {followingCount > 0 && (
                <span>
                  •{' '}
                  <strong className="font-semibold text-ink">
                    {formatCount(followingCount)}
                  </strong>{' '}
                  đang theo dõi
                </span>
              )}
              {domain && (
                <span>
                  • trên <span className="font-medium text-meta">{domain}</span>
                </span>
              )}
            </div>

            {/* Link hồ sơ ActivityPub gốc */}
            {actorUri && (
              <a
                href={actorUri}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1 text-[12px] text-meta hover:underline mt-1 truncate"
                title="Xem hồ sơ gốc trên Fediverse"
              >
                <ExternalLink className="w-3 h-3 shrink-0" />
                <span className="truncate">{actorUri}</span>
              </a>
            )}
          </div>
        </div>

        {/* Nút Theo dõi / Đang theo dõi (Pill button với Optimistic UI) */}
        {!isMe && shadowUserId && (
          <button
            type="button"
            onClick={handleToggleFollow}
            disabled={isLoading}
            data-testid="federated-follow-btn"
            className={`px-4 py-1.5 rounded-full text-[13px] font-semibold transition-all shrink-0 cursor-pointer ${
              isFollowing
                ? 'border border-cloud bg-paper text-ink hover:bg-mist hover:border-ash'
                : 'bg-ink hover:bg-ink/85 text-paper border border-transparent'
            } disabled:opacity-60 flex items-center justify-center min-w-[90px]`}
          >
            {isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin inline-block text-current" />
            ) : isFollowing ? (
              'Đang theo dõi'
            ) : (
              'Theo dõi'
            )}
          </button>
        )}
      </div>
    </div>
  );
};

export default FederatedUserCard;

import React, { useState, useEffect, useCallback } from 'react';
import { UserDto, PostDto } from '../types/PulseTypes';
import { usePulse } from '../context/PulseContext';
import { api } from '../api/PulseApiClient';
import { PostFeedItem } from '../components/PostFeedItem';
import { VerifiedBadge } from '../components/VerifiedBadge';
import { formatCount } from '../utils/formatters';
import {
  isAccountLocked,
  getFollowButtonVisualInfo,
  getFollowButtonClasses,
} from '../utils/privateAccounts';
import {
  ArrowLeft,
  Calendar,
  UserPlus,
  UserCheck,
  Ban,
  AlertCircle,
  Inbox,
  Bookmark,
  MessageSquare,
  VolumeX,
  Lock,
  Clock,
} from 'lucide-react';

export const UserProfileView: React.FC = () => {
  const {
    viewParams,
    currentUser,
    navigateTo,
    addToast,
    refreshUsers,
    setIsEditProfileOpen,
    openMuteModal,
    openFollowRequestsModal,
    pendingFollowRequestsCount,
  } = usePulse();
  const username = viewParams.username || currentUser.username;

  const [profile, setProfile] = useState<UserDto | null>(null);
  const [posts, setPosts] = useState<PostDto[]>([]);
  const [bookmarkedPosts, setBookmarkedPosts] = useState<PostDto[]>([]);
  const [activeTab, setActiveTab] = useState<'posts' | 'replies' | 'bookmarks'>('posts');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isBookmarksLoading, setIsBookmarksLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Social graph action states
  const [isFollowing, setIsFollowing] = useState<boolean>(false);
  const [hasPendingFollowRequest, setHasPendingFollowRequest] = useState<boolean>(false);
  const [isHoveringRequested, setIsHoveringRequested] = useState<boolean>(false);
  const [isBlocked, setIsBlocked] = useState<boolean>(false);
  const [followersCount, setFollowersCount] = useState<number>(0);
  const [isGraphActionLoading, setIsGraphActionLoading] = useState<boolean>(false);

  const isSelf = currentUser.username === username;

  // Handle tab from viewParams
  useEffect(() => {
    if (viewParams.tab === 'bookmarks' && isSelf) {
      setActiveTab('bookmarks');
    } else if (viewParams.tab === 'replies') {
      setActiveTab('replies');
    } else if (viewParams.tab === 'posts') {
      setActiveTab('posts');
    }
  }, [viewParams.tab, isSelf]);

  const loadProfileAndPosts = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      // 1. Fetch user profile
      const userData = await api.getUserProfile(username);
      setProfile(userData);
      setIsFollowing(!!userData.isFollowing);
      setHasPendingFollowRequest(!!userData.hasPendingFollowRequest);
      setIsBlocked(!!userData.isBlocked);
      setFollowersCount(userData.followersCount || 0);

      // Check account privacy lock invariant
      const locked = isAccountLocked(userData, currentUser.id);

      // 2. Fetch user's posts if unblocked and not locked
      if (!userData.isBlocked && !locked) {
        const userPosts = await api.getUserFeed(username);
        setPosts(userPosts);
      } else {
        setPosts([]);
      }
    } catch (err: any) {
      console.error('Failed to load profile:', err);
      setError(err.message || 'Không thể tải hồ sơ người dùng này.');
    } finally {
      setIsLoading(false);
    }
  }, [username, currentUser.id]);

  const loadBookmarks = useCallback(async () => {
    if (!isSelf) return;
    setIsBookmarksLoading(true);
    try {
      const bPosts = await api.getBookmarks();
      setBookmarkedPosts(bPosts);
    } catch (err: any) {
      addToast(err.message || 'Không thể tải danh sách bài viết đã lưu', 'error');
    } finally {
      setIsBookmarksLoading(false);
    }
  }, [isSelf, addToast]);

  useEffect(() => {
    loadProfileAndPosts();
  }, [loadProfileAndPosts]);

  useEffect(() => {
    if (activeTab === 'bookmarks' && isSelf) {
      loadBookmarks();
    }
  }, [activeTab, isSelf, loadBookmarks]);

  // Sync profile changes when currentUser edits their own profile
  useEffect(() => {
    if (isSelf && currentUser && profile) {
      if (
        profile.displayName !== currentUser.displayName ||
        profile.bio !== currentUser.bio ||
        profile.avatarUrl !== currentUser.avatarUrl ||
        profile.isPrivate !== currentUser.isPrivate
      ) {
        setProfile((prev) => (prev ? { ...prev, ...currentUser } : currentUser));
      }
    }
  }, [currentUser, isSelf, profile]);

  // Evaluate Follow Button visual state
  const buttonInfo = getFollowButtonVisualInfo(
    profile
      ? {
          ...profile,
          isFollowing,
          hasPendingFollowRequest,
        }
      : null,
    isHoveringRequested
  );

  // Evaluate privacy lock
  const isLocked = isAccountLocked(
    profile
      ? {
          ...profile,
          isFollowing,
          hasPendingFollowRequest,
        }
      : null,
    currentUser.id
  );

  // Handle Follow / Request / Unfollow / Cancel Request
  const handleToggleFollow = async () => {
    if (!profile || isSelf || isGraphActionLoading) return;

    setIsGraphActionLoading(true);

    // 1. If currently has pending follow request -> Cancel follow request
    if (hasPendingFollowRequest) {
      setHasPendingFollowRequest(false);
      try {
        await api.cancelFollowRequest(profile.id);
        addToast(`Đã hủy yêu cầu theo dõi @${profile.username}`, 'info');
        refreshUsers();
      } catch (err: any) {
        setHasPendingFollowRequest(true);
        addToast(err.message || 'Hủy yêu cầu theo dõi thất bại', 'error');
      } finally {
        setIsGraphActionLoading(false);
      }
      return;
    }

    // 2. If currently following -> Unfollow
    if (isFollowing) {
      const nextFollowers = Math.max(0, followersCount - 1);
      setIsFollowing(false);
      setFollowersCount(nextFollowers);

      try {
        await api.unfollowUser(profile.id);
        addToast(`Đã hủy theo dõi @${profile.username}`, 'info');
        refreshUsers();
        if (profile.isPrivate) {
          setPosts([]);
        }
      } catch (err: any) {
        setIsFollowing(true);
        setFollowersCount(followersCount);
        addToast(err.message || 'Thao tác hủy theo dõi thất bại', 'error');
      } finally {
        setIsGraphActionLoading(false);
      }
      return;
    }

    // 3. Not following & not requested -> Follow (or Send Follow Request if private)
    try {
      const res = await api.followUser(profile.id);
      if (
        res.status === 'REQUESTED' ||
        res.hasPendingFollowRequest ||
        (!res.isFollowing && profile.isPrivate)
      ) {
        setHasPendingFollowRequest(true);
        setIsFollowing(false);
        addToast(`Đã gửi yêu cầu theo dõi @${profile.username}`, 'info');
      } else {
        setIsFollowing(true);
        setFollowersCount(followersCount + 1);
        addToast(`Đã theo dõi @${profile.username}`, 'success');
        if (profile.isPrivate) {
          loadProfileAndPosts();
        }
      }
      refreshUsers();
    } catch (err: any) {
      addToast(err.message || 'Thao tác theo dõi thất bại', 'error');
    } finally {
      setIsGraphActionLoading(false);
    }
  };

  // Handle Block / Unblock
  const handleToggleBlock = async () => {
    if (!profile || isSelf || isGraphActionLoading) return;

    setIsGraphActionLoading(true);
    const nextIsBlocked = !isBlocked;

    try {
      if (nextIsBlocked) {
        await api.blockUser(profile.id);
        setIsBlocked(true);
        setIsFollowing(false);
        setHasPendingFollowRequest(false);
        setPosts([]);
        setBookmarkedPosts([]);
        addToast(`Đã chặn @${profile.username}. Quan hệ follow 2 chiều đã bị hủy.`, 'info');
      } else {
        await api.unblockUser(profile.id);
        setIsBlocked(false);
        addToast(`Đã bỏ chặn @${profile.username}`, 'info');
        loadProfileAndPosts();
      }
      refreshUsers();
    } catch (err: any) {
      addToast(err.message || 'Thao tác chặn thất bại', 'error');
    } finally {
      setIsGraphActionLoading(false);
    }
  };

  // Handle Mute User
  const handleToggleMute = async () => {
    if (!profile || isSelf || isGraphActionLoading) return;
    setIsGraphActionLoading(true);
    try {
      await api.muteUser(profile.id);
      addToast(`Đã tắt tiếng @${profile.username}`, 'success');
      setPosts((prev) => prev.filter((p) => p.authorId !== profile.id));
    } catch (err: any) {
      addToast(err.message || 'Thao tác tắt tiếng thất bại', 'error');
    } finally {
      setIsGraphActionLoading(false);
    }
  };

  const displayedPosts = activeTab === 'replies'
    ? posts.filter((p) => p.replyToId !== null)
    : posts.filter((p) => p.replyToId === null).sort((a, b) => {
        if (a.isPinned && !b.isPinned) return -1;
        if (!a.isPinned && b.isPinned) return 1;
        return 0;
      });

  return (
    <div className="min-w-0 flex-1 min-h-screen pb-20 md:pb-8 bg-[#fafafa]">
      {/* Top Header (~53px tall, background Paper White #fafafa, centered section title in 15px/600 #000000) */}
      <header className="sticky top-0 z-20 bg-[#fafafa]/95 backdrop-blur-md border-b border-[#d5d5d5] flex items-center justify-between h-[53px] px-4">
        <button
          onClick={() => navigateTo('home')}
          className="p-1.5 -ml-1.5 rounded-full text-[#969696] hover:text-[#000000] hover:bg-[#efefef] transition-colors focus:outline-none"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-1.5">
          <h1 className="text-[15px] font-semibold text-[#000000]">
            {profile ? profile.displayName : username}
          </h1>
          {profile?.isPrivate && (
            <span title="Tài khoản riêng tư">
              <Lock className="w-3.5 h-3.5 text-[#424242]" />
            </span>
          )}
        </div>
        <div className="w-8" />
      </header>

      {isLoading ? (
        <div className="animate-pulse bg-[#fafafa]">
          <div className="h-28 bg-[#efefef]" />
          <div className="p-4 space-y-3">
            <div className="w-20 h-20 -mt-12 rounded-full bg-[#d5d5d5] border-4 border-[#fafafa]" />
            <div className="h-5 bg-[#efefef] rounded w-1/4" />
            <div className="h-3 bg-[#efefef] rounded w-1/2" />
          </div>
        </div>
      ) : error || !profile ? (
        <div className="py-16 px-4 text-center">
          <AlertCircle className="w-8 h-8 text-[#424242] mx-auto mb-2" />
          <h2 className="text-[15px] font-semibold text-[#000000] mb-1">
            Không tìm thấy người dùng
          </h2>
          <p className="text-[#424242] text-[13px] max-w-sm mx-auto mb-4">
            {error || `Người dùng @${username} không tồn tại hoặc đã kích hoạt chặn.`}
          </p>
          <button
            onClick={() => navigateTo('home')}
            className="px-4 py-2 bg-[#000000] text-[#fafafa] rounded-full text-[13px] font-semibold hover:bg-[#000000]/85 transition-colors"
          >
            Trở về trang chủ
          </button>
        </div>
      ) : (
        <div>
          {/* Subtle Mist Header Strip */}
          <div className="h-24 bg-[#efefef] border-b border-[#d5d5d5]" />

          {/* Profile Details Card */}
          <div className="px-4 pt-2 pb-4 border-b border-[#d5d5d5]">
            {/* Avatar & Action Button Row */}
            <div className="flex items-end justify-between -mt-12 mb-3">
              <div className="relative">
                <img
                  src={
                    profile.avatarUrl ||
                    `https://api.dicebear.com/7.x/bottts/svg?seed=${profile.username}`
                  }
                  alt={profile.displayName}
                  className="w-20 h-20 rounded-full object-cover border-4 border-[#fafafa] bg-[#efefef]"
                />
              </div>

              {/* Action Buttons: Follow / Block / Edit Profile / Mute */}
              <div className="flex items-center gap-2">
                {isSelf ? (
                  <>
                    <button
                      onClick={() => setIsEditProfileOpen(true)}
                      className="px-4 py-1.5 rounded-full border border-[#d5d5d5] hover:border-[#000000] text-[13px] font-semibold text-[#000000] hover:bg-[#efefef] transition-colors focus:outline-none"
                    >
                      Chỉnh sửa trang cá nhân
                    </button>
                    {currentUser.isPrivate && (
                      <button
                        onClick={openFollowRequestsModal}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-[#d5d5d5] hover:border-[#000000] text-[13px] font-semibold text-[#000000] hover:bg-[#efefef] transition-colors focus:outline-none relative"
                        title="Yêu cầu theo dõi đang chờ duyệt"
                        data-testid="profile-view-follow-requests-btn"
                      >
                        <Lock className="w-3.5 h-3.5 text-[#424242]" />
                        <span>Yêu cầu</span>
                        {pendingFollowRequestsCount > 0 && (
                          <span className="ml-0.5 px-1.5 py-0.2 bg-[#000000] text-[#fafafa] text-[10px] rounded-full font-bold">
                            {pendingFollowRequestsCount}
                          </span>
                        )}
                      </button>
                    )}
                    <button
                      onClick={() => openMuteModal('users')}
                      className="p-2 rounded-full border border-[#d5d5d5] hover:border-[#000000] text-[#424242] hover:text-[#000000] hover:bg-[#efefef] transition-colors focus:outline-none"
                      title="Quản lý tắt tiếng"
                      aria-label="Quản lý tắt tiếng"
                      data-testid="profile-manage-mute-btn"
                    >
                      <VolumeX className="w-4 h-4" />
                    </button>
                  </>
                ) : (
                  <>
                    {/* Mute Button */}
                    {!isBlocked && (
                      <button
                        onClick={handleToggleMute}
                        disabled={isGraphActionLoading}
                        className="p-2 rounded-full border border-[#d5d5d5] hover:border-[#000000] text-[#424242] hover:text-[#000000] hover:bg-[#efefef] transition-colors focus:outline-none"
                        title={`Tắt tiếng @${profile.username}`}
                        data-testid="profile-mute-user-btn"
                      >
                        <VolumeX className="w-4 h-4" />
                      </button>
                    )}

                    {/* Block/Unblock Button */}
                    <button
                      onClick={handleToggleBlock}
                      disabled={isGraphActionLoading}
                      className={`p-2 rounded-full border transition-colors focus:outline-none ${
                        isBlocked
                          ? 'border-[#000000] bg-[#000000] text-[#fafafa]'
                          : 'border-[#d5d5d5] hover:border-[#000000] text-[#424242] hover:text-[#000000]'
                      }`}
                      title={isBlocked ? 'Bỏ chặn người này' : 'Chặn người dùng (2-way unfollow)'}
                    >
                      <Ban className="w-4 h-4" />
                    </button>

                    {/* Follow/Unfollow/Requested Button */}
                    {!isBlocked && (
                      <button
                        onClick={handleToggleFollow}
                        disabled={isGraphActionLoading}
                        onMouseEnter={() => setIsHoveringRequested(true)}
                        onMouseLeave={() => setIsHoveringRequested(false)}
                        data-testid={
                          buttonInfo.state === 'REQUESTED'
                            ? 'follow-requested-btn'
                            : buttonInfo.state === 'FOLLOWING'
                            ? 'following-btn'
                            : 'follow-btn'
                        }
                        className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full text-[13px] font-semibold transition-all focus:outline-none ${getFollowButtonClasses(
                          buttonInfo.state
                        )}`}
                        title={buttonInfo.ariaLabel}
                      >
                        {buttonInfo.state === 'FOLLOWING' ? (
                          <>
                            <UserCheck className="w-3.5 h-3.5" />
                            <span>{buttonInfo.label}</span>
                          </>
                        ) : buttonInfo.state === 'REQUESTED' ? (
                          <>
                            <Clock className="w-3.5 h-3.5" />
                            <span>{buttonInfo.label}</span>
                          </>
                        ) : (
                          <>
                            <UserPlus className="w-3.5 h-3.5" />
                            <span>Theo dõi</span>
                          </>
                        )}
                      </button>
                    )}

                    {/* Direct Message Button */}
                    {!isBlocked && (
                      <button
                        onClick={() => navigateTo('messages', { recipientId: profile.id })}
                        className="flex items-center gap-1.5 px-4 py-1.5 rounded-full border border-[#d5d5d5] hover:border-[#000000] text-[13px] font-semibold text-[#000000] hover:bg-[#efefef] transition-colors focus:outline-none"
                        title={`Nhắn tin với @${profile.username}`}
                      >
                        <MessageSquare className="w-3.5 h-3.5 stroke-[2]" />
                        <span>Nhắn tin</span>
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* Display Name & Verified Badge */}
            <div className="mb-1">
              <div className="flex items-center gap-1.5 flex-wrap">
                <h2 className="text-[20px] font-semibold text-[#000000]">
                  {profile.displayName}
                </h2>
                {profile.isCelebrity && (
                  <VerifiedBadge size={14} title="Celebrity VIP" />
                )}
                {profile.isPrivate && (
                  <span
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-[#424242] bg-[#efefef] px-2 py-0.5 rounded-full border border-[#d5d5d5]"
                    data-testid="profile-private-pill"
                    title="Tài khoản riêng tư"
                  >
                    <Lock className="w-3 h-3 text-[#424242]" />
                    <span>Riêng tư</span>
                  </span>
                )}
              </div>
              <span className="text-[13px] text-[#424242]">@{profile.username}</span>
            </div>

            {/* Bio */}
            {profile.bio && (
              <p className="text-[15px] leading-[1.4] text-[#000000] mb-3">
                {profile.bio}
              </p>
            )}

            {/* Meta tags */}
            <div className="flex items-center gap-4 text-[13px] text-[#424242] mb-3 flex-wrap">
              <span className="flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5 text-[#969696]" />
                Tham gia{' '}
                {new Date(profile.createdAt).toLocaleDateString('vi-VN', {
                  month: 'long',
                  year: 'numeric',
                })}
              </span>
              {profile.isCelebrity && (
                <span className="text-[#385898]">
                  Tài khoản người nổi tiếng (Fan-out on Read)
                </span>
              )}
            </div>

            {/* Stats Row */}
            <div className="flex items-center gap-5 text-[13px]">
              <div>
                <strong className="text-[#000000] font-semibold">
                  {formatCount(profile.followingCount)}
                </strong>{' '}
                <span className="text-[#424242]">Đang theo dõi</span>
              </div>
              <div>
                <strong className="text-[#000000] font-semibold">
                  {formatCount(followersCount)}
                </strong>{' '}
                <span className="text-[#424242]">Người theo dõi</span>
              </div>
              <div>
                <strong className="text-[#000000] font-semibold">
                  {formatCount(profile.postsCount)}
                </strong>{' '}
                <span className="text-[#424242]">Bài viết</span>
              </div>
            </div>

            {/* Blocked Notice */}
            {isBlocked && (
              <div className="mt-3 p-3 rounded-[8px] bg-[#efefef] border border-[#d5d5d5] text-[13px] text-[#424242]">
                Bạn đã chặn người dùng này. Bài viết của họ bị ẩn khỏi bảng tin.
              </div>
            )}
          </div>

          {/* Body content: Lock Shield OR Feed with sub-tabs */}
          {isBlocked ? null : isLocked ? (
            /* TASK-21: Private Account Lock Shield */
            <div
              className="py-16 px-6 text-center max-w-md mx-auto"
              data-testid="private-account-lock-shield"
            >
              <div className="w-16 h-16 rounded-full bg-[#efefef] border border-[#d5d5d5] flex items-center justify-center mx-auto mb-4">
                <Lock className="w-8 h-8 text-[#000000]" />
              </div>
              <h3 className="text-[17px] font-bold text-[#000000] mb-1.5">
                Tài khoản này ở chế độ riêng tư
              </h3>
              <p className="text-[13px] text-[#424242] mb-6 leading-relaxed">
                Hãy theo dõi để xem bài viết của họ.
              </p>
              <button
                onClick={handleToggleFollow}
                disabled={isGraphActionLoading}
                onMouseEnter={() => setIsHoveringRequested(true)}
                onMouseLeave={() => setIsHoveringRequested(false)}
                data-testid={hasPendingFollowRequest ? 'shield-requested-btn' : 'shield-follow-btn'}
                className={`inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-full text-[13px] font-semibold transition-all ${getFollowButtonClasses(
                  buttonInfo.state
                )}`}
              >
                {buttonInfo.state === 'REQUESTED' ? (
                  <>
                    <Clock className="w-4 h-4" />
                    <span>{buttonInfo.label}</span>
                  </>
                ) : (
                  <>
                    <UserPlus className="w-4 h-4" />
                    <span>Theo dõi</span>
                  </>
                )}
              </button>
            </div>
          ) : (
            <>
              {/* Sub-tab navigation */}
              <div
                className={`grid ${
                  isSelf ? 'grid-cols-3' : 'grid-cols-2'
                } text-center text-[15px] border-b border-[#d5d5d5]`}
              >
                <button
                  onClick={() => setActiveTab('posts')}
                  className={`py-3 relative font-semibold transition-colors focus:outline-none ${
                    activeTab === 'posts'
                      ? 'text-[#000000]'
                      : 'text-[#969696] hover:text-[#000000]'
                  }`}
                >
                  <span>Bài viết</span>
                  {activeTab === 'posts' && (
                    <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-16 h-0.5 bg-[#000000]" />
                  )}
                </button>
                <button
                  onClick={() => setActiveTab('replies')}
                  className={`py-3 relative font-semibold transition-colors focus:outline-none ${
                    activeTab === 'replies'
                      ? 'text-[#000000]'
                      : 'text-[#969696] hover:text-[#000000]'
                  }`}
                >
                  <span>Câu trả lời</span>
                  {activeTab === 'replies' && (
                    <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-16 h-0.5 bg-[#000000]" />
                  )}
                </button>
                {isSelf && (
                  <button
                    onClick={() => setActiveTab('bookmarks')}
                    className={`py-3 relative font-semibold transition-colors focus:outline-none ${
                      activeTab === 'bookmarks'
                        ? 'text-[#000000]'
                        : 'text-[#969696] hover:text-[#000000]'
                    }`}
                  >
                    <span>Đã lưu</span>
                    {activeTab === 'bookmarks' && (
                      <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-16 h-0.5 bg-[#000000]" />
                    )}
                  </button>
                )}
              </div>

              {/* Posts / Bookmarks Feed */}
              {activeTab === 'bookmarks' ? (
                isBookmarksLoading ? (
                  <div className="py-16 text-center text-[#969696]">
                    <div className="w-6 h-6 border-2 border-[#000000] border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                    <p className="text-[13px]">Đang tải bài viết đã lưu...</p>
                  </div>
                ) : bookmarkedPosts.length === 0 ? (
                  <div className="py-16 text-center text-[#969696]">
                    <Bookmark className="w-8 h-8 mx-auto mb-2 text-[#969696]" />
                    <p className="text-[15px] font-semibold text-[#000000] mb-1">
                      Chưa có bài viết đã lưu
                    </p>
                    <p className="text-[13px] text-[#424242] max-w-xs mx-auto">
                      Nhấn vào biểu tượng bookmark trên bài viết bất kỳ để lưu lại xem sau.
                    </p>
                  </div>
                ) : (
                  <div className="divide-y divide-[#d5d5d5]">
                    {bookmarkedPosts.map((post) => (
                      <PostFeedItem
                        key={post.id}
                        post={post}
                        onPostUpdated={(updated) => {
                          if (!updated.isBookmarked) {
                            setBookmarkedPosts((prev) =>
                              prev.filter((p) => p.id !== updated.id)
                            );
                          } else {
                            setBookmarkedPosts((prev) =>
                              prev.map((p) => (p.id === updated.id ? updated : p))
                            );
                          }
                        }}
                      />
                    ))}
                  </div>
                )
              ) : displayedPosts.length === 0 ? (
                <div className="py-16 text-center text-[#969696]">
                  <Inbox className="w-8 h-8 mx-auto mb-2 text-[#969696]" />
                  <p className="text-[13px]">
                    {activeTab === 'replies'
                      ? 'Chưa có câu trả lời nào.'
                      : 'Chưa có bài viết nào từ người dùng này.'}
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-[#d5d5d5]">
                  {displayedPosts.map((post) => (
                    <PostFeedItem
                      key={post.id}
                      post={post}
                      onPostUpdated={(updated) => {
                        setPosts((prev) => {
                          if (updated.isPinned) {
                            return prev.map((p) =>
                              p.id === updated.id
                                ? updated
                                : p.isPinned
                                ? { ...p, isPinned: false }
                                : p
                            );
                          }
                          return prev.map((p) => (p.id === updated.id ? updated : p));
                        });
                      }}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};

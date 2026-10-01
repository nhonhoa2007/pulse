import React, { useState, useEffect, useCallback, useRef } from 'react';
import { PostDto, UserDto, TrendingItemDto, RemoteActorDiscoveryResult } from '../types/PulseTypes';
import { usePulse } from '../context/PulseContext';
import { api } from '../api/PulseApiClient';
import { PostFeedItem } from '../components/PostFeedItem';
import { VerifiedBadge } from '../components/VerifiedBadge';
import { FederatedUserCard } from '../components/FederatedUserCard';
import { formatCount } from '../utils/formatters';
import { parseFediverseIdentifier } from '../utils/federatedUtils';
import { Search, X, Loader2, TrendingUp, Users, ArrowRight, Globe } from 'lucide-react';

const FALLBACK_TRENDING: TrendingItemDto[] = [
  { tag: 'tech', postsCount: 128 },
  { tag: 'pulse', postsCount: 95 },
  { tag: 'Sky', postsCount: 5400 },
  { tag: 'concurrency', postsCount: 42 },
  { tag: 'architecture', postsCount: 67 },
];

export const ExploreView: React.FC = () => {
  const { viewParams, currentUser, navigateTo, addToast, refreshUsers } = usePulse();

  // Search state
  const initialTag = viewParams.hashtag ? `#${viewParams.hashtag}` : '';
  const [searchQuery, setSearchQuery] = useState<string>(initialTag);
  const [debouncedQuery, setDebouncedQuery] = useState<string>(initialTag);
  const [activeTab, setActiveTab] = useState<'all' | 'posts' | 'users'>('all');

  // Fediverse Remote Discovery state
  const [isResolvingRemote, setIsResolvingRemote] = useState<boolean>(false);
  const [federatedUser, setFederatedUser] = useState<UserDto | null>(null);
  const [federatedActor, setFederatedActor] = useState<RemoteActorDiscoveryResult | null>(null);
  const [federatedError, setFederatedError] = useState<string | null>(null);
  const [resolvedHandle, setResolvedHandle] = useState<string | null>(null);

  // Data states
  const [trendingList, setTrendingList] = useState<TrendingItemDto[]>(FALLBACK_TRENDING);
  const [isTrendingLoading, setIsTrendingLoading] = useState<boolean>(false);

  const [postResults, setPostResults] = useState<PostDto[]>([]);
  const [userResults, setUserResults] = useState<UserDto[]>([]);
  const [isSearching, setIsSearching] = useState<boolean>(false);

  const [explorePosts, setExplorePosts] = useState<PostDto[]>([]);
  const [isExploreLoading, setIsExploreLoading] = useState<boolean>(false);
  const [followLoadingMap, setFollowLoadingMap] = useState<Record<string, boolean>>({});

  const searchInputRef = useRef<HTMLInputElement>(null);

  // Parse fediverse handles in search queries
  const fediverseTarget = parseFediverseIdentifier(searchQuery);
  const debouncedFediverseTarget = parseFediverseIdentifier(debouncedQuery);

  // Sync with navigation params if user clicked a hashtag elsewhere
  useEffect(() => {
    if (viewParams.hashtag) {
      const tagWithHash = `#${viewParams.hashtag}`;
      setSearchQuery(tagWithHash);
      setDebouncedQuery(tagWithHash);
    }
  }, [viewParams.hashtag]);

  // Debounce search input (300ms)
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Load Trending Hashtags
  const fetchTrending = useCallback(async () => {
    setIsTrendingLoading(true);
    try {
      const data = await api.getTrending();
      if (Array.isArray(data) && data.length > 0) {
        setTrendingList(data);
      }
    } catch {
      // Keep fallback tags
    } finally {
      setIsTrendingLoading(false);
    }
  }, []);

  // Load Explore Feed (when search query is empty)
  const fetchExploreFeed = useCallback(async () => {
    setIsExploreLoading(true);
    try {
      const data = await api.getExploreFeed();
      setExplorePosts(data);
    } catch {
      // Fallback
    } finally {
      setIsExploreLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTrending();
    fetchExploreFeed();
  }, [fetchTrending, fetchExploreFeed]);

  // Resolve remote Fediverse actor
  const handleResolveRemote = useCallback(
    async (targetHandle: string) => {
      const trimmed = targetHandle.trim();
      if (!trimmed) return;

      setIsResolvingRemote(true);
      setFederatedError(null);
      setResolvedHandle(trimmed);

      try {
        const res = await api.resolveFederatedActor(trimmed);
        let foundUser: UserDto | null = null;
        let foundActor: RemoteActorDiscoveryResult | null = null;

        if (res?.user) {
          foundUser = res.user;
        } else if (res?.shadowUserId) {
          foundActor = res as RemoteActorDiscoveryResult;
          foundUser = {
            id: res.shadowUserId,
            username: res.username,
            displayName: res.displayName,
            avatarUrl: res.avatarUrl || null,
            bio: res.bio || null,
            isCelebrity: false,
            followersCount: 0,
            followingCount: 0,
            postsCount: 0,
            isRemote: true,
            domain: res.domain,
            actorUri: res.actorUri,
            isFollowing: !!res.isFollowing,
            createdAt: new Date().toISOString(),
          };
        } else if (res?.id) {
          foundUser = res as UserDto;
        }

        if (res?.actor) {
          foundActor = res.actor;
        }

        if (foundUser) {
          setFederatedUser(foundUser);
          setFederatedActor(foundActor);

          // Merge into userResults so it is visible in the users list
          setUserResults((prev) => {
            const exists = prev.some((u) => u.id === foundUser!.id);
            if (exists) {
              return prev.map((u) => (u.id === foundUser!.id ? foundUser! : u));
            }
            return [foundUser!, ...prev];
          });
        } else {
          const domainMatch = trimmed.match(/@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
          const domainName = domainMatch ? domainMatch[1] : 'máy chủ từ xa';
          setFederatedError(
            `Không tìm thấy tài khoản liên hợp tương ứng với "${trimmed}" trên ${domainName}. Vui lòng kiểm tra lại định danh.`
          );
        }
      } catch (err: any) {
        const domainMatch = trimmed.match(/@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
        const domainName = domainMatch ? domainMatch[1] : 'máy chủ từ xa';
        setFederatedError(
          `Không thể tìm thấy hoặc kết nối tới tài khoản từ xa trên ${domainName}. Vui lòng kiểm tra lại định danh @user@domain.`
        );
      } finally {
        setIsResolvingRemote(false);
      }
    },
    []
  );

  // Automatic debounce trigger for Fediverse handles
  useEffect(() => {
    if (debouncedFediverseTarget) {
      if (debouncedFediverseTarget.normalizedHandle !== resolvedHandle) {
        handleResolveRemote(debouncedFediverseTarget.normalizedHandle);
      }
    } else {
      // Clear remote resolution states when query is not a Fediverse pattern
      setFederatedUser(null);
      setFederatedActor(null);
      setFederatedError(null);
      setResolvedHandle(null);
    }
  }, [debouncedFediverseTarget, resolvedHandle, handleResolveRemote]);

  // Execute Search
  useEffect(() => {
    const trimmed = debouncedQuery.trim();
    if (!trimmed) {
      setPostResults([]);
      setUserResults([]);
      setIsSearching(false);
      return;
    }

    let isCancelled = false;
    setIsSearching(true);

    api
      .search(trimmed, activeTab)
      .then((res) => {
        if (!isCancelled) {
          setPostResults(res.posts || []);
          setUserResults(res.users || []);
          if (res.federatedResult) {
            setFederatedActor(res.federatedResult);
          }
        }
      })
      .catch(() => {
        if (!isCancelled) {
          setPostResults([]);
          setUserResults([]);
        }
      })
      .finally(() => {
        if (!isCancelled) {
          setIsSearching(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [debouncedQuery, activeTab]);

  // Toggle Follow / Unfollow User with optimistic update (Local users)
  const handleToggleFollow = async (targetUser: UserDto, e: React.MouseEvent) => {
    e.stopPropagation();
    const isCurrentlyFollowing = targetUser.isFollowing;
    const nextFollowing = !isCurrentlyFollowing;
    const nextFollowersCount = nextFollowing
      ? targetUser.followersCount + 1
      : Math.max(0, targetUser.followersCount - 1);

    setFollowLoadingMap((prev) => ({ ...prev, [targetUser.id]: true }));

    // Optimistic UI update in search user results
    setUserResults((prev) =>
      prev.map((u) =>
        u.id === targetUser.id
          ? { ...u, isFollowing: nextFollowing, followersCount: nextFollowersCount }
          : u
      )
    );

    try {
      if (isCurrentlyFollowing) {
        await api.unfollowUser(targetUser.id);
        addToast(`Đã bỏ theo dõi @${targetUser.username}`, 'info');
      } else {
        await api.followUser(targetUser.id);
        addToast(`Đã theo dõi @${targetUser.username}`, 'success');
      }
      refreshUsers();
    } catch (err: any) {
      // Rollback on failure
      setUserResults((prev) =>
        prev.map((u) =>
          u.id === targetUser.id
            ? { ...u, isFollowing: isCurrentlyFollowing, followersCount: targetUser.followersCount }
            : u
        )
      );
      addToast(err.message || 'Không thể thay đổi trạng thái theo dõi', 'error');
    } finally {
      setFollowLoadingMap((prev) => ({ ...prev, [targetUser.id]: false }));
    }
  };

  const handleFederatedFollowChange = (nextFollowing: boolean) => {
    if (federatedUser) {
      const nextFollowersCount = nextFollowing
        ? federatedUser.followersCount + 1
        : Math.max(0, federatedUser.followersCount - 1);
      const updated = {
        ...federatedUser,
        isFollowing: nextFollowing,
        followersCount: nextFollowersCount,
      };
      setFederatedUser(updated);
      setUserResults((prev) =>
        prev.map((u) => (u.id === federatedUser.id ? updated : u))
      );
    }
  };

  const handlePostUpdated = (updated: PostDto) => {
    setPostResults((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
    setExplorePosts((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
  };

  const hasSearchText = debouncedQuery.trim().length > 0;

  // Filter out the explicitly displayed federatedUser from general userResults to avoid duplicates
  const nonFederatedUserResults = federatedUser
    ? userResults.filter((u) => u.id !== federatedUser.id)
    : userResults;

  // Render a User card (Threads Light Theme specs)
  const renderUserCard = (user: UserDto) => {
    if (user.isRemote) {
      return (
        <FederatedUserCard
          key={user.id}
          user={user}
          onFollowChange={(nextFollowing) => {
            setUserResults((prev) =>
              prev.map((u) =>
                u.id === user.id
                  ? {
                      ...u,
                      isFollowing: nextFollowing,
                      followersCount: nextFollowing
                        ? u.followersCount + 1
                        : Math.max(0, u.followersCount - 1),
                    }
                  : u
              )
            );
            if (federatedUser && federatedUser.id === user.id) {
              setFederatedUser({
                ...federatedUser,
                isFollowing: nextFollowing,
                followersCount: nextFollowing
                  ? federatedUser.followersCount + 1
                  : Math.max(0, federatedUser.followersCount - 1),
              });
            }
          }}
        />
      );
    }

    const isFollowing = !!user.isFollowing;
    const isMe = user.id === currentUser.id;
    const isLoading = !!followLoadingMap[user.id];

    return (
      <div
        key={user.id}
        onClick={() => navigateTo('profile', { username: user.username })}
        className="p-4 border-b border-cloud bg-paper hover:bg-mist/40 transition-colors cursor-pointer"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0 flex-1">
            {/* Circular Avatar (40px, 1000px radius) */}
            <img
              src={
                user.avatarUrl ||
                `https://api.dicebear.com/7.x/bottts/svg?seed=${user.username}`
              }
              alt={user.displayName}
              className="w-10 h-10 rounded-full object-cover shrink-0"
            />

            <div className="min-w-0 flex-1">
              {/* Display name (15px/600) + Badge */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[15px] font-semibold text-ink hover:underline truncate">
                  {user.displayName}
                </span>
                {user.isCelebrity && (
                  <VerifiedBadge size={12} title="Celebrity VIP" />
                )}
              </div>

              {/* @username (13px/400 Graphite) */}
              <span className="text-[13px] font-normal text-graphite block truncate">
                @{user.username}
              </span>

              {/* Bio */}
              {user.bio && (
                <p className="text-[14px] text-ink mt-1.5 line-clamp-2 leading-[1.4] break-words">
                  {user.bio}
                </p>
              )}

              {/* followersCount */}
              <div className="text-[13px] text-graphite mt-1.5 font-normal">
                {formatCount(user.followersCount) || '0'} người theo dõi
              </div>
            </div>
          </div>

          {/* Follow/Unfollow pill button */}
          {!isMe && (
            <button
              type="button"
              onClick={(e) => handleToggleFollow(user, e)}
              disabled={isLoading}
              className={`px-4 py-1.5 rounded-full text-[13px] font-semibold transition-all shrink-0 cursor-pointer ${
                isFollowing
                  ? 'border border-cloud bg-paper text-ink hover:bg-mist hover:border-ash'
                  : 'bg-ink hover:bg-ink/85 text-paper border border-transparent'
              } disabled:opacity-60`}
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

  return (
    <div className="min-w-0 flex-1 min-h-screen pb-20 md:pb-8 bg-paper">
      {/* Live Search Header (~53px, Paper White, sticky top-0) */}
      <header className="sticky top-0 z-20 bg-paper/95 backdrop-blur-md border-b border-cloud px-4 py-2.5">
        <div className="relative flex items-center w-full">
          {/* Search icon in Ash Gray #969696 */}
          <Search className="w-4 h-4 text-ash absolute left-3.5 pointer-events-none" />
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Tìm kiếm hoặc nhập @user@domain để khám phá Fediverse..."
            className="w-full bg-mist border border-cloud rounded-full pl-10 pr-9 py-2 text-[15px] text-ink placeholder-ash focus:outline-none focus:bg-paper focus:border-ink transition-colors"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setDebouncedQuery('');
                setFederatedUser(null);
                setFederatedActor(null);
                setFederatedError(null);
                setResolvedHandle(null);
                searchInputRef.current?.focus();
              }}
              className="absolute right-3 p-1 text-ash hover:text-ink rounded-full hover:bg-cloud/50 transition-colors"
              title="Xóa tìm kiếm"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </header>

      {/* Fediverse Remote Discovery Suggestion Banner (shown when input matches @user@domain pattern) */}
      {fediverseTarget && (
        <div
          className="p-3.5 mx-4 my-3 rounded-xl border border-cloud bg-paper shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3"
          data-testid="fediverse-discovery-banner"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-full bg-mist border border-cloud flex items-center justify-center text-meta shrink-0">
              <Globe className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[12px] font-semibold uppercase tracking-wider text-graphite">
                  Fediverse Remote Discovery
                </span>
                <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-meta/10 text-meta border border-meta/20">
                  Mạng liên hợp
                </span>
              </div>
              <p className="text-[14px] text-ink mt-0.5 truncate">
                Khám phá tài khoản từ xa trên Fediverse:{' '}
                <strong
                  className="font-semibold text-meta"
                  data-testid="fediverse-suggest-handle"
                >
                  {fediverseTarget.normalizedHandle}
                </strong>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => handleResolveRemote(fediverseTarget.normalizedHandle)}
            disabled={isResolvingRemote}
            className="px-4 py-1.5 rounded-full text-[13px] font-semibold bg-ink hover:bg-ink/85 text-paper border border-transparent disabled:opacity-60 transition-all shrink-0 flex items-center gap-1.5 cursor-pointer"
            data-testid="fediverse-discover-btn"
          >
            {isResolvingRemote ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Đang tìm...</span>
              </>
            ) : (
              <>
                <Globe className="w-3.5 h-3.5" />
                <span>Khám phá từ xa</span>
              </>
            )}
          </button>
        </div>
      )}

      {/* Trending Section (only when search query is empty) */}
      {!hasSearchText && (
        <div className="p-4 border-b border-cloud bg-paper">
          <div className="flex items-center justify-between mb-2.5">
            <div className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wider text-graphite">
              <TrendingUp className="w-3.5 h-3.5 text-meta" />
              <span>Chủ đề thịnh hành</span>
            </div>
            {isTrendingLoading && (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-ash" />
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            {trendingList.map((item) => {
              const isSelected =
                searchQuery.trim().toLowerCase() === `#${item.tag.toLowerCase()}`;
              return (
                <button
                  key={item.tag}
                  type="button"
                  onClick={() => {
                    const newTag = `#${item.tag}`;
                    setSearchQuery(newTag);
                    setDebouncedQuery(newTag);
                  }}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[13px] transition-all cursor-pointer ${
                    isSelected
                      ? 'border-ink bg-ink text-paper'
                      : 'border-cloud bg-paper text-ink hover:bg-mist hover:border-ash'
                  }`}
                >
                  <span
                    className={
                      isSelected
                        ? 'text-paper font-semibold'
                        : 'text-meta font-semibold'
                    }
                  >
                    #{item.tag}
                  </span>
                  <span
                    className={`text-[11px] ${
                      isSelected ? 'text-paper/80' : 'text-graphite'
                    }`}
                  >
                    {item.postsCount} bài viết
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Result Tabs (when searching): "Tất cả" (All), "Bài viết" (Posts), "Người dùng" (Users) */}
      {hasSearchText && (
        <div className="flex border-b border-cloud bg-paper sticky top-[53px] z-10">
          {[
            { key: 'all', label: 'Tất cả' },
            { key: 'posts', label: 'Bài viết' },
            { key: 'users', label: 'Người dùng' },
          ].map((tab) => {
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key as 'all' | 'posts' | 'users')}
                className={`flex-1 py-3 text-[14px] font-semibold transition-colors relative text-center cursor-pointer ${
                  isActive ? 'text-ink' : 'text-ash hover:text-ink'
                }`}
              >
                <span>{tab.label}</span>
                {isActive && (
                  <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-ink" />
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Remote Resolution Loading Indicator (when resolving fediverse actor) */}
      {isResolvingRemote && (
        <div
          className="p-8 text-center flex flex-col items-center justify-center gap-3 bg-paper border-b border-cloud"
          data-testid="fediverse-loading-skeleton"
        >
          <div className="w-12 h-12 rounded-full bg-mist border border-cloud flex items-center justify-center text-meta animate-pulse">
            <Globe className="w-6 h-6 animate-spin" style={{ animationDuration: '3s' }} />
          </div>
          <div>
            <p className="text-[15px] font-semibold text-ink">
              Đang tìm kiếm tài khoản từ xa trên Fediverse...
            </p>
            <p className="text-[13px] text-ash mt-0.5">
              Đang kết nối WebFinger và phân giải hồ sơ ActivityPub từ máy chủ từ xa
            </p>
          </div>
        </div>
      )}

      {/* Remote Resolution Friendly Error Notice (if server unreachable or handle not found) */}
      {federatedError && !isResolvingRemote && (
        <div
          className="p-4 mx-4 my-3 rounded-xl border border-cloud bg-paper flex items-start gap-3 shadow-sm"
          data-testid="fediverse-error-state"
        >
          <div className="w-9 h-9 rounded-full bg-mist border border-cloud flex items-center justify-center text-graphite shrink-0 mt-0.5">
            <Globe className="w-5 h-5 text-ash" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[14px] font-semibold text-ink">
              Không thể phân giải tài khoản từ xa
            </p>
            <p className="text-[13px] text-ash mt-0.5 leading-relaxed">
              {federatedError}
            </p>
          </div>
          {fediverseTarget && (
            <button
              type="button"
              onClick={() => handleResolveRemote(fediverseTarget.normalizedHandle)}
              disabled={isResolvingRemote}
              className="px-3 py-1.5 text-[12px] font-semibold text-ink border border-cloud rounded-full hover:bg-mist transition-colors shrink-0 disabled:opacity-60 cursor-pointer"
              data-testid="fediverse-retry-btn"
            >
              Thử lại
            </button>
          )}
        </div>
      )}

      {/* Search Content / Feed Zone */}
      {hasSearchText ? (
        <div>
          {isSearching && !federatedUser ? (
            <div className="p-12 text-center flex flex-col items-center justify-center gap-2">
              <Loader2 className="w-6 h-6 animate-spin text-ink" />
              <span className="text-[13px] text-ash">Đang tìm kiếm...</span>
            </div>
          ) : (
            <div>
              {/* TAB: ALL */}
              {activeTab === 'all' && (
                <div>
                  {/* Dedicated Remote Federated Account Section */}
                  {(federatedUser || federatedActor) && (
                    <div
                      className="border-b border-cloud bg-paper"
                      data-testid="fediverse-search-section"
                    >
                      <div className="flex items-center justify-between px-4 pt-3 pb-1 text-[12px] font-semibold uppercase tracking-wider text-graphite">
                        <div className="flex items-center gap-1.5">
                          <Globe className="w-3.5 h-3.5 text-meta" />
                          <span>Tài khoản từ xa trên Fediverse</span>
                        </div>
                        <span className="text-[11px] font-medium text-ash normal-case">
                          Khám phá liên hợp
                        </span>
                      </div>
                      <FederatedUserCard
                        user={federatedUser}
                        actor={federatedActor}
                        onFollowChange={handleFederatedFollowChange}
                      />
                    </div>
                  )}

                  {/* Matching Users Preview if any */}
                  {nonFederatedUserResults.length > 0 && (
                    <div className="border-b border-cloud bg-paper">
                      <div className="flex items-center justify-between px-4 pt-3 pb-1 text-[12px] font-semibold uppercase tracking-wider text-graphite">
                        <div className="flex items-center gap-1.5">
                          <Users className="w-3.5 h-3.5" />
                          <span>Người dùng ({nonFederatedUserResults.length})</span>
                        </div>
                        {nonFederatedUserResults.length > 3 && (
                          <button
                            type="button"
                            onClick={() => setActiveTab('users')}
                            className="text-[12px] font-medium text-meta hover:underline flex items-center gap-1 normal-case"
                          >
                            Xem tất cả <ArrowRight className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                      <div className="divide-y divide-cloud/60">
                        {nonFederatedUserResults.slice(0, 3).map(renderUserCard)}
                      </div>
                    </div>
                  )}

                  {/* Matching Posts */}
                  {postResults.length > 0 && (
                    <div>
                      {(nonFederatedUserResults.length > 0 || federatedUser) && (
                        <div className="px-4 pt-3 pb-1 text-[12px] font-semibold uppercase tracking-wider text-graphite border-b border-cloud">
                          Bài viết ({postResults.length})
                        </div>
                      )}
                      <div>
                        {postResults.map((post) => (
                          <PostFeedItem
                            key={post.id}
                            post={post}
                            onPostUpdated={handlePostUpdated}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Empty state for 'all' tab */}
                  {postResults.length === 0 &&
                    nonFederatedUserResults.length === 0 &&
                    !federatedUser &&
                    !federatedActor &&
                    !isResolvingRemote &&
                    !federatedError && (
                      <div className="p-12 text-center flex flex-col items-center justify-center">
                        <div className="w-12 h-12 rounded-full bg-mist flex items-center justify-center text-ash mb-3">
                          <Search className="w-6 h-6" />
                        </div>
                        <p className="text-[15px] font-semibold text-ink mb-1">
                          Không tìm thấy kết quả cho "{debouncedQuery}"
                        </p>
                        <p className="text-[13px] text-ash max-w-sm">
                          Hãy thử tìm kiếm với từ khóa khác, tìm theo hashtag #{debouncedQuery.replace(/^[@#]/, '')} hoặc nhập @user@domain để khám phá Fediverse.
                        </p>
                      </div>
                    )}
                </div>
              )}

              {/* TAB: POSTS */}
              {activeTab === 'posts' && (
                <div>
                  {postResults.length > 0 ? (
                    postResults.map((post) => (
                      <PostFeedItem
                        key={post.id}
                        post={post}
                        onPostUpdated={handlePostUpdated}
                      />
                    ))
                  ) : (
                    <div className="p-12 text-center flex flex-col items-center justify-center">
                      <div className="w-12 h-12 rounded-full bg-mist flex items-center justify-center text-ash mb-3">
                        <Search className="w-6 h-6" />
                      </div>
                      <p className="text-[15px] font-semibold text-ink mb-1">
                        Không tìm thấy bài viết nào cho "{debouncedQuery}"
                      </p>
                      <p className="text-[13px] text-ash">
                        Hãy thử tìm kiếm với các từ khóa hoặc chủ đề khác.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* TAB: USERS */}
              {activeTab === 'users' && (
                <div>
                  {/* Remote Federated Account at the top of Users tab */}
                  {(federatedUser || federatedActor) && (
                    <div
                      className="border-b border-cloud bg-paper"
                      data-testid="fediverse-user-tab-item"
                    >
                      <div className="px-4 pt-3 pb-1 text-[12px] font-semibold uppercase tracking-wider text-graphite flex items-center gap-1.5">
                        <Globe className="w-3.5 h-3.5 text-meta" />
                        <span>Tài khoản Fediverse từ xa</span>
                      </div>
                      <FederatedUserCard
                        user={federatedUser}
                        actor={federatedActor}
                        onFollowChange={handleFederatedFollowChange}
                      />
                    </div>
                  )}

                  {/* Other User Results */}
                  {nonFederatedUserResults.length > 0 ? (
                    nonFederatedUserResults.map(renderUserCard)
                  ) : !federatedUser && !federatedActor && !isResolvingRemote && !federatedError ? (
                    <div className="p-12 text-center flex flex-col items-center justify-center">
                      <div className="w-12 h-12 rounded-full bg-mist flex items-center justify-center text-ash mb-3">
                        <Users className="w-6 h-6" />
                      </div>
                      <p className="text-[15px] font-semibold text-ink mb-1">
                        Không tìm thấy người dùng nào cho "{debouncedQuery}"
                      </p>
                      <p className="text-[13px] text-ash">
                        Hãy kiểm tra lại tên tài khoản hoặc nhập @user@domain để khám phá máy chủ liên hợp.
                      </p>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        /* Empty State when no query is typed: "Khám phá các chủ đề thịnh hành hôm nay" */
        <div>
          <div className="px-4 py-3 bg-paper border-b border-cloud text-[12px] font-semibold uppercase tracking-wider text-graphite">
            Khám phá các chủ đề thịnh hành hôm nay
          </div>

          {isExploreLoading ? (
            <div className="p-12 text-center flex flex-col items-center justify-center gap-2">
              <Loader2 className="w-6 h-6 animate-spin text-ink" />
              <span className="text-[13px] text-ash">Đang tải nội dung khám phá...</span>
            </div>
          ) : explorePosts.length === 0 ? (
            <div className="p-12 text-center text-ash text-[13px]">
              Chưa có bài viết khám phá nào hôm nay. Hãy bắt đầu theo dõi chủ đề bạn thích!
            </div>
          ) : (
            explorePosts.map((post) => (
              <PostFeedItem
                key={post.id}
                post={post}
                onPostUpdated={handlePostUpdated}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
};

export default ExploreView;

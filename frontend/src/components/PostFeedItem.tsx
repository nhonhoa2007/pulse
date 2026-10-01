import React, { useState, useRef, useEffect } from 'react';
import { PostDto } from '../types/PulseTypes';
import { usePulse } from '../context/PulseContext';
import { api } from '../api/PulseApiClient';
import { formatCount, formatRelativeTime, renderRichContent } from '../utils/formatters';
import { VerifiedBadge } from './VerifiedBadge';
import { QuotePostModal } from './QuotePostModal';
import { PollComponent } from './PollComponent';
import { ContentWarningShield } from './ContentWarningShield';
import { EditPostModal } from './EditPostModal';
import { PostVersionHistoryModal } from './PostVersionHistoryModal';
import { computeEditWindowRemaining } from '../utils/trustSafety';
import { formatViewsBadge } from '../utils/useViewportImpressionTracker';
import {
  Heart,
  MessageCircle,
  Repeat,
  Send,
  MoreHorizontal,
  Bookmark,
  Quote,
  Pin,
  PinOff,
  Pencil,
  VolumeX,
  Flag,
  Eye,
} from 'lucide-react';

interface PostFeedItemProps {
  post: PostDto;
  isThreadParent?: boolean;
  isThreadChild?: boolean;
  onPostUpdated?: (updated: PostDto) => void;
  onReplyClick?: (post: PostDto) => void;
  observeImpression?: (postId: string, el: HTMLElement | null) => void;
}

// PKG-04: lý do báo cáo hiển thị cho người dùng
const REPORT_REASONS: Array<{ value: string; label: string }> = [
  { value: 'SPAM', label: 'Spam hoặc gây nhiễu' },
  { value: 'HARASSMENT', label: 'Quấy rối / bắt nạt' },
  { value: 'HATE_SPEECH', label: 'Ngôn từ thù địch' },
  { value: 'MISINFORMATION', label: 'Thông tin sai lệch' },
  { value: 'OTHER', label: 'Lý do khác' },
];

export const PostFeedItem: React.FC<PostFeedItemProps> = ({
  post,
  isThreadParent = false,
  isThreadChild = false,
  onPostUpdated,
  onReplyClick,
  observeImpression,
}) => {
  const { navigateTo, addToast, currentUser } = usePulse();

  // PKG-04: gửi báo cáo bài viết
  const handleReportPost = async (reason: string) => {
    if (isReporting) return;
    setIsReporting(true);
    try {
      await api.createReport({ targetType: 'POST', targetId: post.id, reason });
      addToast('Đã gửi báo cáo. Cảm ơn bạn đã giúp cộng đồng an toàn hơn.', 'success');
      setShowReportMenu(false);
      setShowActionMenu(false);
    } catch (err: any) {
      addToast(err?.message || 'Không thể gửi báo cáo', 'error');
    } finally {
      setIsReporting(false);
    }
  };

  // Action Menu & Modals State
  const [showActionMenu, setShowActionMenu] = useState<boolean>(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState<boolean>(false);
  const [isVersionHistoryOpen, setIsVersionHistoryOpen] = useState<boolean>(false);
  const [isPinLoading, setIsPinLoading] = useState<boolean>(false);
  const [isMuteLoading, setIsMuteLoading] = useState<boolean>(false);
  // PKG-04: report flow
  const [showReportMenu, setShowReportMenu] = useState<boolean>(false);
  const [isReporting, setIsReporting] = useState<boolean>(false);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const actionMenuRef = useRef<HTMLDivElement>(null);

  const isSelf =
    currentUser &&
    (currentUser.id === post.authorId ||
      currentUser.username === post.author.username ||
      currentUser.id === post.author.id);

  // Optimistic states for Like
  const [isLiked, setIsLiked] = useState<boolean>(!!post.isLiked);
  const [likesCount, setLikesCount] = useState<number>(post.likesCount);
  const [isLikeLoading, setIsLikeLoading] = useState<boolean>(false);
  const [likeHeartBounced, setLikeHeartBounced] = useState<boolean>(false);

  // Optimistic states for Repost
  const [isReposted, setIsReposted] = useState<boolean>(!!post.isReposted);
  const [repostsCount, setRepostsCount] = useState<number>(post.repostsCount);
  const [isRepostLoading, setIsRepostLoading] = useState<boolean>(false);

  // Repost / Quote Menu & Modal
  const [showRepostMenu, setShowRepostMenu] = useState<boolean>(false);
  const [isQuoteModalOpen, setIsQuoteModalOpen] = useState<boolean>(false);
  const repostMenuRef = useRef<HTMLDivElement>(null);

  // Optimistic states for Bookmark
  const [isBookmarked, setIsBookmarked] = useState<boolean>(!!post.isBookmarked);
  const [isBookmarkLoading, setIsBookmarkLoading] = useState<boolean>(false);

  // Sync state if post prop changes
  useEffect(() => {
    setIsLiked(!!post.isLiked);
    setLikesCount(post.likesCount);
    setIsReposted(!!post.isReposted);
    setRepostsCount(post.repostsCount);
    setIsBookmarked(!!post.isBookmarked);
  }, [post.isLiked, post.likesCount, post.isReposted, post.repostsCount, post.isBookmarked]);

  // Close repost popover menu on outside click
  useEffect(() => {
    if (!showRepostMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (repostMenuRef.current && !repostMenuRef.current.contains(e.target as Node)) {
        setShowRepostMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showRepostMenu]);

  // Close action popover menu on outside click & update timer
  useEffect(() => {
    if (!showActionMenu) return;
    setNowMs(Date.now());
    const interval = setInterval(() => setNowMs(Date.now()), 1000);

    const handleClickOutside = (e: MouseEvent) => {
      if (actionMenuRef.current && !actionMenuRef.current.contains(e.target as Node)) {
        setShowActionMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      clearInterval(interval);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showActionMenu]);

  const editWindow = computeEditWindowRemaining(post.createdAt, nowMs);
  const canEditPost = isSelf && !editWindow.isExpired;

  // Pin / Unpin Post Handler
  const handleTogglePin = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowActionMenu(false);
    if (isPinLoading) return;

    const nextIsPinned = !post.isPinned;
    setIsPinLoading(true);

    try {
      if (nextIsPinned) {
        await api.pinPost(post.id);
        addToast('Đã ghim bài viết lên trang cá nhân', 'success');
      } else {
        await api.unpinPost(post.id);
        addToast('Đã bỏ ghim bài viết', 'info');
      }
      onPostUpdated?.({
        ...post,
        isPinned: nextIsPinned,
      });
    } catch (err: any) {
      addToast(err.message || 'Không thể cập nhật trạng thái ghim', 'error');
    } finally {
      setIsPinLoading(false);
    }
  };

  // Mute User Handler
  const handleMuteUser = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowActionMenu(false);
    if (isMuteLoading) return;

    setIsMuteLoading(true);
    try {
      await api.muteUser(post.authorId);
      addToast(`Đã tắt tiếng @${post.author.username}`, 'success');
    } catch (err: any) {
      addToast(err.message || 'Không thể tắt tiếng người dùng', 'error');
    } finally {
      setIsMuteLoading(false);
    }
  };

  // Optimistic Like Handler
  const handleToggleLike = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isLikeLoading) return;

    if (!isLiked) {
      setLikeHeartBounced(true);
      setTimeout(() => setLikeHeartBounced(false), 500);
    }

    const nextIsLiked = !isLiked;
    const nextCount = nextIsLiked ? likesCount + 1 : Math.max(0, likesCount - 1);

    setIsLiked(nextIsLiked);
    setLikesCount(nextCount);
    setIsLikeLoading(true);

    try {
      const res = await api.toggleLike(post.id);
      if (res && typeof res.isLiked === 'boolean') {
        setIsLiked(res.isLiked);
        setLikesCount(res.likesCount);
      }
      onPostUpdated?.({
        ...post,
        isLiked: nextIsLiked,
        likesCount: nextCount,
      });
    } catch (err: any) {
      setIsLiked(isLiked);
      setLikesCount(likesCount);
      addToast(err.message || 'Không thể thích bài viết', 'error');
    } finally {
      setIsLikeLoading(false);
    }
  };

  // Optimistic Repost Handler
  const handleToggleRepost = async (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (isRepostLoading) return;

    const nextIsReposted = !isReposted;
    const nextCount = nextIsReposted ? repostsCount + 1 : Math.max(0, repostsCount - 1);

    setIsReposted(nextIsReposted);
    setRepostsCount(nextCount);
    setIsRepostLoading(true);

    try {
      const res = await api.toggleRepost(post.id);
      if (res && typeof res.isReposted === 'boolean') {
        setIsReposted(res.isReposted);
        setRepostsCount(res.repostsCount);
      }
      addToast(nextIsReposted ? 'Đã đăng lại bài viết' : 'Đã hủy đăng lại', 'info');
      onPostUpdated?.({
        ...post,
        isReposted: nextIsReposted,
        repostsCount: nextCount,
      });
    } catch (err: any) {
      setIsReposted(isReposted);
      setRepostsCount(repostsCount);
      addToast(err.message || 'Không thể đăng lại bài viết', 'error');
    } finally {
      setIsRepostLoading(false);
    }
  };

  // Optimistic Bookmark Handler
  const handleToggleBookmark = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isBookmarkLoading) return;

    const nextIsBookmarked = !isBookmarked;
    setIsBookmarked(nextIsBookmarked);
    setIsBookmarkLoading(true);

    try {
      const result = await api.toggleBookmark(post.id);
      setIsBookmarked(result);
      addToast(result ? 'Đã lưu bài viết' : 'Đã bỏ lưu bài viết', 'info');
      onPostUpdated?.({
        ...post,
        isBookmarked: result,
      });
    } catch (err: any) {
      setIsBookmarked(isBookmarked);
      addToast(err.message || 'Không thể cập nhật đã lưu', 'error');
    } finally {
      setIsBookmarkLoading(false);
    }
  };

  const handleShare = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const url = `${window.location.origin}/#post-${post.id}`;
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(url);
      addToast('Đã sao chép liên kết vào clipboard', 'success');
    } else {
      addToast(`Liên kết: ${url}`, 'info');
    }
  };

  const handleCardClick = () => {
    navigateTo('thread', { postId: post.id });
  };

  const handleAuthorClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigateTo('profile', { username: post.author.username });
  };

  // Smart Media Grid Renderer
  // - 1 image: full-width, 8px radius (rounded-[8px]), max height 400px, object-cover.
  // - 2 images: 2-column grid, 8px radius each, aspect-[4/3].
  // - 3 images: left 1 big, right 2 stacked, 8px radius each.
  // - 4 images: 2x2 grid, 8px radius each.
  const renderMediaGrid = (urls: string[]) => {
    if (!urls || urls.length === 0) return null;
    const count = urls.length;

    if (count === 1) {
      return (
        <div className="mb-2.5 overflow-hidden rounded-[8px] border border-cloud bg-mist">
          <img
            src={urls[0]}
            alt="Post media"
            className="w-full max-h-[400px] object-cover hover:opacity-95 transition-opacity"
            onError={(e) => {
              (e.target as HTMLElement).style.display = 'none';
            }}
            onClick={(e) => {
              e.stopPropagation();
              window.open(urls[0], '_blank');
            }}
          />
        </div>
      );
    }

    if (count === 2) {
      return (
        <div className="grid grid-cols-2 gap-2 mb-2.5">
          {urls.slice(0, 2).map((url, idx) => (
            <div
              key={idx}
              className="overflow-hidden rounded-[8px] border border-cloud aspect-[4/3] bg-mist"
            >
              <img
                src={url}
                alt={`Post media ${idx + 1}`}
                className="w-full h-full object-cover hover:opacity-95 transition-opacity"
                onError={(e) => {
                  (e.target as HTMLElement).style.display = 'none';
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  window.open(url, '_blank');
                }}
              />
            </div>
          ))}
        </div>
      );
    }

    if (count === 3) {
      return (
        <div className="grid grid-cols-2 gap-2 mb-2.5 h-[320px]">
          {/* Left 1 big image */}
          <div className="overflow-hidden rounded-[8px] border border-cloud h-full bg-mist">
            <img
              src={urls[0]}
              alt="Post media 1"
              className="w-full h-full object-cover hover:opacity-95 transition-opacity"
              onError={(e) => {
                (e.target as HTMLElement).style.display = 'none';
              }}
              onClick={(e) => {
                e.stopPropagation();
                window.open(urls[0], '_blank');
              }}
            />
          </div>
          {/* Right 2 stacked images */}
          <div className="grid grid-rows-2 gap-2 h-full">
            {urls.slice(1, 3).map((url, idx) => (
              <div
                key={idx}
                className="overflow-hidden rounded-[8px] border border-cloud h-full bg-mist"
              >
                <img
                  src={url}
                  alt={`Post media ${idx + 2}`}
                  className="w-full h-full object-cover hover:opacity-95 transition-opacity"
                  onError={(e) => {
                    (e.target as HTMLElement).style.display = 'none';
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    window.open(url, '_blank');
                  }}
                />
              </div>
            ))}
          </div>
        </div>
      );
    }

    // 4 or more images: 2x2 grid, 8px radius each
    return (
      <div className="grid grid-cols-2 gap-2 mb-2.5">
        {urls.slice(0, 4).map((url, idx) => (
          <div
            key={idx}
            className="relative overflow-hidden rounded-[8px] border border-cloud aspect-[4/3] bg-mist"
          >
            <img
              src={url}
              alt={`Post media ${idx + 1}`}
              className="w-full h-full object-cover hover:opacity-95 transition-opacity"
              onError={(e) => {
                (e.target as HTMLElement).style.display = 'none';
              }}
              onClick={(e) => {
                e.stopPropagation();
                window.open(url, '_blank');
              }}
            />
            {idx === 3 && urls.length > 4 && (
              <div
                className="absolute inset-0 bg-black/50 flex items-center justify-center text-paper font-semibold text-[16px] cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  window.open(url, '_blank');
                }}
              >
                +{urls.length - 4}
              </div>
            )}
          </div>
        ))}
      </div>
    );
  };

  return (
    <>
      <article
        ref={(el) => {
          if (observeImpression) {
            observeImpression(post.id, el);
          }
        }}
        data-post-id={post.id}
        onClick={handleCardClick}
        className={`group relative flex gap-3 p-4 border-b border-cloud bg-paper hover:bg-mist/40 transition-colors cursor-pointer select-text ${
          isThreadChild ? 'pl-8' : ''
        }`}
      >
        {/* Thread connecting line for hierarchical replies */}
        {isThreadParent && (
          <div className="absolute left-[36px] top-14 bottom-0 w-[1.5px] bg-cloud z-0" />
        )}
        {isThreadChild && (
          <div className="absolute left-[20px] -top-3 bottom-8 w-[1.5px] bg-cloud z-0" />
        )}

        {/* Avatar Column (40px circular avatar, no border) */}
        <div className="relative z-10 shrink-0">
          <button
            onClick={handleAuthorClick}
            className="rounded-full overflow-hidden block focus:outline-none hover:opacity-85 transition-opacity"
          >
            <img
              src={
                post.author.avatarUrl ||
                `https://api.dicebear.com/7.x/bottts/svg?seed=${post.author.username}`
              }
              alt={post.author.displayName}
              className="w-10 h-10 rounded-full object-cover"
            />
          </button>
        </div>

        {/* Main Content Column */}
        <div className="flex-1 min-w-0">
          {/* Pinned Post Badge */}
          {post.isPinned && (
            <div
              data-testid="pinned-post-badge"
              className="flex items-center gap-1.5 text-[12px] font-semibold text-ash mb-1 pl-0.5"
            >
              <Pin className="w-3.5 h-3.5 rotate-45 text-ash" />
              <span>Bài viết đã ghim</span>
            </div>
          )}

          {/* Header Row: Username + Badge + Timestamp + Three-dot menu */}
          <div className="flex items-center justify-between gap-2 mb-1">
            <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
              <button
                onClick={handleAuthorClick}
                className="text-[15px] font-semibold text-ink hover:underline truncate"
              >
                {post.author.displayName}
              </button>

              {post.author.isCelebrity && (
                <VerifiedBadge size={12} title="Tài khoản đã xác minh (KOL VIP)" />
              )}

              <span className="text-[13px] text-graphite truncate">
                @{post.author.username}
              </span>

              <span className="text-ash text-[13px]">•</span>

              <time
                dateTime={post.createdAt}
                className="text-[13px] text-graphite hover:underline"
              >
                {formatRelativeTime(post.createdAt)}
              </time>

              {/* Edited Badge */}
              {post.isEdited && (
                <button
                  type="button"
                  data-testid="edited-badge"
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsVersionHistoryOpen(true);
                  }}
                  className="text-[13px] text-ash hover:text-ink hover:underline focus:outline-none cursor-pointer"
                  title="Xem lịch sử chỉnh sửa bài viết"
                >
                  {' '}• Đã chỉnh sửa
                </button>
              )}
            </div>

            <div className="relative" ref={actionMenuRef}>
              <button
                type="button"
                data-testid="post-action-menu-button"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowActionMenu((prev) => !prev);
                }}
                className="p-1.5 text-ash hover:text-ink hover:bg-mist rounded-full transition-colors focus:outline-none"
                title="Tùy chọn bài viết"
                aria-label="Tùy chọn bài viết"
              >
                <MoreHorizontal className="w-4 h-4" />
              </button>

              {showActionMenu && (
                <div
                  data-testid="post-action-menu-dropdown"
                  className="absolute right-0 top-full mt-1 w-52 bg-paper border border-cloud rounded-[14px] shadow-xl p-1.5 z-40 animate-scale-up"
                  onClick={(e) => e.stopPropagation()}
                >
                  {isSelf ? (
                    <>
                      {/* Chỉnh sửa bài viết */}
                      <button
                        type="button"
                        data-testid="action-edit-post"
                        disabled={!canEditPost}
                        onClick={() => {
                          setShowActionMenu(false);
                          setIsEditModalOpen(true);
                        }}
                        className={`w-full flex items-center gap-2.5 px-3 py-2 text-left text-[13px] font-semibold rounded-[8px] transition-colors ${
                          canEditPost
                            ? 'text-ink hover:bg-mist cursor-pointer'
                            : 'text-ash cursor-not-allowed opacity-50'
                        }`}
                        title={
                          canEditPost
                            ? 'Chỉnh sửa nội dung bài viết'
                            : 'Đã hết thời hạn 15 phút chỉnh sửa'
                        }
                      >
                        <Pencil className="w-4 h-4" />
                        <span>Chỉnh sửa bài viết</span>
                      </button>

                      {/* Ghim / Bỏ ghim bài viết */}
                      {!post.replyToId && (
                        <button
                          type="button"
                          data-testid="action-pin-post"
                          disabled={isPinLoading}
                          onClick={handleTogglePin}
                          className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-[13px] font-semibold text-ink hover:bg-mist rounded-[8px] transition-colors cursor-pointer"
                        >
                          {post.isPinned ? (
                            <>
                              <PinOff className="w-4 h-4 text-ash" />
                              <span>Bỏ ghim khỏi trang cá nhân</span>
                            </>
                          ) : (
                            <>
                              <Pin className="w-4 h-4 text-ash rotate-45" />
                              <span>Ghim lên trang cá nhân</span>
                            </>
                          )}
                        </button>
                      )}
                    </>
                  ) : (
                    <>
                      {/* Tắt tiếng @username */}
                      <button
                        type="button"
                        data-testid="action-mute-user"
                        disabled={isMuteLoading}
                        onClick={handleMuteUser}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-[13px] font-semibold text-ink hover:bg-mist rounded-[8px] transition-colors cursor-pointer"
                      >
                        <VolumeX className="w-4 h-4 text-ash" />
                        <span>Tắt tiếng @{post.author.username}</span>
                      </button>

                      {/* PKG-04: Báo cáo bài viết */}
                      {!showReportMenu ? (
                        <button
                          type="button"
                          data-testid="action-report-post"
                          onClick={() => setShowReportMenu(true)}
                          className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-[13px] font-semibold text-ink hover:bg-mist rounded-[8px] transition-colors cursor-pointer"
                        >
                          <Flag className="w-4 h-4 text-ash" />
                          <span>Báo cáo bài viết</span>
                        </button>
                      ) : (
                        <div data-testid="report-reason-list" className="border border-cloud rounded-[8px] my-1 p-1">
                          <p className="px-2 py-1 text-[11px] font-semibold text-ash uppercase tracking-wide">
                            Chọn lý do báo cáo
                          </p>
                          {REPORT_REASONS.map((r) => (
                            <button
                              key={r.value}
                              type="button"
                              data-testid={`report-reason-${r.value}`}
                              disabled={isReporting}
                              onClick={() => handleReportPost(r.value)}
                              className="w-full flex items-center gap-2 px-2 py-1.5 text-left text-[13px] text-ink hover:bg-mist rounded-[6px] transition-colors disabled:opacity-50"
                            >
                              {r.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  )}

                  {/* Sao chép liên kết */}
                  <button
                    type="button"
                    data-testid="action-copy-link"
                    onClick={(e) => {
                      setShowActionMenu(false);
                      handleShare(e);
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-[13px] font-semibold text-ink hover:bg-mist rounded-[8px] transition-colors cursor-pointer"
                  >
                    <Send className="w-4 h-4 text-ash" />
                    <span>Sao chép liên kết</span>
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Reply To indicator if present */}
          {post.replyTo && (
            <div className="text-[13px] text-graphite mb-1">
              Đang trả lời{' '}
              <span className="text-meta hover:underline">
                @{post.replyTo.author.username}
              </span>
            </div>
          )}

          {/* Content & Media protected by ContentWarningShield */}
          <ContentWarningShield
            isSensitive={post.isSensitive}
            contentWarning={post.contentWarning}
          >
            {/* Post Text Content (15px/400, line-height 1.4, color #000000) */}
            {post.content && (
              <div className="text-[15px] leading-[1.4] text-ink font-normal whitespace-pre-line break-words mb-2.5">
                {renderRichContent(
                  post.content,
                  (tag) => navigateTo('explore', { hashtag: tag }),
                  (user) => navigateTo('profile', { username: user })
                )}
              </div>
            )}

            {/* Attached Images / Smart Media Grid */}
            {renderMediaGrid(post.mediaUrls)}
          </ContentWarningShield>

          {/* Embedded Interactive Poll */}
          {post.poll && (
            <div
              onClick={(e) => e.stopPropagation()}
              className="mb-2.5"
            >
              <PollComponent
                poll={post.poll}
                onVote={async (choiceIndex) => {
                  if (!post.poll) return;
                  const updated = await api.castVote(post.poll.id, choiceIndex);
                  if (onPostUpdated) {
                    onPostUpdated({
                      ...post,
                      poll: updated,
                    });
                  }
                  return updated;
                }}
              />
            </div>
          )}

          {/* Embedded Quoted Post Card (1px Cloud Gray #d5d5d5 border, 8px radius, padding 12px, clickable) */}
          {post.quoteOf && (
            <div
              onClick={(e) => {
                e.stopPropagation();
                navigateTo('thread', { postId: post.quoteOf!.id });
              }}
              className="mb-2.5 p-3 rounded-[8px] border border-cloud bg-paper hover:bg-mist/50 transition-colors"
            >
              <div className="flex items-center gap-2 mb-1.5">
                <img
                  src={
                    post.quoteOf.author.avatarUrl ||
                    `https://api.dicebear.com/7.x/bottts/svg?seed=${post.quoteOf.author.username}`
                  }
                  alt={post.quoteOf.author.displayName}
                  className="w-5 h-5 rounded-full object-cover shrink-0"
                />
                <div className="flex items-center gap-1.5 min-w-0 flex-wrap text-[13px]">
                  <span className="font-semibold text-ink">
                    {post.quoteOf.author.displayName}
                  </span>
                  {post.quoteOf.author.isCelebrity && (
                    <VerifiedBadge size={11} title="Tài khoản đã xác minh" />
                  )}
                  <span className="text-graphite">@{post.quoteOf.author.username}</span>
                  <span className="text-ash">•</span>
                  <span className="text-graphite">
                    {formatRelativeTime(post.quoteOf.createdAt)}
                  </span>
                </div>
              </div>

              {post.quoteOf.content && (
                <p className="text-[14px] leading-[1.4] text-ink line-clamp-3 mb-2 font-normal">
                  {post.quoteOf.content}
                </p>
              )}

              {/* Quoted Media thumbnails if present */}
              {post.quoteOf.mediaUrls && post.quoteOf.mediaUrls.length > 0 && (
                <div className="flex gap-2 overflow-hidden rounded-[6px]">
                  {post.quoteOf.mediaUrls.slice(0, 3).map((mUrl, mIdx) => (
                    <img
                      key={mIdx}
                      src={mUrl}
                      alt="Quoted media"
                      className="w-16 h-16 object-cover rounded-[6px] border border-cloud bg-mist"
                    />
                  ))}
                  {post.quoteOf.mediaUrls.length > 3 && (
                    <div className="w-16 h-16 rounded-[6px] bg-mist border border-cloud flex items-center justify-center text-[12px] font-semibold text-graphite">
                      +{post.quoteOf.mediaUrls.length - 3}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Post Engagement Bar: Like, Reply, Repost/Quote Menu, Bookmark, Views, Share */}
          <div className="flex items-center justify-between pt-1 max-w-[460px] text-ash">
            {/* Like Action */}
            <button
              type="button"
              onClick={handleToggleLike}
              disabled={isLikeLoading}
              className={`flex items-center gap-1.5 py-1 focus:outline-none transition-colors ${
                isLiked ? 'text-ink' : 'text-ash hover:text-ink'
              }`}
              title="Thích"
            >
              <Heart
                className={`w-[18px] h-[18px] stroke-[1.8] transition-transform duration-150 ${
                  isLiked ? 'fill-ink text-ink' : ''
                } ${likeHeartBounced ? 'scale-125' : ''}`}
              />
              {likesCount > 0 && (
                <span className="text-[13px] text-graphite font-normal tabular-nums">
                  {formatCount(likesCount)}
                </span>
              )}
            </button>

            {/* Comment / Reply Action */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (onReplyClick) {
                  onReplyClick(post);
                } else {
                  navigateTo('thread', { postId: post.id });
                }
              }}
              className="flex items-center gap-1.5 py-1 text-ash hover:text-ink focus:outline-none transition-colors"
              title="Trả lời"
            >
              <MessageCircle className="w-[18px] h-[18px] stroke-[1.8]" />
              {post.repliesCount > 0 && (
                <span className="text-[13px] text-graphite font-normal tabular-nums">
                  {formatCount(post.repliesCount)}
                </span>
              )}
            </button>

            {/* Repost & Quote Popover Menu */}
            <div className="relative" ref={repostMenuRef}>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowRepostMenu((prev) => !prev);
                }}
                disabled={isRepostLoading}
                className={`flex items-center gap-1.5 py-1 focus:outline-none transition-colors ${
                  isReposted ? 'text-ink' : 'text-ash hover:text-ink'
                }`}
                title="Đăng lại hoặc trích dẫn"
              >
                <Repeat className="w-[18px] h-[18px] stroke-[1.8]" />
                {repostsCount > 0 && (
                  <span className="text-[13px] text-graphite font-normal tabular-nums">
                    {formatCount(repostsCount)}
                  </span>
                )}
              </button>

              {/* Repost / Quote Dropdown Popover */}
              {showRepostMenu && (
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-44 bg-paper border border-cloud rounded-[14px] shadow-xl p-1.5 z-30 animate-scale-up">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowRepostMenu(false);
                      handleToggleRepost(e);
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-[14px] font-semibold text-ink hover:bg-mist rounded-[8px] transition-colors"
                  >
                    <Repeat className="w-4 h-4 text-ink" />
                    <span>{isReposted ? 'Hủy đăng lại' : 'Đăng lại'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowRepostMenu(false);
                      setIsQuoteModalOpen(true);
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-[14px] font-semibold text-ink hover:bg-mist rounded-[8px] transition-colors"
                  >
                    <Quote className="w-4 h-4 text-ink" />
                    <span>Trích dẫn</span>
                  </button>
                </div>
              )}
            </div>

            {/* Bookmark Action */}
            <button
              type="button"
              onClick={handleToggleBookmark}
              disabled={isBookmarkLoading}
              className={`flex items-center gap-1.5 py-1 focus:outline-none transition-colors ${
                isBookmarked ? 'text-ink' : 'text-ash hover:text-ink'
              }`}
              title={isBookmarked ? 'Bỏ lưu bài viết' : 'Lưu bài viết'}
            >
              <Bookmark
                className={`w-[18px] h-[18px] stroke-[1.8] ${
                  isBookmarked ? 'fill-ink text-ink' : ''
                }`}
              />
            </button>

            {/* Post Views Count Badge (TASK-20) */}
            <div
              className="flex items-center gap-1.5 py-1 text-ash hover:text-ink select-none transition-colors"
              title={`${(post.viewsCount ?? 0).toLocaleString()} lượt xem`}
              data-testid="post-views-badge"
            >
              <Eye className="w-[18px] h-[18px] stroke-[1.8]" />
              <span className="text-[13px] text-graphite font-normal tabular-nums">
                {formatViewsBadge(post.viewsCount ?? 0)}
              </span>
            </div>

            {/* Share / Paper Plane Action */}
            <button
              type="button"
              onClick={handleShare}
              className="flex items-center gap-1.5 py-1 text-ash hover:text-ink focus:outline-none transition-colors"
              title="Chia sẻ liên kết"
            >
              <Send className="w-[18px] h-[18px] stroke-[1.8]" />
            </button>
          </div>
        </div>
      </article>

      {/* Quote Post Modal */}
      <QuotePostModal
        post={post}
        isOpen={isQuoteModalOpen}
        onClose={() => setIsQuoteModalOpen(false)}
        onPostCreated={() => {
          setIsQuoteModalOpen(false);
          navigateTo('home');
        }}
      />

      {/* Edit Post Modal (15-min countdown) */}
      {isEditModalOpen && (
        <EditPostModal
          post={post}
          isOpen={isEditModalOpen}
          onClose={() => setIsEditModalOpen(false)}
          onPostUpdated={(updated) => {
            onPostUpdated?.(updated);
          }}
        />
      )}

      {/* Post Version History Modal */}
      {isVersionHistoryOpen && (
        <PostVersionHistoryModal
          postId={post.id}
          isOpen={isVersionHistoryOpen}
          onClose={() => setIsVersionHistoryOpen(false)}
        />
      )}
    </>
  );
};

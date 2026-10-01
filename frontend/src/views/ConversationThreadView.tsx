import React, { useState, useEffect, useCallback, useRef } from 'react';
import { PostDto } from '../types/PulseTypes';
import { usePulse } from '../context/PulseContext';
import { api } from '../api/PulseApiClient';
import { PostFeedItem } from '../components/PostFeedItem';
import { PostComposerCard } from '../components/PostComposerCard';
import { QuotePostModal } from '../components/QuotePostModal';
import { VerifiedBadge } from '../components/VerifiedBadge';
import { formatCount, formatRelativeTime, renderRichContent } from '../utils/formatters';
import { evaluateReplyPermission } from '../utils/privacy';
import {
  ArrowLeft,
  Heart,
  Repeat,
  Send,
  AlertCircle,
  MoreHorizontal,
  Bookmark,
  Quote,
  Lock,
} from 'lucide-react';

export const ConversationThreadView: React.FC = () => {
  const { viewParams, navigateTo, addToast, currentUser } = usePulse();
  const postId = viewParams.postId;

  const [rootPost, setRootPost] = useState<PostDto | null>(null);
  const [replies, setReplies] = useState<PostDto[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Root post interaction state
  const [isLiked, setIsLiked] = useState(false);
  const [likesCount, setLikesCount] = useState(0);
  const [isReposted, setIsReposted] = useState(false);
  const [repostsCount, setRepostsCount] = useState(0);
  const [isBookmarked, setIsBookmarked] = useState(false);
  const [isBookmarkLoading, setIsBookmarkLoading] = useState(false);
  const [showRepostMenu, setShowRepostMenu] = useState(false);
  const [isQuoteModalOpen, setIsQuoteModalOpen] = useState(false);
  const repostMenuRef = useRef<HTMLDivElement>(null);

  const replyPermission = evaluateReplyPermission(rootPost, currentUser);

  const fetchThread = useCallback(async () => {
    if (!postId) return;
    setIsLoading(true);
    setError(null);

    try {
      const threadData = await api.getPostThread(postId);
      setRootPost(threadData.rootPost);
      setReplies(threadData.replies || []);

      setIsLiked(!!threadData.rootPost?.isLiked);
      setLikesCount(threadData.rootPost?.likesCount || 0);
      setIsReposted(!!threadData.rootPost?.isReposted);
      setRepostsCount(threadData.rootPost?.repostsCount || 0);
      setIsBookmarked(!!threadData.rootPost?.isBookmarked);
    } catch (err: any) {
      console.error('Failed to load thread:', err);
      setError(err.message || 'Không thể tải chuỗi hội thoại này.');
    } finally {
      setIsLoading(false);
    }
  }, [postId]);

  useEffect(() => {
    fetchThread();
  }, [fetchThread]);

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

  const handleOptimisticReplyCreate = (tempReply: PostDto) => {
    setReplies((prev) => [...prev, tempReply]);
    setRootPost((prev) => (prev ? { ...prev, repliesCount: prev.repliesCount + 1 } : prev));
  };

  const handleOptimisticReplyRollback = (tempId: string) => {
    setReplies((prev) => prev.filter((r) => r.id !== tempId));
    setRootPost((prev) =>
      prev ? { ...prev, repliesCount: Math.max(0, prev.repliesCount - 1) } : prev
    );
  };

  const handleReplyCreated = (newReply: PostDto) => {
    setReplies((prev) => {
      // If replacing an optimistic temporary reply
      const tempIndex = prev.findIndex(
        (r) => r.id.startsWith('temp-') || r.id === newReply.id
      );
      if (tempIndex >= 0) {
        const copy = [...prev];
        copy[tempIndex] = newReply;
        return copy;
      }
      return [...prev, newReply];
    });

    // Only increment repliesCount if not already incremented optimistically
    if (rootPost) {
      setRootPost((prev) => {
        if (!prev) return prev;
        // Check if this was already counted via optimistic add
        const hadOptimistic = replies.some((r) => r.id.startsWith('temp-') || r.id === newReply.id);
        return hadOptimistic ? prev : { ...prev, repliesCount: prev.repliesCount + 1 };
      });
    }
  };

  const handleToggleLike = async () => {
    if (!rootPost) return;
    const nextLiked = !isLiked;
    const nextCount = nextLiked ? likesCount + 1 : Math.max(0, likesCount - 1);

    setIsLiked(nextLiked);
    setLikesCount(nextCount);

    try {
      const res = await api.toggleLike(rootPost.id);
      if (res) {
        setIsLiked(res.isLiked);
        setLikesCount(res.likesCount);
      }
    } catch {
      setIsLiked(isLiked);
      setLikesCount(likesCount);
    }
  };

  const handleToggleRepost = async () => {
    if (!rootPost) return;
    const nextReposted = !isReposted;
    const nextCount = nextReposted ? repostsCount + 1 : Math.max(0, repostsCount - 1);

    setIsReposted(nextReposted);
    setRepostsCount(nextCount);

    try {
      const res = await api.toggleRepost(rootPost.id);
      if (res) {
        setIsReposted(res.isReposted);
        setRepostsCount(res.repostsCount);
      }
      addToast(nextReposted ? 'Đã đăng lại bài viết' : 'Đã hủy đăng lại', 'info');
    } catch {
      setIsReposted(isReposted);
      setRepostsCount(repostsCount);
    }
  };

  const handleToggleBookmark = async () => {
    if (!rootPost || isBookmarkLoading) return;
    const nextBookmarked = !isBookmarked;
    setIsBookmarked(nextBookmarked);
    setIsBookmarkLoading(true);

    try {
      const res = await api.toggleBookmark(rootPost.id);
      setIsBookmarked(res);
      addToast(res ? 'Đã lưu bài viết' : 'Đã bỏ lưu bài viết', 'info');
    } catch (err: any) {
      setIsBookmarked(isBookmarked);
      addToast(err.message || 'Không thể lưu bài viết', 'error');
    } finally {
      setIsBookmarkLoading(false);
    }
  };

  const handleShare = async () => {
    if (!rootPost) return;
    const url = `${window.location.origin}/#post-${rootPost.id}`;
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(url);
      addToast('Đã sao chép liên kết vào clipboard', 'success');
    }
  };

  const renderMediaGrid = (urls: string[]) => {
    if (!urls || urls.length === 0) return null;
    const count = urls.length;

    if (count === 1) {
      return (
        <div className="mb-3 overflow-hidden rounded-[8px] border border-cloud bg-mist">
          <img
            src={urls[0]}
            alt="Post Attachment"
            className="w-full max-h-[400px] object-cover hover:opacity-95 transition-opacity cursor-pointer"
            onClick={() => window.open(urls[0], '_blank')}
          />
        </div>
      );
    }

    if (count === 2) {
      return (
        <div className="grid grid-cols-2 gap-2 mb-3">
          {urls.slice(0, 2).map((url, idx) => (
            <div
              key={idx}
              className="overflow-hidden rounded-[8px] border border-cloud aspect-[4/3] bg-mist"
            >
              <img
                src={url}
                alt={`Post Attachment ${idx + 1}`}
                className="w-full h-full object-cover hover:opacity-95 transition-opacity cursor-pointer"
                onClick={() => window.open(url, '_blank')}
              />
            </div>
          ))}
        </div>
      );
    }

    if (count === 3) {
      return (
        <div className="grid grid-cols-2 gap-2 mb-3 h-[320px]">
          <div className="overflow-hidden rounded-[8px] border border-cloud h-full bg-mist">
            <img
              src={urls[0]}
              alt="Post Attachment 1"
              className="w-full h-full object-cover hover:opacity-95 transition-opacity cursor-pointer"
              onClick={() => window.open(urls[0], '_blank')}
            />
          </div>
          <div className="grid grid-rows-2 gap-2 h-full">
            {urls.slice(1, 3).map((url, idx) => (
              <div
                key={idx}
                className="overflow-hidden rounded-[8px] border border-cloud h-full bg-mist"
              >
                <img
                  src={url}
                  alt={`Post Attachment ${idx + 2}`}
                  className="w-full h-full object-cover hover:opacity-95 transition-opacity cursor-pointer"
                  onClick={() => window.open(url, '_blank')}
                />
              </div>
            ))}
          </div>
        </div>
      );
    }

    return (
      <div className="grid grid-cols-2 gap-2 mb-3">
        {urls.slice(0, 4).map((url, idx) => (
          <div
            key={idx}
            className="overflow-hidden rounded-[8px] border border-cloud aspect-[4/3] bg-mist"
          >
            <img
              src={url}
              alt={`Post Attachment ${idx + 1}`}
              className="w-full h-full object-cover hover:opacity-95 transition-opacity cursor-pointer"
              onClick={() => window.open(url, '_blank')}
            />
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="min-w-0 flex-1 min-h-screen pb-20 md:pb-8 bg-paper">
      {/* Top Header (~53px tall, background Paper White #fafafa, centered section title in 15px/600 #000000) */}
      <header className="sticky top-0 z-20 bg-paper/95 backdrop-blur-md border-b border-cloud flex items-center justify-between h-[53px] px-4">
        <button
          onClick={() => navigateTo('home')}
          className="p-1.5 -ml-1.5 rounded-full text-ash hover:text-ink hover:bg-mist transition-colors focus:outline-none"
          title="Quay lại"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-[15px] font-semibold text-ink">Bài viết</h1>
        <div className="w-8" />
      </header>

      {isLoading ? (
        <div className="p-4 space-y-4 animate-pulse bg-paper">
          <div className="flex gap-3">
            <div className="w-10 h-10 rounded-full bg-mist" />
            <div className="flex-1 space-y-2">
              <div className="h-4 bg-mist rounded w-1/4" />
              <div className="h-3 bg-mist rounded w-1/3" />
            </div>
          </div>
          <div className="h-20 bg-mist rounded-[8px]" />
        </div>
      ) : error || !rootPost ? (
        <div className="py-16 px-4 text-center">
          <AlertCircle className="w-8 h-8 text-graphite mx-auto mb-2" />
          <h2 className="text-[15px] font-semibold text-ink mb-1">
            Không thể tải cuộc trò chuyện
          </h2>
          <p className="text-graphite text-[13px] max-w-sm mx-auto mb-4">
            {error || 'Bài viết này không tồn tại hoặc đã bị xóa.'}
          </p>
          <button
            onClick={() => navigateTo('home')}
            className="px-4 py-2 bg-ink text-paper rounded-full text-[13px] font-semibold hover:bg-ink/85 transition-colors"
          >
            Trở về trang chủ
          </button>
        </div>
      ) : (
        <div>
          {/* Main Focus / Root Post */}
          <article className="p-4 border-b border-cloud bg-paper">
            {/* Author Row */}
            <div className="flex items-center justify-between gap-3 mb-3">
              <div className="flex items-center gap-3">
                <button
                  onClick={() =>
                    navigateTo('profile', { username: rootPost.author.username })
                  }
                  className="rounded-full overflow-hidden block focus:outline-none"
                >
                  <img
                    src={
                      rootPost.author.avatarUrl ||
                      `https://api.dicebear.com/7.x/bottts/svg?seed=${rootPost.author.username}`
                    }
                    alt={rootPost.author.displayName}
                    className="w-11 h-11 rounded-full object-cover"
                  />
                </button>
                <div>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() =>
                        navigateTo('profile', { username: rootPost.author.username })
                      }
                      className="text-[15px] font-semibold text-ink hover:underline"
                    >
                      {rootPost.author.displayName}
                    </button>
                    {rootPost.author.isCelebrity && (
                      <VerifiedBadge size={13} title="Tài khoản đã xác minh" />
                    )}
                  </div>
                  <span className="text-[13px] text-graphite">
                    @{rootPost.author.username}
                  </span>
                </div>
              </div>

              <button
                onClick={handleShare}
                className="p-1.5 text-ash hover:text-ink hover:bg-mist rounded-full transition-colors focus:outline-none"
              >
                <MoreHorizontal className="w-4 h-4" />
              </button>
            </div>

            {/* Post Content (15px/400 system-ui #000000, line-height 1.4) */}
            {rootPost.content && (
              <div className="text-[15px] leading-[1.4] text-ink font-normal whitespace-pre-line mb-3">
                {renderRichContent(
                  rootPost.content,
                  (tag) => navigateTo('explore', { hashtag: tag }),
                  (user) => navigateTo('profile', { username: user })
                )}
              </div>
            )}

            {/* Smart Media Grid */}
            {renderMediaGrid(rootPost.mediaUrls)}

            {/* Embedded Quoted Post Card */}
            {rootPost.quoteOf && (
              <div
                onClick={() => navigateTo('thread', { postId: rootPost.quoteOf!.id })}
                className="mb-3 p-3 rounded-[8px] border border-cloud bg-paper hover:bg-mist/50 transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-2 mb-1.5">
                  <img
                    src={
                      rootPost.quoteOf.author.avatarUrl ||
                      `https://api.dicebear.com/7.x/bottts/svg?seed=${rootPost.quoteOf.author.username}`
                    }
                    alt={rootPost.quoteOf.author.displayName}
                    className="w-5 h-5 rounded-full object-cover shrink-0"
                  />
                  <div className="flex items-center gap-1.5 min-w-0 flex-wrap text-[13px]">
                    <span className="font-semibold text-ink">
                      {rootPost.quoteOf.author.displayName}
                    </span>
                    {rootPost.quoteOf.author.isCelebrity && (
                      <VerifiedBadge size={11} title="VIP" />
                    )}
                    <span className="text-graphite">
                      @{rootPost.quoteOf.author.username}
                    </span>
                    <span className="text-ash">•</span>
                    <span className="text-graphite">
                      {formatRelativeTime(rootPost.quoteOf.createdAt)}
                    </span>
                  </div>
                </div>
                <p className="text-[14px] leading-[1.4] text-ink line-clamp-3">
                  {rootPost.quoteOf.content}
                </p>
              </div>
            )}

            {/* Timestamp & Metadata (13px/400 #424242, 1px #d5d5d5 border-y) */}
            <div className="text-[13px] text-graphite py-2.5 border-y border-cloud flex items-center justify-between">
              <span>
                {new Date(rootPost.createdAt).toLocaleTimeString('vi-VN', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}{' '}
                •{' '}
                {new Date(rootPost.createdAt).toLocaleDateString('vi-VN', {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                })}
              </span>
              <div className="flex items-center gap-2">
                {(rootPost.replyPrivacy || rootPost.reply_privacy) &&
                  (rootPost.replyPrivacy !== 'EVERYONE' && rootPost.reply_privacy !== 'EVERYONE') && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-graphite px-2 py-0.5 rounded-full bg-mist border border-cloud">
                      <Lock className="w-3 h-3" />
                      {(rootPost.replyPrivacy || rootPost.reply_privacy) === 'FOLLOWING'
                        ? 'Chỉ người được theo dõi'
                        : 'Chỉ người được nhắc đến'}
                    </span>
                  )}
                <span className="text-ash">Pulse Microblogging Engine</span>
              </div>
            </div>

            {/* Stats row (13px/400 #424242, 1px #d5d5d5 border-b) */}
            <div className="flex items-center gap-6 py-2.5 border-b border-cloud text-[13px] text-graphite">
              <div>
                <strong className="text-ink font-semibold">
                  {formatCount(rootPost.repliesCount)}
                </strong>{' '}
                trả lời
              </div>
              <div>
                <strong className="text-ink font-semibold">
                  {formatCount(repostsCount)}
                </strong>{' '}
                đăng lại
              </div>
              <div>
                <strong className="text-ink font-semibold">
                  {formatCount(likesCount)}
                </strong>{' '}
                thích
              </div>
            </div>

            {/* Engagement Action Bar */}
            <div className="flex items-center justify-around pt-2 text-ash">
              {/* Like */}
              <button
                onClick={handleToggleLike}
                className={`flex items-center gap-1.5 p-1.5 focus:outline-none transition-colors ${
                  isLiked ? 'text-ink' : 'text-ash hover:text-ink'
                }`}
                title="Thích"
              >
                <Heart
                  className={`w-5 h-5 stroke-[1.8] ${
                    isLiked ? 'fill-ink text-ink' : ''
                  }`}
                />
                <span className="text-[13px] text-graphite font-normal tabular-nums">
                  {formatCount(likesCount)}
                </span>
              </button>

              {/* Repost / Quote Menu */}
              <div className="relative" ref={repostMenuRef}>
                <button
                  onClick={() => setShowRepostMenu((prev) => !prev)}
                  className={`flex items-center gap-1.5 p-1.5 focus:outline-none transition-colors ${
                    isReposted ? 'text-ink' : 'text-ash hover:text-ink'
                  }`}
                  title="Đăng lại hoặc trích dẫn"
                >
                  <Repeat className="w-5 h-5 stroke-[1.8]" />
                  <span className="text-[13px] text-graphite font-normal tabular-nums">
                    {formatCount(repostsCount)}
                  </span>
                </button>

                {showRepostMenu && (
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-44 bg-paper border border-cloud rounded-[14px] shadow-xl p-1.5 z-30 animate-scale-up">
                    <button
                      type="button"
                      onClick={() => {
                        setShowRepostMenu(false);
                        handleToggleRepost();
                      }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-[14px] font-semibold text-ink hover:bg-mist rounded-[8px] transition-colors"
                    >
                      <Repeat className="w-4 h-4 text-ink" />
                      <span>{isReposted ? 'Hủy đăng lại' : 'Đăng lại'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
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

              {/* Bookmark */}
              <button
                onClick={handleToggleBookmark}
                disabled={isBookmarkLoading}
                className={`p-1.5 focus:outline-none transition-colors ${
                  isBookmarked ? 'text-ink' : 'text-ash hover:text-ink'
                }`}
                title={isBookmarked ? 'Bỏ lưu bài viết' : 'Lưu bài viết'}
              >
                <Bookmark
                  className={`w-5 h-5 stroke-[1.8] ${
                    isBookmarked ? 'fill-ink text-ink' : ''
                  }`}
                />
              </button>

              {/* Share */}
              <button
                onClick={handleShare}
                className="p-1.5 text-ash hover:text-ink focus:outline-none transition-colors"
                title="Chia sẻ"
              >
                <Send className="w-5 h-5 stroke-[1.8]" />
              </button>
            </div>
          </article>

          {/* Inline Reply Composer */}
          <div className="bg-paper">
            <PostComposerCard
              replyToPost={rootPost}
              placeholder={`Trả lời @${rootPost.author.username}...`}
              onPostCreated={handleReplyCreated}
              onOptimisticCreate={handleOptimisticReplyCreate}
              onOptimisticRollback={handleOptimisticReplyRollback}
              disabled={!replyPermission.canReply}
              disabledReason={replyPermission.reason}
            />
          </div>

          {/* Thread Replies List */}
          <div className="divide-y divide-cloud">
            {replies.map((reply) => (
              <PostFeedItem
                key={reply.id}
                post={reply}
                isThreadChild={true}
                onReplyClick={() => {
                  window.scrollTo({ top: 300, behavior: 'smooth' });
                }}
              />
            ))}
          </div>

          {/* Quote Modal for Root Post */}
          <QuotePostModal
            post={rootPost}
            isOpen={isQuoteModalOpen}
            onClose={() => setIsQuoteModalOpen(false)}
            onPostCreated={() => {
              setIsQuoteModalOpen(false);
              navigateTo('home');
            }}
          />
        </div>
      )}
    </div>
  );
};

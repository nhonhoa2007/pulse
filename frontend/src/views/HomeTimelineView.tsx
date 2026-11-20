import React, { useState, useEffect, useCallback, useRef } from 'react';
import { PostDto } from '../types/PulseTypes';
import { usePulse } from '../context/PulseContext';
import { api } from '../api/PulseApiClient';
import { PostComposerCard } from '../components/PostComposerCard';
import { PostFeedItem } from '../components/PostFeedItem';
import { LiveFeedToastIndicator } from '../components/LiveFeedToastIndicator';
import { useViewportImpressionTracker } from '../utils/useViewportImpressionTracker';
import { useInfiniteScrollTrigger } from '../utils/useInfiniteScrollTrigger';
import { RefreshCw, Inbox, AlertCircle, Loader2 } from 'lucide-react';

interface FeedCacheEntry {
  posts: PostDto[];
  nextCursor: string | null;
  scrollY: number;
}

const feedCache = new Map<string, FeedCacheEntry>();

export const HomeTimelineView: React.FC = () => {
  const { currentUser } = usePulse();

  const [activeTab, setActiveTab] = useState<'forYou' | 'following'>('forYou');
  const [posts, setPosts] = useState<PostDto[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestGenerationRef = useRef(0);
  const requestInFlightRef = useRef(false);
  const cacheKey = `${currentUser.id || 'guest'}:${activeTab}`;

  // Viewport impression tracker beacon (threshold >= 0.5, batching every 2.5s)
  const { observePostElement } = useViewportImpressionTracker({
    batchIntervalMs: 2500,
    threshold: 0.5,
    enabled: true,
  });

  const fetchFeed = useCallback(
    async (isManualRefresh = false, cursor?: string) => {
      if (requestInFlightRef.current) return;
      requestInFlightRef.current = true;
      const generation = ++requestGenerationRef.current;
      const isPagination = Boolean(cursor);
      if (isManualRefresh) {
        setIsRefreshing(true);
      } else if (isPagination) {
        setIsLoadingMore(true);
      } else {
        setIsLoading(true);
      }
      setError(null);

      try {
        const page = activeTab === 'forYou'
          ? await api.getForYouFeed(cursor)
          : await api.getHomeFeed(cursor);
        if (generation !== requestGenerationRef.current) return;
        setPosts((previous) => {
          if (!isPagination) return page.posts;
          const knownIds = new Set(previous.map((post) => post.id));
          return [...previous, ...page.posts.filter((post) => !knownIds.has(post.id))];
        });
        setNextCursor(page.nextCursor);
      } catch (err: any) {
        if (generation !== requestGenerationRef.current) return;
        console.error('Failed to load feed:', err);
        setError(err.message || 'Không thể tải bảng tin. Vui lòng thử lại!');
      } finally {
        if (generation === requestGenerationRef.current) {
          setIsLoading(false);
          setIsRefreshing(false);
          setIsLoadingMore(false);
          requestInFlightRef.current = false;
        }
      }
    },
    [activeTab]
  );

  useEffect(() => {
    requestGenerationRef.current += 1;
    requestInFlightRef.current = false;
    const cached = feedCache.get(cacheKey);
    if (cached) {
      setPosts(cached.posts);
      setNextCursor(cached.nextCursor);
      setError(null);
      setIsLoading(false);
      requestAnimationFrame(() => window.scrollTo({ top: cached.scrollY }));
    } else {
      setPosts([]);
      setNextCursor(null);
      void fetchFeed();
    }
  }, [fetchFeed, cacheKey]);

  useEffect(() => {
    return () => {
      feedCache.set(cacheKey, { posts, nextCursor, scrollY: window.scrollY });
    };
  }, [cacheKey, posts, nextCursor]);

  const loadMore = useCallback(() => {
    if (nextCursor && !isLoadingMore && !isLoading) {
      void fetchFeed(false, nextCursor);
    }
  }, [nextCursor, isLoadingMore, isLoading, fetchFeed]);

  const loadMoreRef = useInfiniteScrollTrigger({
    enabled: Boolean(nextCursor) && !isLoading && !isLoadingMore,
    onLoadMore: loadMore,
  });

  const handleOptimisticCreate = (tempPost: PostDto) => {
    setPosts((prev) => [tempPost, ...prev]);
  };

  const handleOptimisticRollback = (tempId: string) => {
    setPosts((prev) => prev.filter((p) => p.id !== tempId));
  };

  const handlePostCreated = (newPost: PostDto) => {
    setPosts((prev) => {
      const tempIndex = prev.findIndex(
        (p) => p.id.startsWith('temp-') || p.id === newPost.id
      );
      if (tempIndex >= 0) {
        const copy = [...prev];
        copy[tempIndex] = newPost;
        return copy;
      }
      return [newPost, ...prev];
    });
  };

  const handlePostUpdated = (updatedPost: PostDto) => {
    setPosts((prev) =>
      prev.map((p) => (p.id === updatedPost.id ? updatedPost : p))
    );
  };

  const handleRefresh = () => {
    feedCache.delete(cacheKey);
    void fetchFeed(true);
  };

  return (
    <div className="min-w-0 flex-1 min-h-screen pb-20 md:pb-8 bg-paper">
      {/* Top Header Bar (~53px tall, background Paper White #fafafa, centered section title in 15px/600 #000000) */}
      <header className="sticky top-0 z-20 bg-paper/95 backdrop-blur-md border-b border-cloud/60">
        <div className="flex items-center justify-between h-[53px] px-4">
          <div className="w-8">
            <span className="text-[11px] font-semibold tracking-wider uppercase text-ash hidden sm:inline">
              Pulse
            </span>
          </div>

          <h1 className="text-[15px] font-semibold text-ink text-center">
            Trang chủ
          </h1>

          <div className="w-8 flex justify-end">
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="p-1.5 text-ash hover:text-ink rounded-full hover:bg-mist transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-meta"
              title="Tải lại bảng tin"
            >
              <RefreshCw
                className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-ink' : ''}`}
              />
            </button>
          </div>
        </div>

        {/* Dual Pill Switcher: Dành cho bạn vs Đang theo dõi (Threads Light Theme) */}
        <div
          className="py-2.5 px-4 flex items-center justify-center border-t border-cloud/50 bg-paper"
          data-testid="feed-tab-switcher"
        >
          <div
            className="inline-flex p-1 bg-mist rounded-full border border-cloud/60 max-w-sm w-full sm:w-auto"
            role="tablist"
            aria-label="Bảng tin"
          >
            <button
              role="tab"
              id="tab-for-you"
              data-testid="tab-for-you"
              aria-selected={activeTab === 'forYou'}
              onClick={() => setActiveTab('forYou')}
              className={`flex-1 sm:flex-none px-6 py-1.5 rounded-full text-[14px] font-semibold transition-all duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-meta select-none ${
                activeTab === 'forYou'
                  ? 'bg-ink text-paper shadow-sm'
                  : 'text-graphite hover:text-ink'
              }`}
            >
              Dành cho bạn
            </button>

            <button
              role="tab"
              id="tab-following"
              data-testid="tab-following"
              aria-selected={activeTab === 'following'}
              onClick={() => setActiveTab('following')}
              className={`flex-1 sm:flex-none px-6 py-1.5 rounded-full text-[14px] font-semibold transition-all duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-meta select-none ${
                activeTab === 'following'
                  ? 'bg-ink text-paper shadow-sm'
                  : 'text-graphite hover:text-ink'
              }`}
            >
              Đang theo dõi
            </button>
          </div>
        </div>
      </header>

      {/* Floating SSE Realtime Indicator */}
      <LiveFeedToastIndicator onRefresh={handleRefresh} />

      {/* Post Composer Card on Top */}
      <PostComposerCard
        onPostCreated={handlePostCreated}
        onOptimisticCreate={handleOptimisticCreate}
        onOptimisticRollback={handleOptimisticRollback}
      />

      {/* Content Feed Section */}
      {isLoading ? (
        <div className="divide-y divide-cloud">
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className="p-4 flex gap-3 animate-pulse bg-paper">
              <div className="w-10 h-10 rounded-full bg-mist shrink-0" />
              <div className="flex-1 space-y-3">
                <div className="h-4 bg-mist rounded w-1/3" />
                <div className="h-3 bg-mist rounded w-3/4" />
                <div className="h-3 bg-mist rounded w-1/2" />
              </div>
            </div>
          ))}
        </div>
      ) : error && posts.length === 0 ? (
        <div className="py-16 px-4 text-center">
          <AlertCircle className="w-8 h-8 text-graphite mx-auto mb-2" />
          <p className="text-ink font-semibold text-[15px] mb-1">
            Không thể tải bài viết
          </p>
          <p className="text-graphite text-[13px] mb-4">{error}</p>
          <button
            onClick={() => fetchFeed()}
            className="px-4 py-2 bg-ink text-paper rounded-full text-[13px] font-semibold hover:bg-ink/85 transition-colors"
          >
            Thử lại
          </button>
        </div>
      ) : posts.length === 0 ? (
        <div className="py-16 px-4 text-center">
          <div className="w-12 h-12 rounded-full bg-mist flex items-center justify-center mx-auto mb-3 text-ash">
            <Inbox className="w-6 h-6" />
          </div>
          <p className="text-ink font-semibold text-[15px] mb-1">
            Chưa có bài viết nào
          </p>
          <p className="text-graphite text-[13px] max-w-xs mx-auto mb-4">
            {activeTab === 'following'
              ? 'Hãy theo dõi thêm người dùng hoặc chuyển sang tab "Dành cho bạn" để khám phá thêm nội dung.'
              : 'Hãy là người đầu tiên đăng bài trên Pulse!'}
          </p>
        </div>
      ) : (
        <>
          <div className="divide-y divide-cloud">
            {posts.map((post) => (
              <PostFeedItem
                key={post.id}
                post={post}
                onPostUpdated={handlePostUpdated}
                observeImpression={observePostElement}
              />
            ))}
          </div>
          <div ref={loadMoreRef} className="min-h-16 flex items-center justify-center" aria-live="polite">
            {isLoadingMore ? (
              <span className="inline-flex items-center gap-2 text-[13px] text-graphite">
                <Loader2 className="w-4 h-4 animate-spin" /> Đang tải thêm…
              </span>
            ) : nextCursor ? null : (
              <span className="text-[12px] text-ash">Bạn đã xem hết bảng tin.</span>
            )}
          </div>
          {error && posts.length > 0 && (
            <div className="px-4 pb-6 text-center">
              <p className="text-[13px] text-graphite mb-2">{error}</p>
              <button
                onClick={loadMore}
                className="px-4 py-2 rounded-full border border-cloud text-[13px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-meta"
              >
                Thử tải lại
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

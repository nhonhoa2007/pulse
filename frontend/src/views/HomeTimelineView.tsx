import React, { useState, useEffect, useCallback } from 'react';
import { PostDto } from '../types/PulseTypes';
import { usePulse } from '../context/PulseContext';
import { api } from '../api/PulseApiClient';
import { PostComposerCard } from '../components/PostComposerCard';
import { PostFeedItem } from '../components/PostFeedItem';
import { LiveFeedToastIndicator } from '../components/LiveFeedToastIndicator';
import { useViewportImpressionTracker } from '../utils/useViewportImpressionTracker';
import { RefreshCw, Inbox, AlertCircle } from 'lucide-react';

export const HomeTimelineView: React.FC = () => {
  const { currentUser } = usePulse();

  const [activeTab, setActiveTab] = useState<'forYou' | 'following'>('forYou');
  const [posts, setPosts] = useState<PostDto[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Viewport impression tracker beacon (threshold >= 0.5, batching every 2.5s)
  const { observePostElement } = useViewportImpressionTracker({
    batchIntervalMs: 2500,
    threshold: 0.5,
    enabled: true,
  });

  const fetchFeed = useCallback(
    async (isManualRefresh = false) => {
      if (isManualRefresh) {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }
      setError(null);

      try {
        let feedData: PostDto[];
        if (activeTab === 'forYou') {
          feedData = await api.getForYouFeed();
        } else {
          feedData = await api.getHomeFeed();
        }
        setPosts(feedData);
      } catch (err: any) {
        console.error('Failed to load feed:', err);
        setError(err.message || 'Không thể tải bảng tin. Vui lòng thử lại!');
        if (posts.length === 0) {
          setPosts(getFallbackFeed());
        }
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [activeTab]
  );

  useEffect(() => {
    fetchFeed();
  }, [fetchFeed, currentUser.id]);

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
    fetchFeed(true);
  };

  return (
    <div className="min-w-0 flex-1 min-h-screen pb-20 md:pb-8 bg-[#fafafa]">
      {/* Top Header Bar (~53px tall, background Paper White #fafafa, centered section title in 15px/600 #000000) */}
      <header className="sticky top-0 z-20 bg-[#fafafa]/95 backdrop-blur-md border-b border-[#d5d5d5]/60">
        <div className="flex items-center justify-between h-[53px] px-4">
          <div className="w-8">
            <span className="text-[11px] font-semibold tracking-wider uppercase text-[#969696] hidden sm:inline">
              Pulse
            </span>
          </div>

          <h1 className="text-[15px] font-semibold text-[#000000] text-center">
            Trang chủ
          </h1>

          <div className="w-8 flex justify-end">
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="p-1.5 text-[#969696] hover:text-[#000000] rounded-full hover:bg-[#efefef] transition-colors focus:outline-none"
              title="Tải lại bảng tin"
            >
              <RefreshCw
                className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-[#000000]' : ''}`}
              />
            </button>
          </div>
        </div>

        {/* Dual Pill Switcher: Dành cho bạn vs Đang theo dõi (Threads Light Theme) */}
        <div
          className="py-2.5 px-4 flex items-center justify-center border-t border-[#d5d5d5]/50 bg-[#fafafa]"
          data-testid="feed-tab-switcher"
        >
          <div
            className="inline-flex p-1 bg-[#efefef] rounded-full border border-[#d5d5d5]/60 max-w-sm w-full sm:w-auto"
            role="tablist"
            aria-label="Bảng tin"
          >
            <button
              role="tab"
              id="tab-for-you"
              data-testid="tab-for-you"
              aria-selected={activeTab === 'forYou'}
              onClick={() => setActiveTab('forYou')}
              className={`flex-1 sm:flex-none px-6 py-1.5 rounded-full text-[14px] font-semibold transition-all duration-200 focus:outline-none select-none ${
                activeTab === 'forYou'
                  ? 'bg-[#000000] text-[#fafafa] shadow-sm'
                  : 'text-[#424242] hover:text-[#000000]'
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
              className={`flex-1 sm:flex-none px-6 py-1.5 rounded-full text-[14px] font-semibold transition-all duration-200 focus:outline-none select-none ${
                activeTab === 'following'
                  ? 'bg-[#000000] text-[#fafafa] shadow-sm'
                  : 'text-[#424242] hover:text-[#000000]'
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
        <div className="divide-y divide-[#d5d5d5]">
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className="p-4 flex gap-3 animate-pulse bg-[#fafafa]">
              <div className="w-10 h-10 rounded-full bg-[#efefef] shrink-0" />
              <div className="flex-1 space-y-3">
                <div className="h-4 bg-[#efefef] rounded w-1/3" />
                <div className="h-3 bg-[#efefef] rounded w-3/4" />
                <div className="h-3 bg-[#efefef] rounded w-1/2" />
              </div>
            </div>
          ))}
        </div>
      ) : error && posts.length === 0 ? (
        <div className="py-16 px-4 text-center">
          <AlertCircle className="w-8 h-8 text-[#424242] mx-auto mb-2" />
          <p className="text-[#000000] font-semibold text-[15px] mb-1">
            Không thể tải bài viết
          </p>
          <p className="text-[#424242] text-[13px] mb-4">{error}</p>
          <button
            onClick={() => fetchFeed()}
            className="px-4 py-2 bg-[#000000] text-[#fafafa] rounded-full text-[13px] font-semibold hover:bg-[#000000]/85 transition-colors"
          >
            Thử lại
          </button>
        </div>
      ) : posts.length === 0 ? (
        <div className="py-16 px-4 text-center">
          <div className="w-12 h-12 rounded-full bg-[#efefef] flex items-center justify-center mx-auto mb-3 text-[#969696]">
            <Inbox className="w-6 h-6" />
          </div>
          <p className="text-[#000000] font-semibold text-[15px] mb-1">
            Chưa có bài viết nào
          </p>
          <p className="text-[#424242] text-[13px] max-w-xs mx-auto mb-4">
            {activeTab === 'following'
              ? 'Hãy theo dõi thêm người dùng hoặc chuyển sang tab "Dành cho bạn" để khám phá thêm nội dung.'
              : 'Hãy là người đầu tiên đăng bài trên Pulse!'}
          </p>
        </div>
      ) : (
        <div className="divide-y divide-[#d5d5d5]">
          {posts.map((post) => (
            <PostFeedItem
              key={post.id}
              post={post}
              onPostUpdated={handlePostUpdated}
              observeImpression={observePostElement}
            />
          ))}
        </div>
      )}
    </div>
  );
};

// Fallback initial posts for instant preview
function getFallbackFeed(): PostDto[] {
  return [
    {
      id: 'mock-post-1',
      authorId: '44444444-4444-4444-4444-444444444444',
      content:
        'Một ngày thật tuyệt vời cùng các bạn Sky! Hẹn gặp tối nay nhé ✨ #Sky #Concert',
      mediaUrls: [
        'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=800',
      ],
      replyToId: null,
      rootPostId: null,
      repostOfId: null,
      quoteOfId: null,
      likesCount: 12500,
      repliesCount: 420,
      repostsCount: 3400,
      quotesCount: 150,
      hashtags: ['Sky', 'Concert'],
      mentions: [],
      createdAt: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
      author: {
        id: '44444444-4444-4444-4444-444444444444',
        username: 'sontungmtp',
        displayName: 'Sơn Tùng M-TP',
        avatarUrl:
          'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150',
        isCelebrity: true,
      },
      isLiked: false,
      isReposted: false,
    },
  ];
}

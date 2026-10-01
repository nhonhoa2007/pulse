/**
 * PKG-03: Trang Bookmarks độc lập — kho bài viết đã lưu của người dùng.
 */
import React, { useState, useCallback, useEffect } from 'react';
import { Bookmark, AlertCircle, RefreshCw } from 'lucide-react';
import { PostDto } from '../types/PulseTypes';
import { usePulse } from '../context/PulseContext';
import { api } from '../api/PulseApiClient';
import { PostFeedItem } from '../components/PostFeedItem';

export const BookmarksView: React.FC = () => {
  const { currentUser } = usePulse();
  const [posts, setPosts] = useState<PostDto[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchBookmarks = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.getBookmarks();
      setPosts(data);
    } catch (err: any) {
      setError(err?.message || 'Không thể tải danh sách đã lưu');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBookmarks();
  }, [fetchBookmarks]);

  const handlePostUpdated = useCallback((updated: PostDto) => {
    setPosts((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
  }, []);

  if (!currentUser?.id) {
    return (
      <div className="max-w-feed mx-auto pt-8 px-4 text-center" data-testid="bookmarks-view">
        <p className="text-graphite text-[14px]">Đăng nhập để xem bài viết đã lưu.</p>
      </div>
    );
  }

  return (
    <div className="max-w-feed mx-auto pt-8 px-4 pb-24" data-testid="bookmarks-view">
      <header className="flex items-center justify-between mb-4">
        <h1 className="text-[22px] font-bold text-ink flex items-center gap-2">
          <Bookmark className="w-5 h-5 fill-ink" />
          Đã lưu
        </h1>
        <button
          onClick={fetchBookmarks}
          className="p-2 rounded-full text-ash hover:text-ink hover:bg-mist transition-colors"
          title="Làm mới"
          aria-label="Làm mới danh sách đã lưu"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
        </button>
      </header>

      {isLoading ? (
        <div className="divide-y divide-cloud">
          {[1, 2, 3].map((n) => (
            <div key={n} className="p-4 flex gap-3 animate-pulse bg-paper">
              <div className="w-10 h-10 rounded-full bg-mist shrink-0" />
              <div className="flex-1 space-y-3">
                <div className="h-4 bg-mist rounded w-1/3" />
                <div className="h-3 bg-mist rounded w-3/4" />
              </div>
            </div>
          ))}
        </div>
      ) : error && posts.length === 0 ? (
        <div className="py-16 px-4 text-center">
          <AlertCircle className="w-8 h-8 text-graphite mx-auto mb-2" />
          <p className="text-ink font-semibold text-[15px] mb-4">{error}</p>
          <button
            onClick={fetchBookmarks}
            className="px-4 py-2 bg-ink text-paper rounded-full text-[13px] font-semibold hover:bg-ink/85 transition-colors"
          >
            Thử lại
          </button>
        </div>
      ) : posts.length === 0 ? (
        <div className="py-16 px-4 text-center">
          <div className="w-12 h-12 rounded-full bg-mist flex items-center justify-center mx-auto mb-3 text-ash">
            <Bookmark className="w-6 h-6" />
          </div>
          <p className="text-ink font-semibold text-[15px] mb-1">Chưa có bài viết nào được lưu</p>
          <p className="text-graphite text-[13px] max-w-xs mx-auto">
            Nhấn biểu tượng đánh dấu trên bất kỳ bài viết nào để lưu lại tại đây.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-cloud" data-testid="bookmarks-list">
          {posts.map((post) => (
            <PostFeedItem
              key={post.id}
              post={post}
              onPostUpdated={handlePostUpdated}
            />
          ))}
        </div>
      )}
    </div>
  );
};

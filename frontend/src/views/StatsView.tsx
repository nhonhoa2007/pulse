/**
 * PKG-14: Creator Dashboard — thống kê views/engagement của tác giả.
 */
import React, { useState, useCallback, useEffect } from 'react';
import { BarChart3, Eye, Heart, Users, TrendingUp, AlertCircle } from 'lucide-react';
import { usePulse } from '../context/PulseContext';
import { api } from '../api/PulseApiClient';
import { formatCount } from '../utils/formatters';

interface CreatorStats {
  totals: {
    posts: number;
    views: number;
    likes: number;
    replies: number;
    reposts: number;
    quotes: number;
    followers: number;
    following: number;
  };
  windows: Record<string, { posts: number; views: number; likes: number; engagement: number }>;
  topPosts: Array<{
    id: string;
    content: string;
    viewsCount: number;
    likesCount: number;
    engagementRate: number;
    createdAt: string;
  }>;
}

const WINDOW_LABELS: Record<string, string> = {
  last24h: '24 giờ qua',
  last7d: '7 ngày qua',
  last28d: '28 ngày qua',
};

export const StatsView: React.FC = () => {
  const { currentUser, navigateTo } = usePulse();
  const [stats, setStats] = useState<CreatorStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchStats = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.getMyStats();
      setStats(data as CreatorStats);
    } catch (err: any) {
      setError(err?.message || 'Không thể tải thống kê');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  if (!currentUser?.id) {
    return (
      <div className="max-w-feed mx-auto pt-8 px-4 text-center" data-testid="stats-view">
        <p className="text-graphite text-[14px]">Đăng nhập để xem thống kê của bạn.</p>
      </div>
    );
  }

  return (
    <div className="max-w-feed mx-auto pt-8 px-4 pb-24" data-testid="stats-view">
      <header className="flex items-center gap-2 mb-5">
        <BarChart3 className="w-5 h-5 text-ink" />
        <h1 className="text-[22px] font-bold text-ink">Thống kê của tôi</h1>
      </header>

      {isLoading ? (
        <div className="space-y-3 animate-pulse">
          <div className="h-24 bg-mist rounded-[14px]" />
          <div className="h-24 bg-mist rounded-[14px]" />
        </div>
      ) : error || !stats ? (
        <div className="py-16 px-4 text-center">
          <AlertCircle className="w-8 h-8 text-graphite mx-auto mb-2" />
          <p className="text-ink font-semibold text-[15px] mb-4">{error || 'Không có dữ liệu'}</p>
          <button
            onClick={fetchStats}
            className="px-4 py-2 bg-ink text-paper rounded-full text-[13px] font-semibold hover:bg-ink/85 transition-colors"
          >
            Thử lại
          </button>
        </div>
      ) : (
        <div className="space-y-5">
          {/* Totals */}
          <div className="grid grid-cols-2 gap-3" data-testid="stats-totals">
            <div className="border border-cloud rounded-[14px] p-4">
              <div className="flex items-center gap-2 text-ash text-[12px] uppercase tracking-wide mb-1">
                <Eye className="w-3.5 h-3.5" /> Lượt xem
              </div>
              <p className="text-[22px] font-bold text-ink">{formatCount(stats.totals.views)}</p>
            </div>
            <div className="border border-cloud rounded-[14px] p-4">
              <div className="flex items-center gap-2 text-ash text-[12px] uppercase tracking-wide mb-1">
                <Heart className="w-3.5 h-3.5" /> Lượt thích
              </div>
              <p className="text-[22px] font-bold text-ink">{formatCount(stats.totals.likes)}</p>
            </div>
            <div className="border border-cloud rounded-[14px] p-4">
              <div className="flex items-center gap-2 text-ash text-[12px] uppercase tracking-wide mb-1">
                <Users className="w-3.5 h-3.5" /> Người theo dõi
              </div>
              <p className="text-[22px] font-bold text-ink">{formatCount(stats.totals.followers)}</p>
            </div>
            <div className="border border-cloud rounded-[14px] p-4">
              <div className="flex items-center gap-2 text-ash text-[12px] uppercase tracking-wide mb-1">
                <TrendingUp className="w-3.5 h-3.5" /> Bài viết
              </div>
              <p className="text-[22px] font-bold text-ink">{formatCount(stats.totals.posts)}</p>
            </div>
          </div>

          {/* Windows */}
          <div className="space-y-2" data-testid="stats-windows">
            <h2 className="text-[15px] font-bold text-ink">Hiệu suất gần đây</h2>
            {Object.entries(stats.windows).map(([key, w]) => (
              <div key={key} className="flex items-center justify-between border border-cloud rounded-[14px] px-4 py-3">
                <span className="text-[13px] font-semibold text-ink">{WINDOW_LABELS[key] || key}</span>
                <span className="text-[13px] text-graphite">
                  {w.posts} bài · {formatCount(w.views)} xem · {w.engagement}% engagement
                </span>
              </div>
            ))}
          </div>

          {/* Top posts */}
          <div className="space-y-2" data-testid="stats-top-posts">
            <h2 className="text-[15px] font-bold text-ink">Bài xem nhiều nhất</h2>
            {stats.topPosts.length === 0 ? (
              <p className="text-graphite text-[13px]">Chưa có bài viết nào.</p>
            ) : (
              stats.topPosts.map((p) => (
                <button
                  key={p.id}
                  onClick={() => navigateTo('thread', { postId: p.id })}
                  className="w-full text-left border border-cloud rounded-[14px] px-4 py-3 hover:bg-mist/50 transition-colors"
                >
                  <p className="text-[14px] text-ink line-clamp-2">{p.content}</p>
                  <p className="text-[12px] text-ash mt-1">
                    {formatCount(p.viewsCount)} xem · {formatCount(p.likesCount)} thích · {p.engagementRate}% engagement
                  </p>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};

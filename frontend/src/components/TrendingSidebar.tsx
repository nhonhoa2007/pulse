import { ProtectedMedia } from "./ProtectedMedia";
import React, { useCallback, useEffect, useState } from 'react';
import { usePulse } from '../context/PulseContext';
import { api } from '../api/PulseApiClient';
import { TrendingItemDto } from '../types/PulseTypes';
import { Loader2, RefreshCw, TrendingUp, User } from 'lucide-react';

export const TrendingSidebar: React.FC = () => {
  const { currentUser, navigateTo, isAuthenticated } = usePulse();
  const [topics, setTopics] = useState<TrendingItemDto[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadTrending = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setTopics((await api.getTrending()).slice(0, 8));
    } catch (loadError: any) {
      setTopics([]);
      setError(loadError.message || 'Không thể tải chủ đề thịnh hành.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTrending();
  }, [loadTrending]);

  return (
    <aside className="hidden lg:flex flex-col gap-5 w-72 xl:w-80 p-4 sticky top-0 h-screen overflow-y-auto">
      <section className="p-4 bg-paper border border-cloud rounded-[12px]" aria-labelledby="trending-title">
        <div className="flex items-center justify-between mb-3">
          <h2 id="trending-title" className="inline-flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-graphite">
            <TrendingUp className="w-4 h-4 text-meta" />
            Đang thịnh hành
          </h2>
          <button
            type="button"
            onClick={() => void loadTrending()}
            disabled={isLoading}
            className="p-1.5 rounded-full text-ash hover:text-ink hover:bg-mist disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-meta"
            aria-label="Tải lại chủ đề thịnh hành"
          >
            {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          </button>
        </div>

        {error ? (
          <div className="text-[12px] text-graphite">
            <p>{error}</p>
            <button type="button" onClick={() => void loadTrending()} className="mt-2 font-semibold text-ink underline underline-offset-2">
              Thử lại
            </button>
          </div>
        ) : !isLoading && topics.length === 0 ? (
          <p className="text-[12px] text-graphite">Chưa có chủ đề công khai nào trong 48 giờ qua.</p>
        ) : (
          <ol className="space-y-1">
            {topics.map((topic, index) => (
              <li key={topic.tag}>
                <button
                  type="button"
                  onClick={() => navigateTo('explore', { hashtag: topic.tag })}
                  className="w-full flex items-center gap-3 p-2.5 rounded-[8px] text-left hover:bg-mist transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-meta"
                >
                  <span className="w-5 text-[11px] text-ash tabular-nums">{index + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold text-ink">#{topic.tag}</span>
                    <span className="block text-[11px] text-graphite">{topic.postsCount} bài viết</span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        )}
      </section>

      {isAuthenticated && currentUser.id && (
        <section className="p-4 bg-paper border border-cloud rounded-[12px]" aria-labelledby="account-title">
          <h2 id="account-title" className="text-[12px] font-semibold uppercase tracking-wider text-graphite mb-3">
            Tài khoản của bạn
          </h2>
          <button
            type="button"
            onClick={() => navigateTo('profile', { username: currentUser.username, tab: 'posts' })}
            className="w-full flex items-center gap-3 p-2 rounded-[8px] hover:bg-mist text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-meta"
          >
            {currentUser.avatarUrl ? (
              <ProtectedMedia src={currentUser.avatarUrl} alt="" className="w-9 h-9 rounded-full object-cover" />
            ) : (
              <span className="w-9 h-9 rounded-full bg-mist flex items-center justify-center">
                <User className="w-4 h-4 text-graphite" />
              </span>
            )}
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-semibold text-ink">{currentUser.displayName}</span>
              <span className="block truncate text-[11px] text-graphite">@{currentUser.username}</span>
            </span>
          </button>
        </section>
      )}

      <footer className="px-2 text-[12px] text-ash">Pulse © 2026</footer>
    </aside>
  );
};

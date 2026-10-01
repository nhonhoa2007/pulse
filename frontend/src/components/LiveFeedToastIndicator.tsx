import React from 'react';
import { usePulse } from '../context/PulseContext';
import { ArrowUp } from 'lucide-react';

interface LiveFeedToastIndicatorProps {
  onRefresh: () => void;
}

export const LiveFeedToastIndicator: React.FC<LiveFeedToastIndicatorProps> = ({ onRefresh }) => {
  const { hasNewTimelinePosts, setHasNewTimelinePosts } = usePulse();

  if (!hasNewTimelinePosts) return null;

  const handleClick = () => {
    setHasNewTimelinePosts(false);
    onRefresh();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="sticky top-16 z-30 flex justify-center py-2 pointer-events-none animate-slide-down">
      <button
        onClick={handleClick}
        className="pointer-events-auto flex items-center gap-2 px-4 py-2 bg-paper hover:bg-mist text-ink text-[13px] font-semibold rounded-full shadow-[0_4px_16px_rgba(0,0,0,0.08)] border border-cloud transition-all duration-150 active:scale-95 group focus:outline-none"
      >
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-meta opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2 w-2 bg-meta"></span>
        </span>
        <span>Có bài viết mới</span>
        <ArrowUp className="w-3.5 h-3.5 text-graphite group-hover:-translate-y-0.5 transition-transform" />
      </button>
    </div>
  );
};

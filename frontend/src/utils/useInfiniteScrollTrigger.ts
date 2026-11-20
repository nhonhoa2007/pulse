import { useEffect, useRef } from 'react';

interface InfiniteScrollOptions {
  enabled: boolean;
  onLoadMore: () => void;
  rootMargin?: string;
}

export function useInfiniteScrollTrigger({
  enabled,
  onLoadMore,
  rootMargin = '400px 0px',
}: InfiniteScrollOptions) {
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const callbackRef = useRef(onLoadMore);
  callbackRef.current = onLoadMore;

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!enabled || !sentinel || typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) callbackRef.current();
      },
      { rootMargin }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [enabled, rootMargin]);

  return sentinelRef;
}

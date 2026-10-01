import { useEffect, useRef, useCallback } from 'react';
import { api } from '../api/PulseApiClient.ts';

/**
 * Format numbers to compact view counts (e.g. 0 -> '0', 42 -> '42', 1200 -> '1.2K', 1500000 -> '1.5M')
 */
export function formatViewsCount(count: number | undefined | null): string {
  if (count === undefined || count === null || count <= 0) {
    return '0';
  }
  if (count < 1000) {
    return count.toString();
  }
  if (count < 1000000) {
    const formatted = (count / 1000).toFixed(count < 10000 ? 1 : 0);
    return `${formatted.replace(/\.0$/, '')}K`;
  }
  const formatted = (count / 1000000).toFixed(1);
  return `${formatted.replace(/\.0$/, '')}M`;
}

/**
 * Format views badge text according to spec (e.g. '42', '1.2K views', '2.5M views')
 */
export function formatViewsBadge(count: number | undefined | null): string {
  if (count === undefined || count === null || count <= 0) {
    return '0';
  }
  if (count < 1000) {
    return count.toString();
  }
  const compact = formatViewsCount(count);
  return `${compact} views`;
}

/**
 * In-memory impression batch deduplication buffer
 */
export class ImpressionBatchBuffer {
  private pendingIds = new Set<string>();
  private sentIds = new Set<string>();

  public add(postId: string): boolean {
    if (!postId || this.sentIds.has(postId) || this.pendingIds.has(postId)) {
      return false;
    }
    this.pendingIds.add(postId);
    return true;
  }

  public flush(): string[] {
    if (this.pendingIds.size === 0) return [];
    const batch = Array.from(this.pendingIds);
    batch.forEach((id) => this.sentIds.add(id));
    this.pendingIds.clear();
    return batch;
  }

  public hasPending(): boolean {
    return this.pendingIds.size > 0;
  }

  public getPendingCount(): number {
    return this.pendingIds.size;
  }

  public isAlreadyRecorded(postId: string): boolean {
    return this.sentIds.has(postId) || this.pendingIds.has(postId);
  }

  public reset(): void {
    this.pendingIds.clear();
    this.sentIds.clear();
  }
}

export interface UseViewportImpressionTrackerOptions {
  /**
   * Batch flush interval in milliseconds. Default: 2500ms (2-3s window)
   */
  batchIntervalMs?: number;
  /**
   * Visibility threshold for impression beacon. Default: 0.5 (>= 50% visible in viewport)
   */
  threshold?: number;
  /**
   * Whether tracking is enabled. Default: true
   */
  enabled?: boolean;
  /**
   * Custom beacon transport handler. Defaults to `api.recordPostViews`
   */
  onRecordViews?: (postIds: string[]) => Promise<any>;
}

export function useViewportImpressionTracker(
  options: UseViewportImpressionTrackerOptions = {}
) {
  const {
    batchIntervalMs = 2500,
    threshold = 0.5,
    enabled = true,
    onRecordViews,
  } = options;

  const bufferRef = useRef<ImpressionBatchBuffer>(new ImpressionBatchBuffer());
  const observerRef = useRef<IntersectionObserver | null>(null);
  const elementToPostIdMapRef = useRef<Map<Element, string>>(new Map());
  const postIdToElementMapRef = useRef<Map<string, Element>>(new Map());
  const timerRef = useRef<any>(null);

  // Send pending impressions to backend
  const flushBatch = useCallback(async () => {
    const batch = bufferRef.current.flush();
    if (batch.length === 0) return;

    try {
      if (onRecordViews) {
        await onRecordViews(batch);
      } else {
        await api.recordPostViews(batch);
      }
    } catch (err) {
      console.warn('Failed to dispatch post view impressions batch:', err);
    }
  }, [onRecordViews]);

  // Ref callback to register individual post elements
  const observePostElement = useCallback(
    (postId: string, element: HTMLElement | null) => {
      if (!enabled || typeof window === 'undefined') return;

      const existingEl = postIdToElementMapRef.current.get(postId);
      if (existingEl && observerRef.current) {
        observerRef.current.unobserve(existingEl);
        elementToPostIdMapRef.current.delete(existingEl);
        postIdToElementMapRef.current.delete(postId);
      }

      if (!element) return;

      // If already recorded in this session, skip observing
      if (bufferRef.current.isAlreadyRecorded(postId)) return;

      elementToPostIdMapRef.current.set(element, postId);
      postIdToElementMapRef.current.set(postId, element);

      if (observerRef.current) {
        observerRef.current.observe(element);
      }
    },
    [enabled]
  );

  // Initialize IntersectionObserver and batch timer
  useEffect(() => {
    if (!enabled || typeof window === 'undefined' || typeof IntersectionObserver === 'undefined') {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && entry.intersectionRatio >= threshold) {
            const targetEl = entry.target;
            const postId =
              elementToPostIdMapRef.current.get(targetEl) ||
              targetEl.getAttribute('data-post-id');

            if (postId) {
              const added = bufferRef.current.add(postId);
              if (added) {
                // Unobserve once viewed so we don't trigger repeatedly
                observer.unobserve(targetEl);
                elementToPostIdMapRef.current.delete(targetEl);
                postIdToElementMapRef.current.delete(postId);
              }
            }
          }
        });
      },
      {
        threshold,
      }
    );

    observerRef.current = observer;

    // Observe any previously registered elements
    elementToPostIdMapRef.current.forEach((_, el) => {
      observer.observe(el);
    });

    // Start periodic debounced batch timer (every 2-3 seconds)
    timerRef.current = setInterval(() => {
      if (bufferRef.current.hasPending()) {
        flushBatch();
      }
    }, batchIntervalMs);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
      observer.disconnect();
      observerRef.current = null;
      // Flush remaining impressions on unmount
      flushBatch();
    };
  }, [enabled, threshold, batchIntervalMs, flushBatch]);

  return {
    observePostElement,
    flushPendingViews: flushBatch,
    buffer: bufferRef.current,
  };
}

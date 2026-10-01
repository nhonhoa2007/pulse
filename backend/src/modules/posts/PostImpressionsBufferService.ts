import { prisma } from '../../db/PrismaClientSingleton.js';

export class PostImpressionsBufferService {
  private pendingCounts: Map<string, number> = new Map();
  private deduplicationCache: Map<string, number> = new Map(); // key -> expiresAt timestamp
  private flushTimer: NodeJS.Timeout | null = null;
  private pruneTimer: NodeJS.Timeout | null = null;
  private isFlushing = false;
  private readonly FLUSH_INTERVAL_MS = 5000;
  private readonly FLUSH_THRESHOLD = 100;
  private readonly DEDUP_WINDOW_MS = 30 * 60 * 1000; // 30 minutes
  private readonly MAX_CACHE_SIZE = 50000;
  private readonly MAX_PENDING_SIZE = 20000;
  private readonly MAX_BATCH_SIZE = 100;
  private readonly UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  constructor() {
    this.setupExitHooks();
  }

  public start(): void {
    if (!this.flushTimer) {
      this.flushTimer = setInterval(() => {
        this.flush().catch((err) => {
          console.error('[PostImpressionsBufferService] Periodic flush error:', err);
        });
      }, this.FLUSH_INTERVAL_MS);
      this.flushTimer.unref();
    }

    if (!this.pruneTimer) {
      this.pruneTimer = setInterval(() => {
        this.pruneExpiredCache();
      }, 5 * 60 * 1000);
      this.pruneTimer.unref();
    }
  }

  public stop(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.pruneTimer) {
      clearInterval(this.pruneTimer);
      this.pruneTimer = null;
    }
  }

  public recordViews(identifier: string, postIds: string[]): { recorded: number; buffered: number } {
    if (!Array.isArray(postIds)) {
      return { recorded: 0, buffered: this.getTotalBufferedCount() };
    }

    const now = Date.now();
    let recorded = 0;
    const boundedBatch = postIds.slice(0, this.MAX_BATCH_SIZE);

    for (const postId of boundedBatch) {
      if (!postId || typeof postId !== 'string' || !this.UUID_REGEX.test(postId)) continue;
      const key = `${identifier}:${postId}`;
      const expiresAt = this.deduplicationCache.get(key);

      if (expiresAt && expiresAt > now) {
        // Already recorded within 30 minutes, skip deduplicated
        continue;
      }

      if (this.pendingCounts.size >= this.MAX_PENDING_SIZE && !this.pendingCounts.has(postId)) {
        // Drop synthetic overflow to bound memory
        continue;
      }

      this.deduplicationCache.set(key, now + this.DEDUP_WINDOW_MS);
      const current = this.pendingCounts.get(postId) || 0;
      this.pendingCounts.set(postId, current + 1);
      recorded++;
    }

    const buffered = this.getTotalBufferedCount();

    if (buffered >= this.FLUSH_THRESHOLD) {
      this.flush().catch((err) => {
        console.error('[PostImpressionsBufferService] Threshold flush error:', err);
      });
    }

    return { recorded, buffered };
  }

  public recordSingleView(identifier: string, postId: string): { recorded: boolean; pendingForPost: number } {
    const res = this.recordViews(identifier, [postId]);
    const recorded = res.recorded > 0;
    const pendingForPost = this.pendingCounts.get(postId) || 0;
    return { recorded, pendingForPost };
  }

  public getPendingForPost(postId: string): number {
    return this.pendingCounts.get(postId) || 0;
  }

  public getTotalBufferedCount(): number {
    let sum = 0;
    for (const count of this.pendingCounts.values()) {
      sum += count;
    }
    return sum;
  }

  public clearDeduplicationCache(): void {
    this.deduplicationCache.clear();
  }

  public clearPendingCounts(): void {
    this.pendingCounts.clear();
  }

  public async flush(): Promise<number> {
    if (this.isFlushing || this.pendingCounts.size === 0) {
      return 0;
    }

    this.isFlushing = true;
    const batch = new Map(this.pendingCounts);
    this.pendingCounts.clear();

    let totalFlushed = 0;
    try {
      const updatePromises = Array.from(batch.entries()).map(async ([postId, delta]) => {
        if (delta <= 0) return;
        try {
          await prisma.post.update({
            where: { id: postId },
            data: {
              viewsCount: {
                increment: delta,
              },
            },
          });
          totalFlushed += delta;
        } catch {
          // Ignore errors if post was soft-deleted or removed
        }
      });

      await Promise.allSettled(updatePromises);
    } catch (err) {
      console.error('[PostImpressionsBufferService] Flush batch error:', err);
    } finally {
      this.isFlushing = false;
    }

    return totalFlushed;
  }

  private pruneExpiredCache(): void {
    const now = Date.now();
    for (const [key, expiresAt] of this.deduplicationCache.entries()) {
      if (expiresAt <= now) {
        this.deduplicationCache.delete(key);
      }
    }
    if (this.deduplicationCache.size > this.MAX_CACHE_SIZE) {
      this.deduplicationCache.clear();
    }
  }

  private setupExitHooks(): void {
    const exitHandler = async () => {
      try {
        await this.flush();
      } catch {
        // Ignore exit errors
      }
    };

    process.once('beforeExit', exitHandler);
    process.once('SIGTERM', exitHandler);
    process.once('SIGINT', exitHandler);
  }
}

export const postImpressionsBufferService = new PostImpressionsBufferService();

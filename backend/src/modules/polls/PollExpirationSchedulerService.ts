import { prisma } from '../../db/PrismaClientSingleton.js';
import { realtimeStreamController } from '../notifications/RealtimeEventStreamController.js';
import { formatPollDto } from './PollDto.js';

export class PollExpirationSchedulerService {
  private intervalTimer: NodeJS.Timeout | null = null;
  private timeouts: Map<string, NodeJS.Timeout> = new Map();
  private isRunning: boolean = false;

  constructor() {
    this.checkExpiredPolls = this.checkExpiredPolls.bind(this);
  }

  /**
   * Start the recurring background expiration sweep (runs every 1 second).
   * 1-second interval ensures expirations fire within ±1s (well inside ±5s criterion).
   */
  public start(intervalMs: number = 1000): void {
    if (this.isRunning) return;
    this.isRunning = true;

    this.intervalTimer = setInterval(async () => {
      try {
        await this.checkExpiredPolls();
      } catch (err) {
        console.error('Error during poll expiration sweep:', err);
      }
    }, intervalMs);

    // Unref timer so it does not hold the Node.js process open in tests
    if (this.intervalTimer && typeof this.intervalTimer.unref === 'function') {
      this.intervalTimer.unref();
    }

    // Initial check on start
    this.checkExpiredPolls().catch((err) => {
      console.error('Error during initial poll expiration check:', err);
    });
  }

  /**
   * Stop all timers (for clean server shutdown / test teardown).
   */
  public stop(): void {
    this.isRunning = false;
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
    for (const [, timer] of this.timeouts) {
      clearTimeout(timer);
    }
    this.timeouts.clear();
  }

  /**
   * Schedule an exact timer for a specific poll's expiresAt.
   */
  public schedulePoll(pollId: string, expiresAt: Date): void {
    const delay = expiresAt.getTime() - Date.now();
    if (delay <= 0) {
      // Already expired, expire immediately
      this.expirePoll(pollId).catch((err) => console.error(err));
      return;
    }

    // If within 24 hours, schedule an in-memory timeout for sub-second precision
    if (delay < 24 * 60 * 60 * 1000) {
      if (this.timeouts.has(pollId)) {
        clearTimeout(this.timeouts.get(pollId)!);
      }

      const timer = setTimeout(async () => {
        this.timeouts.delete(pollId);
        try {
          await this.expirePoll(pollId);
        } catch (err) {
          console.error(`Error expiring poll ${pollId}:`, err);
        }
      }, delay);

      if (timer && typeof timer.unref === 'function') {
        timer.unref();
      }

      this.timeouts.set(pollId, timer);
    }
  }

  /**
   * Query database for any active polls whose expiresAt has passed,
   * mark them inactive, and broadcast realtime events.
   */
  public async checkExpiredPolls(): Promise<number> {
    const now = new Date();

    const expiredPolls = await prisma.poll.findMany({
      where: {
        isActive: true,
        expiresAt: {
          lte: now,
        },
      },
      select: {
        id: true,
      },
    });

    if (expiredPolls.length === 0) {
      return 0;
    }

    let expiredCount = 0;
    for (const item of expiredPolls) {
      const expired = await this.expirePoll(item.id);
      if (expired) expiredCount++;
    }

    return expiredCount;
  }

  /**
   * Mark a single poll as inactive and broadcast realtime SSE event.
   */
  public async expirePoll(pollId: string): Promise<boolean> {
    try {
      const updated = await prisma.$transaction(async (tx) => {
        const poll = await tx.poll.findUnique({
          where: { id: pollId },
          include: { choices: true, votes: true },
        });

        if (!poll || !poll.isActive) {
          return null;
        }

        // Atomically deactivate
        const deactivatedPoll = await tx.poll.update({
          where: { id: pollId },
          data: {
            isActive: false,
          },
          include: {
            choices: true,
            votes: true,
          },
        });

        return deactivatedPoll;
      });

      if (updated) {
        const pollDto = formatPollDto(updated);

        // Broadcast to all connected clients via SSE
        realtimeStreamController.broadcast('POLL_EXPIRED', {
          pollId: updated.id,
          poll: pollDto,
          expiredAt: new Date().toISOString(),
        });
        realtimeStreamController.broadcast('POLL_UPDATED', pollDto);

        return true;
      }
    } catch (err) {
      console.error(`Failed to mark poll ${pollId} as expired:`, err);
    }

    return false;
  }
}

export const pollExpirationSchedulerService = new PollExpirationSchedulerService();

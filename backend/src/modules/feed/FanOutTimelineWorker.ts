import { prisma } from '../../db/PrismaClientSingleton.js';
import { realtimeStreamController } from '../notifications/RealtimeEventStreamController.js';
import { postMatchesKeywords } from '../mutes/KeywordFilterUtil.js';

export interface FanOutPostPayload {
  id: string;
  authorId: string;
  createdAt: Date | string;
  content?: string;
  hashtags?: string[];
}

export class FanOutTimelineWorker {
  /**
   * Performs fan-out on write for regular users.
   * If the author is a celebrity (isCelebrity = true), no fan-out is performed (fan-out on read).
   */
  public async fanOut(post: FanOutPostPayload): Promise<number> {
    const author = await prisma.user.findUnique({
      where: { id: post.authorId },
      select: { id: true, isCelebrity: true },
    });

    if (!author || author.isCelebrity) {
      // Celebrities bypass write fan-out completely to avoid write amplification storms
      return 0;
    }

    const followers = await prisma.follow.findMany({
      where: { followingId: post.authorId },
      select: { followerId: true },
    });

    if (followers.length === 0) {
      return 0;
    }

    const createdAtDate = typeof post.createdAt === 'string' ? new Date(post.createdAt) : post.createdAt;

    // Bulk insert into TimelineInbox
    await prisma.timelineInbox.createMany({
      data: followers.map((f) => ({
        userId: f.followerId,
        postId: post.id,
        authorId: post.authorId,
        createdAt: createdAtDate,
      })),
      skipDuplicates: true,
    });

    // Query mutes given by followers against this author or keywords to prevent SSE leakage
    const followerIds = followers.map((f) => f.followerId);
    const [userMutes, keywordMutes] = await Promise.all([
      prisma.userMute.findMany({
        where: {
          mutedId: post.authorId,
          muterId: { in: followerIds },
        },
        select: { muterId: true },
      }),
      post.content
        ? prisma.keywordMute.findMany({
            where: {
              userId: { in: followerIds },
              muteContext: { in: ['ALL', 'HOME_TIMELINE'] },
              OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
            },
          })
        : [],
    ]);

    const mutedFollowerIds = new Set(userMutes.map((m) => m.muterId));

    if (post.content && keywordMutes.length > 0) {
      const kwsByUser = new Map<string, any[]>();
      for (const km of keywordMutes) {
        if (!kwsByUser.has(km.userId)) {
          kwsByUser.set(km.userId, []);
        }
        kwsByUser.get(km.userId)!.push(km);
      }

      for (const [fId, rules] of kwsByUser) {
        if (postMatchesKeywords({ content: post.content, hashtags: post.hashtags || [] }, rules, 'HOME_TIMELINE')) {
          mutedFollowerIds.add(fId);
        }
      }
    }

    // Notify connected followers in real-time via SSE (strictly excluding muted followers)
    const createdAtIso = createdAtDate.toISOString();
    for (const f of followers) {
      if (mutedFollowerIds.has(f.followerId)) {
        continue;
      }
      realtimeStreamController.sendToUser(f.followerId, 'NEW_TIMELINE_POST', {
        postId: post.id,
        authorId: post.authorId,
        createdAt: createdAtIso,
      });
    }

    return followers.length;
  }

  /**
   * Enqueue fan-out asynchronously in background without blocking current thread
   */
  public enqueue(post: FanOutPostPayload): void {
    setImmediate(async () => {
      try {
        await this.fanOut(post);
      } catch (err) {
        console.error(`[FanOutTimelineWorker] Error fanning out post ${post.id}:`, err);
      }
    });
  }
}

export const fanOutTimelineWorker = new FanOutTimelineWorker();

/**
 * PKG-14: Creator Dashboard — thống kê tác giả từ dữ liệu impressions/counters.
 *
 * GET /api/v1/users/me/stats:
 *  - totals: tổng views/likes/replies/reposts/quotes + followers hiện tại
 *  - windows: số liệu theo tuổi bài viết (24h / 7 ngày / 28 ngày)
 *  - topPosts: 5 bài nhiều views nhất (kèm engagement rate)
 *
 * viewsCount/likesCount là denormalized cumulative — không có timeline lịch sử,
 * nên "windows" hiểu là bài viết ĐĂNG trong khoảng đó (created_at based).
 */
import { prisma } from '../../db/PrismaClientSingleton.js';

export interface CreatorStats {
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
  windows: Record<'last24h' | 'last7d' | 'last28d', { posts: number; views: number; likes: number; engagement: number }>;
  topPosts: Array<{
    id: string;
    content: string;
    viewsCount: number;
    likesCount: number;
    engagementRate: number;
    createdAt: string;
  }>;
}

export class CreatorStatsService {
  public async getStats(userId: string): Promise<CreatorStats> {
    const [user, posts] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: {
          followersCount: true,
          followingCount: true,
          postsCount: true,
          isDeleted: true,
        },
      }),
      prisma.post.findMany({
        where: { authorId: userId, isDeleted: false, replyToId: null },
        select: {
          id: true,
          content: true,
          viewsCount: true,
          likesCount: true,
          repliesCount: true,
          repostsCount: true,
          quotesCount: true,
          createdAt: true,
        },
      }),
    ]);

    if (!user || user.isDeleted) {
      const err: any = new Error('User not found');
      err.statusCode = 404;
      err.code = 'USER_NOT_FOUND';
      throw err;
    }

    const now = Date.now();
    const windowsDefs: Record<'last24h' | 'last7d' | 'last28d', number> = {
      last24h: 1 * 24 * 3600 * 1000,
      last7d: 7 * 24 * 3600 * 1000,
      last28d: 28 * 24 * 3600 * 1000,
    };

    const windows: CreatorStats['windows'] = {
      last24h: { posts: 0, views: 0, likes: 0, engagement: 0 },
      last7d: { posts: 0, views: 0, likes: 0, engagement: 0 },
      last28d: { posts: 0, views: 0, likes: 0, engagement: 0 },
    };

    for (const post of posts) {
      const age = now - post.createdAt.getTime();
      for (const [key, span] of Object.entries(windowsDefs)) {
        if (age <= span) {
          windows[key as keyof typeof windowsDefs].posts += 1;
          windows[key as keyof typeof windowsDefs].views += post.viewsCount;
          windows[key as keyof typeof windowsDefs].likes += post.likesCount;
        }
      }
    }
    // engagement rate mỗi window = likes / max(views, 1)
    for (const w of Object.values(windows)) {
      w.engagement = w.views > 0 ? Number(((w.likes / w.views) * 100).toFixed(2)) : 0;
    }

    const totals = posts.reduce(
      (acc, p) => ({
        posts: acc.posts + 1,
        views: acc.views + p.viewsCount,
        likes: acc.likes + p.likesCount,
        replies: acc.replies + p.repliesCount,
        reposts: acc.reposts + p.repostsCount,
        quotes: acc.quotes + p.quotesCount,
        followers: user.followersCount,
        following: user.followingCount,
      }),
      { posts: 0, views: 0, likes: 0, replies: 0, reposts: 0, quotes: 0, followers: 0, following: 0 }
    );
    totals.followers = user.followersCount;
    totals.following = user.followingCount;

    const topPosts = [...posts]
      .sort((a, b) => b.viewsCount - a.viewsCount)
      .slice(0, 5)
      .map((p) => ({
        id: p.id,
        content: p.content.slice(0, 140),
        viewsCount: p.viewsCount,
        likesCount: p.likesCount,
        engagementRate: p.viewsCount > 0 ? Number(((p.likesCount / p.viewsCount) * 100).toFixed(2)) : 0,
        createdAt: p.createdAt.toISOString(),
      }));

    return { totals, windows, topPosts };
  }
}

export const creatorStatsService = new CreatorStatsService();

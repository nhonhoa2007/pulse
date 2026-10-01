import { prisma } from '../../db/PrismaClientSingleton.js';
import {
  PostDto,
  UserDto,
  SearchResultData,
  TrendingItemDto,
  TrendingResponseData,
} from '../../contracts/ApiContracts.js';
import { postMatchesKeywords } from '../mutes/KeywordFilterUtil.js';
import { resolveRemoteActorService } from '../federation/ResolveRemoteActorService.js';

export interface SearchParams {
  q: string;
  type?: 'all' | 'posts' | 'users';
  limit?: number;
  offset?: number;
  currentUserId?: string | null;
}

export class SearchService {
  /**
   * Full-text search across posts and users with:
   * - Hashtag discovery (#tag)
   * - Username lookup (@username)
   * - Two-way block relationship filtering
   * - User engagement resolution (isLiked, isReposted, isBookmarked, isFollowing)
   */
  public async search(params: SearchParams): Promise<SearchResultData> {
    const trimmedQuery = params.q.trim();
    const type = params.type || 'all';
    const limit = Math.min(Math.max(params.limit || 20, 1), 100);
    const offset = Math.max(params.offset || 0, 0);
    const { currentUserId } = params;

    if (!trimmedQuery) {
      return {
        posts: [],
        users: [],
        query: trimmedQuery,
      };
    }

    // Determine query intent
    const isHashtagSearch = trimmedQuery.startsWith('#');
    const isUserMentionSearch = trimmedQuery.startsWith('@');

    const cleanTag = isHashtagSearch
      ? trimmedQuery.replace(/^#+/, '').trim().toLowerCase()
      : '';
    const cleanUsername = isUserMentionSearch
      ? trimmedQuery.replace(/^@+/, '').trim()
      : '';

    // Retrieve all blocked / blocker user IDs and muted user IDs
    const blockedUserIds = new Set<string>();
    const mutedUserIds = new Set<string>();
    let activeKeywordMutes: any[] = [];

    if (currentUserId) {
      const [blocks, mutes, kws] = await Promise.all([
        prisma.block.findMany({
          where: {
            OR: [{ blockerId: currentUserId }, { blockedId: currentUserId }],
          },
          select: {
            blockerId: true,
            blockedId: true,
          },
        }),
        prisma.userMute.findMany({
          where: { muterId: currentUserId },
          select: { mutedId: true },
        }),
        prisma.keywordMute.findMany({
          where: {
            userId: currentUserId,
            muteContext: 'ALL',
            OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
          },
        }),
      ]);

      for (const b of blocks) {
        blockedUserIds.add(b.blockerId === currentUserId ? b.blockedId : b.blockerId);
      }
      for (const m of mutes) {
        mutedUserIds.add(m.mutedId);
      }
      activeKeywordMutes = kws;
    }

    const excludedUserIds = Array.from(new Set([...blockedUserIds, ...mutedUserIds]));

    let postDtos: PostDto[] = [];
    let userDtos: UserDto[] = [];

    // 1. Search Posts (when type is 'all' or 'posts', and query is NOT a user lookup @...)
    const shouldSearchPosts = (type === 'all' || type === 'posts') && !isUserMentionSearch;
    if (shouldSearchPosts) {
      let followedUserIds: string[] = [];
      if (currentUserId) {
        const follows = await prisma.follow.findMany({
          where: { followerId: currentUserId },
          select: { followingId: true },
        });
        followedUserIds = follows.map((f) => f.followingId);
      }
      const allowedAuthorIds = currentUserId ? [currentUserId, ...followedUserIds] : [];

      const postWhere: any = {
        isDeleted: false,
        ...(excludedUserIds.length > 0 ? { authorId: { notIn: excludedUserIds } } : {}),
        AND: [
          {
            OR: [
              { author: { isPrivate: false } },
              ...(allowedAuthorIds.length > 0 ? [{ authorId: { in: allowedAuthorIds } }] : []),
            ],
          },
        ],
      };

      if (isHashtagSearch) {
        if (cleanTag) {
          postWhere.OR = [
            { hashtags: { has: cleanTag } },
            { content: { contains: `#${cleanTag}`, mode: 'insensitive' } },
            { content: { contains: cleanTag, mode: 'insensitive' } },
          ];
        } else {
          postWhere.content = { contains: '#', mode: 'insensitive' };
        }
      } else {
        // General keyword search
        const words = trimmedQuery.split(/\s+/).filter(Boolean);
        const orConditions: any[] = [
          { content: { contains: trimmedQuery, mode: 'insensitive' } },
          { hashtags: { has: trimmedQuery.toLowerCase() } },
        ];

        if (words.length > 1) {
          orConditions.push({
            AND: words.map((w) => ({ content: { contains: w, mode: 'insensitive' } })),
          });
        }

        postWhere.OR = orConditions;
      }

      const posts = await prisma.post.findMany({
        where: postWhere,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        include: {
          author: {
            select: { id: true, username: true, displayName: true, avatarUrl: true, isCelebrity: true, pinnedPostId: true },
          },
          replyTo: {
            select: { id: true, author: { select: { username: true, displayName: true } } },
          },
          quoteOf: {
            include: {
              author: {
                select: { id: true, username: true, displayName: true, avatarUrl: true, isCelebrity: true, pinnedPostId: true, isPrivate: true },
              },
            },
          },
        },
      });

      // Safeguard: filter out any posts authored by blocked or muted users, and posts matching keyword mutes
      const validPosts = posts.filter(
        (p) =>
          !blockedUserIds.has(p.authorId) &&
          !mutedUserIds.has(p.authorId) &&
          !postMatchesKeywords(p, activeKeywordMutes)
      );
      const postIds = validPosts.map((p) => p.id);

      // Resolve engagement states for current user
      const [likes, reposts, bookmarks] = await Promise.all([
        currentUserId && postIds.length > 0
          ? prisma.like.findMany({
              where: { userId: currentUserId, postId: { in: postIds } },
              select: { postId: true },
            })
          : [],
        currentUserId && postIds.length > 0
          ? prisma.repost.findMany({
              where: { userId: currentUserId, postId: { in: postIds } },
              select: { postId: true },
            })
          : [],
        currentUserId && postIds.length > 0
          ? prisma.bookmark.findMany({
              where: { userId: currentUserId, postId: { in: postIds } },
              select: { postId: true },
            })
          : [],
      ]);

      const likedSet = new Set(likes.map((l) => l.postId));
      const repostedSet = new Set(reposts.map((r) => r.postId));
      const bookmarkedSet = new Set(bookmarks.map((b) => b.postId));

      postDtos = validPosts.map((p) => {
        const quoteAuthorIsPrivate = Boolean((p.quoteOf?.author as any)?.isPrivate);
        const canViewQuote =
          !quoteAuthorIsPrivate ||
          p.quoteOf?.authorId === currentUserId ||
          Boolean(currentUserId && p.quoteOf?.authorId && allowedAuthorIds.includes(p.quoteOf.authorId));

        return {
          id: p.id,
          authorId: p.authorId,
          content: p.content,
          mediaUrls: p.mediaUrls,
          replyToId: p.replyToId,
          rootPostId: p.rootPostId,
          repostOfId: p.repostOfId,
          quoteOfId: p.quoteOfId,
          reply_privacy: (p as any).reply_privacy || 'EVERYONE',
          replyPrivacy: (p as any).reply_privacy || 'EVERYONE',
          isEdited: p.isEdited,
          editCount: p.editCount,
          lastEditedAt: p.lastEditedAt ? p.lastEditedAt.toISOString() : null,
          isPinned: (p.author as any).pinnedPostId === p.id,
          isSensitive: p.isSensitive,
          contentWarning: p.contentWarning,
          likesCount: p.likesCount,
          repliesCount: p.repliesCount,
          repostsCount: p.repostsCount,
          quotesCount: p.quotesCount,
          hashtags: p.hashtags,
          mentions: p.mentions,
          isLiked: likedSet.has(p.id),
          isReposted: repostedSet.has(p.id),
          isBookmarked: bookmarkedSet.has(p.id),
          createdAt: p.createdAt.toISOString(),
          author: p.author,
          replyTo: p.replyTo,
          quoteOf: p.quoteOf && canViewQuote
            ? {
              id: p.quoteOf.id,
              authorId: p.quoteOf.authorId,
              content: p.quoteOf.content,
              mediaUrls: p.quoteOf.mediaUrls,
              replyToId: p.quoteOf.replyToId,
              rootPostId: p.quoteOf.rootPostId,
              repostOfId: p.quoteOf.repostOfId,
              quoteOfId: p.quoteOf.quoteOfId,
              reply_privacy: (p.quoteOf as any).reply_privacy || 'EVERYONE',
              replyPrivacy: (p.quoteOf as any).reply_privacy || 'EVERYONE',
              likesCount: p.quoteOf.likesCount,
              repliesCount: p.quoteOf.repliesCount,
              repostsCount: p.quoteOf.repostsCount,
              quotesCount: p.quoteOf.quotesCount,
              hashtags: p.quoteOf.hashtags,
              mentions: p.quoteOf.mentions,
              createdAt: p.quoteOf.createdAt.toISOString(),
              author: p.quoteOf.author,
            }
          : null,
        };
      });
    }

    // 2. Search Users (when type is 'all' or 'users', and query is NOT a hashtag lookup #...)
    const shouldSearchUsers = (type === 'all' || type === 'users') && !isHashtagSearch;
    if (shouldSearchUsers) {
      const userWhere: any = {
        ...(excludedUserIds.length > 0 ? { id: { notIn: excludedUserIds } } : {}),
      };

      if (isUserMentionSearch) {
        if (cleanUsername) {
          userWhere.username = { contains: cleanUsername, mode: 'insensitive' };
        } else {
          userWhere.username = { not: '' };
        }
      } else {
        userWhere.OR = [
          { username: { contains: trimmedQuery, mode: 'insensitive' } },
          { displayName: { contains: trimmedQuery, mode: 'insensitive' } },
        ];
      }

      const users = await prisma.user.findMany({
        where: userWhere,
        take: limit,
        skip: offset,
        orderBy: { followersCount: 'desc' },
      });

      // Safeguard: filter out any blocked users
      const validUsers = users.filter((u) => !blockedUserIds.has(u.id));
      const userIds = validUsers.map((u) => u.id);

      let followingSet = new Set<string>();
      if (currentUserId && userIds.length > 0) {
        const follows = await prisma.follow.findMany({
          where: {
            followerId: currentUserId,
            followingId: { in: userIds },
          },
          select: { followingId: true },
        });
        followingSet = new Set(follows.map((f) => f.followingId));
      }

      userDtos = validUsers.map((u) => ({
        id: u.id,
        username: u.username,
        displayName: u.displayName,
        avatarUrl: u.avatarUrl,
        bio: u.bio,
        isCelebrity: u.isCelebrity,
        followersCount: u.followersCount,
        followingCount: u.followingCount,
        postsCount: u.postsCount,
        isPrivate: Boolean(u.isPrivate),
        isFollowing: followingSet.has(u.id),
        createdAt: u.createdAt.toISOString(),
      }));
    }

    // 3. Remote Federated Discovery on @user@domain or Actor URI
    let federatedResult: SearchResultData['federatedResult'] = null;
    const isRemoteHandle =
      (/^@?[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+(?::\d+)?$/.test(trimmedQuery) ||
        /^https?:\/\/[a-zA-Z0-9.-]+(?::\d+)?\/.+$/i.test(trimmedQuery)) &&
      !trimmedQuery.startsWith('#');

    if (isRemoteHandle) {
      try {
        const resolved = await resolveRemoteActorService.resolveActor(
          trimmedQuery,
          currentUserId
        );
        if (resolved && resolved.user) {
          federatedResult = {
            actorUri: resolved.actor.uri,
            username: resolved.actor.username,
            domain: resolved.actor.domain,
            displayName: resolved.user.displayName,
            bio: resolved.user.bio,
            avatarUrl: resolved.user.avatarUrl,
            isRemote: true,
            shadowUserId: resolved.user.id,
            inboxUrl: resolved.actor.inboxUrl,
            sharedInboxUrl: resolved.actor.sharedInboxUrl,
            isFollowing: resolved.user.isFollowing,
          };
        }
      } catch {
        federatedResult = null;
      }
    }

    return {
      posts: postDtos,
      users: userDtos,
      query: trimmedQuery,
      federatedResult,
    };
  }

  /**
   * Trending Engine:
   * Aggregates hashtags from recent posts (last 48h), computes decaying trending scores,
   * updates/reads the Hashtag table in Prisma, and returns the ranked list.
   */
  public async getTrending(limit: number = 20): Promise<TrendingResponseData> {
    const cappedLimit = Math.min(Math.max(limit, 1), 50);
    const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);

    // 1. Fetch recent posts within 48h from PUBLIC users only (prevent private hashtag leakage)
    const recentPosts = await prisma.post.findMany({
      where: {
        createdAt: { gte: fortyEightHoursAgo },
        isDeleted: false,
        author: { isPrivate: false },
      },
      select: {
        hashtags: true,
        createdAt: true,
        likesCount: true,
        repliesCount: true,
        repostsCount: true,
      },
    });

    const tagStatsMap = new Map<string, { count: number; score: number; latestCreatedAt: number }>();

    const now = Date.now();
    for (const post of recentPosts) {
      if (!post.hashtags || post.hashtags.length === 0) continue;

      const hoursAgo = Math.max(0, (now - post.createdAt.getTime()) / (1000 * 60 * 60));
      // Exponential time decay with half-life ~24 hours
      const recencyWeight = Math.exp(-hoursAgo / 24);
      // Engagement weight (likes, reposts, replies)
      const engagementWeight =
        1.0 +
        post.likesCount * 0.5 +
        post.repostsCount * 1.0 +
        post.repliesCount * 0.5;

      const postScore = engagementWeight * recencyWeight;
      const postTime = post.createdAt.getTime();

      for (const rawTag of post.hashtags) {
        const tag = rawTag.toLowerCase().trim();
        if (!tag) continue;

        const existing = tagStatsMap.get(tag);
        if (existing) {
          existing.count += 1;
          existing.score += postScore;
          existing.latestCreatedAt = Math.max(existing.latestCreatedAt, postTime);
        } else {
          tagStatsMap.set(tag, { count: 1, score: postScore, latestCreatedAt: postTime });
        }
      }
    }

    // 2. Sync/upsert discovered recent tags into Hashtag table in Prisma
    for (const [tag, stats] of tagStatsMap.entries()) {
      await prisma.hashtag.upsert({
        where: { tag },
        create: {
          tag,
          postsCount: stats.count,
        },
        update: {},
      });
    }

    // 3. Read existing hashtags from Prisma Hashtag table
    const dbHashtags = await prisma.hashtag.findMany({
      orderBy: { postsCount: 'desc' },
      take: 50,
    });

    // 4. Combine recent post stats with Hashtag table data
    const combinedTrendingMap = new Map<string, TrendingItemDto & { latestCreatedAt?: number }>();

    // Add recent tags first with their computed scores
    for (const [tag, stats] of tagStatsMap.entries()) {
      combinedTrendingMap.set(tag, {
        tag,
        postsCount: stats.count,
        score: Number(stats.score.toFixed(2)),
        latestCreatedAt: stats.latestCreatedAt,
      });
    }

    // Add remaining db hashtags if not already present
    for (const h of dbHashtags) {
      const existing = combinedTrendingMap.get(h.tag);
      if (existing) {
        // Maintain the higher postsCount if DB tracks all-time counts
        existing.postsCount = Math.max(existing.postsCount, h.postsCount);
      } else {
        combinedTrendingMap.set(h.tag, {
          tag: h.tag,
          postsCount: h.postsCount,
          score: 0.01,
          latestCreatedAt: 0,
        });
      }
    }

    // 5. Sort descending by score, then postsCount, then latestCreatedAt
    const trendingList = Array.from(combinedTrendingMap.values()).sort((a, b) => {
      const scoreA = a.score ?? 0;
      const scoreB = b.score ?? 0;
      if (Math.abs(scoreB - scoreA) > 0.001) {
        return scoreB - scoreA;
      }
      if (b.postsCount !== a.postsCount) {
        return b.postsCount - a.postsCount;
      }
      return (b.latestCreatedAt || 0) - (a.latestCreatedAt || 0);
    });

    return {
      trending: trendingList.slice(0, cappedLimit),
    };
  }
}

export const searchService = new SearchService();

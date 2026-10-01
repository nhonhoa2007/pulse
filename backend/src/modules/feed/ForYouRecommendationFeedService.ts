import { prisma } from '../../db/PrismaClientSingleton.js';
import { FeedResponse, PostDto, ReplyPrivacy } from '../../contracts/ApiContracts.js';
import { postMatchesKeywords } from '../mutes/KeywordFilterUtil.js';
import { formatPollDto } from '../polls/PollDto.js';
import { postImpressionsBufferService } from '../posts/PostImpressionsBufferService.js';

interface ForYouFeedParams {
  userId: string;
  cursor?: string;
  limit?: number;
}

interface ScoredPost {
  post: any;
  score: number;
}

export class ForYouRecommendationFeedService {
  /**
   * "For You" Algorithmic Recommendation Heuristic Feed:
   * 1. Candidate Generation: In-network (followed + friends-of-friends) & Out-of-network within sliding 72h window
   * 2. Hard Exclusion Filters: Two-way blocks, user mutes, active keyword mutes, soft-deleted, self-posts
   * 3. Gravity Heuristic Scoring:
   *    Score(P, U) = [ (1.0*L + 2.0*R + 1.5*C + 2.5*Q + 0.5*log10(1+V)) * Affinity(P, U) / (age_hours + 2)^1.5 ] * Diversity(P)
   * 4. Cursor-based compound pagination ({score}:{postId})
   */
  public async getForYouFeed(params: ForYouFeedParams): Promise<FeedResponse> {
    const { userId, cursor } = params;
    const limit = Math.min(Math.max(params.limit || 20, 1), 50);
    const now = new Date();
    const windowStart = new Date(now.getTime() - 72 * 60 * 60 * 1000); // 72-hour sliding window

    // Retrieve blocks, user mutes, and active keyword mutes concurrently
    const [blocks, userMutes, keywordMutes, directFollows] = await Promise.all([
      prisma.block.findMany({
        where: {
          OR: [{ blockerId: userId }, { blockedId: userId }],
        },
      }),
      prisma.userMute.findMany({
        where: { muterId: userId },
        select: { mutedId: true },
      }),
      prisma.keywordMute.findMany({
        where: {
          userId,
          muteContext: { in: ['ALL', 'HOME_TIMELINE'] },
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
      }),
      prisma.follow.findMany({
        where: { followerId: userId },
        select: { followingId: true },
      }),
    ]);

    const blockedUserIds = new Set<string>();
    for (const b of blocks) {
      blockedUserIds.add(b.blockerId === userId ? b.blockedId : b.blockerId);
    }
    const mutedUserIds = new Set(userMutes.map((m) => m.mutedId));

    const directFollowedIds = new Set(directFollows.map((f) => f.followingId));

    // Discover Friends-of-Friends (second-degree connections)
    const fofFollowedIds = new Set<string>();
    if (directFollowedIds.size > 0) {
      const fofFollows = await prisma.follow.findMany({
        where: {
          followerId: { in: Array.from(directFollowedIds) },
        },
        select: { followingId: true },
      });
      for (const f of fofFollows) {
        if (!directFollowedIds.has(f.followingId) && f.followingId !== userId) {
          fofFollowedIds.add(f.followingId);
        }
      }
    }

    const postAuthorSelect = {
      id: true,
      username: true,
      displayName: true,
      avatarUrl: true,
      isCelebrity: true,
      pinnedPostId: true,
      isPrivate: true,
    };

    const postIncludes = {
      author: {
        select: postAuthorSelect,
      },
      replyTo: {
        select: { id: true, author: { select: { username: true, displayName: true } } },
      },
      quoteOf: {
        include: {
          author: {
            select: postAuthorSelect,
          },
        },
      },
      poll: {
        include: {
          choices: true,
          votes: true,
        },
      },
    };

    const inNetworkUserIds = Array.from(new Set([...directFollowedIds, ...fofFollowedIds]));

    // Candidate Generation across 2 streams (In-Network + Out-of-Network Top Performing & Fresh Discovery)
    const [inNetworkPosts, topPosts, freshPosts] = await Promise.all([
      inNetworkUserIds.length > 0
        ? prisma.post.findMany({
            where: {
              isDeleted: false,
              createdAt: { gte: windowStart },
              authorId: { in: inNetworkUserIds },
            },
            include: postIncludes,
            orderBy: { createdAt: 'desc' },
            take: 300,
          })
        : Promise.resolve([]),
      prisma.post.findMany({
        where: {
          isDeleted: false,
          createdAt: { gte: windowStart },
          authorId: { not: userId },
        },
        include: postIncludes,
        orderBy: [
          { likesCount: 'desc' },
          { repostsCount: 'desc' },
          { createdAt: 'desc' },
        ],
        take: 300,
      }),
      prisma.post.findMany({
        where: {
          isDeleted: false,
          createdAt: { gte: windowStart },
          authorId: { not: userId },
        },
        include: postIncludes,
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
    ]);

    const candidateMap = new Map<string, any>();
    for (const post of inNetworkPosts) candidateMap.set(post.id, post);
    for (const post of topPosts) candidateMap.set(post.id, post);
    for (const post of freshPosts) candidateMap.set(post.id, post);

    const candidates = Array.from(candidateMap.values());

    // Hard Exclusion Filtering: Blocks, Mutes, Keyword Mutes, Soft-deletes, Self-Posts, Private Accounts
    const filteredCandidates = candidates.filter((post) => {
      if (post.isDeleted) return false;
      if (post.authorId === userId) return false;
      if (blockedUserIds.has(post.authorId)) return false;
      if (mutedUserIds.has(post.authorId)) return false;
      if (postMatchesKeywords(post, keywordMutes as any, 'HOME_TIMELINE')) return false;
      if (post.author?.isPrivate && !directFollowedIds.has(post.authorId) && post.authorId !== userId) return false;
      return true;
    });

    // Heuristic Gravity Scoring
    const scoredCandidates: ScoredPost[] = [];
    for (const post of filteredCandidates) {
      const L = post.likesCount;
      const R = post.repostsCount;
      const C = post.repliesCount;
      const Q = post.quotesCount;
      const bufferedViews = postImpressionsBufferService.getPendingForPost(post.id);
      const V = (post.viewsCount ?? 0) + bufferedViews;

      // Engagement velocity weight
      const engagementWeight = 1.0 * L + 2.0 * R + 1.5 * C + 2.5 * Q + 0.5 * Math.log10(1 + V);
      // Give a small non-zero base engagement (0.1) so new posts with 0 likes still decay gracefully
      const W_engagement = Math.max(engagementWeight, 0.1);

      // Social Affinity Multiplier
      let affinity = 1.0; // Stranger / Discovery default
      if (directFollowedIds.has(post.authorId)) {
        affinity = 2.0; // Direct Follow
      } else if (fofFollowedIds.has(post.authorId)) {
        affinity = 1.5; // Mutual Network / FoF
      } else if (post.author.isCelebrity) {
        affinity = 1.2; // Celebrity Post
      }

      // Time-Decay Gravity
      const ageHours = Math.max(0, (now.getTime() - post.createdAt.getTime()) / (1000 * 60 * 60));
      const timeDecay = Math.pow(ageHours + 2, 1.5);

      const rawGravityScore = (W_engagement * affinity) / timeDecay;
      scoredCandidates.push({
        post,
        score: rawGravityScore,
      });
    }

    // Preliminary Sort by rawGravityScore descending
    scoredCandidates.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.post.createdAt.getTime() - a.post.createdAt.getTime();
    });

    // Author Diversity Penalty & Drop 4th+ posts
    const authorCounts = new Map<string, number>();
    const diversifiedCandidates: ScoredPost[] = [];

    for (const item of scoredCandidates) {
      const authorId = item.post.authorId;
      const count = authorCounts.get(authorId) || 0;

      if (count >= 3) {
        // >= 4th post from author: Excluded from feed page
        continue;
      }

      let diversityMultiplier = 1.0;
      if (count === 1) {
        diversityMultiplier = 0.6; // 2nd post
      } else if (count === 2) {
        diversityMultiplier = 0.3; // 3rd post
      }

      authorCounts.set(authorId, count + 1);
      diversifiedCandidates.push({
        post: item.post,
        score: item.score * diversityMultiplier,
      });
    }

    // Final Sort by adjusted score DESC, createdAt DESC, id DESC
    diversifiedCandidates.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const timeDiff = b.post.createdAt.getTime() - a.post.createdAt.getTime();
      if (timeDiff !== 0) return timeDiff;
      return b.post.id.localeCompare(a.post.id);
    });

    // Cursor Pagination ({score}:{postId})
    let pageCandidates = diversifiedCandidates;
    if (cursor) {
      const delimiterIndex = cursor.indexOf(':') !== -1 ? cursor.indexOf(':') : cursor.indexOf('_');
      if (delimiterIndex !== -1) {
        const cursorScore = parseFloat(cursor.slice(0, delimiterIndex));
        const cursorPostId = cursor.slice(delimiterIndex + 1);

        const existingIndex = diversifiedCandidates.findIndex(
          (c) => c.post.id === cursorPostId
        );

        if (existingIndex !== -1) {
          pageCandidates = diversifiedCandidates.slice(existingIndex + 1);
        } else if (!Number.isNaN(cursorScore)) {
          pageCandidates = diversifiedCandidates.filter((c) => {
            if (c.score < cursorScore - 1e-7) return true;
            if (Math.abs(c.score - cursorScore) <= 1e-7) {
              return c.post.id < cursorPostId;
            }
            return false;
          });
        }
      }
    }

    const selectedBatch = pageCandidates.slice(0, limit);
    const candidatePostIds = selectedBatch.map((item) => item.post.id);

    // Resolve user engagement states (isLiked, isReposted, isBookmarked)
    const [likes, reposts, bookmarks] = await Promise.all([
      prisma.like.findMany({
        where: { userId, postId: { in: candidatePostIds } },
        select: { postId: true },
      }),
      prisma.repost.findMany({
        where: { userId, postId: { in: candidatePostIds } },
        select: { postId: true },
      }),
      prisma.bookmark.findMany({
        where: { userId, postId: { in: candidatePostIds } },
        select: { postId: true },
      }),
    ]);

    const likedSet = new Set(likes.map((l) => l.postId));
    const repostedSet = new Set(reposts.map((r) => r.postId));
    const bookmarkedSet = new Set(bookmarks.map((b) => b.postId));

    const posts: PostDto[] = selectedBatch.map((item) => {
      const p = item.post;
      const pendingViews = postImpressionsBufferService.getPendingForPost(p.id);

      const quoteAuthorIsPrivate = Boolean((p.quoteOf?.author as any)?.isPrivate);
      const canViewQuote =
        !quoteAuthorIsPrivate ||
        p.quoteOf?.authorId === userId ||
        directFollowedIds.has(p.quoteOf?.authorId);

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
        viewsCount: (p.viewsCount ?? 0) + pendingViews,
        hashtags: p.hashtags,
        mentions: p.mentions,
        isLiked: likedSet.has(p.id),
        isReposted: repostedSet.has(p.id),
        isBookmarked: bookmarkedSet.has(p.id),
        poll: (p as any).poll ? formatPollDto((p as any).poll, userId) : null,
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
              viewsCount: (p.quoteOf as any).viewsCount ?? 0,
              hashtags: p.quoteOf.hashtags,
              mentions: p.quoteOf.mentions,
              createdAt: p.quoteOf.createdAt.toISOString(),
              author: p.quoteOf.author,
            }
          : null,
      };
    });

    let nextCursor: string | null = null;
    if (pageCandidates.length > limit && selectedBatch.length > 0) {
      const lastItem = selectedBatch[selectedBatch.length - 1];
      nextCursor = `${lastItem.score.toFixed(6)}:${lastItem.post.id}`;
    }

    return {
      posts,
      nextCursor,
    };
  }
}

export const forYouRecommendationFeedService = new ForYouRecommendationFeedService();

import { formatPollDto } from '../polls/PollDto.js';
import { prisma } from '../../db/PrismaClientSingleton.js';
import { FeedResponse, PostDto } from '../../contracts/ApiContracts.js';
import { postMatchesKeywords } from '../mutes/KeywordFilterUtil.js';
import { postImpressionsBufferService } from '../posts/PostImpressionsBufferService.js';

interface FeedQueryParams {
  userId: string;
  cursor?: string;
  limit?: number;
}

export class HybridFeedTimelineService {
  /**
   * Hybrid Fan-out Feed Algorithm:
   * 1. Pulls from TimelineInbox for regular followed users (Fan-out on Write)
   * 2. Pulls directly from Post table for followed Celebrities (Fan-out on Read)
   * 3. Merges both streams sorted by createdAt DESC using K-Way Merge
   * 4. Enforces Two-Way Block privacy filtering
   */
  public async getHomeFeed(params: FeedQueryParams): Promise<FeedResponse> {
    const { userId, cursor } = params;
    const limit = Math.min(Math.max(params.limit || 20, 1), 50);
    const cursorDate = cursor ? new Date(cursor) : undefined;
    const now = new Date();

    // Retrieve blocks, user mutes, and active keyword mutes concurrently
    const [blocks, userMutes, keywordMutes] = await Promise.all([
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
    ]);

    const blockedUserIds = new Set<string>();
    for (const b of blocks) {
      blockedUserIds.add(b.blockerId === userId ? b.blockedId : b.blockerId);
    }
    const mutedUserIds = new Set(userMutes.map((m) => m.mutedId));

    const postAuthorSelect = {
      id: true,
      username: true,
      displayName: true,
      avatarUrl: true,
      isCelebrity: true,
      pinnedPostId: true,
    };

    // Step 1: Read posts from TimelineInbox (Fan-out on write source)
    const inboxes = await prisma.timelineInbox.findMany({
      where: {
        userId,
        ...(cursorDate ? { createdAt: { lt: cursorDate } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit * 2, // Fetch slightly more to account for possible block filtering
      include: {
        post: {
          include: {
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
          },
        },
      },
    });

    const inboxPosts = inboxes
      .map((item) => item.post)
      .filter(
        (post) =>
          !post.isDeleted &&
          !blockedUserIds.has(post.authorId) &&
          !mutedUserIds.has(post.authorId) &&
          !postMatchesKeywords(post, keywordMutes as any, 'HOME_TIMELINE')
      );

    // Step 2: Identify Celebrities that the user follows
    const celebrityFollows = await prisma.follow.findMany({
      where: {
        followerId: userId,
        following: { isCelebrity: true },
      },
      select: { followingId: true },
    });
    const celebrityIds = celebrityFollows
      .map((f) => f.followingId)
      .filter((id) => !blockedUserIds.has(id) && !mutedUserIds.has(id));

    // Step 3: Fetch latest posts from Celebrities (Fan-out on read source)
    let celebrityPosts: typeof inboxPosts = [];
    if (celebrityIds.length > 0) {
      const fetchedCelebrityPosts = await prisma.post.findMany({
        where: {
          authorId: { in: celebrityIds },
          isDeleted: false,
          ...(cursorDate ? { createdAt: { lt: cursorDate } } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: limit * 2,
        include: {
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
        },
      });

      celebrityPosts = fetchedCelebrityPosts.filter(
        (post) => !postMatchesKeywords(post, keywordMutes as any, 'HOME_TIMELINE')
      );
    }

    // Step 4: K-Way (2-Way) Merge of sorted arrays
    const mergedPosts: typeof inboxPosts = [];
    const seenPostIds = new Set<string>();
    let i = 0;
    let j = 0;

    while (
      (i < inboxPosts.length || j < celebrityPosts.length) &&
      mergedPosts.length < limit
    ) {
      const postA = inboxPosts[i];
      const postB = celebrityPosts[j];

      if (postA && postB) {
        if (postA.createdAt.getTime() >= postB.createdAt.getTime()) {
          if (!seenPostIds.has(postA.id)) {
            seenPostIds.add(postA.id);
            mergedPosts.push(postA);
          }
          i++;
        } else {
          if (!seenPostIds.has(postB.id)) {
            seenPostIds.add(postB.id);
            mergedPosts.push(postB);
          }
          j++;
        }
      } else if (postA) {
        if (!seenPostIds.has(postA.id)) {
          seenPostIds.add(postA.id);
          mergedPosts.push(postA);
        }
        i++;
      } else if (postB) {
        if (!seenPostIds.has(postB.id)) {
          seenPostIds.add(postB.id);
          mergedPosts.push(postB);
        }
        j++;
      }
    }

    // Step 5: Resolve user engagement states (isLiked, isReposted)
    const postIds = mergedPosts.map((p) => p.id);
    const [likes, reposts] = await Promise.all([
      prisma.like.findMany({
        where: { userId, postId: { in: postIds } },
        select: { postId: true },
      }),
      prisma.repost.findMany({
        where: { userId, postId: { in: postIds } },
        select: { postId: true },
      }),
    ]);

    const likedSet = new Set(likes.map((l) => l.postId));
    const repostedSet = new Set(reposts.map((r) => r.postId));

    const posts: PostDto[] = mergedPosts.map((p) => ({
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
      viewsCount: ((p as any).viewsCount ?? 0) + postImpressionsBufferService.getPendingForPost(p.id),
      hashtags: p.hashtags,
      mentions: p.mentions,
      isLiked: likedSet.has(p.id),
      isReposted: repostedSet.has(p.id),
      poll: (p as any).poll ? formatPollDto((p as any).poll, userId) : null,
      createdAt: p.createdAt.toISOString(),
      author: p.author,
      replyTo: p.replyTo,
      quoteOf: p.quoteOf
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
    }));

    const nextCursor =
      posts.length === limit && mergedPosts.length > 0
        ? mergedPosts[mergedPosts.length - 1].createdAt.toISOString()
        : null;

    return {
      posts,
      nextCursor,
    };
  }
}

export const hybridFeedTimelineService = new HybridFeedTimelineService();

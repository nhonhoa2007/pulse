import { prisma } from '../../db/PrismaClientSingleton.js';
import { PostDto, ToggleBookmarkResult } from '../../contracts/ApiContracts.js';

export class BookmarkService {
  /**
   * Toggles bookmark for a given user and post.
   * If already bookmarked, deletes the bookmark and returns { bookmarked: false }.
   * If not bookmarked, creates the bookmark and returns { bookmarked: true }.
   */
  public async toggleBookmark(userId: string, postId: string): Promise<ToggleBookmarkResult> {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new Error('User not found');
    }

    const post = await prisma.post.findUnique({
      where: { id: postId },
      select: { id: true, authorId: true, isDeleted: true },
    });

    if (!post || post.isDeleted) {
      throw new Error('Post not found or unavailable');
    }

    // Check block relationship
    const block = await prisma.block.findFirst({
      where: {
        OR: [
          { blockerId: userId, blockedId: post.authorId },
          { blockerId: post.authorId, blockedId: userId },
        ],
      },
    });

    if (block) {
      throw new Error('Post not found or unavailable');
    }

    const existingBookmark = await prisma.bookmark.findUnique({
      where: { userId_postId: { userId, postId } },
    });

    if (existingBookmark) {
      await prisma.bookmark.delete({
        where: { userId_postId: { userId, postId } },
      });
      return { bookmarked: false };
    } else {
      await prisma.bookmark.create({
        data: { userId, postId },
      });
      return { bookmarked: true };
    }
  }

  /**
   * Returns array of posts bookmarked by the current user,
   * ordered by bookmark createdAt DESC, with author info,
   * and resolved engagement states (isLiked, isReposted, isBookmarked).
   */
  public async getBookmarks(userId: string): Promise<PostDto[]> {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new Error('User not found');
    }

    // Check block constraints
    const blocks = await prisma.block.findMany({
      where: {
        OR: [{ blockerId: userId }, { blockedId: userId }],
      },
    });
    const blockedUserIds = new Set<string>();
    for (const b of blocks) {
      blockedUserIds.add(b.blockerId === userId ? b.blockedId : b.blockerId);
    }

    const bookmarks = await prisma.bookmark.findMany({
      where: {
        userId,
        post: {
          isDeleted: false,
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        post: {
          include: {
            author: {
              select: { id: true, username: true, displayName: true, avatarUrl: true, isCelebrity: true },
            },
            replyTo: {
              select: { id: true, author: { select: { username: true, displayName: true } } },
            },
            quoteOf: {
              include: {
                author: {
                  select: { id: true, username: true, displayName: true, avatarUrl: true, isCelebrity: true },
                },
              },
            },
          },
        },
      },
    });

    // Filter out posts authored by blocked users
    const validBookmarks = bookmarks.filter((b) => !blockedUserIds.has(b.post.authorId));

    const postIds = validBookmarks.map((b) => b.postId);

    // Batch resolve like and repost engagements
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

    return validBookmarks.map((b) => {
      const p = b.post;
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
        likesCount: p.likesCount,
        repliesCount: p.repliesCount,
        repostsCount: p.repostsCount,
        quotesCount: p.quotesCount,
        hashtags: p.hashtags,
        mentions: p.mentions,
        isLiked: likedSet.has(p.id),
        isReposted: repostedSet.has(p.id),
        isBookmarked: true,
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
              hashtags: p.quoteOf.hashtags,
              mentions: p.quoteOf.mentions,
              createdAt: p.quoteOf.createdAt.toISOString(),
              author: p.quoteOf.author,
            }
          : null,
      };
    });
  }
}

export const bookmarkService = new BookmarkService();

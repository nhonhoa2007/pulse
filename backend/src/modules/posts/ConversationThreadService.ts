import { prisma } from '../../db/PrismaClientSingleton.js';
import { ConversationThreadResponse, PostDto, ReplyPrivacy } from '../../contracts/ApiContracts.js';
import { validateReplyPermissionService } from './ValidateReplyPermissionService.js';

export class ConversationThreadService {
  /**
   * Fetches entire conversation thread for a post with 1 single SQL query.
   * Finds the rootPostId, queries all posts where id = rootId OR rootPostId = rootId,
   * checks block relations, and resolves engagement states.
   */
  public async getThread(postId: string, currentUserId?: string | null): Promise<ConversationThreadResponse | null> {
    const targetPost = await prisma.post.findUnique({
      where: { id: postId },
      select: { id: true, rootPostId: true, authorId: true, isDeleted: true },
    });

    if (!targetPost || targetPost.isDeleted) {
      return null;
    }

    const rootId = targetPost.rootPostId || targetPost.id;

    // Invariant 3: Check block constraints
    const blockedUserIds = new Set<string>();
    if (currentUserId) {
      const blocks = await prisma.block.findMany({
        where: {
          OR: [{ blockerId: currentUserId }, { blockedId: currentUserId }],
        },
      });
      for (const b of blocks) {
        blockedUserIds.add(b.blockerId === currentUserId ? b.blockedId : b.blockerId);
      }
    }

    // Step 1: Optimized single query to retrieve root post and all replies in chronological order
    const posts = await prisma.post.findMany({
      where: {
        OR: [{ id: rootId }, { rootPostId: rootId }],
        isDeleted: false,
      },
      orderBy: { createdAt: 'asc' },
      include: {
        author: {
          select: { id: true, username: true, displayName: true, avatarUrl: true, isCelebrity: true, pinnedPostId: true, isPrivate: true },
        },
        replyTo: {
          select: { id: true, author: { select: { username: true, displayName: true } } },
        },
        quoteOf: {
          include: {
            author: {
              select: { id: true, username: true, displayName: true, avatarUrl: true, isCelebrity: true, isPrivate: true },
            },
          },
        },
      },
    });

    // If root post author is blocked, return null (404)
    const rootPostRecord = posts.find((p) => p.id === rootId);
    if (!rootPostRecord || blockedUserIds.has(rootPostRecord.authorId)) {
      return null;
    }

    // TASK-21 Privacy Gate: If root post author is private, requester must be author or approved follower
    const rootAuthorIsPrivate = Boolean((rootPostRecord.author as any).isPrivate);
    const isRootOwner = currentUserId === rootPostRecord.authorId;
    if (rootAuthorIsPrivate && !isRootOwner) {
      if (!currentUserId) {
        return null;
      }
      const follow = await prisma.follow.findUnique({
        where: {
          followerId_followingId: {
            followerId: currentUserId,
            followingId: rootPostRecord.authorId,
          },
        },
      });
      if (!follow) {
        return null;
      }
    }

    // TASK-21 Privacy Gate: In conversation threads, filter out replies authored by private users
    // unless currentUserId is the author or an approved follower.
    const privateAuthorIds = new Set<string>();
    for (const p of posts) {
      if ((p.author as any)?.isPrivate && p.authorId !== currentUserId) {
        privateAuthorIds.add(p.authorId);
      }
      if (p.quoteOf && (p.quoteOf.author as any)?.isPrivate && p.quoteOf.authorId !== currentUserId) {
        privateAuthorIds.add(p.quoteOf.authorId);
      }
    }

    const followedPrivateAuthorIds = new Set<string>();
    if (currentUserId && privateAuthorIds.size > 0) {
      const follows = await prisma.follow.findMany({
        where: {
          followerId: currentUserId,
          followingId: { in: Array.from(privateAuthorIds) },
        },
        select: { followingId: true },
      });
      for (const f of follows) {
        followedPrivateAuthorIds.add(f.followingId);
      }
    }

    // Filter out any replies authored by blocked users OR private accounts not followed by viewer
    const filteredPosts = posts.filter((p) => {
      if (blockedUserIds.has(p.authorId)) return false;
      if ((p.author as any)?.isPrivate && p.authorId !== currentUserId && !followedPrivateAuthorIds.has(p.authorId)) {
        return false;
      }
      return true;
    });

    // Batch resolve like and repost engagements
    const postIds = filteredPosts.map((p) => p.id);
    const [likes, reposts] = await Promise.all([
      currentUserId
        ? prisma.like.findMany({
            where: { userId: currentUserId, postId: { in: postIds } },
            select: { postId: true },
          })
        : [],
      currentUserId
        ? prisma.repost.findMany({
            where: { userId: currentUserId, postId: { in: postIds } },
            select: { postId: true },
          })
        : [],
    ]);

    const likedSet = new Set(likes.map((l) => l.postId));
    const repostedSet = new Set(reposts.map((r) => r.postId));

    const postDtos: PostDto[] = await Promise.all(
      filteredPosts.map(async (p) => {
        const canReply = await validateReplyPermissionService.checkCanReply(currentUserId, p);
        const quoteAuthorIsPrivate = Boolean((p.quoteOf?.author as any)?.isPrivate);
        const canViewQuote =
          !quoteAuthorIsPrivate ||
          p.quoteOf?.authorId === currentUserId ||
          Boolean(currentUserId && p.quoteOf?.authorId && followedPrivateAuthorIds.has(p.quoteOf.authorId));

        return {
          id: p.id,
          authorId: p.authorId,
          content: p.content,
          mediaUrls: p.mediaUrls,
          replyToId: p.replyToId,
          rootPostId: p.rootPostId,
          repostOfId: p.repostOfId,
          quoteOfId: p.quoteOfId,
          reply_privacy: p.reply_privacy as ReplyPrivacy,
          replyPrivacy: p.reply_privacy as ReplyPrivacy,
          canReply,
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
          viewsCount: (p as any).viewsCount ?? 0,
          hashtags: p.hashtags,
          mentions: p.mentions,
          isLiked: likedSet.has(p.id),
          isReposted: repostedSet.has(p.id),
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
                reply_privacy: p.quoteOf.reply_privacy as ReplyPrivacy,
                replyPrivacy: p.quoteOf.reply_privacy as ReplyPrivacy,
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
      })
    );

    const rootPostDto = postDtos.find((p) => p.id === rootId);
    if (!rootPostDto) {
      return null;
    }

    const replies = postDtos.filter((p) => p.id !== rootId);

    return {
      rootPost: rootPostDto,
      replies,
      thread: postDtos,
    };
  }
}

export const conversationThreadService = new ConversationThreadService();

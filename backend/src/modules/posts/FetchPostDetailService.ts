import { prisma } from '../../db/PrismaClientSingleton.js';
import { PostDto, ReplyPrivacy } from '../../contracts/ApiContracts.js';
import { formatPollDto } from '../polls/PollDto.js';
import { validateReplyPermissionService } from './ValidateReplyPermissionService.js';

export class FetchPostDetailService {
  public async getPostDetail(postId: string, currentUserId?: string | null): Promise<PostDto | null> {
    const post = await prisma.post.findUnique({
      where: { id: postId },
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
              select: { id: true, username: true, displayName: true, avatarUrl: true, isCelebrity: true },
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

    if (!post || post.isDeleted) {
      return null;
    }

    // Invariant 3: Check block relationship
    if (currentUserId) {
      const block = await prisma.block.findFirst({
        where: {
          OR: [
            { blockerId: currentUserId, blockedId: post.authorId },
            { blockerId: post.authorId, blockedId: currentUserId },
          ],
        },
      });

      if (block) {
        return null;
      }
    }

    // TASK-21 Privacy Gate: If author is private, viewer must be author or approved follower
    const authorIsPrivate = Boolean((post.author as any).isPrivate);
    const isOwner = currentUserId === post.authorId;
    if (authorIsPrivate && !isOwner) {
      if (!currentUserId) {
        return null;
      }
      const follow = await prisma.follow.findUnique({
        where: {
          followerId_followingId: {
            followerId: currentUserId,
            followingId: post.authorId,
          },
        },
      });
      if (!follow) {
        return null;
      }
    }

    let isLiked = false;
    let isReposted = false;
    let isBookmarked = false;

    if (currentUserId) {
      const [like, repost, bookmark] = await Promise.all([
        prisma.like.findUnique({
          where: { userId_postId: { userId: currentUserId, postId } },
        }),
        prisma.repost.findUnique({
          where: { userId_postId: { userId: currentUserId, postId } },
        }),
        prisma.bookmark.findUnique({
          where: { userId_postId: { userId: currentUserId, postId } },
        }),
      ]);
      isLiked = !!like;
      isReposted = !!repost;
      isBookmarked = !!bookmark;
    }

    const canReply = await validateReplyPermissionService.checkCanReply(currentUserId, post);

    return {
      id: post.id,
      authorId: post.authorId,
      content: post.content,
      mediaUrls: post.mediaUrls,
      replyToId: post.replyToId,
      rootPostId: post.rootPostId,
      repostOfId: post.repostOfId,
      quoteOfId: post.quoteOfId,
      reply_privacy: post.reply_privacy as ReplyPrivacy,
      replyPrivacy: post.reply_privacy as ReplyPrivacy,
      canReply,
      isEdited: post.isEdited,
      editCount: post.editCount,
      lastEditedAt: post.lastEditedAt ? post.lastEditedAt.toISOString() : null,
      isPinned: (post.author as any).pinnedPostId === post.id,
      isSensitive: post.isSensitive,
      contentWarning: post.contentWarning,
      likesCount: post.likesCount,
      repliesCount: post.repliesCount,
      repostsCount: post.repostsCount,
      quotesCount: post.quotesCount,
      viewsCount: post.viewsCount ?? 0,
      hashtags: post.hashtags,
      mentions: post.mentions,
      isLiked,
      isReposted,
      isBookmarked,
      poll: post.poll ? formatPollDto(post.poll, currentUserId) : null,
      createdAt: post.createdAt.toISOString(),
      author: post.author,
      replyTo: post.replyTo,
      quoteOf: post.quoteOf
        ? {
            id: post.quoteOf.id,
            authorId: post.quoteOf.authorId,
            content: post.quoteOf.content,
            mediaUrls: post.quoteOf.mediaUrls,
            replyToId: post.quoteOf.replyToId,
            rootPostId: post.quoteOf.rootPostId,
            repostOfId: post.quoteOf.repostOfId,
            quoteOfId: post.quoteOf.quoteOfId,
            reply_privacy: post.quoteOf.reply_privacy as ReplyPrivacy,
            replyPrivacy: post.quoteOf.reply_privacy as ReplyPrivacy,
            likesCount: post.quoteOf.likesCount,
            repliesCount: post.quoteOf.repliesCount,
            repostsCount: post.quoteOf.repostsCount,
            quotesCount: post.quoteOf.quotesCount,
            viewsCount: (post.quoteOf as any).viewsCount ?? 0,
            hashtags: post.quoteOf.hashtags,
            mentions: post.quoteOf.mentions,
            createdAt: post.quoteOf.createdAt.toISOString(),
            author: post.quoteOf.author,
          }
        : null,
    };
  }
}

export const fetchPostDetailService = new FetchPostDetailService();

import { prisma } from '../../db/PrismaClientSingleton.js';
import { ReplyPrivacy } from '../../contracts/ApiContracts.js';

export interface ReplyPermissionResult {
  allowed: boolean;
  statusCode?: number;
  code?: string;
  message?: string;
}

export class ReplyRestrictedError extends Error {
  public statusCode: number;
  public code: string;

  constructor(message: string, code = 'REPLY_RESTRICTED', statusCode = 403) {
    super(message);
    this.name = 'ReplyRestrictedError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export class ValidateReplyPermissionService {
  /**
   * Strictly validates whether a user is permitted to reply to a given post.
   * Evaluates:
   * 1. Existence and deletion status of target post and root post
   * 2. Social graph block invariants (both blocker and blocked)
   * 3. Author bypass (author can always reply to own post)
   * 4. Root conversation privacy controls (thread-level inheritance)
   * 5. Parent post privacy controls (EVERYONE, FOLLOWING, MENTIONED)
   */
  public async validate(requesterId: string, replyToId: string): Promise<ReplyPermissionResult> {
    if (!requesterId) {
      return {
        allowed: false,
        statusCode: 401,
        code: 'UNAUTHORIZED',
        message: 'Authentication required to reply',
      };
    }

    const requester = await prisma.user.findUnique({
      where: { id: requesterId },
      select: { id: true, username: true },
    });

    if (!requester) {
      return {
        allowed: false,
        statusCode: 401,
        code: 'UNAUTHORIZED',
        message: 'Requester account not found',
      };
    }

    const parentPost = await prisma.post.findUnique({
      where: { id: replyToId },
      select: {
        id: true,
        authorId: true,
        reply_privacy: true,
        replyToId: true,
        rootPostId: true,
        mentions: true,
        isDeleted: true,
        author: {
          select: { isPrivate: true },
        },
      },
    });

    if (!parentPost || parentPost.isDeleted) {
      return {
        allowed: false,
        statusCode: 404,
        code: 'POST_NOT_FOUND',
        message: 'Parent post not found or has been deleted',
      };
    }

    // Block invariant check with parent post author
    const directBlock = await prisma.block.findFirst({
      where: {
        OR: [
          { blockerId: requesterId, blockedId: parentPost.authorId },
          { blockerId: parentPost.authorId, blockedId: requesterId },
        ],
      },
    });

    if (directBlock) {
      return {
        allowed: false,
        statusCode: 403,
        code: 'FORBIDDEN',
        message: 'You cannot reply to this post because of block privacy settings',
      };
    }

    // Author can always reply to their own post
    const isParentAuthor = requesterId === parentPost.authorId;

    // TASK-21 Privacy Invariant: If parent post author is private, non-author must be an approved follower
    if (parentPost.author?.isPrivate && !isParentAuthor) {
      const follow = await prisma.follow.findUnique({
        where: {
          followerId_followingId: {
            followerId: requesterId,
            followingId: parentPost.authorId,
          },
        },
      });
      if (!follow) {
        return {
          allowed: false,
          statusCode: 403,
          code: 'FORBIDDEN',
          message: 'Cannot reply to a post from a private account you do not follow',
        };
      }
    }

    // Resolve true root post id for deep threads (fall back to parentPost.replyToId if rootPostId is unlinked)
    let resolvedRootId = parentPost.rootPostId;
    if (!resolvedRootId && parentPost.replyToId) {
      const immediateParent = await prisma.post.findUnique({
        where: { id: parentPost.replyToId },
        select: { id: true, rootPostId: true },
      });
      resolvedRootId = immediateParent?.rootPostId || immediateParent?.id || null;
    }

    let isRootAuthor = false;

    // Check Root Post constraints if parent is part of a deeper thread
    if (resolvedRootId && resolvedRootId !== parentPost.id) {
      const rootPost = await prisma.post.findUnique({
        where: { id: resolvedRootId },
        select: {
          id: true,
          authorId: true,
          reply_privacy: true,
          mentions: true,
          isDeleted: true,
          author: {
            select: { isPrivate: true },
          },
        },
      });

      if (!rootPost || rootPost.isDeleted) {
        return {
          allowed: false,
          statusCode: 404,
          code: 'POST_NOT_FOUND',
          message: 'Root post not found or has been deleted',
        };
      }

      // Block invariant check with root post author
      const rootBlock = await prisma.block.findFirst({
        where: {
          OR: [
            { blockerId: requesterId, blockedId: rootPost.authorId },
            { blockerId: rootPost.authorId, blockedId: requesterId },
          ],
        },
      });

      if (rootBlock) {
        return {
          allowed: false,
          statusCode: 403,
          code: 'FORBIDDEN',
          message: 'You cannot reply in this conversation thread because of block privacy settings',
        };
      }

      isRootAuthor = requesterId === rootPost.authorId;

      // TASK-21 Privacy Invariant: If root post author is private, non-author must be an approved follower
      if (rootPost.author?.isPrivate && !isRootAuthor) {
        const rootFollow = await prisma.follow.findUnique({
          where: {
            followerId_followingId: {
              followerId: requesterId,
              followingId: rootPost.authorId,
            },
          },
        });
        if (!rootFollow) {
          return {
            allowed: false,
            statusCode: 403,
            code: 'FORBIDDEN',
            message: 'Cannot reply in a thread started by a private account you do not follow',
          };
        }
      }

      // Root post reply privacy evaluation if requester is not root author
      if (!isRootAuthor) {
        const rootPrivacy = (rootPost.reply_privacy as ReplyPrivacy) || 'EVERYONE';

        if (rootPrivacy === 'FOLLOWING') {
          const authorFollowsRequester = await prisma.follow.findUnique({
            where: {
              followerId_followingId: {
                followerId: rootPost.authorId,
                followingId: requesterId,
              },
            },
          });

          if (!authorFollowsRequester) {
            return {
              allowed: false,
              statusCode: 403,
              code: 'REPLY_RESTRICTED',
              message: 'Only users followed by the author can reply in this thread',
            };
          }
        } else if (rootPrivacy === 'MENTIONED') {
          const isMentionedInRoot = rootPost.mentions.some(
            (m) => m.toLowerCase() === requester.username.toLowerCase() || m === requesterId
          );

          if (!isMentionedInRoot) {
            return {
              allowed: false,
              statusCode: 403,
              code: 'REPLY_RESTRICTED',
              message: 'Only users mentioned in this post can reply in this thread',
            };
          }
        }
      }
    }

    // If requester is author of parent post or root post of the thread, they are permitted to reply
    if (isParentAuthor || isRootAuthor) {
      return { allowed: true };
    }

    // Parent post reply privacy evaluation
    const parentPrivacy = (parentPost.reply_privacy as ReplyPrivacy) || 'EVERYONE';

    if (parentPrivacy === 'FOLLOWING') {
      const authorFollowsRequester = await prisma.follow.findUnique({
        where: {
          followerId_followingId: {
            followerId: parentPost.authorId,
            followingId: requesterId,
          },
        },
      });

      if (!authorFollowsRequester) {
        return {
          allowed: false,
          statusCode: 403,
          code: 'REPLY_RESTRICTED',
          message: 'Only users followed by the author can reply to this post',
        };
      }
    } else if (parentPrivacy === 'MENTIONED') {
      const isMentionedInParent = parentPost.mentions.some(
        (m) => m.toLowerCase() === requester.username.toLowerCase() || m === requesterId
      );

      if (!isMentionedInParent) {
        return {
          allowed: false,
          statusCode: 403,
          code: 'REPLY_RESTRICTED',
          message: 'Only users mentioned in this post can reply',
        };
      }
    }

    return { allowed: true };
  }

  /**
   * Helper to evaluate canReply flag for post detail / thread retrieval.
   */
  public async checkCanReply(
    requesterId: string | null | undefined,
    post: {
      id: string;
      authorId: string;
      reply_privacy: string;
      mentions: string[];
      rootPostId?: string | null;
    }
  ): Promise<boolean> {
    if (!requesterId) {
      return false;
    }

    try {
      const result = await this.validate(requesterId, post.id);
      return result.allowed;
    } catch {
      return false;
    }
  }
}

export const validateReplyPermissionService = new ValidateReplyPermissionService();

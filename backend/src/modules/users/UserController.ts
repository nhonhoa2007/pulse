import { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../db/PrismaClientSingleton.js';
import { formatPollDto } from '../polls/PollDto.js';
import { postImpressionsBufferService } from '../posts/PostImpressionsBufferService.js';
import {
  ApiResponse,
  UserDto,
  UpdateProfileInput,
  FeedResponse,
  PostDto,
  ReplyPrivacy,
} from '../../contracts/ApiContracts.js';

interface UserParams {
  username: string;
}

interface UserPostsQueryParams {
  cursor?: string;
  limit?: string;
}

export class UserController {
  public async getMe(
    req: FastifyRequest,
    reply: FastifyReply
  ): Promise<ApiResponse<UserDto>> {
    const currentUserId = (req as unknown as { currentUserId?: string | null }).currentUserId;

    if (!currentUserId) {
      reply.status(401);
      return {
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required via x-user-id header' },
      };
    }

    const user = await prisma.user.findUnique({
      where: { id: currentUserId },
    });

    if (!user) {
      reply.status(404);
      return {
        success: false,
        error: { code: 'USER_NOT_FOUND', message: 'User not found' },
      };
    }

    return {
      success: true,
      data: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        bio: user.bio,
        isCelebrity: user.isCelebrity,
        isPrivate: Boolean(user.isPrivate),
        followersCount: user.followersCount,
        followingCount: user.followingCount,
        postsCount: user.postsCount,
        createdAt: user.createdAt.toISOString(),
      },
    };
  }

  public async getProfile(
    req: FastifyRequest<{ Params: UserParams }>,
    reply: FastifyReply
  ): Promise<ApiResponse<UserDto>> {
    const { username } = req.params;
    const currentUserId = (req as unknown as { currentUserId?: string | null }).currentUserId;

    const user = await prisma.user.findUnique({
      where: { username },
    });

    if (!user) {
      reply.status(404);
      return {
        success: false,
        error: { code: 'USER_NOT_FOUND', message: 'User not found' },
      };
    }

    let isFollowing = false;
    let isBlocked = false;

    if (currentUserId) {
      // Check if current user has been blocked by target user
      const blockedByTarget = await prisma.block.findUnique({
        where: {
          blockerId_blockedId: {
            blockerId: user.id,
            blockedId: currentUserId,
          },
        },
      });

      // Invariant 3: If target user blocked current user, return 404 Not Found
      if (blockedByTarget) {
        reply.status(404);
        return {
          success: false,
          error: { code: 'USER_NOT_FOUND', message: 'User not found or unavailable' },
        };
      }

      // Check if current user has blocked the target user
      const blockedByCurrentUser = await prisma.block.findUnique({
        where: {
          blockerId_blockedId: {
            blockerId: currentUserId,
            blockedId: user.id,
          },
        },
      });

      isBlocked = !!blockedByCurrentUser;

      // Check following status
      const follow = await prisma.follow.findUnique({
        where: {
          followerId_followingId: {
            followerId: currentUserId,
            followingId: user.id,
          },
        },
      });

      isFollowing = !!follow;
    }

    const isOwner = currentUserId === user.id;
    const isLocked = Boolean(user.isPrivate && !isOwner && !isFollowing);

    let hasPendingFollowRequest = false;
    if (currentUserId && !isOwner && !isFollowing && user.isPrivate) {
      const pendingReq = await prisma.followRequest.findUnique({
        where: {
          unique_follow_request: {
            requesterId: currentUserId,
            targetUserId: user.id,
          },
        },
      });
      hasPendingFollowRequest = Boolean(pendingReq && pendingReq.status === 'PENDING');
    }

    const data: UserDto = {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      bio: user.bio,
      isCelebrity: user.isCelebrity,
      isPrivate: Boolean(user.isPrivate),
      followersCount: user.followersCount,
      followingCount: user.followingCount,
      postsCount: user.postsCount,
      isFollowing,
      isBlocked,
      isLocked,
      hasPendingFollowRequest,
      createdAt: user.createdAt.toISOString(),
    };

    return {
      success: true,
      data,
    };
  }

  public async updateProfile(
    req: FastifyRequest<{ Body: UpdateProfileInput }>,
    reply: FastifyReply
  ): Promise<ApiResponse<UserDto>> {
    const currentUserId = (req as unknown as { currentUserId?: string | null }).currentUserId;

    if (!currentUserId) {
      reply.status(401);
      return {
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      };
    }

    const { displayName, bio, avatarUrl, isPrivate } = req.body || {};

    if (isPrivate !== undefined && typeof isPrivate !== 'boolean') {
      reply.status(400);
      return {
        success: false,
        error: { code: 'INVALID_IS_PRIVATE', message: 'isPrivate phải là kiểu boolean' },
      };
    }

    if (displayName !== undefined) {
      if (typeof displayName !== 'string' || displayName.trim().length === 0) {
        reply.status(400);
        return {
          success: false,
          error: { code: 'INVALID_DISPLAY_NAME', message: 'Tên hiển thị không được để trống' },
        };
      }
    }

    if (bio !== undefined && bio !== null && typeof bio !== 'string') {
      reply.status(400);
      return {
        success: false,
        error: { code: 'INVALID_BIO', message: 'Tiểu sử không hợp lệ' },
      };
    }

    if (avatarUrl !== undefined && avatarUrl !== null && typeof avatarUrl !== 'string') {
      reply.status(400);
      return {
        success: false,
        error: { code: 'INVALID_AVATAR_URL', message: 'Ảnh đại diện không hợp lệ' },
      };
    }

    try {
      const updatedUser = await prisma.user.update({
        where: { id: currentUserId },
        data: {
          ...(displayName !== undefined ? { displayName: displayName.trim() } : {}),
          ...(bio !== undefined ? { bio: bio === null ? null : bio.trim() } : {}),
          ...(avatarUrl !== undefined ? { avatarUrl: avatarUrl === null ? null : avatarUrl.trim() } : {}),
          ...(isPrivate !== undefined ? { isPrivate } : {}),
        },
      });

      return {
        success: true,
        data: {
          id: updatedUser.id,
          username: updatedUser.username,
          displayName: updatedUser.displayName,
          avatarUrl: updatedUser.avatarUrl,
          bio: updatedUser.bio,
          isCelebrity: updatedUser.isCelebrity,
          isPrivate: Boolean(updatedUser.isPrivate),
          followersCount: updatedUser.followersCount,
          followingCount: updatedUser.followingCount,
          postsCount: updatedUser.postsCount,
          createdAt: updatedUser.createdAt.toISOString(),
        },
      };
    } catch {
      reply.status(404);
      return {
        success: false,
        error: { code: 'USER_NOT_FOUND', message: 'User not found' },
      };
    }
  }

  public async getUserPosts(
    req: FastifyRequest<{ Params: UserParams; Querystring: UserPostsQueryParams }>,
    reply: FastifyReply
  ): Promise<ApiResponse<FeedResponse>> {
    const { username } = req.params;
    const { cursor, limit } = req.query;
    const currentUserId = req.currentUserId;
    const parsedLimit = limit ? parseInt(limit, 10) : 20;

    const targetUser = await prisma.user.findUnique({
      where: { username },
      select: { id: true, pinnedPostId: true, isPrivate: true },
    });

    if (!targetUser) {
      reply.status(404);
      return {
        success: false,
        error: { code: 'USER_NOT_FOUND', message: 'User not found' },
      };
    }

    // Check block invariant
    if (currentUserId) {
      const block = await prisma.block.findFirst({
        where: {
          OR: [
            { blockerId: currentUserId, blockedId: targetUser.id },
            { blockerId: targetUser.id, blockedId: currentUserId },
          ],
        },
      });

      if (block) {
        reply.status(404);
        return {
          success: false,
          error: { code: 'USER_NOT_FOUND', message: 'User not found' },
        };
      }
    }

    // Privacy lock invariant: If target user is private, requester must be owner or approved follower
    const isOwner = currentUserId === targetUser.id;
    let isFollowing = false;
    if (currentUserId && !isOwner) {
      const follow = await prisma.follow.findUnique({
        where: {
          followerId_followingId: {
            followerId: currentUserId,
            followingId: targetUser.id,
          },
        },
      });
      isFollowing = Boolean(follow);
    }

    if (targetUser.isPrivate && !isOwner && !isFollowing) {
      return {
        success: true,
        data: {
          posts: [],
          nextCursor: null,
          isLocked: true,
        },
      };
    }

    const postInclude = {
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
      poll: {
        include: {
          choices: true,
          votes: true,
        },
      },
    };

    let pinnedPostRecord: any = null;
    if (!cursor && targetUser.pinnedPostId) {
      pinnedPostRecord = await prisma.post.findUnique({
        where: { id: targetUser.pinnedPostId, isDeleted: false },
        include: postInclude,
      });

      if (!pinnedPostRecord) {
        await prisma.user.update({
          where: { id: targetUser.id },
          data: { pinnedPostId: null },
        });
      }
    }

    const cursorDate = cursor ? new Date(cursor) : undefined;
    const regularPostsLimit = pinnedPostRecord ? Math.max(parsedLimit - 1, 1) : parsedLimit;

    const posts = await prisma.post.findMany({
      where: {
        authorId: targetUser.id,
        isDeleted: false,
        ...(targetUser.pinnedPostId ? { id: { not: targetUser.pinnedPostId } } : {}),
        ...(cursorDate ? { createdAt: { lt: cursorDate } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: regularPostsLimit,
      include: postInclude,
    });

    const allPostsToMap = pinnedPostRecord ? [pinnedPostRecord, ...posts] : posts;
    const postIds = allPostsToMap.map((p) => p.id);

    const [likes, reposts] = await Promise.all([
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
    ]);

    const likedSet = new Set(likes.map((l) => l.postId));
    const repostedSet = new Set(reposts.map((r) => r.postId));

    const postDtos: PostDto[] = allPostsToMap.map((p) => {
      const isPinned = p.id === targetUser.pinnedPostId;
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
        isPinned,
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
        poll: (p as any).poll ? formatPollDto((p as any).poll, currentUserId) : null,
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
      };
    });

    const nextCursor =
      posts.length === regularPostsLimit && posts.length > 0
        ? posts[posts.length - 1].createdAt.toISOString()
        : null;

    return {
      success: true,
      data: {
        posts: postDtos,
        nextCursor,
      },
    };
  }

  public async getUserFollowers(
    req: FastifyRequest<{ Params: UserParams }>,
    reply: FastifyReply
  ): Promise<ApiResponse<{ users: UserDto[]; isLocked?: boolean }>> {
    const { username } = req.params;
    const currentUserId = req.currentUserId;

    const user = await prisma.user.findUnique({
      where: { username },
    });

    if (!user) {
      reply.status(404);
      return {
        success: false,
        error: { code: 'USER_NOT_FOUND', message: 'User not found' },
      };
    }

    const isOwner = currentUserId === user.id;
    let isFollowing = false;
    if (currentUserId && !isOwner) {
      const follow = await prisma.follow.findUnique({
        where: {
          followerId_followingId: {
            followerId: currentUserId,
            followingId: user.id,
          },
        },
      });
      isFollowing = Boolean(follow);
    }

    // Privacy gate: Hide followers if private and not following
    if (user.isPrivate && !isOwner && !isFollowing) {
      reply.status(403);
      return {
        success: false,
        error: {
          code: 'ACCOUNT_LOCKED',
          message: 'Tài khoản này là riêng tư. Hãy theo dõi để xem danh sách người theo dõi.',
        },
      };
    }

    const follows = await prisma.follow.findMany({
      where: { followingId: user.id },
      include: {
        follower: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    return {
      success: true,
      data: {
        users: follows.map((f) => ({
          id: f.follower.id,
          username: f.follower.username,
          displayName: f.follower.displayName,
          avatarUrl: f.follower.avatarUrl,
          bio: f.follower.bio,
          isCelebrity: f.follower.isCelebrity,
          followersCount: f.follower.followersCount,
          followingCount: f.follower.followingCount,
          postsCount: f.follower.postsCount,
          isPrivate: Boolean(f.follower.isPrivate),
          createdAt: f.follower.createdAt.toISOString(),
        })),
        isLocked: false,
      },
    };
  }

  public async getUserFollowing(
    req: FastifyRequest<{ Params: UserParams }>,
    reply: FastifyReply
  ): Promise<ApiResponse<{ users: UserDto[]; isLocked?: boolean }>> {
    const { username } = req.params;
    const currentUserId = req.currentUserId;

    const user = await prisma.user.findUnique({
      where: { username },
    });

    if (!user) {
      reply.status(404);
      return {
        success: false,
        error: { code: 'USER_NOT_FOUND', message: 'User not found' },
      };
    }

    const isOwner = currentUserId === user.id;
    let isFollowing = false;
    if (currentUserId && !isOwner) {
      const follow = await prisma.follow.findUnique({
        where: {
          followerId_followingId: {
            followerId: currentUserId,
            followingId: user.id,
          },
        },
      });
      isFollowing = Boolean(follow);
    }

    // Privacy gate: Hide following list if private and not following
    if (user.isPrivate && !isOwner && !isFollowing) {
      reply.status(403);
      return {
        success: false,
        error: {
          code: 'ACCOUNT_LOCKED',
          message: 'Tài khoản này là riêng tư. Hãy theo dõi để xem danh sách đang theo dõi.',
        },
      };
    }

    const follows = await prisma.follow.findMany({
      where: { followerId: user.id },
      include: {
        following: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    return {
      success: true,
      data: {
        users: follows.map((f) => ({
          id: f.following.id,
          username: f.following.username,
          displayName: f.following.displayName,
          avatarUrl: f.following.avatarUrl,
          bio: f.following.bio,
          isCelebrity: f.following.isCelebrity,
          followersCount: f.following.followersCount,
          followingCount: f.following.followingCount,
          postsCount: f.following.postsCount,
          isPrivate: Boolean(f.following.isPrivate),
          createdAt: f.following.createdAt.toISOString(),
        })),
        isLocked: false,
      },
    };
  }
}

export const userController = new UserController();

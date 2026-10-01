import { prisma } from '../../db/PrismaClientSingleton.js';
import { notificationAggregatorService } from '../notifications/NotificationAggregatorService.js';
import { FollowActionResponse, FollowRequestDto } from '../../contracts/ApiContracts.js';

export class FollowUserService {
  public async follow(followerId: string, followingId: string): Promise<FollowActionResponse> {
    if (followerId === followingId) {
      const err = new Error('You cannot follow yourself');
      (err as any).statusCode = 400;
      (err as any).code = 'CANNOT_FOLLOW_SELF';
      throw err;
    }

    const [follower, following] = await Promise.all([
      prisma.user.findUnique({ where: { id: followerId } }),
      prisma.user.findUnique({ where: { id: followingId } }),
    ]);

    if (!follower || !following) {
      const err = new Error('User not found');
      (err as any).statusCode = 404;
      (err as any).code = 'USER_NOT_FOUND';
      throw err;
    }

    // Invariant 3: Check block constraints
    const isBlocked = await prisma.block.findFirst({
      where: {
        OR: [
          { blockerId: followerId, blockedId: followingId },
          { blockerId: followingId, blockedId: followerId },
        ],
      },
    });

    if (isBlocked) {
      const err = new Error('Cannot follow this user due to block restrictions');
      (err as any).statusCode = 403;
      (err as any).code = 'USER_BLOCKED';
      throw err;
    }

    // Check if already following
    const existingFollow = await prisma.follow.findUnique({
      where: { followerId_followingId: { followerId, followingId } },
    });

    if (existingFollow) {
      return {
        status: 'FOLLOWING',
        following: true,
        isFollowing: true,
        hasPendingFollowRequest: false,
        followRequest: null,
      };
    }

    // Check if target user has a private account
    if (following.isPrivate) {
      const userSelect = { id: true, username: true, displayName: true, avatarUrl: true };

      const existingReq = await prisma.followRequest.findUnique({
        where: {
          unique_follow_request: {
            requesterId: followerId,
            targetUserId: followingId,
          },
        },
        include: {
          requester: { select: userSelect },
          targetUser: { select: userSelect },
        },
      });

      if (existingReq) {
        if (existingReq.status === 'PENDING') {
          return {
            status: 'REQUESTED',
            following: false,
            isFollowing: false,
            hasPendingFollowRequest: true,
            followRequest: {
              id: existingReq.id,
              requesterId: existingReq.requesterId,
              targetUserId: existingReq.targetUserId,
              status: 'PENDING',
              requester: existingReq.requester,
              targetUser: existingReq.targetUser,
              createdAt: existingReq.createdAt.toISOString(),
              updatedAt: existingReq.updatedAt.toISOString(),
            },
          };
        }

        if (existingReq.status === 'REJECTED') {
          const updatedReq = await prisma.followRequest.update({
            where: { id: existingReq.id },
            data: { status: 'PENDING', updatedAt: new Date() },
            include: {
              requester: { select: userSelect },
              targetUser: { select: userSelect },
            },
          });

          await notificationAggregatorService.recordNotification({
            recipientId: followingId,
            actorId: followerId,
            verb: 'FOLLOW_REQUEST',
            targetType: 'USER',
            targetId: followerId,
          });

          return {
            status: 'REQUESTED',
            following: false,
            isFollowing: false,
            hasPendingFollowRequest: true,
            followRequest: {
              id: updatedReq.id,
              requesterId: updatedReq.requesterId,
              targetUserId: updatedReq.targetUserId,
              status: 'PENDING',
              requester: updatedReq.requester,
              targetUser: updatedReq.targetUser,
              createdAt: updatedReq.createdAt.toISOString(),
              updatedAt: updatedReq.updatedAt.toISOString(),
            },
          };
        }
      }

      // Create new FollowRequest
      const createdReq = await prisma.followRequest.create({
        data: {
          requesterId: followerId,
          targetUserId: followingId,
          status: 'PENDING',
        },
        include: {
          requester: { select: userSelect },
          targetUser: { select: userSelect },
        },
      });

      await notificationAggregatorService.recordNotification({
        recipientId: followingId,
        actorId: followerId,
        verb: 'FOLLOW_REQUEST',
        targetType: 'USER',
        targetId: followerId,
      });

      return {
        status: 'REQUESTED',
        following: false,
        isFollowing: false,
        hasPendingFollowRequest: true,
        followRequest: {
          id: createdReq.id,
          requesterId: createdReq.requesterId,
          targetUserId: createdReq.targetUserId,
          status: 'PENDING',
          requester: createdReq.requester,
          targetUser: createdReq.targetUser,
          createdAt: createdReq.createdAt.toISOString(),
          updatedAt: createdReq.updatedAt.toISOString(),
        },
      };
    }

    // Public account: direct follow
    await prisma.$transaction(async (tx) => {
      const existing = await tx.follow.findUnique({
        where: { followerId_followingId: { followerId, followingId } },
      });

      if (existing) {
        return;
      }

      await tx.follow.create({
        data: { followerId, followingId },
      });

      await tx.user.update({
        where: { id: followerId },
        data: { followingCount: { increment: 1 } },
      });

      await tx.user.update({
        where: { id: followingId },
        data: { followersCount: { increment: 1 } },
      });

      // If the target is not a celebrity, backfill their recent posts into follower's inbox
      if (!following.isCelebrity) {
        const recentPosts = await tx.post.findMany({
          where: { authorId: followingId, isDeleted: false },
          orderBy: { createdAt: 'desc' },
          take: 50,
          select: { id: true, createdAt: true },
        });

        if (recentPosts.length > 0) {
          await tx.timelineInbox.createMany({
            data: recentPosts.map((p) => ({
              userId: followerId,
              postId: p.id,
              authorId: followingId,
              createdAt: p.createdAt,
            })),
            skipDuplicates: true,
          });
        }
      }
    });

    // Notify target user
    await notificationAggregatorService.recordNotification({
      recipientId: followingId,
      actorId: followerId,
      verb: 'FOLLOW',
      targetType: 'USER',
      targetId: followerId,
    });

    return {
      status: 'FOLLOWING',
      following: true,
      isFollowing: true,
      hasPendingFollowRequest: false,
      followRequest: null,
    };
  }
}

export const followUserService = new FollowUserService();

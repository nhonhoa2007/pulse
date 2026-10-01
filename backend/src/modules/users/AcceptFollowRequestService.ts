import { prisma } from '../../db/PrismaClientSingleton.js';
import { notificationAggregatorService } from '../notifications/NotificationAggregatorService.js';
import { FollowRequestDto } from '../../contracts/ApiContracts.js';

export class AcceptFollowRequestService {
  /**
   * Accepts a pending follow request:
   * 1. Authorization guard: Only the recipient (targetUserId) can approve
   * 2. Atomic PostgreSQL transaction:
   *    - FollowRequest status -> ACCEPTED
   *    - Follow record inserted
   *    - followersCount and followingCount incremented
   *    - Recent posts backfilled into requester's TimelineInbox (if non-celebrity)
   * 3. Notification verb 'FOLLOW_ACCEPT' emitted to requester
   */
  public async accept(requestId: string, currentUserId: string): Promise<FollowRequestDto> {
    const request = await prisma.followRequest.findUnique({
      where: { id: requestId },
      include: {
        requester: {
          select: { id: true, username: true, displayName: true, avatarUrl: true },
        },
        targetUser: {
          select: { id: true, username: true, displayName: true, avatarUrl: true, isCelebrity: true },
        },
      },
    });

    if (!request) {
      const err = new Error('Yêu cầu theo dõi không tồn tại');
      (err as any).statusCode = 404;
      (err as any).code = 'FOLLOW_REQUEST_NOT_FOUND';
      throw err;
    }

    if (request.targetUserId !== currentUserId) {
      const err = new Error('Bạn không có quyền duyệt yêu cầu này');
      (err as any).statusCode = 403;
      (err as any).code = 'FORBIDDEN';
      throw err;
    }

    if (request.status === 'ACCEPTED') {
      return {
        id: request.id,
        requesterId: request.requesterId,
        targetUserId: request.targetUserId,
        status: 'ACCEPTED',
        requester: request.requester,
        targetUser: request.targetUser,
        createdAt: request.createdAt.toISOString(),
        updatedAt: request.updatedAt.toISOString(),
      };
    }

    // Two-Way Block Guard
    const isBlocked = await prisma.block.findFirst({
      where: {
        OR: [
          { blockerId: request.requesterId, blockedId: request.targetUserId },
          { blockerId: request.targetUserId, blockedId: request.requesterId },
        ],
      },
    });

    if (isBlocked) {
      const err = new Error('Không thể duyệt yêu cầu theo dõi do giới hạn chặn');
      (err as any).statusCode = 403;
      (err as any).code = 'USER_BLOCKED';
      throw err;
    }

    const updatedRequest = await prisma.$transaction(async (tx) => {
      const updated = await tx.followRequest.update({
        where: { id: requestId },
        data: { status: 'ACCEPTED' },
      });

      const existingFollow = await tx.follow.findUnique({
        where: {
          followerId_followingId: {
            followerId: request.requesterId,
            followingId: request.targetUserId,
          },
        },
      });

      if (!existingFollow) {
        await tx.follow.create({
          data: {
            followerId: request.requesterId,
            followingId: request.targetUserId,
          },
        });

        await tx.user.update({
          where: { id: request.requesterId },
          data: { followingCount: { increment: 1 } },
        });

        await tx.user.update({
          where: { id: request.targetUserId },
          data: { followersCount: { increment: 1 } },
        });

        // Inbox Backfill for non-celebrity private accounts
        if (!request.targetUser.isCelebrity) {
          const recentPosts = await tx.post.findMany({
            where: { authorId: request.targetUserId, isDeleted: false },
            orderBy: { createdAt: 'desc' },
            take: 50,
            select: { id: true, createdAt: true },
          });

          if (recentPosts.length > 0) {
            await tx.timelineInbox.createMany({
              data: recentPosts.map((p) => ({
                userId: request.requesterId,
                postId: p.id,
                authorId: request.targetUserId,
                createdAt: p.createdAt,
              })),
              skipDuplicates: true,
            });
          }
        }
      }

      return updated;
    });

    // Send Real-time Notification
    await notificationAggregatorService.recordNotification({
      recipientId: request.requesterId,
      actorId: request.targetUserId,
      verb: 'FOLLOW_ACCEPT',
      targetType: 'USER',
      targetId: request.targetUserId,
    });

    return {
      id: updatedRequest.id,
      requesterId: updatedRequest.requesterId,
      targetUserId: updatedRequest.targetUserId,
      status: 'ACCEPTED',
      requester: request.requester,
      targetUser: request.targetUser,
      createdAt: updatedRequest.createdAt.toISOString(),
      updatedAt: updatedRequest.updatedAt.toISOString(),
    };
  }
}

export const acceptFollowRequestService = new AcceptFollowRequestService();

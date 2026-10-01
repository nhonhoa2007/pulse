import { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../db/PrismaClientSingleton.js';
import { ApiResponse, NotificationDto } from '../../contracts/ApiContracts.js';

export class NotificationController {
  public async getNotifications(
    req: FastifyRequest,
    reply: FastifyReply
  ): Promise<ApiResponse<NotificationDto[]>> {
    const currentUserId = (req as unknown as { currentUserId?: string | null }).currentUserId;

    if (!currentUserId) {
      reply.status(401);
      return {
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      };
    }

    const userMutes = await prisma.userMute.findMany({
      where: { muterId: currentUserId },
      select: { mutedId: true },
    });
    const mutedIds = userMutes.map((m) => m.mutedId);

    const notifications = await prisma.notification.findMany({
      where: {
        recipientId: currentUserId,
        ...(mutedIds.length > 0 ? { actorId: { notIn: mutedIds } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        actor: {
          select: { username: true, displayName: true, avatarUrl: true },
        },
      },
    });

    const data: NotificationDto[] = notifications.map((n) => ({
      id: n.id,
      recipientId: n.recipientId,
      actorId: n.actorId,
      verb: n.verb as NotificationDto['verb'],
      targetType: n.targetType as NotificationDto['targetType'],
      targetId: n.targetId,
      aggregatedCount: n.aggregatedCount,
      actorSummary: n.actorSummary,
      isRead: n.isRead,
      createdAt: n.createdAt.toISOString(),
      actor: {
        username: n.actor.username,
        displayName: n.actor.displayName,
        avatarUrl: n.actor.avatarUrl,
      },
    }));

    return {
      success: true,
      data,
    };
  }

  public async markAllAsRead(
    req: FastifyRequest,
    reply: FastifyReply
  ): Promise<ApiResponse<{ markedCount: number }>> {
    const currentUserId = (req as unknown as { currentUserId?: string | null }).currentUserId;

    if (!currentUserId) {
      reply.status(401);
      return {
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      };
    }

    const result = await prisma.notification.updateMany({
      where: {
        recipientId: currentUserId,
        isRead: false,
      },
      data: {
        isRead: true,
      },
    });

    return {
      success: true,
      data: { markedCount: result.count },
    };
  }
}

export const notificationController = new NotificationController();

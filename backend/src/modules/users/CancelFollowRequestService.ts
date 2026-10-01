import { prisma } from '../../db/PrismaClientSingleton.js';

export class CancelFollowRequestService {
  /**
   * Cancels a pending follow request initiated by currentUserId.
   * Parameter can be targetUserId or requestId.
   */
  public async cancel(targetUserIdOrRequestId: string, currentUserId: string): Promise<boolean> {
    const existing = await prisma.followRequest.findFirst({
      where: {
        requesterId: currentUserId,
        status: 'PENDING',
        OR: [
          { targetUserId: targetUserIdOrRequestId },
          { id: targetUserIdOrRequestId },
        ],
      },
    });

    if (!existing) {
      const err = new Error('Yêu cầu theo dõi không tồn tại hoặc đã được xử lý');
      (err as any).statusCode = 404;
      (err as any).code = 'FOLLOW_REQUEST_NOT_FOUND';
      throw err;
    }

    await prisma.followRequest.delete({
      where: { id: existing.id },
    });

    return true;
  }
}

export const cancelFollowRequestService = new CancelFollowRequestService();

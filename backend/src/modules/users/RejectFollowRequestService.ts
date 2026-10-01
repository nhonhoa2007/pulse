import { prisma } from '../../db/PrismaClientSingleton.js';
import { FollowRequestDto } from '../../contracts/ApiContracts.js';

export class RejectFollowRequestService {
  /**
   * Rejects an incoming follow request:
   * 1. Authorization guard: Only the target recipient can reject
   * 2. Sets status to REJECTED
   */
  public async reject(requestId: string, currentUserId: string): Promise<FollowRequestDto> {
    const request = await prisma.followRequest.findUnique({
      where: { id: requestId },
      include: {
        requester: {
          select: { id: true, username: true, displayName: true, avatarUrl: true },
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
      const err = new Error('Bạn không có quyền từ chối yêu cầu này');
      (err as any).statusCode = 403;
      (err as any).code = 'FORBIDDEN';
      throw err;
    }

    const updated = await prisma.followRequest.update({
      where: { id: requestId },
      data: { status: 'REJECTED' },
    });

    return {
      id: updated.id,
      requesterId: updated.requesterId,
      targetUserId: updated.targetUserId,
      status: 'REJECTED',
      requester: request.requester,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    };
  }
}

export const rejectFollowRequestService = new RejectFollowRequestService();

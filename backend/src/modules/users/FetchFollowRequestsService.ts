import { prisma } from '../../db/PrismaClientSingleton.js';
import { FollowRequestDto } from '../../contracts/ApiContracts.js';

export class FetchFollowRequestsService {
  /**
   * Retrieves all incoming PENDING follow requests addressed to currentUserId.
   */
  public async getPendingRequests(userId: string): Promise<FollowRequestDto[]> {
    const requests = await prisma.followRequest.findMany({
      where: {
        targetUserId: userId,
        status: 'PENDING',
      },
      include: {
        requester: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatarUrl: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return requests.map((req) => ({
      id: req.id,
      requesterId: req.requesterId,
      targetUserId: req.targetUserId,
      status: req.status as FollowRequestDto['status'],
      requester: {
        id: req.requester.id,
        username: req.requester.username,
        displayName: req.requester.displayName,
        avatarUrl: req.requester.avatarUrl,
      },
      createdAt: req.createdAt.toISOString(),
      updatedAt: req.updatedAt.toISOString(),
    }));
  }
}

export const fetchFollowRequestsService = new FetchFollowRequestsService();

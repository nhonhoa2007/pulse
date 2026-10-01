import { prisma } from '../../db/PrismaClientSingleton.js';
import { UserMuteDto } from '../../contracts/ApiContracts.js';

export class FetchMutedUsersService {
  public async getMutedUsers(currentUserId: string): Promise<UserMuteDto[]> {
    const mutes = await prisma.userMute.findMany({
      where: { muterId: currentUserId },
      orderBy: { createdAt: 'desc' },
      include: {
        muted: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatarUrl: true,
          },
        },
      },
    });

    return mutes.map((m) => ({
      id: m.id,
      muterId: m.muterId,
      mutedId: m.mutedId,
      mutedUser: m.muted,
      createdAt: m.createdAt.toISOString(),
    }));
  }
}

export const fetchMutedUsersService = new FetchMutedUsersService();

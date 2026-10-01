import { prisma } from '../../db/PrismaClientSingleton.js';

export interface UnmuteUserResult {
  mutedId: string;
  isMuted: boolean;
  message: string;
}

export class UnmuteUserService {
  public async unmuteUser(currentUserId: string, targetUserId: string): Promise<UnmuteUserResult> {
    await prisma.userMute.deleteMany({
      where: {
        muterId: currentUserId,
        mutedId: targetUserId,
      },
    });

    return {
      mutedId: targetUserId,
      isMuted: false,
      message: 'Đã bỏ tắt tiếng người dùng',
    };
  }
}

export const unmuteUserService = new UnmuteUserService();

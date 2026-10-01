import { prisma } from '../../db/PrismaClientSingleton.js';

export class MuteError extends Error {
  public code: string;
  public statusCode: number;

  constructor(message: string, code = 'BAD_REQUEST', statusCode = 400) {
    super(message);
    this.name = 'MuteError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export interface MuteUserResult {
  muterId: string;
  mutedId: string;
  isMuted: boolean;
  createdAt: string;
}

export class MuteUserService {
  public async muteUser(currentUserId: string, targetUserId: string): Promise<MuteUserResult> {
    if (currentUserId === targetUserId) {
      throw new MuteError('Không thể tự tắt tiếng chính mình', 'SELF_MUTE_NOT_ALLOWED', 400);
    }

    const targetUser = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true },
    });

    if (!targetUser) {
      throw new MuteError('User not found', 'USER_NOT_FOUND', 404);
    }

    // Upsert UserMute record - preserves Follow and TimelineInbox completely (1-way stealth filter)
    const mute = await prisma.userMute.upsert({
      where: {
        unique_muter_muted: {
          muterId: currentUserId,
          mutedId: targetUserId,
        },
      },
      create: {
        muterId: currentUserId,
        mutedId: targetUserId,
      },
      update: {},
    });

    return {
      muterId: mute.muterId,
      mutedId: mute.mutedId,
      isMuted: true,
      createdAt: mute.createdAt.toISOString(),
    };
  }
}

export const muteUserService = new MuteUserService();

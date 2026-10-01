import { prisma } from '../../db/PrismaClientSingleton.js';
import { MuteError } from './MuteUserService.js';

export interface UnmuteKeywordResult {
  id: string;
  message: string;
}

export class UnmuteKeywordService {
  public async unmuteKeyword(currentUserId: string, keywordMuteId: string): Promise<UnmuteKeywordResult> {
    const existing = await prisma.keywordMute.findUnique({
      where: { id: keywordMuteId },
      select: { id: true, userId: true },
    });

    if (existing && existing.userId !== currentUserId) {
      throw new MuteError('Không có quyền xóa từ khóa này', 'FORBIDDEN', 403);
    }

    await prisma.keywordMute.deleteMany({
      where: {
        id: keywordMuteId,
        userId: currentUserId,
      },
    });

    return {
      id: keywordMuteId,
      message: 'Đã xóa từ khóa khỏi danh sách tắt tiếng',
    };
  }
}

export const unmuteKeywordService = new UnmuteKeywordService();

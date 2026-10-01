import { prisma } from '../../db/PrismaClientSingleton.js';
import { KeywordMuteDto, MuteMatchType, MuteContext } from '../../contracts/ApiContracts.js';

export class FetchMutedKeywordsService {
  public async getMutedKeywords(currentUserId: string): Promise<KeywordMuteDto[]> {
    const now = new Date();

    const keywordMutes = await prisma.keywordMute.findMany({
      where: {
        userId: currentUserId,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      orderBy: { createdAt: 'desc' },
    });

    return keywordMutes.map((km) => ({
      id: km.id,
      userId: km.userId,
      keyword: km.keyword,
      matchType: km.matchType as MuteMatchType,
      muteContext: km.muteContext as MuteContext,
      expiresAt: km.expiresAt ? km.expiresAt.toISOString() : null,
      createdAt: km.createdAt.toISOString(),
      updatedAt: km.updatedAt.toISOString(),
    }));
  }
}

export const fetchMutedKeywordsService = new FetchMutedKeywordsService();

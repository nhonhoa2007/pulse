import { prisma } from '../../db/PrismaClientSingleton.js';
import {
  CreateKeywordMuteInput,
  KeywordMuteDto,
  MuteMatchType,
  MuteContext,
} from '../../contracts/ApiContracts.js';
import { MuteError } from './MuteUserService.js';

const VALID_MATCH_TYPES: readonly MuteMatchType[] = ['CONTAINS', 'EXACT_WORD'] as const;
const VALID_CONTEXTS: readonly MuteContext[] = ['ALL', 'HOME_TIMELINE', 'NOTIFICATIONS'] as const;

export class MuteKeywordService {
  public async muteKeyword(currentUserId: string, input: CreateKeywordMuteInput): Promise<KeywordMuteDto> {
    const rawKeyword = input?.keyword;
    if (!rawKeyword || typeof rawKeyword !== 'string' || !rawKeyword.trim()) {
      throw new MuteError('Từ khóa không được để trống', 'INVALID_KEYWORD', 400);
    }

    // Sanitize keyword against Stored XSS & HTML injection innermost-first
    let sanitizedKeyword = rawKeyword.trim();
    let prev: string;
    do {
      prev = sanitizedKeyword;
      sanitizedKeyword = sanitizedKeyword.replace(/<[^<>]*>/g, '');
    } while (sanitizedKeyword !== prev);

    sanitizedKeyword = sanitizedKeyword.replace(/<[^<]*$/g, '').replace(/<[^>]*>?/gm, '');
    sanitizedKeyword = sanitizedKeyword.replace(/javascript:/gi, '').trim();

    if (!sanitizedKeyword) {
      throw new MuteError('Từ khóa không hợp lệ sau khi làm sạch', 'INVALID_KEYWORD', 400);
    }

    if (sanitizedKeyword.length > 100) {
      throw new MuteError('Từ khóa không được vượt quá 100 ký tự', 'KEYWORD_TOO_LONG', 400);
    }

    const normalizedKeyword = sanitizedKeyword.toLowerCase();

    const matchType: MuteMatchType = (input.matchType || 'CONTAINS').toUpperCase() as MuteMatchType;
    if (!VALID_MATCH_TYPES.includes(matchType)) {
      throw new MuteError(`Loại khớp không hợp lệ: '${input.matchType}'. Cho phép: CONTAINS, EXACT_WORD`, 'INVALID_MATCH_TYPE', 400);
    }

    const muteContext: MuteContext = (input.muteContext || 'ALL').toUpperCase() as MuteContext;
    if (!VALID_CONTEXTS.includes(muteContext)) {
      throw new MuteError(`Ngữ cảnh không hợp lệ: '${input.muteContext}'. Cho phép: ALL, HOME_TIMELINE, NOTIFICATIONS`, 'INVALID_MUTE_CONTEXT', 400);
    }

    let expiresAt: Date | null = null;
    if (input.durationDays && typeof input.durationDays === 'number' && input.durationDays > 0) {
      expiresAt = new Date(Date.now() + input.durationDays * 24 * 60 * 60 * 1000);
    }

    const keywordMute = await prisma.keywordMute.upsert({
      where: {
        unique_user_keyword: {
          userId: currentUserId,
          keyword: normalizedKeyword,
        },
      },
      create: {
        userId: currentUserId,
        keyword: normalizedKeyword,
        matchType,
        muteContext,
        expiresAt,
      },
      update: {
        matchType,
        muteContext,
        expiresAt,
      },
    });

    return {
      id: keywordMute.id,
      userId: keywordMute.userId,
      keyword: keywordMute.keyword,
      matchType: keywordMute.matchType as MuteMatchType,
      muteContext: keywordMute.muteContext as MuteContext,
      expiresAt: keywordMute.expiresAt ? keywordMute.expiresAt.toISOString() : null,
      createdAt: keywordMute.createdAt.toISOString(),
      updatedAt: keywordMute.updatedAt.toISOString(),
    };
  }
}

export const muteKeywordService = new MuteKeywordService();

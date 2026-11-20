import { prisma } from '../../db/PrismaClientSingleton.js';
import { CreatePollInput, PollDto } from '../../contracts/ApiContracts.js';
import { formatPollDto } from './PollDto.js';
import { pollExpirationSchedulerService } from './PollExpirationSchedulerService.js';
import { publishPostService } from '../posts/PublishPostService.js';
import { visiblePostWhere } from '../posts/PostVisibility.js';

export class CreatePollService {
  public async createPoll(
    input: CreatePollInput,
    currentUserId?: string | null
  ): Promise<PollDto> {
    if (!currentUserId) {
      throw Object.assign(new Error('Authentication required'), { statusCode: 401, code: 'UNAUTHORIZED' });
    }
    const question = typeof input?.question === 'string' ? input.question.trim() : '';
    if (!question || question.length > 500) {
      const err: any = new Error('Poll question must contain 1 to 500 characters');
      err.statusCode = 400;
      err.code = 'INVALID_QUESTION';
      throw err;
    }

    const rawChoices = input.choices;
    if (!Array.isArray(rawChoices) || rawChoices.length < 2 || rawChoices.length > 4) {
      const err: any = new Error('Poll must have between 2 and 4 choices');
      err.statusCode = 400;
      err.code = 'INVALID_CHOICE_COUNT';
      throw err;
    }

    const normalizedChoices: string[] = rawChoices.map((c) => {
      if (typeof c === 'string') return c.trim();
      if (c && typeof c === 'object' && typeof c.text === 'string') return c.text.trim();
      return '';
    });

    for (let i = 0; i < normalizedChoices.length; i++) {
      if (!normalizedChoices[i] || normalizedChoices[i].length > 500) {
        const err: any = new Error(`Choice text at index ${i} must contain 1 to 500 characters`);
        err.statusCode = 400;
        err.code = 'INVALID_CHOICE_TEXT';
        throw err;
      }
    }

    // Determine expiration date
    let expiresAt: Date;
    const rawExpiresAt = input.expiresAt || input.expires_at;
    const rawDurationMinutes = input.durationMinutes ?? input.duration_minutes;
    const rawDurationSeconds = input.durationSeconds ?? input.duration_seconds;

    if (rawExpiresAt) {
      expiresAt = new Date(rawExpiresAt);
      if (isNaN(expiresAt.getTime())) {
        const err: any = new Error('Invalid expires_at format');
        err.statusCode = 400;
        err.code = 'INVALID_EXPIRATION';
        throw err;
      }
    } else if (rawDurationSeconds !== undefined && rawDurationSeconds !== null) {
      expiresAt = new Date(Date.now() + Number(rawDurationSeconds) * 1000);
    } else if (rawDurationMinutes !== undefined && rawDurationMinutes !== null) {
      expiresAt = new Date(Date.now() + Number(rawDurationMinutes) * 60 * 1000);
    } else {
      // Default: 24 hours
      expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    }

    if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
      const err: any = new Error('Poll expiration must be in the future');
      err.statusCode = 400;
      err.code = 'INVALID_EXPIRATION';
      throw err;
    }

    const targetPostId = input.postId ?? input.post_id;
    if (targetPostId !== undefined && (typeof targetPostId !== 'string' || !targetPostId.trim())) {
      throw Object.assign(new Error('Invalid post ID'), { statusCode: 400, code: 'BAD_REQUEST' });
    }
    const data = {
      question,
      expiresAt,
      choices: { create: normalizedChoices.map((text, index) => ({ index, text })) },
    };
    let result: PollDto;
    if (targetPostId === undefined) {
      const post = await publishPostService.publish({ authorId: currentUserId, content: question }, data);
      if (!post.poll) throw new Error('Published poll is missing');
      result = post.poll;
    } else {
      try {
        const poll = await prisma.$transaction(async (tx) => {
          const post = await tx.post.findFirst({
            where: { ...visiblePostWhere(currentUserId), id: targetPostId.trim(), authorId: currentUserId },
            select: { id: true },
          });
          if (!post) throw Object.assign(new Error('Post not found'), { statusCode: 404, code: 'POST_NOT_FOUND' });
          return tx.poll.create({ data: { ...data, postId: post.id }, include: { choices: true } });
        });
        result = formatPollDto(poll, currentUserId);
      } catch (err: any) {
        if (err.code === 'P2002') {
          throw Object.assign(new Error('A poll is already attached to this post'), { statusCode: 409, code: 'POLL_ALREADY_EXISTS' });
        }
        throw err;
      }
    }
    pollExpirationSchedulerService.schedulePoll(result.id, expiresAt);
    return result;
  }
}

export const createPollService = new CreatePollService();

import { prisma } from '../../db/PrismaClientSingleton.js';
import { CreatePollInput, PollDto } from '../../contracts/ApiContracts.js';
import { formatPollDto } from './PollDto.js';
import { pollExpirationSchedulerService } from './PollExpirationSchedulerService.js';

export class CreatePollService {
  public async createPoll(
    input: CreatePollInput,
    currentUserId?: string | null
  ): Promise<PollDto> {
    const question = input.question?.trim();
    if (!question) {
      const err: any = new Error('Poll question is required and cannot be empty');
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
      if (!normalizedChoices[i]) {
        const err: any = new Error(`Choice text at index ${i} cannot be empty`);
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

    if (expiresAt.getTime() <= Date.now()) {
      const err: any = new Error('Poll expiration must be in the future');
      err.statusCode = 400;
      err.code = 'INVALID_EXPIRATION';
      throw err;
    }

    const targetPostId = (input.postId || input.post_id)?.trim() || null;

    // Database transaction to create poll and choices
    const createdPoll = await prisma.$transaction(async (tx) => {
      let linkedPostId = targetPostId;

      if (linkedPostId) {
        // Check if post exists
        const existingPost = await tx.post.findUnique({
          where: { id: linkedPostId },
          include: { poll: true },
        });

        if (existingPost) {
          if (existingPost.poll) {
            const err: any = new Error('A poll is already attached to this post');
            err.statusCode = 409;
            err.code = 'POLL_ALREADY_EXISTS';
            throw err;
          }
        } else {
          // Auto-create a post with this ID if user or author can be resolved
          let authorId = currentUserId;
          if (!authorId) {
            const defaultUser = await tx.user.findFirst();
            if (defaultUser) {
              authorId = defaultUser.id;
            } else {
              const newUser = await tx.user.create({
                data: {
                  username: `user_${Date.now()}`,
                  email: `user_${Date.now()}@test.local`,
                  displayName: 'Poll Author',
                },
              });
              authorId = newUser.id;
            }
          }

          await tx.post.create({
            data: {
              id: linkedPostId,
              authorId,
              content: question,
            },
          });
        }
      } else if (currentUserId) {
        const newPost = await tx.post.create({
          data: {
            authorId: currentUserId,
            content: question,
          },
        });
        linkedPostId = newPost.id;
      }

      // Create Poll
      const poll = await tx.poll.create({
        data: {
          postId: linkedPostId,
          question,
          expiresAt,
          isActive: true,
          choices: {
            create: normalizedChoices.map((text, index) => ({
              index,
              text,
              voteCount: 0,
            })),
          },
        },
        include: {
          choices: true,
        },
      });

      return poll;
    });

    // Schedule background expiration timer for this specific poll
    pollExpirationSchedulerService.schedulePoll(createdPoll.id, createdPoll.expiresAt);

    return formatPollDto(createdPoll, currentUserId);
  }
}

export const createPollService = new CreatePollService();

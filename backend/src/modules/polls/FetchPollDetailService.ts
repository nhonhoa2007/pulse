import { prisma } from '../../db/PrismaClientSingleton.js';
import { PollDto } from '../../contracts/ApiContracts.js';
import { formatPollDto } from './PollDto.js';
import { pollExpirationSchedulerService } from './PollExpirationSchedulerService.js';
import { visiblePostWhere } from '../posts/PostVisibility.js';

export class FetchPollDetailService {
  public async getPollDetail(
    pollId: string,
    currentUserId?: string | null
  ): Promise<PollDto> {
    const poll = await prisma.poll.findFirst({
      where: { id: pollId, post: visiblePostWhere(currentUserId) },
      include: {
        choices: true,
        votes: { where: { userId: currentUserId ?? '' } },
      },
    });

    if (!poll) {
      const err: any = new Error('Poll not found');
      err.statusCode = 404;
      err.code = 'POLL_NOT_FOUND';
      throw err;
    }

    // Lazy expiration check: if poll reached expiration time, mark it inactive
    if (poll.isActive && new Date() >= new Date(poll.expiresAt)) {
      poll.isActive = false;
      await pollExpirationSchedulerService.expirePoll(poll.id);
    }

    return formatPollDto(poll, currentUserId);
  }
}

export const fetchPollDetailService = new FetchPollDetailService();

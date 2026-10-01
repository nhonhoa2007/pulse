import { prisma } from '../../db/PrismaClientSingleton.js';
import { PollDto } from '../../contracts/ApiContracts.js';
import { formatPollDto } from './PollDto.js';
import { realtimeStreamController } from '../notifications/RealtimeEventStreamController.js';

export class ClosePollEarlyService {
  public async closePollEarly(
    pollId: string,
    currentUserId?: string | null
  ): Promise<PollDto> {
    const poll = await prisma.poll.findUnique({
      where: { id: pollId },
      include: {
        choices: true,
        votes: true,
        post: {
          select: { authorId: true },
        },
      },
    });

    if (!poll) {
      const err: any = new Error('Poll not found');
      err.statusCode = 404;
      err.code = 'POLL_NOT_FOUND';
      throw err;
    }

    // IDOR Authorization: Only the author of the attached post can close the poll early
    if (poll.post && (!currentUserId || poll.post.authorId !== currentUserId)) {
      const err: any = new Error('Only the author of the post can close this poll early');
      err.statusCode = 403;
      err.code = 'FORBIDDEN';
      throw err;
    }

    // Deactivate poll immediately
    const updated = await prisma.poll.update({
      where: { id: pollId },
      data: {
        isActive: false,
        expiresAt: new Date(),
      },
      include: {
        choices: true,
        votes: true,
      },
    });

    const pollDto = formatPollDto(updated, currentUserId);

    // Broadcast realtime event
    realtimeStreamController.broadcast('POLL_CLOSED', {
      pollId: pollDto.id,
      poll: pollDto,
      closedAt: new Date().toISOString(),
    });
    realtimeStreamController.broadcast('POLL_UPDATED', pollDto);

    return pollDto;
  }
}

export const closePollEarlyService = new ClosePollEarlyService();

import { prisma } from '../../db/PrismaClientSingleton.js';
import { PollDto } from '../../contracts/ApiContracts.js';
import { visiblePostWhere } from '../posts/PostVisibility.js';
import { formatPollDto } from './PollDto.js';
import { sendPollUpdate } from './SendPollUpdate.js';

export class ClosePollEarlyService {
  public async closePollEarly(pollId: string, userId?: string | null): Promise<PollDto> {
    if (!userId) {
      throw Object.assign(new Error('Authentication required'), { statusCode: 401, code: 'UNAUTHORIZED' });
    }
    const poll = await prisma.$transaction(async (tx) => {
      const existing = await tx.poll.findFirst({
        where: { id: pollId },
        select: { id: true, post: { select: { authorId: true, isDeleted: true } } },
      });
      if (!existing || !existing.post || existing.post.isDeleted) {
        throw Object.assign(new Error('Poll not found'), { statusCode: 404, code: 'POLL_NOT_FOUND' });
      }
      if (existing.post.authorId !== userId) {
        throw Object.assign(new Error('Only the poll author can close it early'), { statusCode: 403, code: 'FORBIDDEN' });
      }
      const changed = await tx.poll.updateMany({
        where: { id: pollId, post: { ...visiblePostWhere(userId), authorId: userId } },
        data: { isActive: false, expiresAt: new Date() },
      });
      if (!changed.count) {
        throw Object.assign(new Error('Poll not found'), { statusCode: 404, code: 'POLL_NOT_FOUND' });
      }
      return tx.poll.findUniqueOrThrow({
        where: { id: pollId },
        include: { choices: true, votes: { where: { userId } } },
      });
    });
    void sendPollUpdate(poll).catch((err) => console.error('Poll update notification failed:', err));
    return formatPollDto(poll, userId);
  }
}

export const closePollEarlyService = new ClosePollEarlyService();

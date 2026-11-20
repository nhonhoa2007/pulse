import { prisma } from '../../db/PrismaClientSingleton.js';
import { PollDto, VotePollInput } from '../../contracts/ApiContracts.js';
import { visiblePostWhere } from '../posts/PostVisibility.js';
import { formatPollDto } from './PollDto.js';
import { sendPollUpdate } from './SendPollUpdate.js';

export class VotePollService {
  public async vote(pollId: string, input: VotePollInput, userId?: string | null): Promise<PollDto> {
    if (!userId) {
      throw Object.assign(new Error('Authentication required'), { statusCode: 401, code: 'UNAUTHORIZED' });
    }

    try {
      const poll = await prisma.$transaction(async (tx) => {
        const where = { id: pollId, post: visiblePostWhere(userId) };
        const current = await tx.poll.findFirst({ where, include: { choices: true } });
        if (!current) {
          throw Object.assign(new Error('Poll not found'), { statusCode: 404, code: 'POLL_NOT_FOUND' });
        }
        const index = input.choiceIndex ?? input.choice_index;
        const id = input.choiceId ?? input.choice_id;
        const choice = current.choices.find((item) => index !== undefined ? item.index === index : item.id === id);
        if (!choice) {
          throw Object.assign(new Error('Invalid poll choice'), { statusCode: 400, code: 'INVALID_CHOICE_INDEX' });
        }

        // Acquire the poll row before adding the vote so close/expiration cannot
        // take effect between checking the poll state and writing the choice.
        const active = await tx.poll.updateMany({
          where: { ...where, isActive: true, expiresAt: { gt: new Date() } },
          data: { updatedAt: new Date() },
        });
        if (!active.count) {
          throw Object.assign(new Error('Poll is no longer accepting votes'), { statusCode: 409, code: 'POLL_EXPIRED' });
        }
        if (new Date(current.expiresAt) <= new Date()) {
          throw Object.assign(new Error('Poll is no longer accepting votes'), { statusCode: 409, code: 'POLL_EXPIRED' });
        }
        await tx.pollVote.create({ data: { pollId, userId, choiceId: choice.id, choiceIndex: choice.index } });
        await tx.pollChoice.update({ where: { id: choice.id }, data: { voteCount: { increment: 1 } } });
        return tx.poll.findUniqueOrThrow({
          where: { id: pollId },
          include: { choices: true, votes: { where: { userId } } },
        });
      });
      void sendPollUpdate(poll).catch((err) => console.error('Poll update notification failed:', err));
      return formatPollDto(poll, userId);
    } catch (err: any) {
      if (err.code === 'P2002') {
        throw Object.assign(new Error('User has already voted in this poll'), { statusCode: 409, code: 'ALREADY_VOTED' });
      }
      throw err;
    }
  }
}

export const votePollService = new VotePollService();

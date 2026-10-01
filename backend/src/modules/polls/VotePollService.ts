import { prisma } from '../../db/PrismaClientSingleton.js';
import { PollDto, VotePollInput } from '../../contracts/ApiContracts.js';
import { formatPollDto } from './PollDto.js';
import { realtimeStreamController } from '../notifications/RealtimeEventStreamController.js';
import { pollExpirationSchedulerService } from './PollExpirationSchedulerService.js';

export class VotePollService {
  public async vote(
    pollId: string,
    input: VotePollInput,
    currentUserId?: string | null
  ): Promise<PollDto> {
    const userId = (currentUserId || input.userId || input.user_id)?.trim();
    if (!userId) {
      const err: any = new Error('Authentication required: user ID is missing');
      err.statusCode = 401;
      err.code = 'UNAUTHORIZED';
      throw err;
    }

    // 1. Fetch poll without full transaction to validate existence first
    const poll = await prisma.poll.findUnique({
      where: { id: pollId },
      include: {
        choices: true,
        post: {
          select: {
            authorId: true,
            author: { select: { isPrivate: true } },
          },
        },
      },
    });

    if (!poll) {
      const err: any = new Error('Poll not found');
      err.statusCode = 404;
      err.code = 'POLL_NOT_FOUND';
      throw err;
    }

    // TASK-21 Privacy Invariant: Voting on polls from private accounts requires approved follow
    if (poll.post?.author?.isPrivate && poll.post.authorId !== userId) {
      const follow = await prisma.follow.findUnique({
        where: { followerId_followingId: { followerId: userId, followingId: poll.post.authorId } },
      });
      if (!follow) {
        const err: any = new Error('Cannot vote on a poll from a private account you do not follow');
        err.statusCode = 403;
        err.code = 'FORBIDDEN';
        throw err;
      }
    }

    // 2. Expiration validation
    const now = new Date();
    if (!poll.isActive || now >= new Date(poll.expiresAt)) {
      if (poll.isActive) {
        // Trigger background deactivation
        pollExpirationSchedulerService.expirePoll(poll.id).catch(() => {});
      }
      const err: any = new Error('Poll has expired and is no longer accepting votes');
      err.statusCode = 409;
      err.code = 'POLL_EXPIRED';
      throw err;
    }

    // 3. Choice index resolution & validation
    let choiceIndex = input.choiceIndex ?? input.choice_index;

    // Support choiceId if passed instead of choiceIndex
    const choiceId = input.choiceId || input.choice_id;
    if (choiceIndex === undefined && choiceId) {
      const match = poll.choices.find((c) => c.id === choiceId);
      if (match) {
        choiceIndex = match.index;
      }
    }

    if (
      choiceIndex === undefined ||
      choiceIndex === null ||
      typeof choiceIndex !== 'number' ||
      !Number.isInteger(choiceIndex) ||
      choiceIndex < 0 ||
      choiceIndex >= poll.choices.length
    ) {
      const err: any = new Error(
        `Invalid choice index: must be an integer between 0 and ${poll.choices.length - 1}`
      );
      err.statusCode = 400;
      err.code = 'INVALID_CHOICE_INDEX';
      throw err;
    }

    // 4. Duplicate vote check (Fast-path check before transaction)
    const existingVote = await prisma.pollVote.findUnique({
      where: {
        pollId_userId: {
          pollId,
          userId,
        },
      },
    });

    if (existingVote) {
      const err: any = new Error('User has already voted in this poll');
      err.statusCode = 409;
      err.code = 'ALREADY_VOTED';
      throw err;
    }

    // 5. Atomic Transaction: record vote and atomic increment
    let updatedPollRecord;
    try {
      updatedPollRecord = await prisma.$transaction(async (tx) => {
        // Re-check poll state inside transaction with fresh read
        const activePoll = await tx.poll.findUnique({
          where: { id: pollId },
          include: { choices: true },
        });

        if (!activePoll || !activePoll.isActive || new Date() >= new Date(activePoll.expiresAt)) {
          const err: any = new Error('Poll has expired');
          err.statusCode = 409;
          err.code = 'POLL_EXPIRED';
          throw err;
        }

        const targetChoice = activePoll.choices.find((c) => c.index === choiceIndex);
        if (!targetChoice) {
          const err: any = new Error('Target choice not found');
          err.statusCode = 400;
          err.code = 'INVALID_CHOICE_INDEX';
          throw err;
        }

        // Insert vote record (DB-level unique constraint @@unique([pollId, userId]) guarantees race immunity)
        await tx.pollVote.create({
          data: {
            pollId,
            choiceId: targetChoice.id,
            choiceIndex,
            userId,
          },
        });

        // Atomic update on choice vote count
        await tx.pollChoice.update({
          where: { id: targetChoice.id },
          data: {
            voteCount: { increment: 1 },
          },
        });

        // Return updated poll with choices and votes
        const freshPoll = await tx.poll.findUniqueOrThrow({
          where: { id: pollId },
          include: {
            choices: true,
            votes: true,
          },
        });

        return freshPoll;
      });
    } catch (err: any) {
      // Prisma error P2002: unique constraint violation on @@unique([pollId, userId])
      if (err.code === 'P2002') {
        const conflictErr: any = new Error('User has already voted in this poll');
        conflictErr.statusCode = 409;
        conflictErr.code = 'ALREADY_VOTED';
        throw conflictErr;
      }
      throw err;
    }

    const pollDto = formatPollDto(updatedPollRecord, userId);

    // 6. Real-time broadcast via SSE (< 500 ms latency requirement)
    realtimeStreamController.broadcast('POLL_UPDATED', pollDto);
    realtimeStreamController.broadcast('POLL_VOTED', {
      pollId: pollDto.id,
      choiceIndex,
      userId,
      poll: pollDto,
    });

    return pollDto;
  }
}

export const votePollService = new VotePollService();

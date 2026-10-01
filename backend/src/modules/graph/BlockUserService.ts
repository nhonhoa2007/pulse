import { prisma } from '../../db/PrismaClientSingleton.js';

export class BlockUserService {
  /**
   * Enforces Two-Way Social Graph Block Invariants inside a strict atomic PostgreSQL transaction:
   * 1. Rejects self-blocking
   * 2. Deletes Follow relationships in BOTH directions
   * 3. Wipes Timeline Inboxes in BOTH directions
   * 4. Accurately adjusts followersCount and followingCount for both accounts
   * 5. Inserts Block record idempotently
   */
  public async block(blockerId: string, blockedId: string): Promise<{ blocked: boolean }> {
    if (blockerId === blockedId) {
      throw new Error('You cannot block yourself');
    }

    const [blocker, blocked] = await Promise.all([
      prisma.user.findUnique({ where: { id: blockerId } }),
      prisma.user.findUnique({ where: { id: blockedId } }),
    ]);

    if (!blocker || !blocked) {
      throw new Error('User not found');
    }

    return await prisma.$transaction(async (tx) => {
      // Step 1: Detect existing follow relations in either direction
      const aFollowsB = await tx.follow.findUnique({
        where: { followerId_followingId: { followerId: blockerId, followingId: blockedId } },
      });
      const bFollowsA = await tx.follow.findUnique({
        where: { followerId_followingId: { followerId: blockedId, followingId: blockerId } },
      });

      // Step 2: Delete follow relationships both ways
      await tx.follow.deleteMany({
        where: {
          OR: [
            { followerId: blockerId, followingId: blockedId },
            { followerId: blockedId, followingId: blockerId },
          ],
        },
      });

      // Step 2b: Delete follow requests both ways
      await tx.followRequest.deleteMany({
        where: {
          OR: [
            { requesterId: blockerId, targetUserId: blockedId },
            { requesterId: blockedId, targetUserId: blockerId },
          ],
        },
      });

      // Step 3: Delete timeline inboxes both ways
      await tx.timelineInbox.deleteMany({
        where: {
          OR: [
            { userId: blockerId, authorId: blockedId },
            { userId: blockedId, authorId: blockerId },
          ],
        },
      });

      // Step 4: Adjust counters
      if (aFollowsB) {
        await tx.user.update({
          where: { id: blockerId },
          data: { followingCount: { decrement: 1 } },
        });
        await tx.user.update({
          where: { id: blockedId },
          data: { followersCount: { decrement: 1 } },
        });
      }

      if (bFollowsA) {
        await tx.user.update({
          where: { id: blockedId },
          data: { followingCount: { decrement: 1 } },
        });
        await tx.user.update({
          where: { id: blockerId },
          data: { followersCount: { decrement: 1 } },
        });
      }

      // Safeguard against any negative counts
      await tx.$executeRaw`
        UPDATE "User"
        SET "followersCount" = GREATEST(0, "followersCount"),
            "followingCount" = GREATEST(0, "followingCount")
        WHERE id IN (${blockerId}, ${blockedId})
      `;

      // Step 5: Upsert Block record
      await tx.block.upsert({
        where: { blockerId_blockedId: { blockerId, blockedId } },
        create: { blockerId, blockedId },
        update: {},
      });

      return { blocked: true };
    });
  }

  public async unblock(blockerId: string, blockedId: string): Promise<{ unblocked: boolean }> {
    if (blockerId === blockedId) {
      throw new Error('You cannot unblock yourself');
    }

    const result = await prisma.block.deleteMany({
      where: {
        blockerId,
        blockedId,
      },
    });

    return { unblocked: result.count > 0 };
  }
}

export const blockUserService = new BlockUserService();

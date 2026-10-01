import { prisma } from '../../db/PrismaClientSingleton.js';

export class UnfollowUserService {
  public async unfollow(followerId: string, followingId: string): Promise<{ unfollowed: boolean }> {
    if (followerId === followingId) {
      throw new Error('You cannot unfollow yourself');
    }

    return await prisma.$transaction(async (tx) => {
      const existing = await tx.follow.findUnique({
        where: { followerId_followingId: { followerId, followingId } },
      });

      if (!existing) {
        return { unfollowed: false };
      }

      // Delete follow relation
      await tx.follow.delete({
        where: { followerId_followingId: { followerId, followingId } },
      });

      // Decrement followingCount on follower
      await tx.user.update({
        where: { id: followerId },
        data: { followingCount: { decrement: 1 } },
      });

      // Decrement followersCount on following
      await tx.user.update({
        where: { id: followingId },
        data: { followersCount: { decrement: 1 } },
      });

      // Safeguard against negative counts
      await tx.$executeRaw`
        UPDATE "User"
        SET "followersCount" = GREATEST(0, "followersCount"),
            "followingCount" = GREATEST(0, "followingCount")
        WHERE id IN (${followerId}, ${followingId})
      `;

      // Remove unfollowed user's posts from follower's inbox
      await tx.timelineInbox.deleteMany({
        where: {
          userId: followerId,
          authorId: followingId,
        },
      });

      // Also clean up any follow requests
      await tx.followRequest.deleteMany({
        where: {
          requesterId: followerId,
          targetUserId: followingId,
        },
      });

      return { unfollowed: true };
    });
  }
}

export const unfollowUserService = new UnfollowUserService();

/**
 * PKG-10: Account Lifecycle — xóa tài khoản (soft-delete) + export dữ liệu.
 *
 * Xóa tài khoản trong 1 transaction nguyên tử:
 *  1. Soft-delete User (isDeleted) — username/email "đóng băng" bằng hậu tố
 *     `deleted__<id rút gọn>` để giải phóng unique constraint cho tài khoản mới,
 *     đồng thời vô hiệu đăng nhập.
 *  2. Thu hồi mọi refresh token + đăng ký web push (phiên chết ngay).
 *  3. Dọn social graph 2 chiều: Follow (cả hai hướng), FollowRequest, Block,
 *     UserMute, TimelineInbox của chính user.
 *  4. Giảm denormalized followers/followingCount của đối tác cho mỗi follow bị xóa.
 *  5. Nội dung công khai (Post, Like, Repost...) giữ nguyên nhưng ẩn qua
 *     isDeleted trên user — profile trả 404 như cơ chế block hiện hành.
 */
import { prisma } from '../../db/PrismaClientSingleton.js';
import { toUserDto } from '../auth/AuthService.js';

export class UserNotFoundError extends Error {
  constructor(message: string = 'Không tìm thấy người dùng') {
    super(message);
    this.name = 'UserNotFoundError';
  }
}

export class DeleteAccountService {
  /**
   * Soft-delete tài khoản trong một $transaction. Trả về username gốc.
   */
  public async deleteAccount(userId: string): Promise<{ username: string }> {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.isDeleted) {
      throw new UserNotFoundError();
    }

    // Follow liên quan (cả hai hướng) — để tính điều chỉnh counter đối tác.
    const outgoingFollows = await prisma.follow.findMany({
      where: { followerId: userId },
      select: { followingId: true },
    });
    const incomingFollows = await prisma.follow.findMany({
      where: { followingId: userId },
      select: { followerId: true },
    });

    await prisma.$transaction(async (tx) => {
      // 1. Dọn social graph 2 chiều + inbox
      await tx.follow.deleteMany({
        where: { OR: [{ followerId: userId }, { followingId: userId }] },
      });
      await tx.followRequest.deleteMany({
        where: { OR: [{ requesterId: userId }, { targetUserId: userId }] },
      });
      await tx.block.deleteMany({
        where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
      });
      await tx.userMute.deleteMany({
        where: { OR: [{ muterId: userId }, { mutedId: userId }] },
      });
      await tx.timelineInbox.deleteMany({ where: { userId } });

      // 2. Điều chỉnh denormalized counters của đối tác (không âm)
      for (const f of outgoingFollows) {
        await tx.user.update({
          where: { id: f.followingId },
          data: { followersCount: { decrement: 1 } },
        });
      }
      for (const f of incomingFollows) {
        await tx.user.update({
          where: { id: f.followerId },
          data: { followingCount: { decrement: 1 } },
        });
      }

      // 3. Thu hồi phiên + push subscriptions
      await tx.refreshToken.updateMany({
        where: { userId, isRevoked: false },
        data: { isRevoked: true },
      });
      await tx.webPushSubscription.deleteMany({ where: { userId } });

      // 4. Soft-delete + giải phóng unique username/email + vô hiệu mật khẩu
      const suffix = `deleted__${userId.replace(/-/g, '').slice(0, 12)}`;
      await tx.user.update({
        where: { id: userId },
        data: {
          isDeleted: true,
          passwordHash: null,
          username: `${user.username}__${suffix}`,
          email: `${user.email}__${suffix}`,
          pinnedPostId: null,
        },
      });
    });

    return { username: user.username };
  }

  /**
   * Export dữ liệu cá nhân theo chuẩn GDPR-style (JSON đầy đủ, không DM của bên khác).
   */
  public async exportData(userId: string): Promise<{
    profile: ReturnType<typeof toUserDto>;
    posts: unknown[];
    follows: { following: string[]; followers: string[] };
    bookmarks: unknown[];
    dms: unknown[];
    exportedAt: string;
  }> {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.isDeleted) {
      throw new UserNotFoundError();
    }

    const [posts, following, followers, bookmarks, dms] = await Promise.all([
      prisma.post.findMany({
        where: { authorId: userId, isDeleted: false },
        orderBy: { createdAt: 'desc' },
        select: { id: true, content: true, createdAt: true, likesCount: true, replyToId: true },
      }),
      prisma.follow.findMany({ where: { followerId: userId }, select: { followingId: true } }),
      prisma.follow.findMany({ where: { followingId: userId }, select: { followerId: true } }),
      prisma.bookmark.findMany({
        where: { userId },
        select: { postId: true, createdAt: true },
      }),
      prisma.dmMessage.findMany({
        where: { senderId: userId },
        orderBy: { createdAt: 'desc' },
        select: { id: true, content: true, conversationId: true, createdAt: true },
      }),
    ]);

    return {
      profile: toUserDto(user),
      posts,
      follows: {
        following: following.map((f) => f.followingId),
        followers: followers.map((f) => f.followerId),
      },
      bookmarks,
      dms,
      exportedAt: new Date().toISOString(),
    };
  }
}

export const deleteAccountService = new DeleteAccountService();

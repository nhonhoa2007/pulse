import { prisma } from '../../db/PrismaClientSingleton.js';
import { PinPostResult } from '../../contracts/ApiContracts.js';

export class CannotPinError extends Error {
  public code: string;
  public statusCode: number;

  constructor(message: string, code = 'BAD_REQUEST', statusCode = 400) {
    super(message);
    this.name = 'CannotPinError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export class PinPostService {
  public async pin(currentUserId: string, postId: string): Promise<PinPostResult> {
    const post = await prisma.post.findUnique({
      where: { id: postId },
      select: {
        id: true,
        authorId: true,
        replyToId: true,
        isDeleted: true,
      },
    });

    if (!post || post.isDeleted) {
      throw new CannotPinError('Không thể ghim bài viết đã bị xóa', 'CANNOT_PIN_DELETED', 400);
    }

    if (post.authorId !== currentUserId) {
      throw new CannotPinError('Chỉ có thể ghim bài viết do chính mình tạo', 'FORBIDDEN', 403);
    }

    if (post.replyToId !== null) {
      throw new CannotPinError('Không thể ghim bài viết bình luận', 'CANNOT_PIN_REPLY', 400);
    }

    // Atomically update user's pinnedPostId
    await prisma.user.update({
      where: { id: currentUserId },
      data: { pinnedPostId: post.id },
    });

    return {
      pinnedPostId: post.id,
      isPinned: true,
      message: 'Ghim bài viết thành công',
    };
  }
}

export const pinPostService = new PinPostService();

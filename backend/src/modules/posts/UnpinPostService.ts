import { prisma } from '../../db/PrismaClientSingleton.js';
import { PinPostResult } from '../../contracts/ApiContracts.js';
import { CannotPinError } from './PinPostService.js';

export class UnpinPostService {
  public async unpin(currentUserId: string, postId: string): Promise<PinPostResult> {
    const post = await prisma.post.findUnique({
      where: { id: postId },
      select: {
        id: true,
        authorId: true,
      },
    });

    if (post && post.authorId !== currentUserId) {
      throw new CannotPinError('Chỉ có thể bỏ ghim bài viết của chính mình', 'FORBIDDEN', 403);
    }

    await prisma.user.update({
      where: { id: currentUserId },
      data: { pinnedPostId: null },
    });

    return {
      pinnedPostId: null,
      isPinned: false,
      message: 'Bỏ ghim bài viết thành công',
    };
  }
}

export const unpinPostService = new UnpinPostService();

import { prisma } from '../../db/PrismaClientSingleton.js';
import { PostVersionsResponse } from '../../contracts/ApiContracts.js';
import { PostNotFoundError } from './UpdatePostService.js';

export class FetchPostVersionsService {
  public async getVersions(postId: string, currentUserId?: string | null): Promise<PostVersionsResponse> {
    const post = await prisma.post.findUnique({
      where: { id: postId },
      select: {
        id: true,
        authorId: true,
        content: true,
        mediaUrls: true,
        contentWarning: true,
        isSensitive: true,
        editCount: true,
        isEdited: true,
        lastEditedAt: true,
        isDeleted: true,
        createdAt: true,
      },
    });

    if (!post || post.isDeleted) {
      throw new PostNotFoundError('Post not found or unavailable');
    }

    if (currentUserId) {
      const block = await prisma.block.findFirst({
        where: {
          OR: [
            { blockerId: currentUserId, blockedId: post.authorId },
            { blockerId: post.authorId, blockedId: currentUserId },
          ],
        },
      });

      if (block) {
        throw new PostNotFoundError('Post not found or unavailable');
      }
    }

    const versions = await prisma.postVersion.findMany({
      where: { postId: post.id },
      orderBy: { versionNumber: 'asc' },
    });

    return {
      postId: post.id,
      current: {
        versionNumber: post.editCount === 0 ? 1 : post.editCount + 1,
        content: post.content,
        mediaUrls: post.mediaUrls,
        contentWarning: post.contentWarning,
        isSensitive: post.isSensitive,
        editedAt: post.lastEditedAt ? post.lastEditedAt.toISOString() : null,
      },
      versions: versions.map((v) => ({
        id: v.id,
        postId: v.postId,
        versionNumber: v.versionNumber,
        content: v.content,
        mediaUrls: v.mediaUrls,
        contentWarning: v.contentWarning,
        isSensitive: v.isSensitive,
        hashtags: v.hashtags,
        mentions: v.mentions,
        editorId: v.editorId,
        createdAt: v.createdAt.toISOString(),
      })),
    };
  }
}

export const fetchPostVersionsService = new FetchPostVersionsService();

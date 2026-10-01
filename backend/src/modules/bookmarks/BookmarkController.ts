import { FastifyRequest, FastifyReply } from 'fastify';
import { bookmarkService } from './BookmarkService.js';
import { ApiResponse, PostDto, ToggleBookmarkResult } from '../../contracts/ApiContracts.js';

interface PostParams {
  id: string;
}

export class BookmarkController {
  public async toggleBookmark(
    req: FastifyRequest<{ Params: PostParams }>,
    reply: FastifyReply
  ): Promise<ApiResponse<ToggleBookmarkResult>> {
    const { id } = req.params;
    const currentUserId = (req as unknown as { currentUserId?: string | null }).currentUserId;

    if (!currentUserId) {
      reply.status(401);
      return {
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      };
    }

    try {
      const result = await bookmarkService.toggleBookmark(currentUserId, id);
      return {
        success: true,
        data: result,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Error toggling bookmark';
      const statusCode = message.includes('not found') ? 404 : 400;
      reply.status(statusCode);
      return {
        success: false,
        error: { code: statusCode === 404 ? 'POST_NOT_FOUND' : 'BAD_REQUEST', message },
      };
    }
  }

  public async getBookmarks(
    req: FastifyRequest,
    reply: FastifyReply
  ): Promise<ApiResponse<PostDto[]>> {
    const currentUserId = (req as unknown as { currentUserId?: string | null }).currentUserId;

    if (!currentUserId) {
      reply.status(401);
      return {
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      };
    }

    try {
      const posts = await bookmarkService.getBookmarks(currentUserId);
      return {
        success: true,
        data: posts,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Error retrieving bookmarks';
      reply.status(400);
      return {
        success: false,
        error: { code: 'BAD_REQUEST', message },
      };
    }
  }
}

export const bookmarkController = new BookmarkController();

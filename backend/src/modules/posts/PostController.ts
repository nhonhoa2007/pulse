import { FastifyRequest, FastifyReply } from 'fastify';
import { publishPostService } from './PublishPostService.js';
import { fetchPostDetailService } from './FetchPostDetailService.js';
import { conversationThreadService } from './ConversationThreadService.js';
import { toggleLikeService } from './ToggleLikeService.js';
import { repostService } from './RepostService.js';
import { bookmarkController } from '../bookmarks/BookmarkController.js';
import { ReplyRestrictedError } from './ValidateReplyPermissionService.js';
import {
  updatePostService,
  PostNotFoundError,
  ForbiddenError,
  EditWindowExpiredError,
  ValidationError,
} from './UpdatePostService.js';
import { fetchPostVersionsService } from './FetchPostVersionsService.js';
import { pinPostService, CannotPinError } from './PinPostService.js';
import { unpinPostService } from './UnpinPostService.js';
import { postImpressionsBufferService } from './PostImpressionsBufferService.js';
import { prisma } from '../../db/PrismaClientSingleton.js';
import {
  ApiResponse,
  PostDto,
  CreatePostInput,
  UpdatePostInput,
  ToggleLikeResult,
  ToggleRepostResult,
  ToggleBookmarkResult,
  ConversationThreadResponse,
  PostVersionsResponse,
  PinPostResult,
  RecordPostViewsInput,
  RecordPostViewsResponse,
} from '../../contracts/ApiContracts.js';

interface PostParams {
  id: string;
}

export class PostController {
  public async createPost(
    req: FastifyRequest<{ Body: CreatePostInput }>,
    reply: FastifyReply
  ): Promise<ApiResponse<PostDto>> {
    const currentUserId = (req as unknown as { currentUserId?: string | null }).currentUserId;

    if (!currentUserId) {
      reply.status(401);
      return {
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required via x-user-id header' },
      };
    }

    const { content, mediaUrls, replyToId, quoteOfId, reply_privacy, replyPrivacy, isSensitive, contentWarning } = req.body;

    try {
      const post = await publishPostService.publish({
        authorId: currentUserId,
        content,
        mediaUrls,
        replyToId,
        quoteOfId,
        reply_privacy,
        replyPrivacy,
        isSensitive,
        contentWarning,
      });

      reply.status(201);
      return {
        success: true,
        data: post,
      };
    } catch (err: unknown) {
      if (err instanceof ReplyRestrictedError) {
        reply.status(err.statusCode || 403);
        return {
          success: false,
          error: { code: err.code || 'REPLY_RESTRICTED', message: err.message },
        };
      }
      const message = err instanceof Error ? err.message : 'Failed to publish post';
      reply.status(400);
      return {
        success: false,
        error: { code: 'BAD_REQUEST', message },
      };
    }
  }

  public async updatePost(
    req: FastifyRequest<{ Params: PostParams; Body: UpdatePostInput }>,
    reply: FastifyReply
  ): Promise<ApiResponse<PostDto>> {
    const currentUserId = (req as unknown as { currentUserId?: string | null }).currentUserId;

    if (!currentUserId) {
      reply.status(401);
      return {
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required via x-user-id header' },
      };
    }

    const { id } = req.params;
    const { content, mediaUrls, reply_privacy, replyPrivacy, isSensitive, contentWarning } = req.body || {};

    try {
      const updatedPost = await updatePostService.update(currentUserId, id, {
        content,
        mediaUrls,
        reply_privacy,
        replyPrivacy,
        isSensitive,
        contentWarning,
      });

      reply.status(200);
      return {
        success: true,
        data: updatedPost,
      };
    } catch (err: unknown) {
      if (err instanceof PostNotFoundError) {
        reply.status(404);
        return {
          success: false,
          error: { code: 'POST_NOT_FOUND', message: err.message },
        };
      }
      if (err instanceof EditWindowExpiredError) {
        reply.status(403);
        return {
          success: false,
          error: { code: 'EDIT_WINDOW_EXPIRED', message: err.message },
        };
      }
      if (err instanceof ForbiddenError) {
        reply.status(403);
        return {
          success: false,
          error: { code: 'FORBIDDEN', message: err.message },
        };
      }
      if (err instanceof ValidationError) {
        reply.status(400);
        return {
          success: false,
          error: { code: err.code || 'BAD_REQUEST', message: err.message },
        };
      }
      const message = err instanceof Error ? err.message : 'Failed to update post';
      reply.status(400);
      return {
        success: false,
        error: { code: 'BAD_REQUEST', message },
      };
    }
  }

  public async getPost(
    req: FastifyRequest<{ Params: PostParams }>,
    reply: FastifyReply
  ): Promise<ApiResponse<PostDto>> {
    const { id } = req.params;
    const currentUserId = (req as unknown as { currentUserId?: string | null }).currentUserId;

    const post = await fetchPostDetailService.getPostDetail(id, currentUserId);

    if (!post) {
      reply.status(404);
      return {
        success: false,
        error: { code: 'POST_NOT_FOUND', message: 'Post not found or unavailable' },
      };
    }

    const pending = postImpressionsBufferService.getPendingForPost(post.id);
    if (pending > 0) {
      post.viewsCount = (post.viewsCount ?? 0) + pending;
    }

    return {
      success: true,
      data: post,
    };
  }

  public async getThread(
    req: FastifyRequest<{ Params: PostParams }>,
    reply: FastifyReply
  ): Promise<ApiResponse<ConversationThreadResponse>> {
    const { id } = req.params;
    const currentUserId = (req as unknown as { currentUserId?: string | null }).currentUserId;

    const thread = await conversationThreadService.getThread(id, currentUserId);

    if (!thread) {
      reply.status(404);
      return {
        success: false,
        error: { code: 'THREAD_NOT_FOUND', message: 'Thread not found or unavailable' },
      };
    }

    if (thread.rootPost) {
      const pending = postImpressionsBufferService.getPendingForPost(thread.rootPost.id);
      if (pending > 0) {
        thread.rootPost.viewsCount = (thread.rootPost.viewsCount ?? 0) + pending;
      }
    }
    if (thread.replies) {
      for (const replyPost of thread.replies) {
        const pending = postImpressionsBufferService.getPendingForPost(replyPost.id);
        if (pending > 0) {
          replyPost.viewsCount = (replyPost.viewsCount ?? 0) + pending;
        }
      }
    }

    return {
      success: true,
      data: thread,
    };
  }

  public async toggleLike(
    req: FastifyRequest<{ Params: PostParams }>,
    reply: FastifyReply
  ): Promise<ApiResponse<ToggleLikeResult>> {
    const { id } = req.params;
    const currentUserId = (req as unknown as { currentUserId?: string | null }).currentUserId;

    if (!currentUserId) {
      reply.status(401);
      return {
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required via x-user-id header' },
      };
    }

    try {
      const result = await toggleLikeService.toggleLike(currentUserId, id);
      return {
        success: true,
        data: result,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Error toggling like';
      const statusCode = (err as any).statusCode || 400;
      const code = (err as any).code || 'BAD_REQUEST';
      reply.status(statusCode);
      return {
        success: false,
        error: { code, message },
      };
    }
  }

  public async toggleRepost(
    req: FastifyRequest<{ Params: PostParams }>,
    reply: FastifyReply
  ): Promise<ApiResponse<ToggleRepostResult>> {
    const { id } = req.params;
    const currentUserId = (req as unknown as { currentUserId?: string | null }).currentUserId;

    if (!currentUserId) {
      reply.status(401);
      return {
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required via x-user-id header' },
      };
    }

    try {
      const result = await repostService.toggleRepost(currentUserId, id);
      return {
        success: true,
        data: result,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Error toggling repost';
      const statusCode = (err as any).statusCode || 400;
      const code = (err as any).code || 'BAD_REQUEST';
      reply.status(statusCode);
      return {
        success: false,
        error: { code, message },
      };
    }
  }

  public async toggleBookmark(
    req: FastifyRequest<{ Params: PostParams }>,
    reply: FastifyReply
  ): Promise<ApiResponse<ToggleBookmarkResult>> {
    return bookmarkController.toggleBookmark(req, reply);
  }

  public async getVersions(
    req: FastifyRequest<{ Params: PostParams }>,
    reply: FastifyReply
  ): Promise<ApiResponse<PostVersionsResponse>> {
    const { id } = req.params;
    const currentUserId = req.currentUserId;

    try {
      const data = await fetchPostVersionsService.getVersions(id, currentUserId);
      return {
        success: true,
        data,
      };
    } catch (err: unknown) {
      if (err instanceof PostNotFoundError) {
        reply.status(404);
        return {
          success: false,
          error: { code: 'POST_NOT_FOUND', message: err.message },
        };
      }
      const message = err instanceof Error ? err.message : 'Failed to fetch versions';
      reply.status(400);
      return {
        success: false,
        error: { code: 'BAD_REQUEST', message },
      };
    }
  }

  public async pinPost(
    req: FastifyRequest<{ Params: PostParams }>,
    reply: FastifyReply
  ): Promise<ApiResponse<PinPostResult>> {
    const currentUserId = req.currentUserId;
    if (!currentUserId) {
      reply.status(401);
      return {
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required via x-user-id header' },
      };
    }

    const { id } = req.params;

    try {
      const data = await pinPostService.pin(currentUserId, id);
      return {
        success: true,
        data,
      };
    } catch (err: unknown) {
      if (err instanceof CannotPinError) {
        reply.status(err.statusCode);
        return {
          success: false,
          error: { code: err.code, message: err.message },
        };
      }
      const message = err instanceof Error ? err.message : 'Failed to pin post';
      reply.status(400);
      return {
        success: false,
        error: { code: 'BAD_REQUEST', message },
      };
    }
  }

  public async unpinPost(
    req: FastifyRequest<{ Params: PostParams }>,
    reply: FastifyReply
  ): Promise<ApiResponse<PinPostResult>> {
    const currentUserId = req.currentUserId;
    if (!currentUserId) {
      reply.status(401);
      return {
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required via x-user-id header' },
      };
    }

    const { id } = req.params;

    try {
      const data = await unpinPostService.unpin(currentUserId, id);
      return {
        success: true,
        data,
      };
    } catch (err: unknown) {
      if (err instanceof CannotPinError) {
        reply.status(err.statusCode);
        return {
          success: false,
          error: { code: err.code, message: err.message },
        };
      }
      const message = err instanceof Error ? err.message : 'Failed to unpin post';
      reply.status(400);
      return {
        success: false,
        error: { code: 'BAD_REQUEST', message },
      };
    }
  }

  public async recordViews(
    req: FastifyRequest<{ Body: RecordPostViewsInput }>,
    reply: FastifyReply
  ): Promise<ApiResponse<RecordPostViewsResponse>> {
    const postIds = req.body?.postIds;
    if (!Array.isArray(postIds)) {
      reply.status(400);
      return {
        success: false,
        error: { code: 'BAD_REQUEST', message: 'postIds must be an array of strings' },
      };
    }

    const identifier =
      req.currentUserId ||
      (req.headers['x-forwarded-for'] as string) ||
      req.ip ||
      'anonymous';

    const result = postImpressionsBufferService.recordViews(identifier, postIds);

    return {
      success: true,
      data: {
        recorded: result.recorded,
        buffered: result.buffered,
      },
    };
  }

  public async recordSingleView(
    req: FastifyRequest<{ Params: PostParams }>,
    reply: FastifyReply
  ): Promise<ApiResponse<{ success: true; viewsCount: number }>> {
    const { id } = req.params;

    const post = await prisma.post.findUnique({
      where: { id },
      select: { id: true, viewsCount: true, isDeleted: true },
    });

    if (!post || post.isDeleted) {
      reply.status(404);
      return {
        success: false,
        error: { code: 'NOT_FOUND', message: 'Post not found' },
      };
    }

    const identifier =
      req.currentUserId ||
      (req.headers['x-forwarded-for'] as string) ||
      req.ip ||
      'anonymous';

    postImpressionsBufferService.recordSingleView(identifier, post.id);
    const pending = postImpressionsBufferService.getPendingForPost(post.id);

    return {
      success: true,
      data: {
        success: true,
        viewsCount: post.viewsCount + pending,
      },
    };
  }
}

export const postController = new PostController();

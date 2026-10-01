import { FastifyRequest, FastifyReply } from 'fastify';
import { followUserService } from './FollowUserService.js';
import { unfollowUserService } from './UnfollowUserService.js';
import { blockUserService } from './BlockUserService.js';
import { ApiResponse, FollowActionResponse } from '../../contracts/ApiContracts.js';

interface GraphActionBody {
  targetUserId: string;
}

export class SocialGraphController {
  public async follow(
    req: FastifyRequest<{ Body: GraphActionBody }>,
    reply: FastifyReply
  ): Promise<ApiResponse<FollowActionResponse>> {
    const currentUserId = (req as unknown as { currentUserId?: string | null }).currentUserId;

    if (!currentUserId) {
      reply.status(401);
      return {
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      };
    }

    const { targetUserId } = req.body;
    if (!targetUserId) {
      reply.status(400);
      return {
        success: false,
        error: { code: 'BAD_REQUEST', message: 'targetUserId is required' },
      };
    }

    try {
      const result = await followUserService.follow(currentUserId, targetUserId);
      return {
        success: true,
        data: result,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Error following user';
      const statusCode = (err as any).statusCode || (message.includes('block') ? 403 : 400);
      const code = (err as any).code || (message.includes('block') ? 'USER_BLOCKED' : 'BAD_REQUEST');
      reply.status(statusCode);
      return {
        success: false,
        error: { code, message },
      };
    }
  }

  public async followUserById(
    req: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply
  ): Promise<ApiResponse<FollowActionResponse>> {
    const currentUserId = (req as unknown as { currentUserId?: string | null }).currentUserId;

    if (!currentUserId) {
      reply.status(401);
      return {
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      };
    }

    const targetUserId = req.params.id;
    if (!targetUserId) {
      reply.status(400);
      return {
        success: false,
        error: { code: 'BAD_REQUEST', message: 'targetUserId is required' },
      };
    }

    try {
      const result = await followUserService.follow(currentUserId, targetUserId);
      return {
        success: true,
        data: result,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Error following user';
      const statusCode = (err as any).statusCode || (message.includes('block') ? 403 : 400);
      const code = (err as any).code || (message.includes('block') ? 'USER_BLOCKED' : 'BAD_REQUEST');
      reply.status(statusCode);
      return {
        success: false,
        error: { code, message },
      };
    }
  }

  public async unfollow(
    req: FastifyRequest<{ Body: GraphActionBody }>,
    reply: FastifyReply
  ): Promise<ApiResponse<{ unfollowed: boolean }>> {
    const currentUserId = (req as unknown as { currentUserId?: string | null }).currentUserId;

    if (!currentUserId) {
      reply.status(401);
      return {
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      };
    }

    const { targetUserId } = req.body;
    if (!targetUserId) {
      reply.status(400);
      return {
        success: false,
        error: { code: 'BAD_REQUEST', message: 'targetUserId is required' },
      };
    }

    try {
      const result = await unfollowUserService.unfollow(currentUserId, targetUserId);
      return {
        success: true,
        data: result,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Error unfollowing user';
      reply.status(400);
      return {
        success: false,
        error: { code: 'BAD_REQUEST', message },
      };
    }
  }

  public async unfollowUserById(
    req: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply
  ): Promise<ApiResponse<{ unfollowed: boolean }>> {
    const currentUserId = (req as unknown as { currentUserId?: string | null }).currentUserId;

    if (!currentUserId) {
      reply.status(401);
      return {
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      };
    }

    const targetUserId = req.params.id;
    if (!targetUserId) {
      reply.status(400);
      return {
        success: false,
        error: { code: 'BAD_REQUEST', message: 'targetUserId is required' },
      };
    }

    try {
      const result = await unfollowUserService.unfollow(currentUserId, targetUserId);
      return {
        success: true,
        data: result,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Error unfollowing user';
      reply.status(400);
      return {
        success: false,
        error: { code: 'BAD_REQUEST', message },
      };
    }
  }

  public async block(
    req: FastifyRequest<{ Body: GraphActionBody }>,
    reply: FastifyReply
  ): Promise<ApiResponse<{ blocked: boolean }>> {
    const currentUserId = (req as unknown as { currentUserId?: string | null }).currentUserId;

    if (!currentUserId) {
      reply.status(401);
      return {
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      };
    }

    const { targetUserId } = req.body;
    if (!targetUserId) {
      reply.status(400);
      return {
        success: false,
        error: { code: 'BAD_REQUEST', message: 'targetUserId is required' },
      };
    }

    try {
      const result = await blockUserService.block(currentUserId, targetUserId);
      return {
        success: true,
        data: result,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Error blocking user';
      reply.status(400);
      return {
        success: false,
        error: { code: 'BAD_REQUEST', message },
      };
    }
  }

  public async unblock(
    req: FastifyRequest<{ Body: GraphActionBody }>,
    reply: FastifyReply
  ): Promise<ApiResponse<{ unblocked: boolean }>> {
    const currentUserId = (req as unknown as { currentUserId?: string | null }).currentUserId;

    if (!currentUserId) {
      reply.status(401);
      return {
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      };
    }

    const { targetUserId } = req.body;
    if (!targetUserId) {
      reply.status(400);
      return {
        success: false,
        error: { code: 'BAD_REQUEST', message: 'targetUserId is required' },
      };
    }

    try {
      const result = await blockUserService.unblock(currentUserId, targetUserId);
      return {
        success: true,
        data: result,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Error unblocking user';
      reply.status(400);
      return {
        success: false,
        error: { code: 'BAD_REQUEST', message },
      };
    }
  }
}

export const socialGraphController = new SocialGraphController();

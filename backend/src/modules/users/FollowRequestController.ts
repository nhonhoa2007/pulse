import { FastifyRequest, FastifyReply } from 'fastify';
import { fetchFollowRequestsService } from './FetchFollowRequestsService.js';
import { acceptFollowRequestService } from './AcceptFollowRequestService.js';
import { rejectFollowRequestService } from './RejectFollowRequestService.js';
import { cancelFollowRequestService } from './CancelFollowRequestService.js';
import { ApiResponse, FollowRequestDto } from '../../contracts/ApiContracts.js';

interface RequestParams {
  id: string;
}

export class FollowRequestController {
  public async getPendingRequests(
    req: FastifyRequest,
    reply: FastifyReply
  ): Promise<ApiResponse<FollowRequestDto[]>> {
    const currentUserId = (req as unknown as { currentUserId?: string | null }).currentUserId;

    if (!currentUserId) {
      reply.status(401);
      return {
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Yêu cầu xác thực' },
      };
    }

    try {
      const requests = await fetchFollowRequestsService.getPendingRequests(currentUserId);
      return {
        success: true,
        data: requests,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Lỗi truy vấn yêu cầu theo dõi';
      reply.status(500);
      return {
        success: false,
        error: { code: 'INTERNAL_SERVER_ERROR', message },
      };
    }
  }

  public async acceptRequest(
    req: FastifyRequest<{ Params: RequestParams }>,
    reply: FastifyReply
  ): Promise<ApiResponse<FollowRequestDto>> {
    const currentUserId = (req as unknown as { currentUserId?: string | null }).currentUserId;

    if (!currentUserId) {
      reply.status(401);
      return {
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Yêu cầu xác thực' },
      };
    }

    const { id } = req.params;

    try {
      const result = await acceptFollowRequestService.accept(id, currentUserId);
      return {
        success: true,
        data: result,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Lỗi duyệt yêu cầu theo dõi';
      const statusCode = (err as any).statusCode || 400;
      const code = (err as any).code || 'BAD_REQUEST';

      reply.status(statusCode);
      return {
        success: false,
        error: { code, message },
      };
    }
  }

  public async rejectRequest(
    req: FastifyRequest<{ Params: RequestParams }>,
    reply: FastifyReply
  ): Promise<ApiResponse<FollowRequestDto>> {
    const currentUserId = (req as unknown as { currentUserId?: string | null }).currentUserId;

    if (!currentUserId) {
      reply.status(401);
      return {
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Yêu cầu xác thực' },
      };
    }

    const { id } = req.params;

    try {
      const result = await rejectFollowRequestService.reject(id, currentUserId);
      return {
        success: true,
        data: result,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Lỗi từ chối yêu cầu theo dõi';
      const statusCode = (err as any).statusCode || 400;
      const code = (err as any).code || 'BAD_REQUEST';

      reply.status(statusCode);
      return {
        success: false,
        error: { code, message },
      };
    }
  }

  public async cancelRequest(
    req: FastifyRequest<{ Params: RequestParams }>,
    reply: FastifyReply
  ): Promise<ApiResponse<{ message: string }>> {
    const currentUserId = (req as unknown as { currentUserId?: string | null }).currentUserId;

    if (!currentUserId) {
      reply.status(401);
      return {
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Yêu cầu xác thực' },
      };
    }

    const { id } = req.params;

    try {
      await cancelFollowRequestService.cancel(id, currentUserId);
      return {
        success: true,
        data: { message: 'Đã hủy yêu cầu theo dõi' },
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Lỗi hủy yêu cầu theo dõi';
      const statusCode = (err as any).statusCode || 400;
      const code = (err as any).code || 'BAD_REQUEST';

      reply.status(statusCode);
      return {
        success: false,
        error: { code, message },
      };
    }
  }
}

export const followRequestController = new FollowRequestController();

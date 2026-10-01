import { userController } from '../users/UserController.js';
import { FastifyRequest, FastifyReply } from 'fastify';
import { hybridFeedTimelineService } from './HybridFeedTimelineService.js';
import { forYouRecommendationFeedService } from './ForYouRecommendationFeedService.js';
import { ApiResponse, FeedResponse } from '../../contracts/ApiContracts.js';

interface FeedQueryParams {
  cursor?: string;
  limit?: string;
}

interface UserFeedParams {
  username: string;
}

export class FeedController {
  public async getHomeFeed(
    req: FastifyRequest<{ Querystring: FeedQueryParams }>,
    reply: FastifyReply
  ): Promise<ApiResponse<FeedResponse>> {
    const currentUserId = (req as unknown as { currentUserId?: string | null }).currentUserId;

    if (!currentUserId) {
      reply.status(401);
      return {
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      };
    }

    const { cursor, limit } = req.query;
    const parsedLimit = limit ? parseInt(limit, 10) : 20;

    const data = await hybridFeedTimelineService.getHomeFeed({
      userId: currentUserId,
      cursor,
      limit: parsedLimit,
    });

    return {
      success: true,
      data,
    };
  }

  public async getForYouFeed(
    req: FastifyRequest<{ Querystring: FeedQueryParams }>,
    reply: FastifyReply
  ): Promise<ApiResponse<FeedResponse>> {
    const currentUserId = (req as unknown as { currentUserId?: string | null }).currentUserId;

    if (!currentUserId) {
      reply.status(401);
      return {
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      };
    }

    const { cursor, limit } = req.query;
    const parsedLimit = limit ? parseInt(limit, 10) : 20;

    const data = await forYouRecommendationFeedService.getForYouFeed({
      userId: currentUserId,
      cursor,
      limit: parsedLimit,
    });

    return {
      success: true,
      data,
    };
  }

  public async getUserFeed(
    req: FastifyRequest<{ Params: UserFeedParams; Querystring: FeedQueryParams }>,
    reply: FastifyReply
  ): Promise<ApiResponse<FeedResponse>> {
    return userController.getUserPosts(req as any, reply);
  }
}

export const feedController = new FeedController();

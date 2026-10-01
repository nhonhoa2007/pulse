import { FastifyRequest, FastifyReply } from 'fastify';
import { searchService } from './SearchService.js';
import {
  ApiResponse,
  SearchResultData,
  TrendingResponseData,
} from '../../contracts/ApiContracts.js';

interface SearchQuery {
  q?: string;
  type?: 'all' | 'posts' | 'users';
  limit?: string | number;
  offset?: string | number;
}

interface TrendingQuery {
  limit?: string | number;
}

export class SearchController {
  /**
   * GET /api/v1/search
   * Search posts and users with keyword matching, hashtag discovery, and block isolation.
   */
  public async search(
    req: FastifyRequest<{ Querystring: SearchQuery }>,
    reply: FastifyReply
  ): Promise<ApiResponse<SearchResultData>> {
    const rawQ = req.query.q;

    if (!rawQ || typeof rawQ !== 'string' || !rawQ.trim()) {
      reply.status(400);
      return {
        success: false,
        error: {
          code: 'BAD_REQUEST',
          message: 'Query parameter "q" is required and cannot be empty',
        },
      };
    }

    const q = rawQ.trim();
    const rawType = req.query.type;
    const type: 'all' | 'posts' | 'users' =
      rawType === 'posts' || rawType === 'users' ? rawType : 'all';

    const limit = Math.min(
      Math.max(parseInt(String(req.query.limit || '20'), 10) || 20, 1),
      100
    );
    const offset = Math.max(parseInt(String(req.query.offset || '0'), 10) || 0, 0);
    const currentUserId = req.currentUserId || null;

    try {
      const data = await searchService.search({
        q,
        type,
        limit,
        offset,
        currentUserId,
      });

      return {
        success: true,
        data,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Error executing search';
      reply.status(500);
      return {
        success: false,
        error: {
          code: 'SEARCH_ERROR',
          message,
        },
      };
    }
  }

  /**
   * GET /api/v1/trending
   * Retrieve ranked trending hashtags based on recent post velocity, engagement, and time decay.
   */
  public async getTrending(
    req: FastifyRequest<{ Querystring: TrendingQuery }>,
    reply: FastifyReply
  ): Promise<ApiResponse<TrendingResponseData>> {
    const limit = Math.min(
      Math.max(parseInt(String(req.query.limit || '20'), 10) || 20, 1),
      50
    );

    try {
      const data = await searchService.getTrending(limit);
      return {
        success: true,
        data,
      };
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Error retrieving trending hashtags';
      reply.status(500);
      return {
        success: false,
        error: {
          code: 'TRENDING_ERROR',
          message,
        },
      };
    }
  }
}

export const searchController = new SearchController();

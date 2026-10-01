import { FastifyRequest, FastifyReply } from 'fastify';
import {
  ApiResponse,
  UserMuteDto,
  KeywordMuteDto,
  CreateKeywordMuteInput,
} from '../../contracts/ApiContracts.js';
import { muteUserService, MuteUserResult, MuteError } from './MuteUserService.js';
import { unmuteUserService, UnmuteUserResult } from './UnmuteUserService.js';
import { fetchMutedUsersService } from './FetchMutedUsersService.js';
import { muteKeywordService } from './MuteKeywordService.js';
import { unmuteKeywordService, UnmuteKeywordResult } from './UnmuteKeywordService.js';
import { fetchMutedKeywordsService } from './FetchMutedKeywordsService.js';

interface UserIdParams {
  id: string;
}

interface KeywordIdParams {
  id: string;
}

export class MuteController {
  public async muteUser(
    req: FastifyRequest<{ Params: UserIdParams }>,
    reply: FastifyReply
  ): Promise<ApiResponse<MuteUserResult>> {
    const currentUserId = req.currentUserId;
    if (!currentUserId) {
      reply.status(401);
      return {
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      };
    }

    const { id: targetUserId } = req.params;

    try {
      const result = await muteUserService.muteUser(currentUserId, targetUserId);
      return {
        success: true,
        data: result,
      };
    } catch (err: unknown) {
      if (err instanceof MuteError) {
        reply.status(err.statusCode);
        return {
          success: false,
          error: { code: err.code, message: err.message },
        };
      }
      const message = err instanceof Error ? err.message : 'Failed to mute user';
      reply.status(400);
      return {
        success: false,
        error: { code: 'BAD_REQUEST', message },
      };
    }
  }

  public async unmuteUser(
    req: FastifyRequest<{ Params: UserIdParams }>,
    reply: FastifyReply
  ): Promise<ApiResponse<UnmuteUserResult>> {
    const currentUserId = req.currentUserId;
    if (!currentUserId) {
      reply.status(401);
      return {
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      };
    }

    const { id: targetUserId } = req.params;

    try {
      const result = await unmuteUserService.unmuteUser(currentUserId, targetUserId);
      return {
        success: true,
        data: result,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to unmute user';
      reply.status(400);
      return {
        success: false,
        error: { code: 'BAD_REQUEST', message },
      };
    }
  }

  public async getMutedUsers(
    req: FastifyRequest,
    reply: FastifyReply
  ): Promise<ApiResponse<{ mutes: UserMuteDto[] }>> {
    const currentUserId = req.currentUserId;
    if (!currentUserId) {
      reply.status(401);
      return {
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      };
    }

    try {
      const mutes = await fetchMutedUsersService.getMutedUsers(currentUserId);
      return {
        success: true,
        data: { mutes },
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to fetch muted users';
      reply.status(500);
      return {
        success: false,
        error: { code: 'INTERNAL_SERVER_ERROR', message },
      };
    }
  }

  public async muteKeyword(
    req: FastifyRequest<{ Body: CreateKeywordMuteInput }>,
    reply: FastifyReply
  ): Promise<ApiResponse<KeywordMuteDto>> {
    const currentUserId = req.currentUserId;
    if (!currentUserId) {
      reply.status(401);
      return {
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      };
    }

    try {
      const result = await muteKeywordService.muteKeyword(currentUserId, req.body);
      reply.status(201);
      return {
        success: true,
        data: result,
      };
    } catch (err: unknown) {
      if (err instanceof MuteError) {
        reply.status(err.statusCode);
        return {
          success: false,
          error: { code: err.code, message: err.message },
        };
      }
      const message = err instanceof Error ? err.message : 'Failed to mute keyword';
      reply.status(400);
      return {
        success: false,
        error: { code: 'BAD_REQUEST', message },
      };
    }
  }

  public async getMutedKeywords(
    req: FastifyRequest,
    reply: FastifyReply
  ): Promise<ApiResponse<{ keywords: KeywordMuteDto[] }>> {
    const currentUserId = req.currentUserId;
    if (!currentUserId) {
      reply.status(401);
      return {
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      };
    }

    try {
      const keywords = await fetchMutedKeywordsService.getMutedKeywords(currentUserId);
      return {
        success: true,
        data: { keywords },
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to fetch muted keywords';
      reply.status(500);
      return {
        success: false,
        error: { code: 'INTERNAL_SERVER_ERROR', message },
      };
    }
  }

  public async unmuteKeyword(
    req: FastifyRequest<{ Params: KeywordIdParams }>,
    reply: FastifyReply
  ): Promise<ApiResponse<UnmuteKeywordResult>> {
    const currentUserId = req.currentUserId;
    if (!currentUserId) {
      reply.status(401);
      return {
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      };
    }

    const { id } = req.params;

    try {
      const result = await unmuteKeywordService.unmuteKeyword(currentUserId, id);
      return {
        success: true,
        data: result,
      };
    } catch (err: unknown) {
      if (err instanceof MuteError) {
        reply.status(err.statusCode);
        return {
          success: false,
          error: { code: err.code, message: err.message },
        };
      }
      const message = err instanceof Error ? err.message : 'Failed to delete muted keyword';
      reply.status(400);
      return {
        success: false,
        error: { code: 'BAD_REQUEST', message },
      };
    }
  }
}

export const muteController = new MuteController();

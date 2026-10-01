import { FastifyRequest, FastifyReply } from 'fastify';
import { dmConversationService } from './DmConversationService.js';
import { dmMessageService } from './DmMessageService.js';
import { DmError } from './DmErrors.js';
import {
  ApiResponse,
  DmConversationDto,
  DmConversationListResponse,
  DmMessageDto,
  DmMessageListResponse,
  DmReadReceiptDto,
  CreateDmConversationInput,
  SendDmMessageInput,
  MarkDmReadInput,
} from '../../contracts/ApiContracts.js';

interface ConversationParams {
  id: string;
}

interface MessageParams {
  id: string;
}

interface ListConversationsQuery {
  limit?: string;
  cursor?: string;
}

interface GetMessagesQuery {
  limit?: string;
  cursor?: string;
  direction?: 'before' | 'after';
}

export class DmController {
  /**
   * POST /dm/conversations
   * Find or create a DM conversation.
   */
  public async createConversation(
    req: FastifyRequest<{ Body: CreateDmConversationInput }>,
    reply: FastifyReply
  ): Promise<ApiResponse<DmConversationDto>> {
    const currentUserId = req.currentUserId;
    if (!currentUserId) {
      reply.status(401);
      return {
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      };
    }

    try {
      const recipientId = req.body?.recipientId;
      const { conversation, isCreated } =
        await dmConversationService.getOrCreateConversation(currentUserId, recipientId);

      reply.status(isCreated ? 201 : 200);
      return {
        success: true,
        data: conversation,
      };
    } catch (err: unknown) {
      return this.handleError(err, reply);
    }
  }

  /**
   * GET /dm/conversations
   * List all DM conversations for the authenticated user.
   */
  public async listConversations(
    req: FastifyRequest<{ Querystring: ListConversationsQuery }>,
    reply: FastifyReply
  ): Promise<ApiResponse<DmConversationListResponse>> {
    const currentUserId = req.currentUserId;
    if (!currentUserId) {
      reply.status(401);
      return {
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      };
    }

    try {
      const { limit, cursor } = req.query;
      const result = await dmConversationService.listUserConversations(currentUserId, {
        limit: limit ? parseInt(limit, 10) : undefined,
        cursor,
      });

      return {
        success: true,
        data: result,
      };
    } catch (err: unknown) {
      return this.handleError(err, reply);
    }
  }

  /**
   * GET /dm/conversations/:id/messages
   * Cursor-paginated message history.
   */
  public async getMessages(
    req: FastifyRequest<{ Params: ConversationParams; Querystring: GetMessagesQuery }>,
    reply: FastifyReply
  ): Promise<ApiResponse<DmMessageListResponse>> {
    const currentUserId = req.currentUserId;
    if (!currentUserId) {
      reply.status(401);
      return {
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      };
    }

    try {
      const { id } = req.params;
      const { limit, cursor, direction } = req.query;
      const result = await dmMessageService.getMessages(currentUserId, id, {
        limit: limit ? parseInt(limit, 10) : undefined,
        cursor,
        direction,
      });

      return {
        success: true,
        data: result,
      };
    } catch (err: unknown) {
      return this.handleError(err, reply);
    }
  }

  /**
   * POST /dm/conversations/:id/messages
   * Send a direct message.
   */
  public async sendMessage(
    req: FastifyRequest<{ Params: ConversationParams; Body: SendDmMessageInput }>,
    reply: FastifyReply
  ): Promise<ApiResponse<DmMessageDto>> {
    const currentUserId = req.currentUserId;
    if (!currentUserId) {
      reply.status(401);
      return {
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      };
    }

    try {
      const { id } = req.params;
      const result = await dmMessageService.sendMessage(currentUserId, id, req.body);

      reply.status(201);
      return {
        success: true,
        data: result,
      };
    } catch (err: unknown) {
      return this.handleError(err, reply);
    }
  }

  /**
   * PUT /dm/conversations/:id/read
   * Update read receipt.
   */
  public async markAsRead(
    req: FastifyRequest<{ Params: ConversationParams; Body: MarkDmReadInput }>,
    reply: FastifyReply
  ): Promise<ApiResponse<DmReadReceiptDto>> {
    const currentUserId = req.currentUserId;
    if (!currentUserId) {
      reply.status(401);
      return {
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      };
    }

    try {
      const { id } = req.params;
      const messageId = req.body?.messageId;
      const result = await dmMessageService.markAsRead(currentUserId, id, messageId);

      return {
        success: true,
        data: result,
      };
    } catch (err: unknown) {
      return this.handleError(err, reply);
    }
  }

  /**
   * DELETE /dm/messages/:id
   * Soft delete a message.
   */
  public async deleteMessage(
    req: FastifyRequest<{ Params: MessageParams }>,
    reply: FastifyReply
  ): Promise<ApiResponse<{ messageId: string; conversationId: string; deleted: boolean; deletedAt: string }>> {
    const currentUserId = req.currentUserId;
    if (!currentUserId) {
      reply.status(401);
      return {
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      };
    }

    try {
      const { id } = req.params;
      const result = await dmMessageService.softDeleteMessage(currentUserId, id);

      return {
        success: true,
        data: result,
      };
    } catch (err: unknown) {
      return this.handleError(err, reply);
    }
  }

  private handleError(err: unknown, reply: FastifyReply): ApiResponse<never> {
    if (err instanceof DmError) {
      reply.status(err.statusCode);
      return {
        success: false,
        error: {
          code: err.code,
          message: err.message,
        },
      };
    }

    const message = err instanceof Error ? err.message : 'An unexpected error occurred';
    reply.status(500);
    return {
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message,
      },
    };
  }
}

export const dmController = new DmController();

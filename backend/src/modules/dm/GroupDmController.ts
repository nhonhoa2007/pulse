import { FastifyRequest, FastifyReply } from 'fastify';
import { groupDmConversationService } from './GroupDmConversationService.js';
import { groupDmMessageService } from './GroupDmMessageService.js';
import { DmError } from './DmErrors.js';
import {
  ApiResponse,
  GroupConversationDto,
  GroupConversationListResponse,
  GroupMemberDto,
  GroupMessageDto,
  GroupMessageListResponse,
  GroupReadReceiptDto,
  CreateGroupConversationInput,
  UpdateGroupConversationInput,
  AddGroupMemberInput,
  SendGroupMessageInput,
  MarkGroupReadInput,
} from '../../contracts/ApiContracts.js';

interface GroupParams {
  id: string;
}

interface GroupMemberParams {
  id: string;
  userId: string;
}

interface GroupMessageParams {
  id: string;
  messageId: string;
}

interface ListGroupsQuery {
  limit?: string;
  cursor?: string;
}

interface GetMessagesQuery {
  limit?: string;
  cursor?: string;
  direction?: 'before' | 'after';
}

export class GroupDmController {
  /**
   * POST /api/v1/dm/groups
   */
  public async createGroup(
    req: FastifyRequest<{ Body: CreateGroupConversationInput }>,
    reply: FastifyReply
  ): Promise<ApiResponse<GroupConversationDto>> {
    const currentUserId = req.currentUserId;
    if (!currentUserId) {
      reply.status(401);
      return {
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      };
    }

    try {
      const group = await groupDmConversationService.createConversation(currentUserId, req.body);
      reply.status(201);
      return {
        success: true,
        data: group,
      };
    } catch (err: unknown) {
      return this.handleError(err, reply);
    }
  }

  /**
   * GET /api/v1/dm/groups
   */
  public async listGroups(
    req: FastifyRequest<{ Querystring: ListGroupsQuery }>,
    reply: FastifyReply
  ): Promise<ApiResponse<GroupConversationListResponse>> {
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
      const result = await groupDmConversationService.listConversations(
        currentUserId,
        cursor,
        limit ? parseInt(limit, 10) : undefined
      );

      return {
        success: true,
        data: result,
      };
    } catch (err: unknown) {
      return this.handleError(err, reply);
    }
  }

  /**
   * GET /api/v1/dm/groups/:id
   */
  public async getGroup(
    req: FastifyRequest<{ Params: GroupParams }>,
    reply: FastifyReply
  ): Promise<ApiResponse<GroupConversationDto>> {
    const currentUserId = req.currentUserId;
    if (!currentUserId) {
      reply.status(401);
      return {
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      };
    }

    try {
      const group = await groupDmConversationService.getConversation(currentUserId, req.params.id);
      return {
        success: true,
        data: group,
      };
    } catch (err: unknown) {
      return this.handleError(err, reply);
    }
  }

  /**
   * PATCH /api/v1/dm/groups/:id
   */
  public async updateGroup(
    req: FastifyRequest<{ Params: GroupParams; Body: UpdateGroupConversationInput }>,
    reply: FastifyReply
  ): Promise<ApiResponse<GroupConversationDto>> {
    const currentUserId = req.currentUserId;
    if (!currentUserId) {
      reply.status(401);
      return {
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      };
    }

    try {
      const updated = await groupDmConversationService.updateConversation(
        currentUserId,
        req.params.id,
        req.body || {}
      );
      return {
        success: true,
        data: updated,
      };
    } catch (err: unknown) {
      return this.handleError(err, reply);
    }
  }

  /**
   * POST /api/v1/dm/groups/:id/members
   */
  public async addMember(
    req: FastifyRequest<{ Params: GroupParams; Body: AddGroupMemberInput }>,
    reply: FastifyReply
  ): Promise<ApiResponse<GroupMemberDto>> {
    const currentUserId = req.currentUserId;
    if (!currentUserId) {
      reply.status(401);
      return {
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      };
    }

    try {
      const member = await groupDmConversationService.addMember(
        currentUserId,
        req.params.id,
        req.body
      );
      reply.status(201);
      return {
        success: true,
        data: member,
      };
    } catch (err: unknown) {
      return this.handleError(err, reply);
    }
  }

  /**
   * DELETE /api/v1/dm/groups/:id/members/:userId
   */
  public async removeMember(
    req: FastifyRequest<{ Params: GroupMemberParams }>,
    reply: FastifyReply
  ): Promise<ApiResponse<{ success: true }>> {
    const currentUserId = req.currentUserId;
    if (!currentUserId) {
      reply.status(401);
      return {
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      };
    }

    try {
      await groupDmConversationService.removeMember(
        currentUserId,
        req.params.id,
        req.params.userId
      );
      return {
        success: true,
        data: { success: true },
      };
    } catch (err: unknown) {
      return this.handleError(err, reply);
    }
  }

  /**
   * POST /api/v1/dm/groups/:id/messages
   */
  public async sendMessage(
    req: FastifyRequest<{ Params: GroupParams; Body: SendGroupMessageInput }>,
    reply: FastifyReply
  ): Promise<ApiResponse<GroupMessageDto>> {
    const currentUserId = req.currentUserId;
    if (!currentUserId) {
      reply.status(401);
      return {
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      };
    }

    try {
      const message = await groupDmMessageService.sendMessage(
        currentUserId,
        req.params.id,
        req.body
      );
      reply.status(201);
      return {
        success: true,
        data: message,
      };
    } catch (err: unknown) {
      return this.handleError(err, reply);
    }
  }

  /**
   * GET /api/v1/dm/groups/:id/messages
   */
  public async getMessages(
    req: FastifyRequest<{ Params: GroupParams; Querystring: GetMessagesQuery }>,
    reply: FastifyReply
  ): Promise<ApiResponse<GroupMessageListResponse>> {
    const currentUserId = req.currentUserId;
    if (!currentUserId) {
      reply.status(401);
      return {
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      };
    }

    try {
      const { limit, cursor, direction } = req.query;
      const result = await groupDmMessageService.getMessages(currentUserId, req.params.id, {
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
   * DELETE /api/v1/dm/groups/:id/messages/:messageId
   */
  public async deleteMessage(
    req: FastifyRequest<{ Params: GroupMessageParams }>,
    reply: FastifyReply
  ): Promise<ApiResponse<{ success: true }>> {
    const currentUserId = req.currentUserId;
    if (!currentUserId) {
      reply.status(401);
      return {
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      };
    }

    try {
      await groupDmMessageService.softDeleteMessage(
        currentUserId,
        req.params.id,
        req.params.messageId
      );
      return {
        success: true,
        data: { success: true },
      };
    } catch (err: unknown) {
      return this.handleError(err, reply);
    }
  }

  /**
   * PUT /api/v1/dm/groups/:id/read
   */
  public async markAsRead(
    req: FastifyRequest<{ Params: GroupParams; Body: MarkGroupReadInput }>,
    reply: FastifyReply
  ): Promise<ApiResponse<GroupReadReceiptDto>> {
    const currentUserId = req.currentUserId;
    if (!currentUserId) {
      reply.status(401);
      return {
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      };
    }

    try {
      const receipt = await groupDmMessageService.markAsRead(
        currentUserId,
        req.params.id,
        req.body?.messageId
      );
      return {
        success: true,
        data: receipt,
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

export const groupDmController = new GroupDmController();

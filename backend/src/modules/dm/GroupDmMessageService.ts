import { prisma } from '../../db/PrismaClientSingleton.js';
import {
  GroupMessageDto,
  DmReactionSummaryDto,
  GroupMessageListResponse,
  GroupReadReceiptDto,
  SendGroupMessageInput,
} from '../../contracts/ApiContracts.js';
import {
  DmValidationError,
  DmForbiddenError,
  DmNotFoundError,
} from './DmErrors.js';
import { realtimeStreamController } from '../notifications/RealtimeEventStreamController.js';

export class GroupDmMessageService {
  /**
   * Send a message to a group conversation.
   * Enforces:
   * 1. Content validation (1-5000 chars)
   * 2. Active membership check (IDOR defense)
   * 3. Persistence + conversation updatedAt touch + sender read receipt
   * 4. Realtime SSE push to all group members
   */
  public async sendMessage(
    currentUserId: string,
    conversationId: string,
    input: SendGroupMessageInput
  ): Promise<GroupMessageDto> {
    if (
      !input ||
      typeof input.content !== 'string' ||
      input.content.trim() === '' ||
      input.content.length > 5000
    ) {
      throw new DmValidationError(
        'Message content cannot be empty or exceed 5000 characters'
      );
    }

    const membership = await prisma.groupMember.findUnique({
      where: {
        unique_group_conversation_user: {
          conversationId,
          userId: currentUserId,
        },
      },
    });

    if (!membership) {
      throw new DmForbiddenError('Access denied: You are not a member of this group conversation');
    }

    if (input.mediaUrls !== undefined && !Array.isArray(input.mediaUrls)) {
      throw new DmValidationError('mediaUrls must be an array of URL strings');
    }

    const safeMediaUrls: string[] = [];
    if (Array.isArray(input.mediaUrls)) {
      for (const url of input.mediaUrls) {
        if (typeof url !== 'string') {
          throw new DmValidationError('mediaUrls items must be strings');
        }
        const trimmed = url.trim();
        const lower = trimmed.toLowerCase();
        if (lower.startsWith('javascript:') || lower.startsWith('data:') || lower.startsWith('vbscript:')) {
          throw new DmValidationError('Invalid mediaUrl: Dangerous URI protocol rejected');
        }
        safeMediaUrls.push(trimmed);
      }
    }

    const createdMsg = await prisma.$transaction(async (tx) => {
      const msg = await tx.groupMessage.create({
        data: {
          conversationId,
          senderId: currentUserId,
          content: input.content.trim(),
          messageType: input.messageType || 'TEXT',
          mediaUrls: safeMediaUrls,
        },
        include: {
          sender: {
            select: { id: true, username: true, displayName: true, avatarUrl: true },
          },
        },
      });

      await tx.groupConversation.update({
        where: { id: conversationId },
        data: { updatedAt: new Date() },
      });

      await tx.groupReadReceipt.upsert({
        where: {
          unique_group_conversation_user_receipt: {
            conversationId,
            userId: currentUserId,
          },
        },
        create: {
          conversationId,
          userId: currentUserId,
          lastReadMessageId: msg.id,
          readAt: msg.createdAt,
        },
        update: {
          lastReadMessageId: msg.id,
          readAt: msg.createdAt,
        },
      });

      return msg;
    });

    const messageDto: GroupMessageDto = {
      id: createdMsg.id,
      conversationId,
      senderId: createdMsg.senderId,
      content: createdMsg.content,
      messageType: (createdMsg.messageType || 'TEXT') as 'TEXT' | 'IMAGE' | 'SYSTEM',
      mediaUrls: createdMsg.mediaUrls,
      isDeleted: false,
      createdAt: createdMsg.createdAt.toISOString(),
      updatedAt: createdMsg.updatedAt.toISOString(),
      sender: createdMsg.sender,
    };

    // Broadcast dm.group.message.new via SSE to all members of the group
    const members = await prisma.groupMember.findMany({
      where: { conversationId },
      select: { userId: true },
    });

    for (const m of members) {
      realtimeStreamController.sendToUser(m.userId, 'dm.group.message.new', {
        conversationId,
        message: messageDto,
      });
    }

    return messageDto;
  }

  /**
   * Get messages from a group conversation with cursor-based pagination.
   * Enforces active membership IDOR check.
   */
  private async aggregateGroupReactions(messageIds: string[]): Promise<Map<string, DmReactionSummaryDto[]>> {
    const map = new Map<string, DmReactionSummaryDto[]>();
    if (messageIds.length === 0) return map;
    const rows = await prisma.groupDmReaction.findMany({
      where: { messageId: { in: messageIds } },
      orderBy: { createdAt: 'asc' },
    });
    for (const r of rows) {
      const list = map.get(r.messageId) || [];
      const existing = list.find((x) => x.emoji === r.emoji);
      if (existing) {
        existing.count += 1;
        existing.userIds.push(r.userId);
      } else {
        list.push({ emoji: r.emoji, count: 1, userIds: [r.userId] });
      }
      map.set(r.messageId, list);
    }
    return map;
  }

  /**
   * PKG-05: toggle reaction group message — yêu cầu active membership.
   * Broadcast dm.group.reaction.updated cho toàn bộ members.
   */
  public async toggleReaction(
    userId: string,
    messageId: string,
    emoji: string
  ): Promise<{ messageId: string; toggledOn: boolean; reactions: DmReactionSummaryDto[] }> {
    if (!emoji || emoji.length > 8) {
      const err: any = new Error('Emoji không hợp lệ');
      err.code = 'INVALID_EMOJI';
      err.statusCode = 400;
      throw err;
    }

    const msg = await prisma.groupMessage.findUnique({
      where: { id: messageId },
      select: { id: true, conversationId: true, deletedAt: true },
    });
    if (!msg || msg.deletedAt) {
      const e: any = new Error('Message not found');
      e.statusCode = 404;
      e.code = 'NOT_FOUND';
      throw e;
    }
    const membership = await prisma.groupMember.findUnique({
      where: { unique_group_conversation_user: { conversationId: msg.conversationId, userId } },
    });
    if (!membership) {
      const e: any = new Error('Bạn không phải thành viên của nhóm này');
      e.statusCode = 403;
      e.code = 'FORBIDDEN';
      throw e;
    }

    const existing = await prisma.groupDmReaction.findUnique({
      where: { unique_group_dm_reaction: { messageId, userId, emoji } },
    });
    let toggledOn: boolean;
    if (existing) {
      await prisma.groupDmReaction.delete({ where: { id: existing.id } });
      toggledOn = false;
    } else {
      await prisma.groupDmReaction.create({ data: { messageId, userId, emoji } });
      toggledOn = true;
    }

    const reactionMap = await this.aggregateGroupReactions([messageId]);
    const reactions = reactionMap.get(messageId) || [];

    const members = await prisma.groupMember.findMany({
      where: { conversationId: msg.conversationId },
      select: { userId: true },
    });
    const event = { conversationId: msg.conversationId, messageId, reactions };
    for (const m of members) {
      realtimeStreamController.sendToUser(m.userId, 'dm.group.reaction.updated', event);
    }

    return { messageId, toggledOn, reactions };
  }

  public async getMessages(
    currentUserId: string,
    conversationId: string,
    options?: {
      cursor?: string;
      limit?: number;
      direction?: 'before' | 'after';
    }
  ): Promise<GroupMessageListResponse> {
    const membership = await prisma.groupMember.findUnique({
      where: {
        unique_group_conversation_user: {
          conversationId,
          userId: currentUserId,
        },
      },
    });

    if (!membership) {
      throw new DmForbiddenError('Access denied: You are not a member of this group conversation');
    }

    const limit = Math.min(Math.max(Number(options?.limit) || 30, 1), 100);
    const direction = options?.direction || 'before';

    const whereClause: {
      conversationId: string;
      createdAt?: { lt?: Date; gt?: Date };
    } = {
      conversationId,
    };

    if (options?.cursor) {
      const cursorMsg = await prisma.groupMessage.findUnique({
        where: { id: options.cursor },
        select: { createdAt: true },
      });
      if (cursorMsg) {
        if (direction === 'before') {
          whereClause.createdAt = { lt: cursorMsg.createdAt };
        } else {
          whereClause.createdAt = { gt: cursorMsg.createdAt };
        }
      } else {
        const cursorDate = new Date(options.cursor);
        if (!Number.isNaN(cursorDate.getTime())) {
          if (direction === 'before') {
            whereClause.createdAt = { lt: cursorDate };
          } else {
            whereClause.createdAt = { gt: cursorDate };
          }
        }
      }
    }

    const rawMessages = await prisma.groupMessage.findMany({
      where: whereClause,
      orderBy: { createdAt: direction === 'after' ? 'asc' : 'desc' },
      take: limit + 1,
      include: {
        sender: {
          select: { id: true, username: true, displayName: true, avatarUrl: true },
        },
      },
    });

    const hasMore = rawMessages.length > limit;
    const paged = hasMore ? rawMessages.slice(0, limit) : rawMessages;

    // Arrange returned batch in chronological order (oldest to newest)
    const sorted = direction === 'after' ? paged : [...paged].reverse();

    const reactionMap = await this.aggregateGroupReactions(sorted.map((m) => m.id));

    const messages: GroupMessageDto[] = sorted.map((msg) => {
      const isDeleted = msg.deletedAt !== null;
      return {
        id: msg.id,
        conversationId: msg.conversationId,
        senderId: msg.senderId,
        content: isDeleted ? 'This message was deleted' : msg.content,
        messageType: (msg.messageType || 'TEXT') as 'TEXT' | 'IMAGE' | 'SYSTEM',
        mediaUrls: isDeleted ? [] : msg.mediaUrls,
        isDeleted,
        createdAt: msg.createdAt.toISOString(),
        updatedAt: msg.updatedAt.toISOString(),
        sender: msg.sender,
        reactions: reactionMap.get(msg.id) || [],
      };
    });

    let nextCursor: string | null = null;
    if (hasMore) {
      if (direction === 'before') {
        nextCursor = sorted.length > 0 ? sorted[0].id : null;
      } else {
        nextCursor = sorted.length > 0 ? sorted[sorted.length - 1].id : null;
      }
    }

    return {
      conversationId,
      messages,
      nextCursor,
      hasMore,
    };
  }

  /**
   * Soft delete own message in a group.
   * Only the original sender can delete.
   * Emits dm.group.message.deleted to all group members.
   */
  public async softDeleteMessage(
    currentUserId: string,
    conversationId: string,
    messageId: string
  ): Promise<{ success: true; messageId: string; conversationId: string; deletedAt: string }> {
    const membership = await prisma.groupMember.findUnique({
      where: {
        unique_group_conversation_user: {
          conversationId,
          userId: currentUserId,
        },
      },
    });

    if (!membership) {
      throw new DmForbiddenError('Access denied: You are not a member of this group conversation');
    }

    const message = await prisma.groupMessage.findUnique({
      where: { id: messageId },
    });

    if (!message || message.conversationId !== conversationId) {
      throw new DmNotFoundError('Message not found');
    }

    if (message.senderId !== currentUserId) {
      throw new DmForbiddenError('You can only delete your own messages');
    }

    const deletedAt = new Date();
    await prisma.groupMessage.update({
      where: { id: messageId },
      data: { deletedAt },
    });

    // Broadcast dm.group.message.deleted to all members
    const members = await prisma.groupMember.findMany({
      where: { conversationId },
      select: { userId: true },
    });

    for (const m of members) {
      realtimeStreamController.sendToUser(m.userId, 'dm.group.message.deleted', {
        conversationId,
        messageId,
      });
    }

    return {
      success: true,
      messageId,
      conversationId,
      deletedAt: deletedAt.toISOString(),
    };
  }

  /**
   * Mark group conversation as read up to a message.
   * Emits dm.group.read_receipt.updated to all group members.
   */
  public async markAsRead(
    currentUserId: string,
    conversationId: string,
    messageId?: string
  ): Promise<GroupReadReceiptDto> {
    const membership = await prisma.groupMember.findUnique({
      where: {
        unique_group_conversation_user: {
          conversationId,
          userId: currentUserId,
        },
      },
    });

    if (!membership) {
      throw new DmForbiddenError('Access denied: You are not a member of this group conversation');
    }

    let targetMessageId: string | null = messageId || null;
    let readAt = new Date();

    if (targetMessageId) {
      const msg = await prisma.groupMessage.findUnique({
        where: { id: targetMessageId },
        select: { id: true, createdAt: true },
      });
      if (msg) {
        readAt = msg.createdAt;
      }
    } else {
      const latestMsg = await prisma.groupMessage.findFirst({
        where: { conversationId },
        orderBy: { createdAt: 'desc' },
        select: { id: true, createdAt: true },
      });
      if (latestMsg) {
        targetMessageId = latestMsg.id;
        readAt = latestMsg.createdAt;
      }
    }

    const receipt = await prisma.groupReadReceipt.upsert({
      where: {
        unique_group_conversation_user_receipt: {
          conversationId,
          userId: currentUserId,
        },
      },
      create: {
        conversationId,
        userId: currentUserId,
        lastReadMessageId: targetMessageId,
        readAt,
      },
      update: {
        lastReadMessageId: targetMessageId,
        readAt,
      },
    });

    // Notify other group members via SSE
    const members = await prisma.groupMember.findMany({
      where: { conversationId },
      select: { userId: true },
    });

    for (const m of members) {
      realtimeStreamController.sendToUser(m.userId, 'dm.group.read_receipt.updated', {
        conversationId,
        userId: currentUserId,
        lastReadMessageId: receipt.lastReadMessageId,
        readAt: receipt.readAt.toISOString(),
      });
    }

    return {
      conversationId,
      userId: currentUserId,
      lastReadMessageId: receipt.lastReadMessageId,
      readAt: receipt.readAt.toISOString(),
    };
  }
}

export const groupDmMessageService = new GroupDmMessageService();

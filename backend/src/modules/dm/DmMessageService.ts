import { prisma } from '../../db/PrismaClientSingleton.js';
import {
  DmMessageDto,
  DmReactionSummaryDto,
  DmMessageListResponse,
  DmReadReceiptDto,
  SendDmMessageInput,
} from '../../contracts/ApiContracts.js';
import {
  DmValidationError,
  DmForbiddenError,
  DmNotFoundError,
} from './DmErrors.js';
import { realtimeStreamController } from '../notifications/RealtimeEventStreamController.js';

export class DmMessageService {
  // PKG-05: throttle typing — mỗi user mỗi conversation tối đa 1 heartbeat / 2s
  private lastTypingAt: Map<string, number> = new Map();

  /**
   * PKG-05: heartbeat "đang soạn tin" — broadcast SSE dm.typing cho đối phương.
   * Throttle in-memory 2s/user/conversation để tránh flood SSE.
   */
  public async sendTyping(userId: string, conversationId: string): Promise<{ sent: boolean }> {
    const conv = await prisma.dmConversation.findUnique({
      where: { id: conversationId },
      select: { participant1Id: true, participant2Id: true },
    });
    if (!conv) {
      throw new DmNotFoundError('Không tìm thấy hội thoại');
    }
    if (conv.participant1Id !== userId && conv.participant2Id !== userId) {
      throw new DmForbiddenError('Bạn không phải thành viên của hội thoại này');
    }

    const key = `${userId}:${conversationId}`;
    const now = Date.now();
    const last = this.lastTypingAt.get(key) || 0;
    if (now - last < 2000) {
      return { sent: false };
    }
    this.lastTypingAt.set(key, now);
    if (this.lastTypingAt.size > 10000) {
      this.lastTypingAt.clear();
    }

    const sender =
      userId === conv.participant1Id ? conv.participant2Id : conv.participant1Id;
    const username = (await prisma.user.findUnique({ where: { id: userId }, select: { username: true } }))?.username || '';
    realtimeStreamController.sendToUser(sender, 'dm.typing', {
      conversationId,
      userId,
      username,
    });
    return { sent: true };
  }

  /**
   * Send a direct message into an existing conversation.
   * Enforces:
   * 1. Content validation (non-empty string, <= 5000 chars)
   * 2. Conversation existence (404)
   * 3. IDOR participant check (403)
   * 4. Two-way block prevention (403)
   * 5. Atomic persistence, conversation updatedAt touch, sender read receipt update
   * 6. Realtime SSE push to recipient and sender multi-client sessions
   */
  public async sendMessage(
    currentUserId: string,
    conversationId: string,
    input: SendDmMessageInput
  ): Promise<DmMessageDto> {
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

    const conv = await prisma.dmConversation.findUnique({
      where: { id: conversationId },
    });

    if (!conv) {
      throw new DmNotFoundError('Conversation not found');
    }

    // IDOR participant check
    if (
      conv.participant1Id !== currentUserId &&
      conv.participant2Id !== currentUserId
    ) {
      throw new DmForbiddenError('You are not a participant of this conversation');
    }

    // Identify recipient
    const recipientId =
      conv.participant1Id === currentUserId
        ? conv.participant2Id
        : conv.participant1Id;

    // Check two-way block
    const block = await prisma.block.findFirst({
      where: {
        OR: [
          { blockerId: currentUserId, blockedId: recipientId },
          { blockerId: recipientId, blockedId: currentUserId },
        ],
      },
    });

    if (block) {
      throw new DmForbiddenError('Cannot send message: User is blocked');
    }

    // Persist message, update conversation timestamp, and update sender's read receipt
    const createdMsg = await prisma.$transaction(async (tx) => {
      const msg = await tx.dmMessage.create({
        data: {
          conversationId,
          senderId: currentUserId,
          content: input.content.trim(),
          messageType: input.messageType || 'TEXT',
          mediaUrls: input.mediaUrls || [],
        },
        include: {
          sender: {
            select: { id: true, username: true, displayName: true, avatarUrl: true },
          },
        },
      });

      await tx.dmConversation.update({
        where: { id: conversationId },
        data: { updatedAt: new Date() },
      });

      await tx.dmReadReceipt.upsert({
        where: {
          unique_conversation_user_receipt: {
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

    const messageDto: DmMessageDto = {
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

    // Emit realtime event dm.message.new via SSE
    realtimeStreamController.sendToUser(recipientId, 'dm.message.new', {
      conversationId,
      message: messageDto,
    });
    realtimeStreamController.sendToUser(currentUserId, 'dm.message.new', {
      conversationId,
      message: messageDto,
    });

    return messageDto;
  }

  /**
   * Get cursor-paginated messages for a conversation.
   * Enforces:
   * 1. Conversation existence (404)
   * 2. IDOR participant check (403)
   * 3. Soft-deleted content masking ("This message was deleted")
   * 4. Cursor-based pagination (before / after)
   */
  /**
   * PKG-05: aggregate reactions cho một list messageIds.
   */
  private async aggregateDmReactions(messageIds: string[]): Promise<Map<string, DmReactionSummaryDto[]>> {
    const map = new Map<string, DmReactionSummaryDto[]>();
    if (messageIds.length === 0) return map;
    const rows = await prisma.dmReaction.findMany({
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
   * PKG-05: toggle reaction (thêm nếu chưa có, bỏ nếu đã có).
   * Broadcast SSE dm.reaction.updated cho CẢ HAI participants.
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

    const msg = await prisma.dmMessage.findUnique({
      where: { id: messageId },
      select: { id: true, conversationId: true, deletedAt: true },
    });
    if (!msg || msg.deletedAt) {
      throw new DmNotFoundError('Message not found');
    }
    const conv = await prisma.dmConversation.findUnique({
      where: { id: msg.conversationId },
      select: { participant1Id: true, participant2Id: true },
    });
    if (!conv || (conv.participant1Id !== userId && conv.participant2Id !== userId)) {
      throw new DmForbiddenError('You are not a participant of this conversation');
    }

    const existing = await prisma.dmReaction.findUnique({
      where: { unique_dm_reaction: { messageId, userId, emoji } },
    });
    let toggledOn: boolean;
    if (existing) {
      await prisma.dmReaction.delete({ where: { id: existing.id } });
      toggledOn = false;
    } else {
      await prisma.dmReaction.create({ data: { messageId, userId, emoji } });
      toggledOn = true;
    }

    const reactionMap = await this.aggregateDmReactions([messageId]);
    const reactions = reactionMap.get(messageId) || [];

    const event = { conversationId: msg.conversationId, messageId, reactions };
    realtimeStreamController.sendToUser(conv.participant1Id, 'dm.reaction.updated', event);
    realtimeStreamController.sendToUser(conv.participant2Id, 'dm.reaction.updated', event);

    return { messageId, toggledOn, reactions };
  }

  public async getMessages(
    currentUserId: string,
    conversationId: string,
    options?: { limit?: number; cursor?: string; direction?: 'before' | 'after' }
  ): Promise<DmMessageListResponse> {
    const conv = await prisma.dmConversation.findUnique({
      where: { id: conversationId },
    });

    if (!conv) {
      throw new DmNotFoundError('Conversation not found');
    }

    // IDOR participant check
    if (
      conv.participant1Id !== currentUserId &&
      conv.participant2Id !== currentUserId
    ) {
      throw new DmForbiddenError('You are not a participant of this conversation');
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
      const cursorMsg = await prisma.dmMessage.findUnique({
        where: { id: options.cursor },
        select: { createdAt: true },
      });
      if (cursorMsg) {
        if (direction === 'before') {
          whereClause.createdAt = { lt: cursorMsg.createdAt };
        } else {
          whereClause.createdAt = { gt: cursorMsg.createdAt };
        }
      }
    }

    const rawMessages = await prisma.dmMessage.findMany({
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

    const reactionMap = await this.aggregateDmReactions(sorted.map((m) => m.id));

    const messages: DmMessageDto[] = sorted.map((msg) => {
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
   * Mark a conversation as read up to a specific message or the latest message.
   * Emits dm.read_receipt.updated to the other participant.
   */
  public async markAsRead(
    currentUserId: string,
    conversationId: string,
    messageId?: string
  ): Promise<DmReadReceiptDto> {
    const conv = await prisma.dmConversation.findUnique({
      where: { id: conversationId },
    });

    if (!conv) {
      throw new DmNotFoundError('Conversation not found');
    }

    // IDOR participant check
    if (
      conv.participant1Id !== currentUserId &&
      conv.participant2Id !== currentUserId
    ) {
      throw new DmForbiddenError('You are not a participant of this conversation');
    }

    let targetMessageId: string | null = null;
    if (messageId) {
      const msg = await prisma.dmMessage.findFirst({
        where: { id: messageId, conversationId },
        select: { id: true },
      });
      if (msg) {
        targetMessageId = msg.id;
      }
    }

    if (!targetMessageId) {
      const latestMsg = await prisma.dmMessage.findFirst({
        where: { conversationId },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
      if (latestMsg) {
        targetMessageId = latestMsg.id;
      }
    }

    const readAt = new Date();
    const receipt = await prisma.dmReadReceipt.upsert({
      where: {
        unique_conversation_user_receipt: {
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

    // Notify other participant via SSE
    const otherUserId =
      conv.participant1Id === currentUserId
        ? conv.participant2Id
        : conv.participant1Id;

    realtimeStreamController.sendToUser(otherUserId, 'dm.read_receipt.updated', {
      conversationId,
      userId: currentUserId,
      lastReadMessageId: receipt.lastReadMessageId,
      readAt: receipt.readAt.toISOString(),
    });

    return {
      conversationId,
      userId: currentUserId,
      lastReadMessageId: receipt.lastReadMessageId,
      readAt: receipt.readAt.toISOString(),
    };
  }

  /**
   * Soft-delete a message.
   * Only the message author can delete it.
   * Emits dm.message.deleted to both participants.
   */
  public async softDeleteMessage(
    currentUserId: string,
    messageId: string
  ): Promise<{
    messageId: string;
    conversationId: string;
    deleted: boolean;
    deletedAt: string;
  }> {
    const message = await prisma.dmMessage.findUnique({
      where: { id: messageId },
      include: { conversation: true },
    });

    if (!message) {
      throw new DmNotFoundError('Message not found');
    }

    if (message.senderId !== currentUserId) {
      throw new DmForbiddenError('You can only delete your own messages');
    }

    const deletedAt = new Date();
    await prisma.dmMessage.update({
      where: { id: messageId },
      data: { deletedAt },
    });

    const conv = message.conversation;
    const eventPayload = {
      conversationId: conv.id,
      messageId: message.id,
      deletedAt: deletedAt.toISOString(),
    };

    realtimeStreamController.sendToUser(conv.participant1Id, 'dm.message.deleted', eventPayload);
    realtimeStreamController.sendToUser(conv.participant2Id, 'dm.message.deleted', eventPayload);

    return {
      messageId: message.id,
      conversationId: conv.id,
      deleted: true,
      deletedAt: deletedAt.toISOString(),
    };
  }
}

export const dmMessageService = new DmMessageService();

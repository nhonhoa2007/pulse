import { prisma } from '../../db/PrismaClientSingleton.js';
import {
  DmConversationDto,
  DmConversationListResponse,
  DmMessageDto,
  DmUserSummaryDto,
} from '../../contracts/ApiContracts.js';
import {
  DmValidationError,
  DmForbiddenError,
  DmNotFoundError,
} from './DmErrors.js';

export class DmConversationService {
  /**
   * Find or create a 1-1 DM conversation between current user and target recipient.
   * Enforces:
   * 1. Self-DM rejection (400)
   * 2. Recipient existence (404)
   * 3. Two-way block prevention (403)
   * 4. Canonical participant ID ordering (participant1Id < participant2Id)
   * 5. Idempotent find-or-create with race-condition safety
   */
  public async getOrCreateConversation(
    currentUserId: string,
    recipientId: string
  ): Promise<{ conversation: DmConversationDto; isCreated: boolean }> {
    if (!recipientId || typeof recipientId !== 'string' || recipientId.trim() === '') {
      throw new DmValidationError('Missing or invalid recipientId');
    }

    const trimmedRecipientId = recipientId.trim();

    if (currentUserId === trimmedRecipientId) {
      throw new DmValidationError('Self-DM is not allowed');
    }

    // Check recipient exists
    const recipient = await prisma.user.findUnique({
      where: { id: trimmedRecipientId },
      select: {
        id: true,
        username: true,
        displayName: true,
        avatarUrl: true,
      },
    });

    if (!recipient) {
      throw new DmNotFoundError('Recipient user not found');
    }

    // Check two-way block
    const block = await prisma.block.findFirst({
      where: {
        OR: [
          { blockerId: currentUserId, blockedId: trimmedRecipientId },
          { blockerId: trimmedRecipientId, blockedId: currentUserId },
        ],
      },
    });

    if (block) {
      throw new DmForbiddenError('Cannot start conversation with this user due to block settings');
    }

    // Canonical ordering: participant1Id < participant2Id
    const [participant1Id, participant2Id] =
      currentUserId < trimmedRecipientId
        ? [currentUserId, trimmedRecipientId]
        : [trimmedRecipientId, currentUserId];

    let isCreated = false;
    let conv = await prisma.dmConversation.findUnique({
      where: {
        unique_dm_participants: { participant1Id, participant2Id },
      },
      include: {
        participant1: {
          select: { id: true, username: true, displayName: true, avatarUrl: true },
        },
        participant2: {
          select: { id: true, username: true, displayName: true, avatarUrl: true },
        },
      },
    });

    if (!conv) {
      try {
        conv = await prisma.dmConversation.create({
          data: {
            participant1Id,
            participant2Id,
          },
          include: {
            participant1: {
              select: { id: true, username: true, displayName: true, avatarUrl: true },
            },
            participant2: {
              select: { id: true, username: true, displayName: true, avatarUrl: true },
            },
          },
        });
        isCreated = true;
      } catch (err: unknown) {
        // Handle race condition where another request created the conversation concurrently
        if (typeof err === 'object' && err !== null && 'code' in err && (err as { code: string }).code === 'P2002') {
          conv = await prisma.dmConversation.findUnique({
            where: {
              unique_dm_participants: { participant1Id, participant2Id },
            },
            include: {
              participant1: {
                select: { id: true, username: true, displayName: true, avatarUrl: true },
              },
              participant2: {
                select: { id: true, username: true, displayName: true, avatarUrl: true },
              },
            },
          });
          if (!conv) throw err;
        } else {
          throw err;
        }
      }
    }

    const dto = await this.enrichConversation(conv, currentUserId);
    return { conversation: dto, isCreated };
  }

  /**
   * List all conversations for the authenticated user, ordered by updatedAt DESC.
   * Includes last message preview, unread count, and other user summary.
   */
  public async listUserConversations(
    currentUserId: string,
    options?: { limit?: number; cursor?: string }
  ): Promise<DmConversationListResponse> {
    const limit = Math.min(Math.max(Number(options?.limit) || 20, 1), 50);

    const whereClause: {
      OR: Array<{ participant1Id: string } | { participant2Id: string }>;
      updatedAt?: { lt: Date };
    } = {
      OR: [
        { participant1Id: currentUserId },
        { participant2Id: currentUserId },
      ],
    };

    if (options?.cursor) {
      const cursorConv = await prisma.dmConversation.findUnique({
        where: { id: options.cursor },
        select: { updatedAt: true },
      });
      if (cursorConv) {
        whereClause.updatedAt = { lt: cursorConv.updatedAt };
      }
    }

    const conversations = await prisma.dmConversation.findMany({
      where: whereClause,
      orderBy: { updatedAt: 'desc' },
      take: limit + 1,
      include: {
        participant1: {
          select: { id: true, username: true, displayName: true, avatarUrl: true },
        },
        participant2: {
          select: { id: true, username: true, displayName: true, avatarUrl: true },
        },
      },
    });

    const hasMore = conversations.length > limit;
    const items = hasMore ? conversations.slice(0, limit) : conversations;
    const nextCursor = hasMore && items.length > 0 ? items[items.length - 1].id : null;

    const enrichedList: DmConversationDto[] = await Promise.all(
      items.map((c) => this.enrichConversation(c, currentUserId))
    );

    return {
      conversations: enrichedList,
      nextCursor,
    };
  }

  /**
   * Enriches a conversation record with otherUser details, lastMessage preview,
   * unreadCount, and block status.
   */
  private async enrichConversation(
    conv: {
      id: string;
      participant1Id: string;
      participant2Id: string;
      createdAt: Date;
      updatedAt: Date;
      participant1: DmUserSummaryDto;
      participant2: DmUserSummaryDto;
    },
    currentUserId: string
  ): Promise<DmConversationDto> {
    const otherUser =
      conv.participant1Id === currentUserId ? conv.participant2 : conv.participant1;

    // Check block status between current user and other user
    const block = await prisma.block.findFirst({
      where: {
        OR: [
          { blockerId: currentUserId, blockedId: otherUser.id },
          { blockerId: otherUser.id, blockedId: currentUserId },
        ],
      },
    });

    // Fetch latest message
    const lastMsg = await prisma.dmMessage.findFirst({
      where: { conversationId: conv.id },
      orderBy: { createdAt: 'desc' },
      include: {
        sender: {
          select: { id: true, username: true, displayName: true, avatarUrl: true },
        },
      },
    });

    let lastMessageDto: DmMessageDto | null = null;
    if (lastMsg) {
      const isDeleted = lastMsg.deletedAt !== null;
      lastMessageDto = {
        id: lastMsg.id,
        conversationId: conv.id,
        senderId: lastMsg.senderId,
        content: isDeleted ? 'This message was deleted' : lastMsg.content,
        messageType: (lastMsg.messageType || 'TEXT') as 'TEXT' | 'IMAGE' | 'SYSTEM',
        mediaUrls: isDeleted ? [] : lastMsg.mediaUrls,
        isDeleted,
        createdAt: lastMsg.createdAt.toISOString(),
        updatedAt: lastMsg.updatedAt.toISOString(),
        sender: lastMsg.sender,
      };
    }

    // Fetch read receipt to compute unread count
    const receipt = await prisma.dmReadReceipt.findUnique({
      where: {
        unique_conversation_user_receipt: {
          conversationId: conv.id,
          userId: currentUserId,
        },
      },
    });

    const unreadCount = await prisma.dmMessage.count({
      where: {
        conversationId: conv.id,
        senderId: { not: currentUserId },
        deletedAt: null,
        ...(receipt ? { createdAt: { gt: receipt.readAt } } : {}),
      },
    });

    return {
      id: conv.id,
      participant1Id: conv.participant1Id,
      participant2Id: conv.participant2Id,
      createdAt: conv.createdAt.toISOString(),
      updatedAt: conv.updatedAt.toISOString(),
      otherUser,
      lastMessage: lastMessageDto,
      unreadCount,
      isBlocked: Boolean(block),
    };
  }
}

export const dmConversationService = new DmConversationService();

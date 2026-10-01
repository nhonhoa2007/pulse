import { prisma } from '../../db/PrismaClientSingleton.js';
import {
  GroupConversationDto,
  GroupConversationListResponse,
  GroupMemberDto,
  GroupMemberRole,
  CreateGroupConversationInput,
  UpdateGroupConversationInput,
  AddGroupMemberInput,
  GroupMessageDto,
} from '../../contracts/ApiContracts.js';
import {
  DmValidationError,
  DmForbiddenError,
  DmNotFoundError,
} from './DmErrors.js';
import { realtimeStreamController } from '../notifications/RealtimeEventStreamController.js';

export class GroupDmConversationService {
  private validateAvatarUrl(url?: string | null): string | null {
    if (!url) return null;
    const trimmed = url.trim();
    if (!trimmed) return null;
    const lower = trimmed.toLowerCase();
    if (lower.startsWith('javascript:') || lower.startsWith('data:') || lower.startsWith('vbscript:')) {
      throw new DmValidationError('Invalid avatarUrl: Dangerous URI protocol rejected');
    }
    return trimmed;
  }

  private sanitizeTitle(rawTitle: string): string {
    return rawTitle
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
      .replace(/<[^>]*>/g, '')
      .trim();
  }

  /**
   * Create a new Group DM conversation.
   * Enforces:
   * 1. Valid title (1-100 chars)
   * 2. Total members >= 2 (creator + at least 1 other participant)
   * 3. Two-way block invariant between creator and participants
   * 4. Creator assigned ADMIN role, participants assigned MEMBER role
   */
  public async createConversation(
    currentUserId: string,
    input: CreateGroupConversationInput
  ): Promise<GroupConversationDto> {
    if (!input || typeof input.title !== 'string') {
      throw new DmValidationError('Group title must be between 1 and 100 characters');
    }

    const cleanTitle = this.sanitizeTitle(input.title);
    if (cleanTitle === '' || cleanTitle.length > 100) {
      throw new DmValidationError('Group title must be between 1 and 100 characters');
    }

    const safeAvatar = this.validateAvatarUrl(input.avatarUrl);

    if (!Array.isArray(input.memberIds)) {
      throw new DmValidationError('memberIds must be an array of user IDs');
    }

    // Deduplicate and filter out creator
    const targetMemberIds = Array.from(
      new Set(input.memberIds.filter((id) => id && id !== currentUserId))
    );

    if (targetMemberIds.length < 1) {
      throw new DmValidationError('Group conversation must have at least 2 members');
    }

    // Verify all target users exist
    const existingUsers = await prisma.user.findMany({
      where: { id: { in: targetMemberIds } },
      select: { id: true },
    });

    if (existingUsers.length !== targetMemberIds.length) {
      throw new DmNotFoundError('One or more invited users do not exist');
    }

    // Check two-way block invariant between creator and participants
    const blocks = await prisma.block.findMany({
      where: {
        OR: [
          { blockerId: currentUserId, blockedId: { in: targetMemberIds } },
          { blockerId: { in: targetMemberIds }, blockedId: currentUserId },
        ],
      },
    });

    if (blocks.length > 0) {
      throw new DmForbiddenError('Cannot create group conversation: Blocked relationship with participant');
    }

    // Persist Group Conversation and Members in transaction
    const conversation = await prisma.$transaction(async (tx) => {
      const conv = await tx.groupConversation.create({
        data: {
          title: cleanTitle,
          avatarUrl: safeAvatar,
          creatorId: currentUserId,
        },
      });

      // Add creator as ADMIN
      await tx.groupMember.create({
        data: {
          conversationId: conv.id,
          userId: currentUserId,
          role: 'ADMIN',
        },
      });

      // Add other participants as MEMBER
      for (const memberId of targetMemberIds) {
        await tx.groupMember.create({
          data: {
            conversationId: conv.id,
            userId: memberId,
            role: 'MEMBER',
          },
        });
      }

      // Initialize read receipt for creator
      await tx.groupReadReceipt.create({
        data: {
          conversationId: conv.id,
          userId: currentUserId,
          readAt: conv.createdAt,
        },
      });

      return conv;
    });

    return this.getConversation(currentUserId, conversation.id);
  }

  /**
   * List group conversations the user belongs to with preview and unread counts.
   */
  public async listConversations(
    currentUserId: string,
    cursor?: string,
    limit: number = 20
  ): Promise<GroupConversationListResponse> {
    const parsedLimit = Math.min(Math.max(limit || 20, 1), 50);

    // Get group conversation IDs for current user
    const memberships = await prisma.groupMember.findMany({
      where: { userId: currentUserId },
      select: { conversationId: true, role: true },
    });

    if (memberships.length === 0) {
      return { groups: [], nextCursor: null };
    }

    const conversationIds = memberships.map((m) => m.conversationId);
    const cursorDate = cursor ? new Date(cursor) : undefined;

    const conversations = await prisma.groupConversation.findMany({
      where: {
        id: { in: conversationIds },
        ...(cursorDate ? { updatedAt: { lt: cursorDate } } : {}),
      },
      orderBy: { updatedAt: 'desc' },
      take: parsedLimit + 1,
      include: {
        members: {
          include: {
            user: {
              select: { id: true, username: true, displayName: true, avatarUrl: true, isCelebrity: true },
            },
          },
        },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: {
            sender: {
              select: { id: true, username: true, displayName: true, avatarUrl: true },
            },
          },
        },
        readReceipts: {
          where: { userId: currentUserId },
        },
      },
    });

    const hasMore = conversations.length > parsedLimit;
    const items = hasMore ? conversations.slice(0, parsedLimit) : conversations;

    const groups: GroupConversationDto[] = await Promise.all(
      items.map(async (c) => {
        const myMember = c.members.find((m) => m.userId === currentUserId);
        const myReceipt = c.readReceipts[0];
        const lastReadAt = myReceipt?.readAt || new Date(0);

        // Count unread messages created after user's last read timestamp
        const unreadCount = await prisma.groupMessage.count({
          where: {
            conversationId: c.id,
            createdAt: { gt: lastReadAt },
            senderId: { not: currentUserId },
            deletedAt: null,
          },
        });

        const lastMsg = c.messages[0];
        let lastMessageDto: GroupMessageDto | null = null;
        if (lastMsg) {
          const isDeleted = !!lastMsg.deletedAt;
          lastMessageDto = {
            id: lastMsg.id,
            conversationId: lastMsg.conversationId,
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

        const memberDtos: GroupMemberDto[] = c.members.map((m) => ({
          id: m.id,
          conversationId: m.conversationId,
          userId: m.userId,
          role: m.role as GroupMemberRole,
          joinedAt: m.joinedAt.toISOString(),
          user: m.user,
        }));

        return {
          id: c.id,
          title: c.title,
          avatarUrl: c.avatarUrl,
          creatorId: c.creatorId,
          createdAt: c.createdAt.toISOString(),
          updatedAt: c.updatedAt.toISOString(),
          members: memberDtos,
          lastMessage: lastMessageDto,
          unreadCount,
          myRole: (myMember?.role as GroupMemberRole) || 'MEMBER',
        };
      })
    );

    const nextCursor =
      hasMore && items.length > 0 ? items[items.length - 1].updatedAt.toISOString() : null;

    return {
      groups,
      nextCursor,
    };
  }

  /**
   * Get single group conversation details and members. Enforces IDOR member check.
   */
  public async getConversation(
    currentUserId: string,
    conversationId: string
  ): Promise<GroupConversationDto> {
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

    const conversation = await prisma.groupConversation.findUnique({
      where: { id: conversationId },
      include: {
        members: {
          include: {
            user: {
              select: { id: true, username: true, displayName: true, avatarUrl: true, isCelebrity: true },
            },
          },
        },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: {
            sender: {
              select: { id: true, username: true, displayName: true, avatarUrl: true },
            },
          },
        },
        readReceipts: {
          where: { userId: currentUserId },
        },
      },
    });

    if (!conversation) {
      throw new DmNotFoundError('Group conversation not found');
    }

    const myReceipt = conversation.readReceipts[0];
    const lastReadAt = myReceipt?.readAt || new Date(0);

    const unreadCount = await prisma.groupMessage.count({
      where: {
        conversationId,
        createdAt: { gt: lastReadAt },
        senderId: { not: currentUserId },
        deletedAt: null,
      },
    });

    const lastMsg = conversation.messages[0];
    let lastMessageDto: GroupMessageDto | null = null;
    if (lastMsg) {
      const isDeleted = !!lastMsg.deletedAt;
      lastMessageDto = {
        id: lastMsg.id,
        conversationId: lastMsg.conversationId,
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

    const memberDtos: GroupMemberDto[] = conversation.members.map((m) => ({
      id: m.id,
      conversationId: m.conversationId,
      userId: m.userId,
      role: m.role as GroupMemberRole,
      joinedAt: m.joinedAt.toISOString(),
      user: m.user,
    }));

    return {
      id: conversation.id,
      title: conversation.title,
      avatarUrl: conversation.avatarUrl,
      creatorId: conversation.creatorId,
      createdAt: conversation.createdAt.toISOString(),
      updatedAt: conversation.updatedAt.toISOString(),
      members: memberDtos,
      lastMessage: lastMessageDto,
      unreadCount,
      myRole: membership.role as GroupMemberRole,
    };
  }

  /**
   * Update group title or avatar. Enforces ADMIN role.
   */
  public async updateConversation(
    currentUserId: string,
    conversationId: string,
    input: UpdateGroupConversationInput
  ): Promise<GroupConversationDto> {
    const membership = await prisma.groupMember.findUnique({
      where: {
        unique_group_conversation_user: {
          conversationId,
          userId: currentUserId,
        },
      },
    });

    if (!membership) {
      throw new DmForbiddenError('Access denied: You are not a member of this group');
    }

    if (membership.role !== 'ADMIN') {
      throw new DmForbiddenError('Only group admins can update group settings');
    }

    const dataToUpdate: { title?: string; avatarUrl?: string | null } = {};

    if (input.title !== undefined) {
      if (typeof input.title !== 'string') {
        throw new DmValidationError('Group title must be between 1 and 100 characters');
      }
      const cleanTitle = this.sanitizeTitle(input.title);
      if (cleanTitle === '' || cleanTitle.length > 100) {
        throw new DmValidationError('Group title must be between 1 and 100 characters');
      }
      dataToUpdate.title = cleanTitle;
    }

    if (input.avatarUrl !== undefined) {
      dataToUpdate.avatarUrl = this.validateAvatarUrl(input.avatarUrl);
    }

    await prisma.groupConversation.update({
      where: { id: conversationId },
      data: {
        ...dataToUpdate,
        updatedAt: new Date(),
      },
    });

    const updated = await this.getConversation(currentUserId, conversationId);

    // Broadcast dm.group.updated event to all members
    for (const m of updated.members) {
      realtimeStreamController.sendToUser(m.userId, 'dm.group.updated', updated);
    }

    return updated;
  }

  /**
   * Add a new member to group. Enforces ADMIN role and checks blocks.
   */
  public async addMember(
    currentUserId: string,
    conversationId: string,
    input: AddGroupMemberInput
  ): Promise<GroupMemberDto> {
    const membership = await prisma.groupMember.findUnique({
      where: {
        unique_group_conversation_user: {
          conversationId,
          userId: currentUserId,
        },
      },
    });

    if (!membership) {
      throw new DmForbiddenError('Access denied: You are not a member of this group');
    }

    if (membership.role !== 'ADMIN') {
      throw new DmForbiddenError('Only group admins can add new members');
    }

    if (!input.userId) {
      throw new DmValidationError('userId is required');
    }

    const targetUser = await prisma.user.findUnique({
      where: { id: input.userId },
      select: { id: true, username: true, displayName: true, avatarUrl: true, isCelebrity: true },
    });

    if (!targetUser) {
      throw new DmNotFoundError('User to add not found');
    }

    const existingMember = await prisma.groupMember.findUnique({
      where: {
        unique_group_conversation_user: {
          conversationId,
          userId: input.userId,
        },
      },
    });

    if (existingMember) {
      throw new DmValidationError('User is already a member of this group');
    }

    // Check two-way block between target user and all existing members of the group
    const currentMemberRecords = await prisma.groupMember.findMany({
      where: { conversationId },
      select: { userId: true },
    });
    const currentMemberIds = currentMemberRecords.map((m) => m.userId);

    const block = await prisma.block.findFirst({
      where: {
        OR: [
          { blockerId: input.userId, blockedId: { in: currentMemberIds } },
          { blockerId: { in: currentMemberIds }, blockedId: input.userId },
        ],
      },
    });

    if (block) {
      throw new DmForbiddenError('Cannot add member: Blocked relationship exists with group participant');
    }

    const createdMember = await prisma.$transaction(async (tx) => {
      const member = await tx.groupMember.create({
        data: {
          conversationId,
          userId: input.userId,
          role: input.role || 'MEMBER',
        },
      });

      await tx.groupConversation.update({
        where: { id: conversationId },
        data: { updatedAt: new Date() },
      });

      return member;
    });

    const memberDto: GroupMemberDto = {
      id: createdMember.id,
      conversationId,
      userId: targetUser.id,
      role: createdMember.role as GroupMemberRole,
      joinedAt: createdMember.joinedAt.toISOString(),
      user: targetUser,
    };

    // Broadcast dm.group.member.joined to existing and new members
    const allMembers = await prisma.groupMember.findMany({
      where: { conversationId },
      select: { userId: true },
    });

    for (const m of allMembers) {
      realtimeStreamController.sendToUser(m.userId, 'dm.group.member.joined', {
        conversationId,
        member: memberDto,
      });
    }

    return memberDto;
  }

  /**
   * Remove member or voluntary leave group.
   * If targetUserId === currentUserId: voluntary leave.
   * If targetUserId !== currentUserId: kick (ADMIN only).
   */
  public async removeMember(
    currentUserId: string,
    conversationId: string,
    targetUserId: string
  ): Promise<{ success: true }> {
    const requesterMember = await prisma.groupMember.findUnique({
      where: {
        unique_group_conversation_user: {
          conversationId,
          userId: currentUserId,
        },
      },
    });

    if (!requesterMember) {
      throw new DmForbiddenError('Access denied: You are not a member of this group');
    }

    const targetMember = await prisma.groupMember.findUnique({
      where: {
        unique_group_conversation_user: {
          conversationId,
          userId: targetUserId,
        },
      },
    });

    if (!targetMember) {
      throw new DmNotFoundError('User is not a member of this group');
    }

    const isSelfLeave = targetUserId === currentUserId;

    if (!isSelfLeave && requesterMember.role !== 'ADMIN') {
      throw new DmForbiddenError('Only group admins can remove other members');
    }

    // Capture all member IDs before deletion to broadcast event
    const remainingMembers = await prisma.groupMember.findMany({
      where: { conversationId },
      select: { userId: true },
    });

    await prisma.$transaction(async (tx) => {
      await tx.groupMember.delete({
        where: {
          unique_group_conversation_user: {
            conversationId,
            userId: targetUserId,
          },
        },
      });

      await tx.groupConversation.update({
        where: { id: conversationId },
        data: { updatedAt: new Date() },
      });
    });

    // Broadcast dm.group.member.left to remaining members and removed user
    for (const m of remainingMembers) {
      realtimeStreamController.sendToUser(m.userId, 'dm.group.member.left', {
        conversationId,
        userId: targetUserId,
      });
    }

    return { success: true };
  }
}

export const groupDmConversationService = new GroupDmConversationService();

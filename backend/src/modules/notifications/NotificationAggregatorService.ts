import { prisma } from '../../db/PrismaClientSingleton.js';
import { realtimeStreamController } from './RealtimeEventStreamController.js';
import { NotificationDto } from '../../contracts/ApiContracts.js';
import { postMatchesKeywords } from '../mutes/KeywordFilterUtil.js';

export interface CreateNotificationParams {
  recipientId: string;
  actorId: string;
  verb: 'LIKE' | 'REPLY' | 'REPOST' | 'QUOTE' | 'MENTION' | 'FOLLOW' | 'FOLLOW_REQUEST' | 'FOLLOW_ACCEPT';
  targetType: 'POST' | 'USER';
  targetId: string;
}

export class NotificationAggregatorService {
  /**
   * Aggregates notification within 24-hour sliding window.
   * If an unread notification matching (recipientId, targetId, verb) exists within 24h,
   * it increments aggregatedCount and updates actorSummary.
   * Otherwise, creates a new Notification record.
   */
  public async recordNotification(params: CreateNotificationParams): Promise<NotificationDto | null> {
    const { recipientId, actorId, verb, targetType, targetId } = params;

    // Do not notify self-interactions
    if (recipientId === actorId) {
      return null;
    }

    // Stealth Mute Filter 1: Check if recipient has muted this actor
    const userMute = await prisma.userMute.findUnique({
      where: {
        unique_muter_muted: {
          muterId: recipientId,
          mutedId: actorId,
        },
      },
    });
    if (userMute) {
      return null;
    }

    // Stealth Mute Filter 2: Check if target post matches recipient's keyword mutes
    if (targetType === 'POST') {
      const targetPost = await prisma.post.findUnique({
        where: { id: targetId },
        select: { content: true, hashtags: true },
      });
      if (targetPost) {
        const now = new Date();
        const keywordMutes = await prisma.keywordMute.findMany({
          where: {
            userId: recipientId,
            muteContext: { in: ['ALL', 'NOTIFICATIONS'] },
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          },
        });
        if (postMatchesKeywords(targetPost, keywordMutes as any, 'NOTIFICATIONS')) {
          return null;
        }
      }
    }

    const actor = await prisma.user.findUnique({
      where: { id: actorId },
      select: { id: true, username: true, displayName: true, avatarUrl: true },
    });

    if (!actor) {
      return null;
    }

    const windowStart = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // Find existing unread notification within 24h window
    const existing = await prisma.notification.findFirst({
      where: {
        recipientId,
        targetId,
        verb,
        isRead: false,
        createdAt: { gte: windowStart },
      },
      include: {
        actor: {
          select: { id: true, username: true, displayName: true, avatarUrl: true },
        },
      },
    });

    let notificationRecord;

    if (existing) {
      const isSameActor = existing.actorId === actorId;
      const newCount = isSameActor ? existing.aggregatedCount : existing.aggregatedCount + 1;
      const previousActorName = existing.actor.displayName;
      const newActorName = actor.displayName;

      const actorSummary = this.formatActorSummary(newActorName, previousActorName, newCount);

      notificationRecord = await prisma.notification.update({
        where: { id: existing.id },
        data: {
          actorId,
          aggregatedCount: newCount,
          actorSummary,
          updatedAt: new Date(),
        },
        include: {
          actor: {
            select: { username: true, displayName: true, avatarUrl: true },
          },
        },
      });
    } else {
      notificationRecord = await prisma.notification.create({
        data: {
          recipientId,
          actorId,
          verb,
          targetType,
          targetId,
          aggregatedCount: 1,
          actorSummary: actor.displayName,
          isRead: false,
        },
        include: {
          actor: {
            select: { username: true, displayName: true, avatarUrl: true },
          },
        },
      });
    }

    const dto: NotificationDto = {
      id: notificationRecord.id,
      recipientId: notificationRecord.recipientId,
      actorId: notificationRecord.actorId,
      verb: notificationRecord.verb as NotificationDto['verb'],
      targetType: notificationRecord.targetType as NotificationDto['targetType'],
      targetId: notificationRecord.targetId,
      aggregatedCount: notificationRecord.aggregatedCount,
      actorSummary: notificationRecord.actorSummary,
      isRead: notificationRecord.isRead,
      createdAt: notificationRecord.createdAt.toISOString(),
      actor: {
        username: notificationRecord.actor.username,
        displayName: notificationRecord.actor.displayName,
        avatarUrl: notificationRecord.actor.avatarUrl,
      },
    };

    // Push real-time SSE event to recipient
    realtimeStreamController.sendToUser(recipientId, 'NEW_NOTIFICATION', dto);

    return dto;
  }

  private formatActorSummary(newActorName: string, previousActorName: string, count: number): string {
    if (count <= 1) {
      return newActorName;
    }
    if (count === 2) {
      if (newActorName === previousActorName) {
        return newActorName;
      }
      return `${newActorName} và ${previousActorName}`;
    }
    const others = count - 2;
    if (others === 1) {
      return `${newActorName}, ${previousActorName} và 1 người khác`;
    }
    return `${newActorName}, ${previousActorName} và ${others} người khác`;
  }
}

export const notificationAggregatorService = new NotificationAggregatorService();

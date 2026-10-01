import { prisma } from '../../db/PrismaClientSingleton.js';
import { fanOutTimelineWorker } from '../feed/FanOutTimelineWorker.js';
import { notificationAggregatorService } from '../notifications/NotificationAggregatorService.js';
import { PostDto, ReplyPrivacy } from '../../contracts/ApiContracts.js';
import { validateReplyPermissionService, ReplyRestrictedError } from './ValidateReplyPermissionService.js';
import { activityDeliveryWorkerService } from '../federation/ActivityDeliveryWorkerService.js';
import { activityPubKeyManagerService } from '../federation/ActivityPubKeyManagerService.js';
import { ActivityPubActivity, ActivityPubNote } from '../../contracts/ActivityPubContracts.js';
import { sanitizeContentWarning } from './UpdatePostService.js';
import { spamDetectionService } from '../moderation/SpamDetectionService.js';

export interface PublishPostInput {
  authorId: string;
  content: string;
  mediaUrls?: string[];
  replyToId?: string;
  quoteOfId?: string;
  reply_privacy?: ReplyPrivacy;
  replyPrivacy?: ReplyPrivacy;
  isSensitive?: boolean;
  contentWarning?: string;
}

export class PublishPostService {
  public async publish(input: PublishPostInput): Promise<PostDto> {
    const { authorId, mediaUrls = [], replyToId, quoteOfId } = input;
    const content = input.content ? input.content.trim() : '';

    if (!content && mediaUrls.length === 0 && !quoteOfId) {
      throw new Error('Post content or media must not be empty');
    }

    const author = await prisma.user.findUnique({
      where: { id: authorId },
    });

    if (!author) {
      throw new Error('Author not found');
    }

    const rawPrivacy = input.reply_privacy || input.replyPrivacy;
    let resolvedPrivacy: ReplyPrivacy = 'EVERYONE';
    if (rawPrivacy !== undefined) {
      const normalized = String(rawPrivacy).toUpperCase() as ReplyPrivacy;
      if (!['EVERYONE', 'FOLLOWING', 'MENTIONED'].includes(normalized)) {
        throw new Error(`Invalid reply_privacy setting: '${rawPrivacy}'. Allowed values: EVERYONE, FOLLOWING, MENTIONED`);
      }
      resolvedPrivacy = normalized;
    }

    // Parse hashtags (#tag) and mentions (@username)
    const hashtags = this.extractHashtags(content);
    const mentions = this.extractMentions(content);

    const sanitizedContentWarning = sanitizeContentWarning(input.contentWarning);

    let rootPostId: string | null = null;
    let parentPostAuthorId: string | null = null;
    let quotedPostAuthorId: string | null = null;

    if (replyToId) {
      // Validate reply permission strictly
      const permission = await validateReplyPermissionService.validate(authorId, replyToId);
      if (!permission.allowed) {
        throw new ReplyRestrictedError(
          permission.message || 'You are not permitted to reply to this post',
          permission.code || 'REPLY_RESTRICTED',
          permission.statusCode || 403
        );
      }

      const parentPost = await prisma.post.findUnique({
        where: { id: replyToId },
        select: { id: true, rootPostId: true, replyToId: true, authorId: true, isDeleted: true },
      });

      if (!parentPost || parentPost.isDeleted) {
        throw new Error('Parent post not found or has been deleted');
      }

      // Root post ID is either the parent's rootPostId or parent's own id if it is root
      let resolvedRootId = parentPost.rootPostId;
      if (!resolvedRootId && parentPost.replyToId) {
        const immediateParent = await prisma.post.findUnique({
          where: { id: parentPost.replyToId },
          select: { id: true, rootPostId: true },
        });
        resolvedRootId = immediateParent?.rootPostId || immediateParent?.id || null;
      }
      rootPostId = resolvedRootId || parentPost.id;
      parentPostAuthorId = parentPost.authorId;
    }

    if (quoteOfId) {
      const quotedPost = await prisma.post.findUnique({
        where: { id: quoteOfId },
        select: {
          id: true,
          authorId: true,
          isDeleted: true,
          author: { select: { isPrivate: true } },
        },
      });

      if (!quotedPost || quotedPost.isDeleted) {
        throw new Error('Quoted post not found or has been deleted');
      }

      // TASK-21 Privacy Invariant: Posts from private accounts cannot be quoted to prevent data exfiltration
      if (quotedPost.author?.isPrivate) {
        throw new ReplyRestrictedError(
          'Cannot quote a post from a private account',
          'FORBIDDEN',
          403
        );
      }

      // Check 2-way block invariant between requester and quoted post author
      const quoteBlock = await prisma.block.findFirst({
        where: {
          OR: [
            { blockerId: authorId, blockedId: quotedPost.authorId },
            { blockerId: quotedPost.authorId, blockedId: authorId },
          ],
        },
      });

      if (quoteBlock) {
        throw new ReplyRestrictedError(
          'You cannot quote this post because of block privacy settings',
          'FORBIDDEN',
          403
        );
      }

      quotedPostAuthorId = quotedPost.authorId;
    }

    // Atomic transaction for post creation and counter updates
    const createdPost = await prisma.$transaction(async (tx) => {
      // Increment repliesCount on parent atomically and verify post is not deleted
      if (replyToId) {
        const updated = await tx.post.updateMany({
          where: { id: replyToId, isDeleted: false },
          data: { repliesCount: { increment: 1 } },
        });
        if (updated.count === 0) {
          throw new ReplyRestrictedError('Parent post not found or has been deleted', 'POST_NOT_FOUND', 404);
        }
      }

      // Increment quotesCount on quoted post atomically and verify post is not deleted
      if (quoteOfId) {
        const updated = await tx.post.updateMany({
          where: { id: quoteOfId, isDeleted: false },
          data: { quotesCount: { increment: 1 } },
        });
        if (updated.count === 0) {
          throw new Error('Quoted post not found or has been deleted');
        }
      }

      const post = await tx.post.create({
        data: {
          authorId,
          content,
          mediaUrls,
          replyToId: replyToId || null,
          rootPostId,
          quoteOfId: quoteOfId || null,
          reply_privacy: resolvedPrivacy,
          isSensitive: Boolean(input.isSensitive),
          contentWarning: sanitizedContentWarning || null,
          hashtags,
          mentions,
        },
        include: {
          author: {
            select: { id: true, username: true, displayName: true, avatarUrl: true, isCelebrity: true },
          },
          replyTo: {
            select: { id: true, author: { select: { username: true, displayName: true } } },
          },
          quoteOf: {
            include: {
              author: {
                select: { id: true, username: true, displayName: true, avatarUrl: true, isCelebrity: true },
              },
            },
          },
        },
      });

      // Increment postsCount on author
      await tx.user.update({
        where: { id: authorId },
        data: { postsCount: { increment: 1 } },
      });

      // Update hashtag registry
      for (const tag of hashtags) {
        await tx.hashtag.upsert({
          where: { tag },
          create: { tag, postsCount: 1 },
          update: { postsCount: { increment: 1 } },
        });
      }

      return post;
    });

    // Send notifications
    if (replyToId && parentPostAuthorId && parentPostAuthorId !== authorId) {
      await notificationAggregatorService.recordNotification({
        recipientId: parentPostAuthorId,
        actorId: authorId,
        verb: 'REPLY',
        targetType: 'POST',
        targetId: createdPost.id,
      });
    }

    if (quoteOfId && quotedPostAuthorId && quotedPostAuthorId !== authorId) {
      await notificationAggregatorService.recordNotification({
        recipientId: quotedPostAuthorId,
        actorId: authorId,
        verb: 'QUOTE',
        targetType: 'POST',
        targetId: quoteOfId,
      });
    }

    // Mention notifications
    for (const mentionUsername of mentions) {
      const mentionedUser = await prisma.user.findUnique({
        where: { username: mentionUsername },
        select: { id: true },
      });
      if (mentionedUser && mentionedUser.id !== authorId) {
        await notificationAggregatorService.recordNotification({
          recipientId: mentionedUser.id,
          actorId: authorId,
          verb: 'MENTION',
          targetType: 'POST',
          targetId: createdPost.id,
        });
      }
    }

    // Fan out to followers' timeline inboxes (if author is regular user)
    await fanOutTimelineWorker.fanOut({
      id: createdPost.id,
      authorId: createdPost.authorId,
      createdAt: createdPost.createdAt,
      content: createdPost.content,
      hashtags: createdPost.hashtags,
    });

    // Enqueue ActivityPub delivery jobs for remote Fediverse followers
    await this.enqueueFederatedDelivery(createdPost).catch((err) => {
      console.error('Error enqueueing federated delivery jobs:', err);
    });

    // PKG-15: pre-filter spam heuristic — auto-flag nếu vượt ngưỡng (không chặn đăng)
    await spamDetectionService
      .maybeAutoFlag(createdPost.id, authorId, createdPost.content)
      .catch((err) => {
        console.error('Spam auto-flag error:', err);
      });

    return {
      id: createdPost.id,
      authorId: createdPost.authorId,
      content: createdPost.content,
      mediaUrls: createdPost.mediaUrls,
      replyToId: createdPost.replyToId,
      rootPostId: createdPost.rootPostId,
      repostOfId: createdPost.repostOfId,
      quoteOfId: createdPost.quoteOfId,
      reply_privacy: createdPost.reply_privacy as ReplyPrivacy,
      replyPrivacy: createdPost.reply_privacy as ReplyPrivacy,
      canReply: true,
      isEdited: createdPost.isEdited,
      editCount: createdPost.editCount,
      lastEditedAt: createdPost.lastEditedAt ? createdPost.lastEditedAt.toISOString() : null,
      isPinned: false,
      isSensitive: createdPost.isSensitive,
      contentWarning: createdPost.contentWarning,
      likesCount: createdPost.likesCount,
      repliesCount: createdPost.repliesCount,
      repostsCount: createdPost.repostsCount,
      quotesCount: createdPost.quotesCount,
      viewsCount: createdPost.viewsCount ?? 0,
      hashtags: createdPost.hashtags,
      mentions: createdPost.mentions,
      isLiked: false,
      isReposted: false,
      isBookmarked: false,
      createdAt: createdPost.createdAt.toISOString(),
      author: createdPost.author,
      replyTo: createdPost.replyTo,
      quoteOf: createdPost.quoteOf
        ? {
            id: createdPost.quoteOf.id,
            authorId: createdPost.quoteOf.authorId,
            content: createdPost.quoteOf.content,
            mediaUrls: createdPost.quoteOf.mediaUrls,
            replyToId: createdPost.quoteOf.replyToId,
            rootPostId: createdPost.quoteOf.rootPostId,
            repostOfId: createdPost.quoteOf.repostOfId,
            quoteOfId: createdPost.quoteOf.quoteOfId,
            reply_privacy: createdPost.quoteOf.reply_privacy as ReplyPrivacy,
            replyPrivacy: createdPost.quoteOf.reply_privacy as ReplyPrivacy,
            likesCount: createdPost.quoteOf.likesCount,
            repliesCount: createdPost.quoteOf.repliesCount,
            repostsCount: createdPost.quoteOf.repostsCount,
            quotesCount: createdPost.quoteOf.quotesCount,
            viewsCount: createdPost.quoteOf.viewsCount ?? 0,
            hashtags: createdPost.quoteOf.hashtags,
            mentions: createdPost.quoteOf.mentions,
            createdAt: createdPost.quoteOf.createdAt.toISOString(),
            author: createdPost.quoteOf.author,
          }
        : null,
    };
  }

  private extractHashtags(content: string): string[] {
    const matches = content.match(/#([\p{L}\p{N}_]+)/gu);
    if (!matches) return [];
    return [...new Set(matches.map((m) => m.slice(1).toLowerCase()))];
  }

  private extractMentions(content: string): string[] {
    const regex = /(?:^|\s)@([a-zA-Z0-9_]{1,30})\b/g;
    const mentions: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      mentions.push(match[1]);
    }
    return [...new Set(mentions)];
  }

  private async enqueueFederatedDelivery(post: any): Promise<void> {
    const remoteFollows = await prisma.federatedFollow.findMany({
      where: {
        localUserId: post.authorId,
        direction: 'INBOUND',
        status: 'ACCEPTED',
      },
      include: {
        remoteActor: true,
      },
    });

    if (!remoteFollows || remoteFollows.length === 0) {
      return;
    }

    const targetInboxes = new Set<string>();
    for (const f of remoteFollows) {
      const inbox = f.remoteActor?.sharedInboxUrl || f.remoteActor?.inboxUrl;
      if (inbox) {
        targetInboxes.add(inbox);
      }
    }

    if (targetInboxes.size === 0) {
      return;
    }

    const domain = activityPubKeyManagerService.getDomain();
    const protocol = domain.startsWith('localhost') ? 'http' : 'https';
    const baseUrl = `${protocol}://${domain}`;
    const authorUsername = post.author?.username || 'user';
    const authorUri = `${baseUrl}/users/${authorUsername}`;
    const postUri = `${baseUrl}/posts/${post.id}`;

    const note: ActivityPubNote = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: postUri,
      type: 'Note',
      attributedTo: authorUri,
      content: post.content,
      published: post.createdAt.toISOString(),
      to: ['https://www.w3.org/ns/activitystreams#Public'],
      cc: [`${authorUri}/followers`],
      ...(post.contentWarning ? { summary: post.contentWarning } : {}),
      ...(post.isSensitive ? { sensitive: true } : {}),
    };

    const createActivity: ActivityPubActivity = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: `${baseUrl}/activities/${post.id}`,
      type: 'Create',
      actor: authorUri,
      published: post.createdAt.toISOString(),
      to: ['https://www.w3.org/ns/activitystreams#Public'],
      cc: [`${authorUri}/followers`],
      object: note,
    };

    for (const inbox of targetInboxes) {
      await activityDeliveryWorkerService.queueDelivery({
        activityId: createActivity.id,
        activityType: 'Create',
        actorUri: authorUri,
        targetInboxUrl: inbox,
        payload: createActivity,
      });
    }
  }
}

export const publishPostService = new PublishPostService();

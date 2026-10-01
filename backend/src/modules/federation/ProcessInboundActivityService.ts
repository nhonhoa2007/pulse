import crypto from 'crypto';
import { prisma } from '../../db/PrismaClientSingleton.js';
import {
  ActivityPubActivity,
  ActivityPubNote,
} from '../../contracts/ActivityPubContracts.js';
import { activityPubKeyManagerService } from './ActivityPubKeyManagerService.js';
import { validateReplyPermissionService } from '../posts/ValidateReplyPermissionService.js';
import { sanitizeFederatedHtml } from './SanitizeFederatedHtml.js';

export interface ProcessActivityOptions {
  targetUsername?: string;
  hostHeader?: string;
}

export interface ProcessActivityResult {
  handled: boolean;
  type: string;
  message: string;
  activityId?: string;
}

export class ProcessInboundActivityService {
  /**
   * Helper to ensure a remote actor record exists in federated_actors
   */
  private async ensureRemoteActor(actorUri: string): Promise<any> {
    const existing = await prisma.federatedActor.findUnique({
      where: { uri: actorUri },
    });

    if (existing) {
      return existing;
    }

    try {
      const parsed = new URL(actorUri);
      const domain = parsed.hostname;
      const pathParts = parsed.pathname.split('/').filter(Boolean);
      const username = pathParts[pathParts.length - 1] || 'remote_user';

      return await prisma.federatedActor.create({
        data: {
          uri: actorUri,
          username,
          domain,
          name: username,
          inboxUrl: `${parsed.protocol}//${parsed.host}/inbox`,
          publicKeyPem: '',
          publicKeyId: `${actorUri}#main-key`,
        },
      });
    } catch {
      return await prisma.federatedActor.create({
        data: {
          uri: actorUri,
          username: 'unknown_remote',
          domain: 'remote.unknown',
          inboxUrl: `${actorUri}/inbox`,
          publicKeyPem: '',
          publicKeyId: `${actorUri}#main-key`,
        },
      });
    }
  }

  /**
   * Helper to ensure a shadow User exists for a remote actor
   */
  private async ensureShadowUser(remoteActor: any): Promise<any> {
    let shadow = await prisma.user.findFirst({
      where: { federatedActorId: remoteActor.id },
    });

    if (shadow) {
      return shadow;
    }

    const cleanDomain = remoteActor.domain.replace(/[^a-zA-Z0-9]/g, '_');
    const cleanUsername = remoteActor.username.replace(/[^a-zA-Z0-9]/g, '_');
    const baseUsername = `${cleanUsername}_${cleanDomain}`.slice(0, 45);
    const uniqueSuffix = crypto.randomBytes(3).toString('hex');
    const username = `${baseUsername}_${uniqueSuffix}`;
    const email = `${username}@remote-shadow.fediverse`;

    shadow = await prisma.user.create({
      data: {
        username,
        email,
        displayName: remoteActor.name || remoteActor.username,
        avatarUrl: remoteActor.avatarUrl,
        bio: remoteActor.summary || `Remote Fediverse user @${remoteActor.username}@${remoteActor.domain}`,
        isRemote: true,
        federatedActorId: remoteActor.id,
      },
    });

    return shadow;
  }

  /**
   * Sanitizes federated HTML to prevent Stored XSS
   */
  private sanitizeFederatedHtml(rawHtml: string): string {
    return sanitizeFederatedHtml(rawHtml);
  }

  /**
   * Main dispatch method for all incoming activities
   */
  public async processActivity(
    activity: ActivityPubActivity,
    options: ProcessActivityOptions = {}
  ): Promise<ProcessActivityResult> {
    const activityType = activity.type;
    const actorUri = activity.actor;
    const serverDomain = activityPubKeyManagerService.getDomain(options.hostHeader);

    // Ensure remote actor record exists
    const remoteActor = await this.ensureRemoteActor(actorUri);

    switch (activityType) {
      case 'Follow':
        return await this.handleFollowActivity(activity, remoteActor, options, serverDomain);

      case 'Undo':
        return await this.handleUndoActivity(activity, remoteActor, options);

      case 'Create':
        return await this.handleCreateActivity(activity, remoteActor);

      case 'Accept':
        return await this.handleAcceptActivity(activity, remoteActor);

      case 'Delete':
        return await this.handleDeleteActivity(activity, remoteActor);

      case 'Like':
        return await this.handleLikeActivity(activity, remoteActor);

      case 'Announce':
        return await this.handleAnnounceActivity(activity, remoteActor);

      default:
        return {
          handled: true,
          type: activityType,
          message: `Inbound activity of type '${activityType}' acknowledged without further action.`,
        };
    }
  }

  /**
   * Handle Follow: remote actor follows local user
   */
  private async handleFollowActivity(
    activity: ActivityPubActivity,
    remoteActor: any,
    options: ProcessActivityOptions,
    serverDomain: string
  ): Promise<ProcessActivityResult> {
    // Determine target local user
    let targetUsername = options.targetUsername;

    if (!targetUsername && typeof activity.object === 'string') {
      try {
        const objUrl = new URL(activity.object);
        const pathParts = objUrl.pathname.split('/').filter(Boolean);
        if (pathParts[0] === 'users' && pathParts[1]) {
          targetUsername = pathParts[1];
        } else if (pathParts[0]?.startsWith('@')) {
          targetUsername = pathParts[0].slice(1);
        }
      } catch {
        targetUsername = activity.object;
      }
    } else if (!targetUsername && typeof activity.object === 'object' && activity.object?.id) {
      const objUrl = new URL(activity.object.id);
      const pathParts = objUrl.pathname.split('/').filter(Boolean);
      targetUsername = pathParts[1];
    }

    if (!targetUsername) {
      return {
        handled: false,
        type: 'Follow',
        message: 'Could not determine target local user for Follow activity',
      };
    }

    const localUser = await prisma.user.findFirst({
      where: {
        username: {
          equals: targetUsername,
          mode: 'insensitive',
        },
        isRemote: false,
      },
    });

    if (!localUser) {
      return {
        handled: false,
        type: 'Follow',
        message: `Target local user '${targetUsername}' not found`,
      };
    }

    // Upsert FederatedFollow (direction: INBOUND, status: ACCEPTED)
    const existingFollow = await prisma.federatedFollow.findFirst({
      where: {
        localUserId: localUser.id,
        remoteActorId: remoteActor.id,
        direction: 'INBOUND',
      },
    });

    if (!existingFollow) {
      await prisma.federatedFollow.create({
        data: {
          localUserId: localUser.id,
          remoteActorId: remoteActor.id,
          direction: 'INBOUND',
          status: 'ACCEPTED',
          activityUri: activity.id,
        },
      });

      // Increment local user followersCount
      await prisma.user.update({
        where: { id: localUser.id },
        data: { followersCount: { increment: 1 } },
      });

      // Shadow user & Notification
      const shadowUser = await this.ensureShadowUser(remoteActor);
      await prisma.notification.create({
        data: {
          recipientId: localUser.id,
          actorId: shadowUser.id,
          verb: 'FOLLOW',
          targetType: 'USER',
          targetId: localUser.id,
          actorSummary: shadowUser.displayName || shadowUser.username,
        },
      });
    }

    // Auto-generate Accept Activity and enqueue delivery job
    const protocol = serverDomain.startsWith('localhost') ? 'http' : 'https';
    const localUserUri = `${protocol}://${serverDomain}/users/${localUser.username}`;
    const acceptActivityId = `${protocol}://${serverDomain}/activities/${crypto.randomUUID()}`;

    const acceptActivity: ActivityPubActivity = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: acceptActivityId,
      type: 'Accept',
      actor: localUserUri,
      object: activity,
      to: [activity.actor],
      published: new Date().toISOString(),
    };

    const targetInbox =
      remoteActor.inboxUrl || remoteActor.sharedInboxUrl || `${activity.actor}/inbox`;

    await prisma.activityDeliveryJob.create({
      data: {
        activityId: acceptActivityId,
        activityType: 'Accept',
        actorUri: localUserUri,
        targetInboxUrl: targetInbox,
        payloadJson: JSON.stringify(acceptActivity),
        status: 'PENDING',
      },
    });

    return {
      handled: true,
      type: 'Follow',
      message: `Follow from ${activity.actor} accepted and Accept queued for delivery.`,
      activityId: acceptActivityId,
    };
  }

  /**
   * Main dispatch for Undo activity: supports Undo(Follow), Undo(Like), and Undo(Announce)
   */
  private async handleUndoActivity(
    activity: ActivityPubActivity,
    remoteActor: any,
    options: ProcessActivityOptions
  ): Promise<ProcessActivityResult> {
    const object = activity.object;
    const objectType = typeof object === 'object' ? object?.type : undefined;

    if (objectType === 'Like') {
      return await this.handleUndoLikeActivity(activity, remoteActor);
    }

    if (objectType === 'Announce') {
      return await this.handleUndoAnnounceActivity(activity, remoteActor);
    }

    if (typeof object === 'string') {
      if (object.includes('/like/') || object.includes('activities/like')) {
        return await this.handleUndoLikeActivity(activity, remoteActor);
      }
      if (object.includes('/announce/') || object.includes('activities/announce')) {
        return await this.handleUndoAnnounceActivity(activity, remoteActor);
      }
    }

    return await this.handleUndoFollowActivity(activity, remoteActor, options);
  }

  /**
   * Handle Undo: remote actor unfollows local user
   */
  private async handleUndoFollowActivity(
    activity: ActivityPubActivity,
    remoteActor: any,
    options: ProcessActivityOptions
  ): Promise<ProcessActivityResult> {
    const object = activity.object;

    // Typically Undo wraps a Follow
    let targetUsername = options.targetUsername;
    if (!targetUsername && typeof object === 'object' && object?.object) {
      try {
        const objTarget = typeof object.object === 'string' ? object.object : object.object.id;
        const objUrl = new URL(objTarget);
        const pathParts = objUrl.pathname.split('/').filter(Boolean);
        targetUsername = pathParts[1];
      } catch {
        targetUsername = object.object;
      }
    }

    const followRecord = await prisma.federatedFollow.findFirst({
      where: {
        remoteActorId: remoteActor.id,
        direction: 'INBOUND',
        ...(targetUsername
          ? {
              localUser: {
                username: { equals: targetUsername, mode: 'insensitive' },
              },
            }
          : {}),
      },
      include: { localUser: true },
    });

    if (followRecord) {
      await prisma.federatedFollow.delete({
        where: { id: followRecord.id },
      });

      // Decrement followersCount safely
      const newFollowersCount = Math.max(0, followRecord.localUser.followersCount - 1);
      await prisma.user.update({
        where: { id: followRecord.localUserId },
        data: { followersCount: newFollowersCount },
      });

      return {
        handled: true,
        type: 'Undo',
        message: `Undo Follow processed. Removed remote follow from ${activity.actor}.`,
      };
    }

    return {
      handled: true,
      type: 'Undo',
      message: 'Undo acknowledged (no active follow relation found).',
    };
  }

  /**
   * Resolves target post by ID or federated URI from raw activity target string/object
   */
  private async resolveTargetPost(rawTarget: any): Promise<any> {
    if (!rawTarget) return null;
    const targetStr =
      typeof rawTarget === 'string'
        ? rawTarget
        : rawTarget?.id || rawTarget?.object;
    if (!targetStr || typeof targetStr !== 'string') return null;

    let candidateId: string | null = null;
    try {
      const parsedUrl = new URL(targetStr);
      const parts = parsedUrl.pathname.split('/').filter(Boolean);
      const postsIdx = parts.indexOf('posts');
      if (postsIdx !== -1 && parts[postsIdx + 1]) {
        candidateId = parts[postsIdx + 1];
      } else {
        candidateId = parts[parts.length - 1];
      }
    } catch {
      candidateId = targetStr;
    }

    return await prisma.post.findFirst({
      where: {
        OR: [
          ...(candidateId ? [{ id: candidateId }] : []),
          { federatedUri: targetStr },
        ],
        isDeleted: false,
      },
      include: { author: true },
    });
  }

  /**
   * Handle Inbound Like: remote actor likes local post
   */
  private async handleLikeActivity(
    activity: ActivityPubActivity,
    remoteActor: any
  ): Promise<ProcessActivityResult> {
    const shadowUser = await this.ensureShadowUser(remoteActor);

    const targetPost = await this.resolveTargetPost(activity.object);
    if (!targetPost) {
      return {
        handled: false,
        type: 'Like',
        message: `Target post not found for Like activity (${typeof activity.object === 'string' ? activity.object : activity.object?.id})`,
      };
    }

    const existingLike = await prisma.like.findUnique({
      where: { userId_postId: { userId: shadowUser.id, postId: targetPost.id } },
    });

    if (!existingLike) {
      await prisma.like.create({
        data: {
          userId: shadowUser.id,
          postId: targetPost.id,
        },
      });

      await prisma.$executeRaw`
        UPDATE "Post"
        SET "likesCount" = "likesCount" + 1
        WHERE id = ${targetPost.id}
      `;

      if (targetPost.authorId !== shadowUser.id) {
        await prisma.notification.create({
          data: {
            recipientId: targetPost.authorId,
            actorId: shadowUser.id,
            verb: 'LIKE',
            targetType: 'POST',
            targetId: targetPost.id,
            actorSummary: `@${remoteActor.username}@${remoteActor.domain} liked your post`,
          },
        });
      }
    }

    return {
      handled: true,
      type: 'Like',
      message: `Inbound Like processed for post ${targetPost.id}`,
      activityId: activity.id,
    };
  }

  /**
   * Handle Inbound Announce: remote actor reposts local post
   */
  private async handleAnnounceActivity(
    activity: ActivityPubActivity,
    remoteActor: any
  ): Promise<ProcessActivityResult> {
    const shadowUser = await this.ensureShadowUser(remoteActor);

    const targetPost = await this.resolveTargetPost(activity.object);
    if (!targetPost) {
      return {
        handled: false,
        type: 'Announce',
        message: `Target post not found for Announce activity (${typeof activity.object === 'string' ? activity.object : activity.object?.id})`,
      };
    }

    const existingRepost = await prisma.repost.findUnique({
      where: { userId_postId: { userId: shadowUser.id, postId: targetPost.id } },
    });

    if (!existingRepost) {
      await prisma.repost.create({
        data: {
          userId: shadowUser.id,
          postId: targetPost.id,
        },
      });

      await prisma.$executeRaw`
        UPDATE "Post"
        SET "repostsCount" = "repostsCount" + 1
        WHERE id = ${targetPost.id}
      `;

      if (targetPost.authorId !== shadowUser.id) {
        await prisma.notification.create({
          data: {
            recipientId: targetPost.authorId,
            actorId: shadowUser.id,
            verb: 'REPOST',
            targetType: 'POST',
            targetId: targetPost.id,
            actorSummary: `@${remoteActor.username}@${remoteActor.domain} reposted your post`,
          },
        });
      }
    }

    return {
      handled: true,
      type: 'Announce',
      message: `Inbound Announce processed for post ${targetPost.id}`,
      activityId: activity.id,
    };
  }

  /**
   * Handle Inbound Undo(Like): remote actor unlikes local post
   */
  private async handleUndoLikeActivity(
    activity: ActivityPubActivity,
    remoteActor: any
  ): Promise<ProcessActivityResult> {
    const shadowUser = await this.ensureShadowUser(remoteActor);
    const innerObject = activity.object;
    const target =
      typeof innerObject === 'object'
        ? innerObject.object || innerObject.id
        : innerObject;

    const targetPost = await this.resolveTargetPost(target);
    if (!targetPost) {
      return {
        handled: true,
        type: 'Undo',
        message: 'Undo Like acknowledged (target post not found).',
        activityId: activity.id,
      };
    }

    const existingLike = await prisma.like.findUnique({
      where: { userId_postId: { userId: shadowUser.id, postId: targetPost.id } },
    });

    if (existingLike) {
      await prisma.like.delete({
        where: { userId_postId: { userId: shadowUser.id, postId: targetPost.id } },
      });

      await prisma.$executeRaw`
        UPDATE "Post"
        SET "likesCount" = GREATEST(0, "likesCount" - 1)
        WHERE id = ${targetPost.id}
      `;
    }

    return {
      handled: true,
      type: 'Undo',
      message: `Undo Like processed for post ${targetPost.id}.`,
      activityId: activity.id,
    };
  }

  /**
   * Handle Inbound Undo(Announce): remote actor unreposts local post
   */
  private async handleUndoAnnounceActivity(
    activity: ActivityPubActivity,
    remoteActor: any
  ): Promise<ProcessActivityResult> {
    const shadowUser = await this.ensureShadowUser(remoteActor);
    const innerObject = activity.object;
    const target =
      typeof innerObject === 'object'
        ? innerObject.object || innerObject.id
        : innerObject;

    const targetPost = await this.resolveTargetPost(target);
    if (!targetPost) {
      return {
        handled: true,
        type: 'Undo',
        message: 'Undo Announce acknowledged (target post not found).',
        activityId: activity.id,
      };
    }

    const existingRepost = await prisma.repost.findUnique({
      where: { userId_postId: { userId: shadowUser.id, postId: targetPost.id } },
    });

    if (existingRepost) {
      await prisma.repost.delete({
        where: { userId_postId: { userId: shadowUser.id, postId: targetPost.id } },
      });

      await prisma.$executeRaw`
        UPDATE "Post"
        SET "repostsCount" = GREATEST(0, "repostsCount" - 1)
        WHERE id = ${targetPost.id}
      `;
    }

    return {
      handled: true,
      type: 'Undo',
      message: `Undo Announce processed for post ${targetPost.id}.`,
      activityId: activity.id,
    };
  }

  /**
   * Handle Create: remote actor published a Note
   */
  private async handleCreateActivity(
    activity: ActivityPubActivity,
    remoteActor: any
  ): Promise<ProcessActivityResult> {
    const object = activity.object as ActivityPubNote;

    if (!object || (object.type !== 'Note' && (object as any).type !== 'Article')) {
      return {
        handled: false,
        type: 'Create',
        message: 'Create activity object is not a Note or supported type',
      };
    }

    // Validate Object ID
    if (!object.id || typeof object.id !== 'string') {
      return {
        handled: false,
        type: 'Create',
        message: 'Create activity object must have a valid string URI as id',
      };
    }

    try {
      const objUrl = new URL(object.id);
      const actorUrl = new URL(activity.actor);
      if (objUrl.host !== actorUrl.host) {
        return {
          handled: false,
          type: 'Create',
          message: `ORIGIN_MISMATCH: Object id host '${objUrl.host}' does not match Actor host '${actorUrl.host}'`,
        };
      }
    } catch {
      return {
        handled: false,
        type: 'Create',
        message: 'INVALID_OBJECT_ID: Object id is not a valid URL',
      };
    }

    // Enforce content length bounds (max 50,000 characters) and HTML sanitization
    const rawContent = object.content || '';
    const boundedContent = rawContent.length > 50000 ? rawContent.slice(0, 50000) : rawContent;
    const sanitizedContent = this.sanitizeFederatedHtml(boundedContent);

    const shadowUser = await this.ensureShadowUser(remoteActor);

    // Deduplication check by federatedUri
    const existingPost = await prisma.post.findFirst({
      where: { federatedUri: object.id },
    });

    if (existingPost) {
      return {
        handled: true,
        type: 'Create',
        message: `Post ${object.id} already exists in database.`,
      };
    }

    // Check if this is a reply to a local or federated post
    let replyToId: string | null = null;
    let rootPostId: string | null = null;
    let parentAuthorId: string | null = null;

    if (object.inReplyTo) {
      let candidateId = object.inReplyTo;
      if (candidateId.includes('/posts/')) {
        candidateId = candidateId.split('/posts/').pop() || candidateId;
      }
      const parentPost = await prisma.post.findFirst({
        where: {
          OR: [{ federatedUri: object.inReplyTo }, { id: object.inReplyTo }, { id: candidateId }],
        },
      });

      if (parentPost && !parentPost.isDeleted) {
        const permission = await validateReplyPermissionService.validate(shadowUser.id, parentPost.id);
        if (permission.allowed) {
          replyToId = parentPost.id;
          rootPostId = parentPost.rootPostId || parentPost.id;
          parentAuthorId = parentPost.authorId;

          await prisma.post.update({
            where: { id: parentPost.id },
            data: { repliesCount: { increment: 1 } },
          });
        }
      }
    }

    // Create post record
    const post = await prisma.post.create({
      data: {
        authorId: shadowUser.id,
        content: sanitizedContent,
        isRemote: true,
        federatedUri: object.id,
        replyToId,
        rootPostId,
        createdAt: object.published ? new Date(object.published) : new Date(),
      },
    });

    // Notify parent post author if it was a reply to local user
    if (parentAuthorId && parentAuthorId !== shadowUser.id) {
      await prisma.notification.create({
        data: {
          recipientId: parentAuthorId,
          actorId: shadowUser.id,
          verb: 'REPLY',
          targetType: 'POST',
          targetId: post.id,
          actorSummary: shadowUser.displayName || shadowUser.username,
        },
      });
    }

    // Fan-out to timeline inboxes of all local users following this remote actor
    const localFollowers = await prisma.federatedFollow.findMany({
      where: {
        remoteActorId: remoteActor.id,
        direction: 'OUTBOUND',
        status: 'ACCEPTED',
      },
      select: { localUserId: true },
    });

    if (localFollowers.length > 0) {
      const timelineEntries = localFollowers.map((f: any) => ({
        userId: f.localUserId,
        postId: post.id,
        authorId: shadowUser.id,
      }));

      await prisma.timelineInbox.createMany({
        data: timelineEntries,
      });
    }

    return {
      handled: true,
      type: 'Create',
      message: `Note ${object.id} stored and fanned out to ${localFollowers.length} local follower(s).`,
      activityId: post.id,
    };
  }

  /**
   * Handle Accept: remote actor accepted local user's follow request
   */
  private async handleAcceptActivity(
    activity: ActivityPubActivity,
    remoteActor: any
  ): Promise<ProcessActivityResult> {
    const followRecord = await prisma.federatedFollow.findFirst({
      where: {
        remoteActorId: remoteActor.id,
        direction: 'OUTBOUND',
      },
      include: { localUser: true },
    });

    if (followRecord) {
      if (followRecord.status !== 'ACCEPTED') {
        await prisma.federatedFollow.update({
          where: { id: followRecord.id },
          data: { status: 'ACCEPTED' },
        });

        await prisma.user.update({
          where: { id: followRecord.localUserId },
          data: { followingCount: { increment: 1 } },
        });
      }

      return {
        handled: true,
        type: 'Accept',
        message: `Accept follow confirmed for local user ${followRecord.localUser.username}.`,
      };
    }

    return {
      handled: true,
      type: 'Accept',
      message: 'Accept acknowledged (no matching outbound follow found).',
    };
  }

  /**
   * Handle Delete: remote actor deleted a post/Note
   * Strictly enforces that only the author of the federated post is allowed to delete it.
   */
  private async handleDeleteActivity(
    activity: ActivityPubActivity,
    remoteActor: any
  ): Promise<ProcessActivityResult> {
    const objectUri =
      typeof activity.object === 'string' ? activity.object : activity.object?.id;

    if (!objectUri) {
      return { handled: false, type: 'Delete', message: 'Delete object URI missing' };
    }

    const post = await prisma.post.findFirst({
      where: { federatedUri: objectUri },
      include: { author: true },
    });

    if (!post) {
      return {
        handled: true,
        type: 'Delete',
        message: 'Delete acknowledged (post not found locally).',
      };
    }

    // Authorization Check: Only the author of the remote post can delete it
    const isAuthorized =
      post.isRemote &&
      post.author &&
      post.author.federatedActorId &&
      remoteActor &&
      post.author.federatedActorId === remoteActor.id;

    if (!isAuthorized) {
      return {
        handled: false,
        type: 'Delete',
        message: `UNAUTHORIZED_DELETE: Actor '${activity.actor}' is not authorized to delete post '${objectUri}'`,
      };
    }

    await prisma.post.update({
      where: { id: post.id },
      data: { isDeleted: true },
    });

    return {
      handled: true,
      type: 'Delete',
      message: `Post ${objectUri} soft-deleted by authorized author.`,
    };
  }
}

export const processInboundActivityService = new ProcessInboundActivityService();

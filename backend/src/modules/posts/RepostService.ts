import { prisma } from '../../db/PrismaClientSingleton.js';
import { notificationAggregatorService } from '../notifications/NotificationAggregatorService.js';
import { ToggleRepostResult } from '../../contracts/ApiContracts.js';
import { activityPubKeyManagerService } from '../federation/ActivityPubKeyManagerService.js';
import { activityDeliveryWorkerService } from '../federation/ActivityDeliveryWorkerService.js';

export class RepostService {
  /**
   * Concurrency-safe atomic toggle repost.
   * Uses PostgreSQL row locking to guarantee counter consistency.
   */
  public async toggleRepost(userId: string, postId: string): Promise<ToggleRepostResult> {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new Error('User not found');
    }

    const targetPost = await prisma.post.findUnique({
      where: { id: postId },
      select: {
        id: true,
        authorId: true,
        isDeleted: true,
        author: { select: { isPrivate: true } },
      },
    });

    if (!targetPost || targetPost.isDeleted) {
      const err = new Error('Post not found');
      (err as any).statusCode = 404;
      throw err;
    }

    // TASK-21 Privacy Invariant: Posts from private accounts cannot be reposted
    if (targetPost.author?.isPrivate) {
      const err = new Error('Cannot repost a post from a private account');
      (err as any).statusCode = 403;
      (err as any).code = 'FORBIDDEN';
      throw err;
    }

    const result = await prisma.$transaction(
      async (tx) => {
        const posts = await tx.$queryRaw<{ id: string; authorId: string; repostsCount: number }[]>`
          SELECT id, "authorId", "repostsCount" FROM "Post" WHERE id = ${postId} AND "isDeleted" = false FOR UPDATE
        `;

        if (!posts || posts.length === 0) {
          throw new Error('Post not found');
        }

        const post = posts[0];

        const existingRepost = await tx.repost.findUnique({
          where: { userId_postId: { userId, postId } },
        });

        if (existingRepost) {
          // Unrepost
          await tx.repost.delete({
            where: { userId_postId: { userId, postId } },
          });

          await tx.$executeRaw`
            UPDATE "Post"
            SET "repostsCount" = GREATEST(0, "repostsCount" - 1)
            WHERE id = ${postId}
          `;

          const updated = await tx.post.findUnique({
            where: { id: postId },
            select: { repostsCount: true },
          });

          return {
            reposted: false,
            repostsCount: updated?.repostsCount ?? 0,
            authorId: post.authorId,
          };
        } else {
          // Repost
          await tx.repost.create({
            data: { userId, postId },
          });

          await tx.$executeRaw`
            UPDATE "Post"
            SET "repostsCount" = "repostsCount" + 1
            WHERE id = ${postId}
          `;

          const updated = await tx.post.findUnique({
            where: { id: postId },
            select: { repostsCount: true },
          });

          return {
            reposted: true,
            repostsCount: updated?.repostsCount ?? 1,
            authorId: post.authorId,
          };
        }
      },
      {
        timeout: 10000,
      }
    );

    // Send aggregated notification on repost (if actor is not author)
    if (result.reposted && result.authorId !== userId) {
      await notificationAggregatorService.recordNotification({
        recipientId: result.authorId,
        actorId: userId,
        verb: 'REPOST',
        targetType: 'POST',
        targetId: postId,
      });
    }

    // Outbound ActivityPub Federation for remote post and/or remote followers
    try {
      const postRecord = await prisma.post.findUnique({
        where: { id: postId },
        include: {
          author: {
            include: {
              federatedActor: true,
            },
          },
        },
      });

      if (postRecord) {
        await this.handleOutboundAnnounceFederation(user, postRecord, result.reposted);
      }
    } catch (err) {
      console.error('Error during outbound ActivityPub Announce federation:', err);
    }

    return {
      reposted: result.reposted,
      repostsCount: result.repostsCount,
    };
  }

  /**
   * Enqueues ActivityPub Announce or Undo(Announce) to target inboxes
   */
  private async handleOutboundAnnounceFederation(
    user: any,
    post: any,
    reposted: boolean
  ): Promise<void> {
    const targetInboxes = new Set<string>();

    // If original post is remote, deliver to remote author's inbox
    if (post.isRemote || post.author?.isRemote || post.federatedUri) {
      const authorInbox =
        post.author?.federatedActor?.inboxUrl || post.author?.federatedActor?.sharedInboxUrl;
      if (authorInbox) {
        targetInboxes.add(authorInbox);
      } else if (post.federatedUri && post.federatedUri.startsWith('http')) {
        try {
          const u = new URL(post.federatedUri);
          targetInboxes.add(`${u.protocol}//${u.host}/inbox`);
        } catch {
          // Fall through
        }
      }
    }

    // Deliver to remote followers of the reposter
    const remoteFollows = await prisma.federatedFollow.findMany({
      where: {
        localUserId: user.id,
        direction: 'INBOUND',
        status: 'ACCEPTED',
      },
      include: {
        remoteActor: true,
      },
    });

    for (const f of remoteFollows) {
      const inbox = f.remoteActor?.sharedInboxUrl || f.remoteActor?.inboxUrl;
      if (inbox) {
        targetInboxes.add(inbox);
      }
    }

    if (targetInboxes.size === 0) return;

    const domain = activityPubKeyManagerService.getDomain();
    const protocol =
      domain.startsWith('localhost') || domain.startsWith('127.0.0.1') ? 'http' : 'https';
    const baseUrl = `${protocol}://${domain}`;
    const authorUri = `${baseUrl}/users/${user.username}`;
    const targetUri = post.federatedUri || `${baseUrl}/posts/${post.id}`;
    const targetActorUri = post.author?.federatedActor?.uri;

    if (reposted) {
      const activityId = `${baseUrl}/activities/announce/${user.id}-${post.id}-${Date.now()}`;
      const announceActivity: any = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: activityId,
        type: 'Announce',
        actor: authorUri,
        published: new Date().toISOString(),
        object: targetUri,
        to: ['https://www.w3.org/ns/activitystreams#Public'],
        cc: [targetActorUri, `${authorUri}/followers`].filter(Boolean),
      };

      for (const inbox of targetInboxes) {
        await activityDeliveryWorkerService.queueDelivery({
          activityId: announceActivity.id,
          activityType: 'Announce',
          actorUri: authorUri,
          targetInboxUrl: inbox,
          payload: announceActivity,
        });
      }
    } else {
      const undoActivityId = `${baseUrl}/activities/undo-announce/${user.id}-${post.id}-${Date.now()}`;
      const undoActivity: any = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: undoActivityId,
        type: 'Undo',
        actor: authorUri,
        object: {
          id: `${baseUrl}/activities/announce/${user.id}-${post.id}`,
          type: 'Announce',
          actor: authorUri,
          object: targetUri,
        },
        to: ['https://www.w3.org/ns/activitystreams#Public'],
        cc: [targetActorUri, `${authorUri}/followers`].filter(Boolean),
      };

      for (const inbox of targetInboxes) {
        await activityDeliveryWorkerService.queueDelivery({
          activityId: undoActivity.id,
          activityType: 'Undo',
          actorUri: authorUri,
          targetInboxUrl: inbox,
          payload: undoActivity,
        });
      }
    }
  }
}

export const repostService = new RepostService();

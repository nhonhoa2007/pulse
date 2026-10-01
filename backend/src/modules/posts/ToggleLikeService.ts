import { prisma } from '../../db/PrismaClientSingleton.js';
import { notificationAggregatorService } from '../notifications/NotificationAggregatorService.js';
import { ToggleLikeResult } from '../../contracts/ApiContracts.js';
import { activityPubKeyManagerService } from '../federation/ActivityPubKeyManagerService.js';
import { activityDeliveryWorkerService } from '../federation/ActivityDeliveryWorkerService.js';

export class ToggleLikeService {
  /**
   * Concurrency-safe atomic toggle like/unlike.
   * Uses PostgreSQL row locking (SELECT ... FOR UPDATE) to guarantee counter consistency
   * and idempotency across concurrent operations.
   */
  public async toggleLike(userId: string, postId: string): Promise<ToggleLikeResult> {
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

    // TASK-21 Privacy Invariant: Liking posts from private accounts requires approved follow
    if (targetPost.author?.isPrivate && targetPost.authorId !== userId) {
      const follow = await prisma.follow.findUnique({
        where: { followerId_followingId: { followerId: userId, followingId: targetPost.authorId } },
      });
      if (!follow) {
        const err = new Error('Cannot like a post from a private account you do not follow');
        (err as any).statusCode = 403;
        (err as any).code = 'FORBIDDEN';
        throw err;
      }
    }

    const result = await prisma.$transaction(
      async (tx) => {
        // Exclusively lock the post row to prevent race conditions during high concurrency
        const posts = await tx.$queryRaw<{ id: string; authorId: string; likesCount: number }[]>`
          SELECT id, "authorId", "likesCount" FROM "Post" WHERE id = ${postId} AND "isDeleted" = false FOR UPDATE
        `;

        if (!posts || posts.length === 0) {
          throw new Error('Post not found');
        }

        const post = posts[0];

        const existingLike = await tx.like.findUnique({
          where: { userId_postId: { userId, postId } },
        });

        if (existingLike) {
          // Unlike: Remove like and decrement counter atomically
          await tx.like.delete({
            where: { userId_postId: { userId, postId } },
          });

          await tx.$executeRaw`
            UPDATE "Post"
            SET "likesCount" = GREATEST(0, "likesCount" - 1)
            WHERE id = ${postId}
          `;

          const updated = await tx.post.findUnique({
            where: { id: postId },
            select: { likesCount: true },
          });

          return {
            liked: false,
            likesCount: updated?.likesCount ?? 0,
            authorId: post.authorId,
          };
        } else {
          // Like: Insert like and increment counter atomically
          await tx.like.create({
            data: { userId, postId },
          });

          await tx.$executeRaw`
            UPDATE "Post"
            SET "likesCount" = "likesCount" + 1
            WHERE id = ${postId}
          `;

          const updated = await tx.post.findUnique({
            where: { id: postId },
            select: { likesCount: true },
          });

          return {
            liked: true,
            likesCount: updated?.likesCount ?? 1,
            authorId: post.authorId,
          };
        }
      },
      {
        timeout: 10000,
      }
    );

    // Send aggregated notification on like (if actor is not the post author)
    if (result.liked && result.authorId !== userId) {
      await notificationAggregatorService.recordNotification({
        recipientId: result.authorId,
        actorId: userId,
        verb: 'LIKE',
        targetType: 'POST',
        targetId: postId,
      });
    }

    // Outbound ActivityPub Federation for remote posts
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

      if (
        postRecord &&
        (postRecord.isRemote || postRecord.author?.isRemote || postRecord.federatedUri)
      ) {
        await this.handleOutboundLikeFederation(user, postRecord, result.liked);
      }
    } catch (err) {
      console.error('Error during outbound ActivityPub Like federation:', err);
    }

    return {
      liked: result.liked,
      likesCount: result.likesCount,
    };
  }

  /**
   * Enqueues ActivityPub Like or Undo(Like) for federated remote posts
   */
  private async handleOutboundLikeFederation(
    user: any,
    post: any,
    liked: boolean
  ): Promise<void> {
    const domain = activityPubKeyManagerService.getDomain();
    const protocol =
      domain.startsWith('localhost') || domain.startsWith('127.0.0.1') ? 'http' : 'https';
    const baseUrl = `${protocol}://${domain}`;
    const authorUri = `${baseUrl}/users/${user.username}`;
    const targetUri = post.federatedUri || `${baseUrl}/posts/${post.id}`;

    const targetActor = post.author?.federatedActor;
    let targetInboxUrl = targetActor?.inboxUrl || targetActor?.sharedInboxUrl;
    const targetActorUri =
      targetActor?.uri || (targetUri.startsWith('http') ? new URL(targetUri).origin : undefined);

    if (!targetInboxUrl && targetUri.startsWith('http')) {
      try {
        const u = new URL(targetUri);
        targetInboxUrl = `${u.protocol}//${u.host}/inbox`;
      } catch {
        // Fall through
      }
    }

    if (!targetInboxUrl) return;

    if (liked) {
      const activityId = `${baseUrl}/activities/like/${user.id}-${post.id}-${Date.now()}`;
      const likeActivity: any = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: activityId,
        type: 'Like',
        actor: authorUri,
        object: targetUri,
        to: [targetActorUri, 'https://www.w3.org/ns/activitystreams#Public'].filter(Boolean),
        cc: [`${authorUri}/followers`],
      };

      await activityDeliveryWorkerService.queueDelivery({
        activityId: likeActivity.id,
        activityType: 'Like',
        actorUri: authorUri,
        targetInboxUrl,
        payload: likeActivity,
      });
    } else {
      const undoActivityId = `${baseUrl}/activities/undo-like/${user.id}-${post.id}-${Date.now()}`;
      const undoActivity: any = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: undoActivityId,
        type: 'Undo',
        actor: authorUri,
        object: {
          id: `${baseUrl}/activities/like/${user.id}-${post.id}`,
          type: 'Like',
          actor: authorUri,
          object: targetUri,
        },
        to: [targetActorUri].filter(Boolean),
      };

      await activityDeliveryWorkerService.queueDelivery({
        activityId: undoActivity.id,
        activityType: 'Undo',
        actorUri: authorUri,
        targetInboxUrl,
        payload: undoActivity,
      });
    }
  }
}

export const toggleLikeService = new ToggleLikeService();

import { prisma } from '../../db/PrismaClientSingleton.js';
import { PostDto, ReplyPrivacy, UpdatePostInput } from '../../contracts/ApiContracts.js';
import { validateReplyPermissionService } from './ValidateReplyPermissionService.js';
import { activityDeliveryWorkerService } from '../federation/ActivityDeliveryWorkerService.js';
import { activityPubKeyManagerService } from '../federation/ActivityPubKeyManagerService.js';
import { ActivityPubActivity, ActivityPubNote } from '../../contracts/ActivityPubContracts.js';

export class PostNotFoundError extends Error {
  public code = 'POST_NOT_FOUND';
  public statusCode = 404;
  constructor(message = 'Post not found or unavailable') {
    super(message);
    this.name = 'PostNotFoundError';
  }
}

export class ForbiddenError extends Error {
  public code = 'FORBIDDEN';
  public statusCode = 403;
  constructor(message = 'You are not authorized to perform this action') {
    super(message);
    this.name = 'ForbiddenError';
  }
}

export class EditWindowExpiredError extends Error {
  public code = 'EDIT_WINDOW_EXPIRED';
  public statusCode = 403;
  constructor(message = 'Bài viết chỉ có thể chỉnh sửa trong vòng 15 phút sau khi đăng') {
    super(message);
    this.name = 'EditWindowExpiredError';
  }
}

export class ValidationError extends Error {
  public code: string;
  public statusCode = 400;
  constructor(message: string, code = 'INVALID_INPUT') {
    super(message);
    this.name = 'ValidationError';
    this.code = code;
  }
}

const ALLOWED_REPLY_PRIVACY: readonly ReplyPrivacy[] = ['EVERYONE', 'FOLLOWING', 'MENTIONED'] as const;

export function sanitizeContentWarning(raw: string | null | undefined): string | null {
  if (raw === undefined || raw === null) return null;
  let text = String(raw).trim();
  if (!text) return null;

  if (text.length > 500) {
    text = text.substring(0, 500);
  }

  // Iteratively strip HTML tags innermost-first to prevent nested bypasses (e.g. <<script>script>)
  let prev: string;
  do {
    prev = text;
    text = text.replace(/<[^<>]*>/g, '');
  } while (text !== prev);

  // Strip any remaining unclosed opening tags
  text = text.replace(/<[^<]*$/g, '').replace(/<[^>]*>?/gm, '');

  text = text.replace(/javascript:/gi, '');
  return text.trim() || null;
}

export class UpdatePostService {
  public async update(
    currentUserId: string,
    postId: string,
    input: UpdatePostInput
  ): Promise<PostDto> {
    const post = await prisma.post.findUnique({
      where: { id: postId },
      include: {
        author: {
          select: { id: true, username: true, displayName: true, avatarUrl: true, isCelebrity: true, pinnedPostId: true },
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

    if (!post || post.isDeleted) {
      throw new PostNotFoundError('Post not found or unavailable');
    }

    if (post.authorId !== currentUserId) {
      throw new ForbiddenError('You are not authorized to update this post');
    }

    // Enforce 15-minute edit window invariant (900,000 ms)
    const elapsedMs = Date.now() - post.createdAt.getTime();
    if (elapsedMs > 15 * 60 * 1000) {
      throw new EditWindowExpiredError('Bài viết chỉ có thể chỉnh sửa trong vòng 15 phút sau khi đăng');
    }

    const rawPrivacy = input.reply_privacy || input.replyPrivacy;
    let validatedPrivacy: ReplyPrivacy | undefined;

    if (rawPrivacy !== undefined) {
      const normalized = String(rawPrivacy).toUpperCase() as ReplyPrivacy;
      if (!ALLOWED_REPLY_PRIVACY.includes(normalized)) {
        throw new ValidationError(
          `Invalid reply_privacy setting: '${rawPrivacy}'. Allowed values: EVERYONE, FOLLOWING, MENTIONED`,
          'INVALID_REPLY_PRIVACY'
        );
      }
      validatedPrivacy = normalized;
    }

    let updatedContent: string | undefined;
    let newHashtags: string[] | undefined;
    let newMentions: string[] | undefined;

    if (input.content !== undefined) {
      updatedContent = input.content.trim();
      newHashtags = this.extractHashtags(updatedContent);
      newMentions = this.extractMentions(updatedContent);
    }

    // Sanitize content warning to prevent XSS payloads
    let sanitizedContentWarning: string | null | undefined;
    if (input.contentWarning !== undefined) {
      sanitizedContentWarning = sanitizeContentWarning(input.contentWarning);
    }

    const now = new Date();

    // Atomic transaction: lock row + snapshot previous version + update post + sync hashtags
    const updatedPost = await prisma.$transaction(async (tx) => {
      // Row-level lock to prevent concurrent race conditions
      await tx.$queryRaw`SELECT id FROM "Post" WHERE id = ${postId} FOR UPDATE`;

      const freshPost = await tx.post.findUniqueOrThrow({
        where: { id: postId },
      });

      if (freshPost.isDeleted) {
        throw new PostNotFoundError('Post not found or unavailable');
      }

      const currentEditCount = freshPost.editCount;
      const nextEditCount = currentEditCount + 1;

      // 1. Snapshot previous state into PostVersion (immutable audit trail)
      if (currentEditCount === 0) {
        // Snapshot initial/original version (version 1)
        await tx.postVersion.create({
          data: {
            postId: freshPost.id,
            versionNumber: 1,
            content: freshPost.content,
            mediaUrls: freshPost.mediaUrls,
            contentWarning: freshPost.contentWarning,
            isSensitive: freshPost.isSensitive,
            hashtags: freshPost.hashtags,
            mentions: freshPost.mentions,
            editorId: freshPost.authorId,
            createdAt: freshPost.createdAt,
          },
        });
      } else {
        // Snapshot intermediate version prior to this update
        await tx.postVersion.create({
          data: {
            postId: freshPost.id,
            versionNumber: currentEditCount + 1,
            content: freshPost.content,
            mediaUrls: freshPost.mediaUrls,
            contentWarning: freshPost.contentWarning,
            isSensitive: freshPost.isSensitive,
            hashtags: freshPost.hashtags,
            mentions: freshPost.mentions,
            editorId: currentUserId,
            createdAt: freshPost.lastEditedAt || freshPost.createdAt,
          },
        });
      }

      // 2. Update post state
      const p = await tx.post.update({
        where: { id: postId },
        data: {
          ...(validatedPrivacy ? { reply_privacy: validatedPrivacy } : {}),
          ...(updatedContent !== undefined ? { content: updatedContent, hashtags: newHashtags, mentions: newMentions } : {}),
          ...(input.mediaUrls !== undefined ? { mediaUrls: input.mediaUrls } : {}),
          ...(sanitizedContentWarning !== undefined ? { contentWarning: sanitizedContentWarning } : {}),
          ...(input.isSensitive !== undefined ? { isSensitive: Boolean(input.isSensitive) } : {}),
          isEdited: true,
          editCount: nextEditCount,
          lastEditedAt: now,
        },
        include: {
          author: {
            select: { id: true, username: true, displayName: true, avatarUrl: true, isCelebrity: true, pinnedPostId: true },
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

      // 3. Update Hashtag registry if hashtags changed
      if (updatedContent !== undefined && newHashtags) {
        const oldHashtags = new Set(freshPost.hashtags);
        const nextHashtagsSet = new Set(newHashtags);

        for (const tag of newHashtags) {
          if (!oldHashtags.has(tag)) {
            await tx.hashtag.upsert({
              where: { tag },
              create: { tag, postsCount: 1 },
              update: { postsCount: { increment: 1 } },
            });
          }
        }

        for (const tag of freshPost.hashtags) {
          if (!nextHashtagsSet.has(tag)) {
            await tx.hashtag.updateMany({
              where: { tag, postsCount: { gt: 0 } },
              data: { postsCount: { decrement: 1 } },
            });
          }
        }
      }

      return p;
    });

    // Enqueue ActivityPub Update Note delivery for remote Fediverse followers
    await this.enqueueFederatedUpdate(updatedPost).catch((err) => {
      console.error('Error enqueueing federated update delivery jobs:', err);
    });

    const [like, repost, bookmark] = await Promise.all([
      prisma.like.findUnique({
        where: { userId_postId: { userId: currentUserId, postId } },
      }),
      prisma.repost.findUnique({
        where: { userId_postId: { userId: currentUserId, postId } },
      }),
      prisma.bookmark.findUnique({
        where: { userId_postId: { userId: currentUserId, postId } },
      }),
    ]);

    const canReply = await validateReplyPermissionService.checkCanReply(currentUserId, updatedPost);
    const isPinned = updatedPost.author.pinnedPostId === updatedPost.id;

    return {
      id: updatedPost.id,
      authorId: updatedPost.authorId,
      content: updatedPost.content,
      mediaUrls: updatedPost.mediaUrls,
      replyToId: updatedPost.replyToId,
      rootPostId: updatedPost.rootPostId,
      repostOfId: updatedPost.repostOfId,
      quoteOfId: updatedPost.quoteOfId,
      reply_privacy: updatedPost.reply_privacy as ReplyPrivacy,
      replyPrivacy: updatedPost.reply_privacy as ReplyPrivacy,
      canReply,
      isEdited: updatedPost.isEdited,
      editCount: updatedPost.editCount,
      lastEditedAt: updatedPost.lastEditedAt ? updatedPost.lastEditedAt.toISOString() : null,
      isPinned,
      isSensitive: updatedPost.isSensitive,
      contentWarning: updatedPost.contentWarning,
      likesCount: updatedPost.likesCount,
      repliesCount: updatedPost.repliesCount,
      repostsCount: updatedPost.repostsCount,
      quotesCount: updatedPost.quotesCount,
      viewsCount: (updatedPost as any).viewsCount ?? 0,
      hashtags: updatedPost.hashtags,
      mentions: updatedPost.mentions,
      isLiked: !!like,
      isReposted: !!repost,
      isBookmarked: !!bookmark,
      createdAt: updatedPost.createdAt.toISOString(),
      author: updatedPost.author,
      replyTo: updatedPost.replyTo,
      quoteOf: updatedPost.quoteOf
        ? {
            id: updatedPost.quoteOf.id,
            authorId: updatedPost.quoteOf.authorId,
            content: updatedPost.quoteOf.content,
            mediaUrls: updatedPost.quoteOf.mediaUrls,
            replyToId: updatedPost.quoteOf.replyToId,
            rootPostId: updatedPost.quoteOf.rootPostId,
            repostOfId: updatedPost.quoteOf.repostOfId,
            quoteOfId: updatedPost.quoteOf.quoteOfId,
            reply_privacy: updatedPost.quoteOf.reply_privacy as ReplyPrivacy,
            replyPrivacy: updatedPost.quoteOf.reply_privacy as ReplyPrivacy,
            likesCount: updatedPost.quoteOf.likesCount,
            repliesCount: updatedPost.quoteOf.repliesCount,
            repostsCount: updatedPost.quoteOf.repostsCount,
            quotesCount: updatedPost.quoteOf.quotesCount,
            viewsCount: (updatedPost.quoteOf as any).viewsCount ?? 0,
            hashtags: updatedPost.quoteOf.hashtags,
            mentions: updatedPost.quoteOf.mentions,
            createdAt: updatedPost.quoteOf.createdAt.toISOString(),
            author: updatedPost.quoteOf.author,
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

  private async enqueueFederatedUpdate(post: any): Promise<void> {
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

    const updateActivity: ActivityPubActivity = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: `${baseUrl}/activities/update-${post.id}-${post.editCount}`,
      type: 'Update',
      actor: authorUri,
      published: (post.lastEditedAt || new Date()).toISOString(),
      to: ['https://www.w3.org/ns/activitystreams#Public'],
      cc: [`${authorUri}/followers`],
      object: note,
    };

    for (const inbox of targetInboxes) {
      await activityDeliveryWorkerService.queueDelivery({
        activityId: updateActivity.id,
        activityType: 'Update',
        actorUri: authorUri,
        targetInboxUrl: inbox,
        payload: updateActivity,
      });
    }
  }
}

export const updatePostService = new UpdatePostService();

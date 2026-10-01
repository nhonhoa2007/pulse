import { prisma } from '../../db/PrismaClientSingleton.js';
import {
  ActivityPubOrderedCollection,
  ActivityPubOrderedCollectionPage,
  ActivityPubActivity,
  ActivityPubNote,
} from '../../contracts/ActivityPubContracts.js';
import { activityPubKeyManagerService } from './ActivityPubKeyManagerService.js';

export class FetchActivityPubOutboxService {
  /**
   * Retrieves user's outbox collection or page
   */
  public async getUserOutbox(
    username: string,
    isPage: boolean,
    hostHeader?: string
  ): Promise<ActivityPubOrderedCollection | ActivityPubOrderedCollectionPage | null> {
    const domain = activityPubKeyManagerService.getDomain(hostHeader);
    const protocol = domain.startsWith('localhost') ? 'http' : 'https';
    const baseUrl = `${protocol}://${domain}`;
    const userUri = `${baseUrl}/users/${username}`;
    const outboxUri = `${userUri}/outbox`;

    const user = await prisma.user.findFirst({
      where: {
        username: {
          equals: username,
          mode: 'insensitive',
        },
        isRemote: false,
      },
    });

    if (!user) {
      return null;
    }

    // TASK-21 Privacy Gate: Private accounts have empty public outbox to prevent Fediverse data leakage
    if (user.isPrivate) {
      if (!isPage) {
        return {
          '@context': 'https://www.w3.org/ns/activitystreams',
          id: outboxUri,
          type: 'OrderedCollection',
          totalItems: 0,
          first: `${outboxUri}?page=true`,
        };
      }
      return {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: `${outboxUri}?page=true`,
        type: 'OrderedCollectionPage',
        partOf: outboxUri,
        totalItems: 0,
        orderedItems: [],
      };
    }

    const totalItems = await prisma.post.count({
      where: {
        authorId: user.id,
        isDeleted: false,
      },
    });

    if (!isPage) {
      const collection: ActivityPubOrderedCollection = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: outboxUri,
        type: 'OrderedCollection',
        totalItems,
        first: `${outboxUri}?page=true`,
      };
      return collection;
    }

    // Page query: fetch recent 20 posts
    const posts = await prisma.post.findMany({
      where: {
        authorId: user.id,
        isDeleted: false,
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    const orderedItems: ActivityPubActivity<ActivityPubNote>[] = posts.map((post) => {
      const note: ActivityPubNote = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: `${baseUrl}/posts/${post.id}`,
        type: 'Note',
        attributedTo: userUri,
        content: post.content,
        published: post.createdAt.toISOString(),
        to: ['https://www.w3.org/ns/activitystreams#Public'],
        cc: [`${userUri}/followers`],
        ...(post.contentWarning ? { summary: post.contentWarning } : {}),
        ...(post.isSensitive ? { sensitive: true } : {}),
      };

      return {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: `${baseUrl}/activities/${post.id}`,
        type: 'Create',
        actor: userUri,
        published: post.createdAt.toISOString(),
        to: ['https://www.w3.org/ns/activitystreams#Public'],
        cc: [`${userUri}/followers`],
        object: note,
      };
    });

    const page: ActivityPubOrderedCollectionPage = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: `${outboxUri}?page=true`,
      type: 'OrderedCollectionPage',
      partOf: outboxUri,
      totalItems,
      orderedItems,
    };

    return page;
  }

  /**
   * Retrieves the instance actor outbox (empty OrderedCollection)
   */
  public getInstanceOutbox(hostHeader?: string): ActivityPubOrderedCollection {
    const domain = activityPubKeyManagerService.getDomain(hostHeader);
    const protocol = domain.startsWith('localhost') ? 'http' : 'https';
    const outboxUri = `${protocol}://${domain}/actor/outbox`;

    return {
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: outboxUri,
      type: 'OrderedCollection',
      totalItems: 0,
    };
  }
}

export const fetchActivityPubOutboxService = new FetchActivityPubOutboxService();

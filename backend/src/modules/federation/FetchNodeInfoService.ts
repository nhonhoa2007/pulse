import { prisma } from '../../db/PrismaClientSingleton.js';
import { activityPubKeyManagerService } from './ActivityPubKeyManagerService.js';
import {
  NodeInfoWellKnownResponse,
  NodeInfo21Response,
  NodeInfo20Response,
  NodeInfoUsage,
} from '../../contracts/ActivityPubContracts.js';

export class FetchNodeInfoService {
  private cachedUsage: { timestamp: number; data: NodeInfoUsage } | null = null;
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  /**
   * Generates FEP-0151 discovery document for GET /.well-known/nodeinfo
   */
  public getWellKnown(hostHeader?: string): NodeInfoWellKnownResponse {
    const domain = activityPubKeyManagerService.getDomain(hostHeader);
    const protocol =
      domain.startsWith('localhost') || domain.startsWith('127.0.0.1') ? 'http' : 'https';
    const baseUrl = `${protocol}://${domain}`;

    return {
      links: [
        {
          rel: 'http://nodeinfo.diaspora.software/ns/schema/2.1',
          href: `${baseUrl}/nodeinfo/2.1`,
        },
        {
          rel: 'http://nodeinfo.diaspora.software/ns/schema/2.0',
          href: `${baseUrl}/nodeinfo/2.0`,
        },
      ],
    };
  }

  /**
   * Aggregates usage statistics with in-memory caching to protect DB performance
   */
  public async getUsageStats(bypassCache = false): Promise<NodeInfoUsage> {
    const isTest = process.env.NODE_ENV === 'test';
    const now = Date.now();

    if (!isTest && !bypassCache && this.cachedUsage) {
      if (now - this.cachedUsage.timestamp < this.CACHE_TTL_MS) {
        return this.cachedUsage.data;
      }
    }

    const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);
    const halfYearAgo = new Date(now - 180 * 24 * 60 * 60 * 1000);

    const [totalUsers, activeHalfyear, activeMonth, localPosts, localComments] =
      await Promise.all([
        // Total internal users (excluding remote Fediverse shadow users)
        prisma.user.count({
          where: { isRemote: false },
        }),
        // Users active in past 180 days
        prisma.user.count({
          where: {
            isRemote: false,
            updatedAt: { gte: halfYearAgo },
          },
        }),
        // Users active in past 30 days
        prisma.user.count({
          where: {
            isRemote: false,
            updatedAt: { gte: thirtyDaysAgo },
          },
        }),
        // Original posts originating from this server
        prisma.post.count({
          where: {
            replyToId: null,
            isDeleted: false,
            isRemote: false,
            author: { isRemote: false },
          },
        }),
        // Comments/replies originating from this server
        prisma.post.count({
          where: {
            replyToId: { not: null },
            isDeleted: false,
            isRemote: false,
            author: { isRemote: false },
          },
        }),
      ]);

    const usage: NodeInfoUsage = {
      users: {
        total: totalUsers,
        activeHalfyear,
        activeMonth,
      },
      localPosts,
      localComments,
    };

    this.cachedUsage = {
      timestamp: now,
      data: usage,
    };

    return usage;
  }

  /**
   * Returns NodeInfo document conforming to schema 2.1 or 2.0
   */
  public async getNodeInfo(
    version: '2.1' | '2.0',
    hostHeader?: string,
    bypassCache = false
  ): Promise<NodeInfo21Response | NodeInfo20Response> {
    const domain = activityPubKeyManagerService.getDomain(hostHeader);
    const protocol =
      domain.startsWith('localhost') || domain.startsWith('127.0.0.1') ? 'http' : 'https';
    const baseUrl = `${protocol}://${domain}`;

    const usage = await this.getUsageStats(bypassCache);

    const baseDoc = {
      software: {
        name: 'pulse',
        version: '1.0.0',
        repository: 'https://github.com/nhonhoa/pulse',
        homepage: 'https://pulse.social',
      },
      protocols: ['activitypub'],
      services: {
        inbound: [],
        outbound: [],
      },
      openRegistrations: true,
      usage,
      metadata: {
        nodeName: 'Pulse Social',
        nodeDescription:
          'A decentralized high-concurrency microblogging engine federating with Fediverse.',
        staffAccounts: [`${baseUrl}/users/admin`],
        federation: {
          enabled: true,
        },
        theme: 'light',
        features: [
          'polls',
          'reply_privacy',
          'version_history',
          'content_warnings',
          'muting',
          'pinning',
          'bookmarks',
        ],
      },
    };

    if (version === '2.0') {
      return {
        version: '2.0',
        ...baseDoc,
      };
    }

    return {
      version: '2.1',
      ...baseDoc,
    };
  }
}

export const fetchNodeInfoService = new FetchNodeInfoService();

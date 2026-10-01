import { prisma } from '../../db/PrismaClientSingleton.js';
import { WebFingerResponse } from '../../contracts/ActivityPubContracts.js';
import { activityPubKeyManagerService } from './ActivityPubKeyManagerService.js';

export interface WebFingerResolutionError {
  statusCode: number;
  code: string;
  message: string;
}

export class ResolveWebFingerQueryService {
  /**
   * Checks whether the queried domain matches this instance's domain
   */
  private isDomainMatch(targetDomain: string, localDomain: string): boolean {
    const t = targetDomain.toLowerCase();
    const l = localDomain.toLowerCase();

    if (t === l) return true;

    // Handle port stripping if needed (e.g. localhost:3001 vs localhost)
    const tNoPort = t.split(':')[0];
    const lNoPort = l.split(':')[0];
    if (tNoPort === lNoPort) return true;

    return false;
  }

  /**
   * Resolves a WebFinger resource string into an ActivityPub JRD response
   */
  public async resolve(
    resourceRaw: string | undefined,
    hostHeader?: string
  ): Promise<{ response?: WebFingerResponse; error?: WebFingerResolutionError }> {
    if (!resourceRaw || typeof resourceRaw !== 'string' || !resourceRaw.trim()) {
      return {
        error: {
          statusCode: 400,
          code: 'MISSING_RESOURCE',
          message: "Query parameter 'resource' is required (e.g. acct:alice@pulse.social)",
        },
      };
    }

    const serverDomain = activityPubKeyManagerService.getDomain(hostHeader);
    const cleanResource = resourceRaw.trim();

    let extractedUsername: string | null = null;
    let extractedDomain: string | null = null;

    if (cleanResource.startsWith('acct:')) {
      const acctPart = cleanResource.slice(5).trim();
      const parts = acctPart.split('@').filter(Boolean);
      if (parts.length === 1) {
        extractedUsername = parts[0];
      } else if (parts.length === 2) {
        extractedUsername = parts[0];
        extractedDomain = parts[1];
      }
    } else if (cleanResource.startsWith('@')) {
      const parts = cleanResource.slice(1).split('@').filter(Boolean);
      if (parts.length === 1) {
        extractedUsername = parts[0];
      } else if (parts.length === 2) {
        extractedUsername = parts[0];
        extractedDomain = parts[1];
      }
    } else if (cleanResource.startsWith('http://') || cleanResource.startsWith('https://')) {
      try {
        const parsedUrl = new URL(cleanResource);
        extractedDomain = parsedUrl.host;
        const pathname = parsedUrl.pathname;
        if (pathname.startsWith('/users/')) {
          extractedUsername = pathname.slice(7).split('/')[0];
        } else if (pathname.startsWith('/@')) {
          extractedUsername = pathname.slice(2).split('/')[0];
        }
      } catch {
        return {
          error: {
            statusCode: 400,
            code: 'INVALID_RESOURCE_URI',
            message: 'Resource URI is malformed',
          },
        };
      }
    } else if (cleanResource.includes('@')) {
      const parts = cleanResource.split('@').filter(Boolean);
      if (parts.length === 2) {
        extractedUsername = parts[0];
        extractedDomain = parts[1];
      }
    } else {
      extractedUsername = cleanResource;
    }

    if (!extractedUsername) {
      return {
        error: {
          statusCode: 400,
          code: 'INVALID_RESOURCE_FORMAT',
          message: 'Could not extract username from resource parameter',
        },
      };
    }

    // If a domain is specified, verify it matches our domain
    if (extractedDomain && !this.isDomainMatch(extractedDomain, serverDomain)) {
      return {
        error: {
          statusCode: 404,
          code: 'DOMAIN_MISMATCH',
          message: `Resource domain '${extractedDomain}' does not belong to this server (${serverDomain})`,
        },
      };
    }

    // Look up local user
    const user = await prisma.user.findFirst({
      where: {
        username: {
          equals: extractedUsername,
          mode: 'insensitive',
        },
        isRemote: false,
      },
    });

    if (!user) {
      return {
        error: {
          statusCode: 404,
          code: 'USER_NOT_FOUND',
          message: `User '${extractedUsername}' not found on this server`,
        },
      };
    }

    const canonicalDomain = extractedDomain || serverDomain;
    const protocol = canonicalDomain.startsWith('localhost') ? 'http' : 'https';

    const jrdResponse: WebFingerResponse = {
      subject: `acct:${user.username}@${canonicalDomain}`,
      aliases: [
        `${protocol}://${canonicalDomain}/@${user.username}`,
        `${protocol}://${canonicalDomain}/users/${user.username}`,
      ],
      links: [
        {
          rel: 'http://webfinger.net/rel/profile-page',
          type: 'text/html',
          href: `${protocol}://${canonicalDomain}/@${user.username}`,
        },
        {
          rel: 'self',
          type: 'application/activity+json',
          href: `${protocol}://${canonicalDomain}/users/${user.username}`,
        },
      ],
    };

    return { response: jrdResponse };
  }
}

export const resolveWebFingerQueryService = new ResolveWebFingerQueryService();

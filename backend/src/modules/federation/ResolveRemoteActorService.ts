import crypto from 'crypto';
import { prisma } from '../../db/PrismaClientSingleton.js';
import { ssrfProtectionGuardService } from './SsrfProtectionGuardService.js';
import { activityPubKeyManagerService } from './ActivityPubKeyManagerService.js';
import { sanitizeFederatedHtml } from './SanitizeFederatedHtml.js';

export interface ResolveRemoteActorOptions {
  allowPrivateForTesting?: boolean;
}

export interface ResolveRemoteActorResponseData {
  user: {
    id: string;
    username: string;
    displayName: string;
    avatarUrl: string | null;
    bio: string | null;
    isCelebrity: boolean;
    followersCount: number;
    followingCount: number;
    postsCount: number;
    isRemote: boolean;
    domain: string;
    actorUri: string;
    isFollowing: boolean;
    createdAt: string;
  };
  actor: {
    uri: string;
    username: string;
    domain: string;
    inboxUrl: string;
    sharedInboxUrl: string | null;
  };
}

export class ResolveRemoteActorService {
  /**
   * Parses handle or URL into username and domain components
   */
  public parseHandleOrUrl(input: string): {
    username?: string;
    domain?: string;
    isUrl: boolean;
    url?: string;
  } {
    const trimmed = input.trim();

    // Check URL pattern
    if (/^https?:\/\//i.test(trimmed)) {
      try {
        const parsed = new URL(trimmed);
        const domain = parsed.host.toLowerCase();
        const pathParts = parsed.pathname.split('/').filter(Boolean);
        let username = pathParts[pathParts.length - 1] || 'remote_actor';
        if (username.startsWith('@')) {
          username = username.slice(1);
        }
        return {
          username,
          domain,
          isUrl: true,
          url: trimmed,
        };
      } catch {
        // Fall through
      }
    }

    // Fediverse handle pattern: @user@domain or user@domain or acct:user@domain
    let clean = trimmed;
    if (clean.startsWith('acct:')) {
      clean = clean.slice(5).trim();
    }
    if (clean.startsWith('@')) {
      clean = clean.slice(1).trim();
    }

    const parts = clean.split('@');
    if (parts.length === 2 && parts[0].trim() && parts[1].trim()) {
      return {
        username: parts[0].trim(),
        domain: parts[1].trim().toLowerCase(),
        isUrl: false,
      };
    }

    if (parts.length === 1 && parts[0].trim()) {
      return {
        username: parts[0].trim(),
        isUrl: false,
      };
    }

    return { isUrl: false };
  }

  /**
   * Resolves a remote federated actor by handle or actor URI, creates shadow user, and caches in DB.
   */
  public async resolveActor(
    handleOrUrl: string,
    currentUserId?: string | null,
    options: ResolveRemoteActorOptions = {}
  ): Promise<ResolveRemoteActorResponseData> {
    if (!handleOrUrl || typeof handleOrUrl !== 'string' || !handleOrUrl.trim()) {
      const error: any = new Error("Field 'handle' is required");
      error.code = 'INVALID_HANDLE';
      error.statusCode = 400;
      throw error;
    }

    const parsed = this.parseHandleOrUrl(handleOrUrl);
    if (!parsed.domain && !parsed.isUrl) {
      // Local user lookup fallback
      if (parsed.username) {
        const localUser = await prisma.user.findFirst({
          where: {
            username: { equals: parsed.username, mode: 'insensitive' },
            isRemote: false,
          },
        });
        if (localUser) {
          const domain = activityPubKeyManagerService.getDomain();
          const protocol = domain.startsWith('localhost') ? 'http' : 'https';
          const baseUrl = `${protocol}://${domain}`;
          const actorUri = `${baseUrl}/users/${localUser.username}`;

          let isFollowing = false;
          if (currentUserId && currentUserId !== localUser.id) {
            const follow = await prisma.follow.findUnique({
              where: {
                followerId_followingId: {
                  followerId: currentUserId,
                  followingId: localUser.id,
                },
              },
            });
            isFollowing = !!follow;
          }

          return {
            user: {
              id: localUser.id,
              username: localUser.username,
              displayName: localUser.displayName,
              avatarUrl: localUser.avatarUrl,
              bio: localUser.bio,
              isCelebrity: localUser.isCelebrity,
              followersCount: localUser.followersCount,
              followingCount: localUser.followingCount,
              postsCount: localUser.postsCount,
              isRemote: false,
              domain,
              actorUri,
              isFollowing,
              createdAt: localUser.createdAt.toISOString(),
            },
            actor: {
              uri: actorUri,
              username: localUser.username,
              domain,
              inboxUrl: `${actorUri}/inbox`,
              sharedInboxUrl: `${baseUrl}/inbox`,
            },
          };
        }
      }

      const error: any = new Error(
        'Invalid Fediverse handle or URL format. Expected @username@domain or https://domain/users/username'
      );
      error.code = 'INVALID_HANDLE_FORMAT';
      error.statusCode = 400;
      throw error;
    }

    const domain = parsed.domain || (parsed.url ? new URL(parsed.url).host.toLowerCase() : '');
    const localDomain = activityPubKeyManagerService.getDomain();

    // Check if domain matches local server domain
    if (domain === localDomain.toLowerCase()) {
      if (parsed.username) {
        const localUser = await prisma.user.findFirst({
          where: {
            username: { equals: parsed.username, mode: 'insensitive' },
            isRemote: false,
          },
        });
        if (localUser) {
          const protocol = domain.startsWith('localhost') ? 'http' : 'https';
          const baseUrl = `${protocol}://${domain}`;
          const actorUri = `${baseUrl}/users/${localUser.username}`;

          let isFollowing = false;
          if (currentUserId && currentUserId !== localUser.id) {
            const follow = await prisma.follow.findUnique({
              where: {
                followerId_followingId: {
                  followerId: currentUserId,
                  followingId: localUser.id,
                },
              },
            });
            isFollowing = !!follow;
          }

          return {
            user: {
              id: localUser.id,
              username: localUser.username,
              displayName: localUser.displayName,
              avatarUrl: localUser.avatarUrl,
              bio: localUser.bio,
              isCelebrity: localUser.isCelebrity,
              followersCount: localUser.followersCount,
              followingCount: localUser.followingCount,
              postsCount: localUser.postsCount,
              isRemote: false,
              domain,
              actorUri,
              isFollowing,
              createdAt: localUser.createdAt.toISOString(),
            },
            actor: {
              uri: actorUri,
              username: localUser.username,
              domain,
              inboxUrl: `${actorUri}/inbox`,
              sharedInboxUrl: `${baseUrl}/inbox`,
            },
          };
        }
      }
    }

    // 1. Check Cache in PostgreSQL (FederatedActor & shadow User)
    const cachedActor = await prisma.federatedActor.findFirst({
      where: parsed.isUrl
        ? { uri: parsed.url }
        : {
            domain: { equals: domain, mode: 'insensitive' },
            username: { equals: parsed.username!, mode: 'insensitive' },
          },
      include: {
        shadowUser: true,
      },
    });

    if (cachedActor && cachedActor.shadowUser) {
      let isFollowing = false;
      if (currentUserId) {
        const [directFollow, fedFollow] = await Promise.all([
          prisma.follow.findUnique({
            where: {
              followerId_followingId: {
                followerId: currentUserId,
                followingId: cachedActor.shadowUser.id,
              },
            },
          }),
          prisma.federatedFollow.findFirst({
            where: {
              localUserId: currentUserId,
              remoteActorId: cachedActor.id,
              direction: 'OUTBOUND',
              status: 'ACCEPTED',
            },
          }),
        ]);
        isFollowing = !!directFollow || !!fedFollow;
      }

      return {
        user: {
          id: cachedActor.shadowUser.id,
          username: cachedActor.shadowUser.username,
          displayName: cachedActor.shadowUser.displayName,
          avatarUrl: cachedActor.shadowUser.avatarUrl,
          bio: cachedActor.shadowUser.bio,
          isCelebrity: cachedActor.shadowUser.isCelebrity,
          followersCount: cachedActor.shadowUser.followersCount,
          followingCount: cachedActor.shadowUser.followingCount,
          postsCount: cachedActor.shadowUser.postsCount,
          isRemote: true,
          domain: cachedActor.domain,
          actorUri: cachedActor.uri,
          isFollowing,
          createdAt: cachedActor.shadowUser.createdAt.toISOString(),
        },
        actor: {
          uri: cachedActor.uri,
          username: cachedActor.username,
          domain: cachedActor.domain,
          inboxUrl: cachedActor.inboxUrl,
          sharedInboxUrl: cachedActor.sharedInboxUrl,
        },
      };
    }

    // 2. SSRF Guard Check on destination
    const cleanHost = domain.replace(/^\[|\]$/g, '').trim().toLowerCase();

    let hostOnly = cleanHost;
    let portNum = 0;

    if (parsed.isUrl && parsed.url) {
      try {
        const u = new URL(parsed.url);
        hostOnly = u.hostname.replace(/^\[|\]$/g, '').trim().toLowerCase();
        portNum = parseInt(u.port, 10) || (u.protocol === 'https:' ? 443 : 80);
      } catch {
        // Fallback
      }
    } else if (cleanHost.includes(':')) {
      const lastColon = cleanHost.lastIndexOf(':');
      hostOnly = cleanHost.slice(0, lastColon).replace(/^\[|\]$/g, '').trim().toLowerCase();
      portNum = parseInt(cleanHost.slice(lastColon + 1), 10) || 0;
    }

    // Strict block on Cloud metadata services under all conditions
    const isCloudMeta =
      hostOnly === '169.254.169.254' ||
      hostOnly === 'metadata.google.internal' ||
      hostOnly === 'metadata.internal' ||
      hostOnly === '169.254.170.2' ||
      hostOnly.includes('169.254.169.254');

    if (isCloudMeta) {
      const error: any = new Error(
        'SSRF_GUARD_BLOCKED: Cloud metadata endpoints are strictly prohibited'
      );
      error.code = 'SSRF_GUARD_BLOCKED';
      error.statusCode = 400;
      throw error;
    }

    // In test environment with ALLOW_HTTP_FEDERATION=true, permit local mock test instances on ephemeral non-privileged ports (> 1024)
    const isMockTestServer =
      (process.env.ALLOW_HTTP_FEDERATION === 'true' || process.env.NODE_ENV === 'test') &&
      (hostOnly === '127.0.0.1' || hostOnly === 'localhost') &&
      portNum > 1024;

    const allowTesting = options.allowPrivateForTesting === true || isMockTestServer;

    if (!allowTesting) {
      if (hostOnly === 'localhost' || ssrfProtectionGuardService.isPrivateIp(hostOnly)) {
        const error: any = new Error(
          `SSRF_GUARD_BLOCKED: Destination '${hostOnly}' is a private, loopback, or reserved IP address`
        );
        error.code = 'SSRF_GUARD_BLOCKED';
        error.statusCode = 400;
        throw error;
      }
    }

    const testUrl = parsed.isUrl
      ? parsed.url!
      : `http://${domain}/.well-known/webfinger?resource=acct:${encodeURIComponent(parsed.username!)}@${domain}`;

    const ssrfCheck = await ssrfProtectionGuardService.isSafeUrl(testUrl, {
      allowPrivateForTesting: allowTesting,
    });

    if (!ssrfCheck.safe) {
      const error: any = new Error(
        `SSRF_GUARD_BLOCKED: ${ssrfCheck.error || 'Destination rejected by SSRF guard'}`
      );
      error.code = 'SSRF_GUARD_BLOCKED';
      error.statusCode = 400;
      throw error;
    }

    // 3. WebFinger Fetch (if handle) or direct Actor JSON-LD fetch (if URL)
    let actorUri: string;

    if (parsed.isUrl && parsed.url) {
      actorUri = parsed.url;
    } else {
      const protocol =
        domain.startsWith('localhost') || domain.startsWith('127.0.0.1') ? 'http' : 'https';
      const webfingerUrl = `${protocol}://${domain}/.well-known/webfinger?resource=acct:${encodeURIComponent(parsed.username!)}@${domain}`;

      let webfingerRes: any;
      try {
        webfingerRes = await ssrfProtectionGuardService.safeFederatedFetch(webfingerUrl, {
          headers: {
            Accept: 'application/jrd+json, application/json',
          },
          timeoutMs: 5000,
          maxResponseSizeBytes: 1048576,
          allowPrivateForTesting: allowTesting,
        });
      } catch (err: any) {
        const error: any = new Error(`WebFinger resolution failed: ${err?.message}`);
        error.code = 'REMOTE_ACTOR_NOT_FOUND';
        error.statusCode = 404;
        throw error;
      }

      if (!webfingerRes.ok) {
        const error: any = new Error(
          `Remote WebFinger endpoint returned HTTP ${webfingerRes.status}`
        );
        error.code = 'REMOTE_ACTOR_NOT_FOUND';
        error.statusCode = 404;
        throw error;
      }

      const jrdDoc = await webfingerRes.json();
      const links = Array.isArray(jrdDoc?.links) ? jrdDoc.links : [];

      const selfLink =
        links.find(
          (l: any) =>
            l.rel === 'self' &&
            (l.type?.includes('activity+json') || l.type?.includes('ld+json'))
        ) || links.find((l: any) => l.rel === 'self');

      if (!selfLink || !selfLink.href) {
        const error: any = new Error(
          "WebFinger response did not contain an ActivityPub 'self' link"
        );
        error.code = 'ACTOR_URI_NOT_FOUND';
        error.statusCode = 404;
        throw error;
      }

      actorUri = selfLink.href;
    }

    // Validate SSRF on actorUri
    const actorSsrfCheck = await ssrfProtectionGuardService.isSafeUrl(actorUri, {
      allowPrivateForTesting: allowTesting,
    });
    if (!actorSsrfCheck.safe) {
      const error: any = new Error(
        `SSRF_GUARD_BLOCKED: Actor URI is unsafe (${actorSsrfCheck.error})`
      );
      error.code = 'SSRF_GUARD_BLOCKED';
      error.statusCode = 400;
      throw error;
    }

    // 4. Fetch Remote Actor JSON-LD
    let actorDocRes: any;
    try {
      actorDocRes = await ssrfProtectionGuardService.safeFederatedFetch(actorUri, {
        headers: {
          Accept:
            'application/activity+json, application/ld+json; profile="https://www.w3.org/ns/activitystreams"',
        },
        timeoutMs: 5000,
        maxResponseSizeBytes: 1048576,
        allowPrivateForTesting: allowTesting,
      });
    } catch (err: any) {
      const error: any = new Error(`Failed to fetch Actor document: ${err?.message}`);
      error.code = 'REMOTE_ACTOR_FETCH_FAILED';
      error.statusCode = 404;
      throw error;
    }

    if (!actorDocRes.ok) {
      const error: any = new Error(
        `Actor document endpoint returned HTTP ${actorDocRes.status}`
      );
      error.code = 'REMOTE_ACTOR_FETCH_FAILED';
      error.statusCode = 404;
      throw error;
    }

    const actorData = await actorDocRes.json();
    const validTypes = ['Person', 'Application', 'Service', 'Group', 'Organization'];
    if (!actorData || !validTypes.includes(actorData.type)) {
      const error: any = new Error(
        `Invalid or unsupported Actor type: '${actorData?.type}'`
      );
      error.code = 'INVALID_ACTOR_TYPE';
      error.statusCode = 400;
      throw error;
    }

    // Extract and sanitize actor properties
    const rawUsername =
      actorData.preferredUsername || parsed.username || 'remote_user';
    const cleanUsername = sanitizeFederatedHtml(rawUsername)
      .replace(/[<>'"/\\&`$]/g, '')
      .trim();
    const actorUsername = cleanUsername || 'remote_user';

    const actorDomain = domain || new URL(actorUri).host.toLowerCase();
    const rawDisplayName = actorData.name || actorUsername;
    const rawBio = actorData.summary || '';

    const sanitizedDisplayName = sanitizeFederatedHtml(rawDisplayName).trim();
    const sanitizedBio = sanitizeFederatedHtml(rawBio).trim();

    let avatarUrl: string | null = null;
    if (typeof actorData.icon === 'object' && actorData.icon?.url) {
      avatarUrl = actorData.icon.url;
    } else if (typeof actorData.icon === 'string') {
      avatarUrl = actorData.icon;
    }

    const inboxUrl =
      actorData.inbox ||
      `${actorUri.replace(/\/+$/, '')}/inbox`;
    const sharedInboxUrl =
      actorData.endpoints?.sharedInbox || actorData.sharedInbox || null;
    const publicKeyPem =
      typeof actorData.publicKey?.publicKeyPem === 'string'
        ? actorData.publicKey.publicKeyPem
        : '';
    const publicKeyId =
      actorData.publicKey?.id || `${actorUri}#main-key`;

    // 5. Prisma Transaction: Upsert FederatedActor & Shadow User
    const { federatedActor, shadowUser } = await prisma.$transaction(
      async (tx) => {
        const actor = await tx.federatedActor.upsert({
          where: { uri: actorUri },
          update: {
            username: actorUsername,
            domain: actorDomain,
            name: sanitizedDisplayName,
            summary: sanitizedBio,
            avatarUrl,
            inboxUrl,
            sharedInboxUrl,
            publicKeyPem,
            publicKeyId,
            lastFetchedAt: new Date(),
          },
          create: {
            uri: actorUri,
            username: actorUsername,
            domain: actorDomain,
            name: sanitizedDisplayName,
            summary: sanitizedBio,
            avatarUrl,
            inboxUrl,
            sharedInboxUrl,
            publicKeyPem,
            publicKeyId,
            lastFetchedAt: new Date(),
          },
        });

        let user = await tx.user.findFirst({
          where: { federatedActorId: actor.id },
        });

        if (!user) {
          const cleanDomain = actorDomain.replace(/[^a-zA-Z0-9]/g, '_');
          const cleanUser = actorUsername.replace(/[^a-zA-Z0-9]/g, '_');
          const baseName = `${cleanUser}_${cleanDomain}`.slice(0, 45);
          const rand = crypto.randomBytes(3).toString('hex');
          const shadowUsername = `${baseName}_${rand}`;
          const shadowEmail = `${shadowUsername}@remote-shadow.fediverse`;

          user = await tx.user.create({
            data: {
              username: shadowUsername,
              email: shadowEmail,
              displayName: sanitizedDisplayName || actorUsername,
              avatarUrl,
              bio:
                sanitizedBio ||
                `Remote Fediverse user @${actorUsername}@${actorDomain}`,
              isRemote: true,
              federatedActorId: actor.id,
            },
          });
        } else {
          user = await tx.user.update({
            where: { id: user.id },
            data: {
              displayName: sanitizedDisplayName || actorUsername || user.displayName,
              avatarUrl: avatarUrl || user.avatarUrl,
              bio: sanitizedBio || user.bio,
            },
          });
        }

        return { federatedActor: actor, shadowUser: user };
      },
      { timeout: 15000 }
    );

    // 6. Check following relationship
    let isFollowing = false;
    if (currentUserId) {
      const [directFollow, fedFollow] = await Promise.all([
        prisma.follow.findUnique({
          where: {
            followerId_followingId: {
              followerId: currentUserId,
              followingId: shadowUser.id,
            },
          },
        }),
        prisma.federatedFollow.findFirst({
          where: {
            localUserId: currentUserId,
            remoteActorId: federatedActor.id,
            direction: 'OUTBOUND',
            status: 'ACCEPTED',
          },
        }),
      ]);
      isFollowing = !!directFollow || !!fedFollow;
    }

    return {
      user: {
        id: shadowUser.id,
        username: shadowUser.username,
        displayName: shadowUser.displayName,
        avatarUrl: shadowUser.avatarUrl,
        bio: shadowUser.bio,
        isCelebrity: shadowUser.isCelebrity,
        followersCount: shadowUser.followersCount,
        followingCount: shadowUser.followingCount,
        postsCount: shadowUser.postsCount,
        isRemote: true,
        domain: federatedActor.domain,
        actorUri: federatedActor.uri,
        isFollowing,
        createdAt: shadowUser.createdAt.toISOString(),
      },
      actor: {
        uri: federatedActor.uri,
        username: federatedActor.username,
        domain: federatedActor.domain,
        inboxUrl: federatedActor.inboxUrl,
        sharedInboxUrl: federatedActor.sharedInboxUrl,
      },
    };
  }
}

export const resolveRemoteActorService = new ResolveRemoteActorService();

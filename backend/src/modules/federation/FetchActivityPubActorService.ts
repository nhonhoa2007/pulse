import { prisma } from '../../db/PrismaClientSingleton.js';
import { ActivityPubActor } from '../../contracts/ActivityPubContracts.js';
import { activityPubKeyManagerService } from './ActivityPubKeyManagerService.js';

export class FetchActivityPubActorService {
  /**
   * Builds the JSON-LD Application actor representing the entire Pulse instance
   */
  public async getInstanceActor(hostHeader?: string): Promise<ActivityPubActor> {
    const domain = activityPubKeyManagerService.getDomain(hostHeader);
    const protocol = domain.startsWith('localhost') ? 'http' : 'https';
    const baseUrl = `${protocol}://${domain}`;

    const instanceKey = await activityPubKeyManagerService.getOrCreateInstanceKey(domain);

    const actorDoc: ActivityPubActor = {
      '@context': [
        'https://www.w3.org/ns/activitystreams',
        'https://w3id.org/security/v1',
      ],
      id: `${baseUrl}/actor`,
      type: 'Application',
      preferredUsername: domain,
      name: 'Pulse Social Fediverse Bridge',
      summary: `Instance actor for ${domain}`,
      inbox: `${baseUrl}/inbox`,
      outbox: `${baseUrl}/actor/outbox`,
      publicKey: {
        id: `${baseUrl}/actor#main-key`,
        owner: `${baseUrl}/actor`,
        publicKeyPem: instanceKey.publicKeyPem,
      },
    };

    return actorDoc;
  }

  /**
   * Builds the JSON-LD Person actor representing a specific Pulse user
   */
  public async getUserActor(
    username: string,
    hostHeader?: string
  ): Promise<ActivityPubActor | null> {
    const domain = activityPubKeyManagerService.getDomain(hostHeader);
    const protocol = domain.startsWith('localhost') ? 'http' : 'https';
    const baseUrl = `${protocol}://${domain}`;

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

    const key = await activityPubKeyManagerService.getOrCreateUserKey(
      user.id,
      user.username,
      domain
    );

    const actorDoc: ActivityPubActor = {
      '@context': [
        'https://www.w3.org/ns/activitystreams',
        'https://w3id.org/security/v1',
      ],
      id: `${baseUrl}/users/${user.username}`,
      type: 'Person',
      preferredUsername: user.username,
      name: user.displayName || user.username,
      summary: user.bio || '',
      url: `${baseUrl}/@${user.username}`,
      inbox: `${baseUrl}/users/${user.username}/inbox`,
      outbox: `${baseUrl}/users/${user.username}/outbox`,
      sharedInbox: `${baseUrl}/inbox`,
      endpoints: {
        sharedInbox: `${baseUrl}/inbox`,
      },
      followers: `${baseUrl}/users/${user.username}/followers`,
      following: `${baseUrl}/users/${user.username}/following`,
      icon: user.avatarUrl
        ? {
            type: 'Image',
            mediaType: 'image/jpeg',
            url: user.avatarUrl,
          }
        : undefined,
      publicKey: {
        id: `${baseUrl}/users/${user.username}#main-key`,
        owner: `${baseUrl}/users/${user.username}`,
        publicKeyPem: key.publicKeyPem,
      },
      manuallyApprovesFollowers: false,
      discoverable: true,
    };

    return actorDoc;
  }
}

export const fetchActivityPubActorService = new FetchActivityPubActorService();

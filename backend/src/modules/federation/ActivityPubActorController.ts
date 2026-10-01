import { FastifyRequest, FastifyReply } from 'fastify';
import { fetchActivityPubActorService } from './FetchActivityPubActorService.js';
import { userController } from '../users/UserController.js';

export class ActivityPubActorController {
  /**
   * GET /actor - Instance Actor
   */
  public async getInstanceActor(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const hostHeader = request.headers.host;
    const actorDoc = await fetchActivityPubActorService.getInstanceActor(hostHeader);

    reply
      .status(200)
      .header('Content-Type', 'application/activity+json; charset=utf-8')
      .header('Access-Control-Allow-Origin', '*')
      .send(actorDoc);
  }

  /**
   * GET /users/:username - User Actor (with Content Negotiation)
   */
  public async getUserActor(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const params = request.params as { username: string };
    const username = params.username;
    const acceptHeader = (request.headers.accept || '').toLowerCase();
    const hostHeader = request.headers.host;

    const isActivityPubRequest =
      acceptHeader.includes('application/activity+json') ||
      acceptHeader.includes('application/ld+json');

    if (isActivityPubRequest) {
      const actorDoc = await fetchActivityPubActorService.getUserActor(username, hostHeader);

      if (!actorDoc) {
        reply.status(404).send({
          success: false,
          error: {
            code: 'USER_NOT_FOUND',
            message: `ActivityPub actor for user '${username}' not found`,
          },
        });
        return;
      }

      reply
        .status(200)
        .header('Content-Type', 'application/activity+json; charset=utf-8')
        .header('Access-Control-Allow-Origin', '*')
        .send(actorDoc);
      return;
    }

    // Default: delegate to standard REST User profile handler
    const profile = await userController.getProfile(request as any, reply);
    reply.send(profile);
  }
}

export const activityPubActorController = new ActivityPubActorController();

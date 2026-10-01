import { FastifyRequest, FastifyReply } from 'fastify';
import { fetchActivityPubOutboxService } from './FetchActivityPubOutboxService.js';

export class ActivityPubOutboxController {
  /**
   * GET /users/:username/outbox
   */
  public async getUserOutbox(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const params = request.params as { username: string };
    const query = request.query as { page?: string };
    const isPage = query.page === 'true' || query.page === '1';

    const outbox = await fetchActivityPubOutboxService.getUserOutbox(
      params.username,
      isPage,
      request.headers.host
    );

    if (!outbox) {
      reply.status(404).send({
        success: false,
        error: {
          code: 'USER_NOT_FOUND',
          message: `Outbox for user '${params.username}' not found`,
        },
      });
      return;
    }

    reply
      .status(200)
      .header('Content-Type', 'application/activity+json; charset=utf-8')
      .header('Access-Control-Allow-Origin', '*')
      .send(outbox);
  }

  /**
   * GET /actor/outbox
   */
  public async getInstanceOutbox(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const outbox = fetchActivityPubOutboxService.getInstanceOutbox(request.headers.host);

    reply
      .status(200)
      .header('Content-Type', 'application/activity+json; charset=utf-8')
      .header('Access-Control-Allow-Origin', '*')
      .send(outbox);
  }
}

export const activityPubOutboxController = new ActivityPubOutboxController();

import { FastifyRequest, FastifyReply } from 'fastify';
import { resolveRemoteActorService } from './ResolveRemoteActorService.js';

export class FederationResolveController {
  /**
   * POST /api/v1/federation/resolve
   * Resolves a remote fediverse handle (@user@domain) or actor URI to a cached actor & shadow user.
   */
  public async resolve(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const body = request.body as { handle?: string };
    const handle = body?.handle;

    if (!handle || typeof handle !== 'string' || !handle.trim()) {
      reply.status(400).send({
        success: false,
        error: {
          code: 'INVALID_HANDLE',
          message: "Field 'handle' is required (e.g. @user@domain or https://domain/users/username)",
        },
      });
      return;
    }

    try {
      const currentUserId = request.currentUserId || null;
      const result = await resolveRemoteActorService.resolveActor(
        handle.trim(),
        currentUserId
      );

      reply.status(200).send({
        success: true,
        data: result,
      });
    } catch (err: any) {
      const statusCode =
        err.statusCode ||
        (err.code === 'SSRF_GUARD_BLOCKED' ||
        err.code === 'INVALID_HANDLE_FORMAT' ||
        err.code === 'INVALID_ACTOR_TYPE'
          ? 400
          : err.code === 'REMOTE_ACTOR_NOT_FOUND' ||
            err.code === 'ACTOR_URI_NOT_FOUND' ||
            err.code === 'REMOTE_ACTOR_FETCH_FAILED'
          ? 404
          : 500);

      reply.status(statusCode).send({
        success: false,
        error: {
          code: err.code || 'RESOLUTION_FAILED',
          message: err.message || 'Failed to resolve remote actor',
        },
      });
    }
  }
}

export const federationResolveController = new FederationResolveController();

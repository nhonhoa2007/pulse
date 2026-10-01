import { FastifyRequest, FastifyReply } from 'fastify';
import { resolveWebFingerQueryService } from './ResolveWebFingerQueryService.js';

export class WebFingerDiscoveryController {
  /**
   * Fastify handler for GET /.well-known/webfinger
   */
  public async handle(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const query = request.query as Record<string, string | undefined>;
    const resource = query.resource;
    const hostHeader = request.headers.host;

    const { response, error } = await resolveWebFingerQueryService.resolve(
      resource,
      hostHeader
    );

    // Standard RFC 7033 headers
    reply.header('Access-Control-Allow-Origin', '*');
    reply.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
    reply.header('Access-Control-Allow-Headers', 'Accept, Content-Type');

    if (error) {
      reply.status(error.statusCode).send({
        success: false,
        error: {
          code: error.code,
          message: error.message,
        },
      });
      return;
    }

    reply
      .status(200)
      .header('Content-Type', 'application/jrd+json; charset=utf-8')
      .header('Cache-Control', 'max-age=3600, public')
      .send(response);
  }
}

export const webFingerDiscoveryController = new WebFingerDiscoveryController();

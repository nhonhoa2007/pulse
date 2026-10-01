import { FastifyRequest, FastifyReply } from 'fastify';
import { httpSignatureVerifierService } from './HttpSignatureVerifierService.js';
import { processInboundActivityService } from './ProcessInboundActivityService.js';
import { ActivityPubActivity } from '../../contracts/ActivityPubContracts.js';

export class ActivityPubInboxController {
  /**
   * POST /inbox - Shared Inbox handler
   */
  public async handleSharedInbox(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    await this.processInboxRequest(request, reply);
  }

  /**
   * POST /users/:username/inbox - Personal Inbox handler
   */
  public async handlePersonalInbox(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const params = request.params as { username: string };
    await this.processInboxRequest(request, reply, params.username);
  }

  /**
   * Common signature verification, payload validation, and activity dispatch logic
   */
  private async processInboxRequest(
    request: FastifyRequest,
    reply: FastifyReply,
    targetUsername?: string
  ): Promise<void> {
    // 1. Verify HTTP Signature
    const verifyResult = await httpSignatureVerifierService.verifyInboundRequest(request);

    if (!verifyResult.valid) {
      reply.status(401).send({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: verifyResult.error || 'Invalid or missing HTTP signature',
        },
      });
      return;
    }

    // 2. Validate Activity payload structure & types
    const activity = request.body as ActivityPubActivity;
    if (
      !activity ||
      typeof activity !== 'object' ||
      typeof activity.type !== 'string' ||
      typeof activity.actor !== 'string'
    ) {
      reply.status(400).send({
        success: false,
        error: {
          code: 'INVALID_ACTIVITY',
          message: "Inbound payload must be a valid ActivityStreams object with string 'type' and 'actor'",
        },
      });
      return;
    }

    // Validate Actor URI structure
    try {
      const parsedActor = new URL(activity.actor);
      if (parsedActor.protocol !== 'http:' && parsedActor.protocol !== 'https:') {
        reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_ACTOR_URI',
            message: 'Activity actor must be a valid HTTP or HTTPS URI',
          },
        });
        return;
      }
    } catch {
      reply.status(400).send({
        success: false,
        error: {
          code: 'INVALID_ACTOR_URI',
          message: 'Activity actor is not a valid URL',
        },
      });
      return;
    }

    // 3. Enforce Signature Identity Binding (Prevent Actor Impersonation)
    try {
      const signerUrl = new URL(verifyResult.actorUri);
      const actorUrl = new URL(activity.actor);

      const isExactMatch = verifyResult.actorUri === activity.actor;
      const isAuthorizedInstanceActor =
        (signerUrl.pathname.endsWith('/actor') || signerUrl.pathname === '/actor') &&
        signerUrl.host === actorUrl.host;

      if (!isExactMatch && !isAuthorizedInstanceActor) {
        reply.status(403).send({
          success: false,
          error: {
            code: 'ACTOR_SIGNATURE_MISMATCH',
            message: `ACTOR_SIGNATURE_MISMATCH: Signing actor '${verifyResult.actorUri}' is not authorized to act on behalf of activity actor '${activity.actor}'`,
          },
        });
        return;
      }
    } catch {
      reply.status(403).send({
        success: false,
        error: {
          code: 'ACTOR_SIGNATURE_MISMATCH',
          message: 'Invalid actor URI in signature or payload',
        },
      });
      return;
    }

    // 4. Process activity through state machine
    try {
      const result = await processInboundActivityService.processActivity(activity, {
        targetUsername,
        hostHeader: request.headers.host,
      });

      if (!result.handled && result.message.startsWith('UNAUTHORIZED_DELETE')) {
        reply.status(403).send({
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: result.message,
          },
        });
        return;
      }

      reply.status(202).send({
        success: true,
        data: {
          handled: result.handled,
          type: result.type,
          message: result.message,
          activityId: result.activityId,
        },
      });
    } catch (err: any) {
      reply.status(500).send({
        success: false,
        error: {
          code: 'ACTIVITY_PROCESSING_FAILED',
          message: err?.message || 'Error executing ActivityPub inbox processing',
        },
      });
    }
  }
}

export const activityPubInboxController = new ActivityPubInboxController();

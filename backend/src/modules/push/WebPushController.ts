import { FastifyRequest, FastifyReply } from 'fastify';
import { webPushService } from './WebPushService.js';
import {
  ApiResponse,
  VapidPublicKeyResponse,
  WebPushSubscriptionDto,
  RegisterWebPushSubscriptionInput,
  UnregisterWebPushSubscriptionInput,
  SendPushNotificationResult,
} from '../../contracts/ApiContracts.js';

export class WebPushController {
  /**
   * GET /api/v1/push/vapid-public-key
   */
  public async getVapidPublicKey(
    _req: FastifyRequest,
    _reply: FastifyReply
  ): Promise<ApiResponse<VapidPublicKeyResponse>> {
    const publicKey = webPushService.getVapidPublicKey();
    return {
      success: true,
      data: {
        publicKey,
      },
    };
  }

  /**
   * POST /api/v1/push/subscriptions
   */
  public async registerSubscription(
    req: FastifyRequest<{ Body: RegisterWebPushSubscriptionInput }>,
    reply: FastifyReply
  ): Promise<ApiResponse<WebPushSubscriptionDto>> {
    const currentUserId = req.currentUserId;
    if (!currentUserId) {
      reply.status(401);
      return {
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required via x-user-id header' },
      };
    }

    try {
      const subscription = await webPushService.registerSubscription(
        currentUserId,
        req.body
      );
      reply.status(201);
      return {
        success: true,
        data: subscription,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to register subscription';
      const code =
        (err as any)?.code ||
        (message.includes('SSRF_GUARD_BLOCKED') || message.includes('SSRF_BLOCKED')
          ? 'SSRF_GUARD_BLOCKED'
          : 'BAD_REQUEST');
      reply.status(400);
      return {
        success: false,
        error: { code, message },
      };
    }
  }

  /**
   * DELETE /api/v1/push/subscriptions
   */
  public async unregisterSubscription(
    req: FastifyRequest<{ Body?: UnregisterWebPushSubscriptionInput; Querystring?: { endpoint?: string } }>,
    reply: FastifyReply
  ): Promise<ApiResponse<{ success: true }>> {
    const currentUserId = req.currentUserId;
    if (!currentUserId) {
      reply.status(401);
      return {
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required via x-user-id header' },
      };
    }

    const endpoint = req.body?.endpoint || req.query?.endpoint;
    if (!endpoint) {
      reply.status(400);
      return {
        success: false,
        error: { code: 'BAD_REQUEST', message: 'endpoint is required' },
      };
    }

    try {
      await webPushService.unregisterSubscription(currentUserId, endpoint);
      return {
        success: true,
        data: { success: true },
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to unregister subscription';
      reply.status(400);
      return {
        success: false,
        error: { code: 'BAD_REQUEST', message },
      };
    }
  }

  /**
   * POST /api/v1/push/test
   */
  public async sendTestNotification(
    req: FastifyRequest<{ Body?: { title?: string; body?: string } }>,
    reply: FastifyReply
  ): Promise<ApiResponse<{ sent: number; results: SendPushNotificationResult[] }>> {
    const currentUserId = req.currentUserId;
    if (!currentUserId) {
      reply.status(401);
      return {
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required via x-user-id header' },
      };
    }

    try {
      const title = req.body?.title || 'Pulse Social Notification';
      const body = req.body?.body || 'Test push notification from Pulse';

      const results = await webPushService.sendNotificationToUser(currentUserId, {
        title,
        body,
        timestamp: new Date().toISOString(),
      });

      const sent = results.filter((r) => r.success).length;

      return {
        success: true,
        data: {
          sent,
          results,
        },
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to send test push';
      reply.status(500);
      return {
        success: false,
        error: { code: 'INTERNAL_SERVER_ERROR', message },
      };
    }
  }
}

export const webPushController = new WebPushController();

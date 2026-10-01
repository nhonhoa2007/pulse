/**
 * PKG-04: Controller cho Report & Moderation.
 *  - POST /api/v1/reports                     (user, auth)
 *  - GET  /api/v1/admin/reports               (admin)
 *  - PATCH /api/v1/admin/reports/:id/resolve  (admin)
 */
import { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../db/PrismaClientSingleton.js';
import {
  reportService,
  ReportValidationError,
  ReportNotFoundError,
  ReportForbiddenError,
} from './ReportService.js';
import type { ReportReason, ReportTargetType, ReportStatus } from '@prisma/client';

const VALID_REASONS: ReportReason[] = [
  'SPAM', 'HARASSMENT', 'HATE_SPEECH', 'MISINFORMATION', 'COPYRIGHT', 'VIOLENCE', 'NUDE_SEXUAL', 'OTHER',
];
const VALID_TARGETS: ReportTargetType[] = ['POST', 'USER', 'DM_MESSAGE', 'GROUP_MESSAGE'];
const VALID_ACTIONS = ['DISMISS', 'DELETE_POST', 'SUSPEND_USER', 'WARN_USER'];

interface CreateReportBody {
  targetType?: string;
  targetId?: string;
  reason?: string;
  details?: string;
}

function requireAuth(req: FastifyRequest): string | null {
  return (req as unknown as { currentUserId?: string | null }).currentUserId || null;
}

async function requireAdmin(req: FastifyRequest, reply: FastifyReply): Promise<string | null> {
  const userId = requireAuth(req);
  if (!userId) {
    reply.status(401);
    return null;
  }
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isAdmin: true, isDeleted: true },
  });
  if (!user || user.isDeleted || !user.isAdmin) {
    reply.status(403);
    return null;
  }
  return userId;
}

export class ModerationController {
  public async createReport(
    req: FastifyRequest<{ Body: CreateReportBody }>,
    reply: FastifyReply
  ): Promise<unknown> {
    const reporterId = requireAuth(req);
    if (!reporterId) {
      reply.status(401);
      return {
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      };
    }

    try {
      const targetType = req.body.targetType as ReportTargetType;
      const reason = req.body.reason as ReportReason;

      if (!targetType || !VALID_TARGETS.includes(targetType)) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_TARGET_TYPE', message: `targetType phải là một trong: ${VALID_TARGETS.join(', ')}` },
        });
      }
      if (!req.body.targetId || typeof req.body.targetId !== 'string') {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_TARGET_ID', message: 'targetId là bắt buộc' },
        });
      }
      if (!reason || !VALID_REASONS.includes(reason)) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_REASON', message: `reason phải là một trong: ${VALID_REASONS.join(', ')}` },
        });
      }

      const result = await reportService.createReport({
        reporterId,
        targetType,
        targetId: req.body.targetId,
        reason,
        details: req.body.details,
      });
      reply.status(201);
      return { success: true, data: result };
    } catch (err) {
      if (err instanceof ReportValidationError) {
        return reply.status(400).send({
          success: false,
          error: { code: err.code, message: err.message },
        });
      }
      throw err;
    }
  }

  public async listReports(
    req: FastifyRequest<{ Querystring: { status?: string; limit?: string; offset?: string } }>,
    reply: FastifyReply
  ): Promise<unknown> {
    const adminId = await requireAdmin(req, reply);
    if (!adminId) {
      return {
        success: false,
        error: { code: 'FORBIDDEN', message: 'Chỉ quản trị viên mới có quyền này' },
      };
    }

    const status = req.query.status as ReportStatus | undefined;
    const validStatus = status && ['PENDING', 'REVIEWING', 'RESOLVED', 'DISMISSED'].includes(status) ? status : undefined;

    const data = await reportService.listReports({
      status: validStatus,
      limit: parseInt(String(req.query.limit || '50'), 10) || 50,
      offset: parseInt(String(req.query.offset || '0'), 10) || 0,
    });
    return { success: true, data };
  }

  public async resolveReport(
    req: FastifyRequest<{ Params: { id: string }; Body: { action?: string; note?: string } }>,
    reply: FastifyReply
  ): Promise<unknown> {
    const adminId = await requireAdmin(req, reply);
    if (!adminId) {
      return {
        success: false,
        error: { code: 'FORBIDDEN', message: 'Chỉ quản trị viên mới có quyền này' },
      };
    }

    try {
      const action = req.body?.action;
      if (!action || !VALID_ACTIONS.includes(action)) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_ACTION', message: `action phải là một trong: ${VALID_ACTIONS.join(', ')}` },
        });
      }

      const result = await reportService.resolveReport({
        reportId: req.params.id,
        reviewerId: adminId,
        action: action as 'DISMISS' | 'DELETE_POST' | 'SUSPEND_USER' | 'WARN_USER',
        note: req.body?.note,
      });
      return { success: true, data: result };
    } catch (err) {
      if (err instanceof ReportValidationError) {
        return reply.status(400).send({
          success: false,
          error: { code: err.code, message: err.message },
        });
      }
      if (err instanceof ReportNotFoundError) {
        return reply.status(404).send({
          success: false,
          error: { code: 'REPORT_NOT_FOUND', message: err.message },
        });
      }
      throw err;
    }
  }
}

export const moderationController = new ModerationController();

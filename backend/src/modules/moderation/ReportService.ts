/**
 * PKG-04: Content Moderation & Report System.
 *
 * Workflow: user tạo Report (kèm autoScore heuristic cho PKG-15) →
 * admin xem hàng đợi (sort theo điểm) → resolve với action:
 *   DISMISS | DELETE_POST | SUSPEND_USER | WARN_USER
 */
import { prisma } from '../../db/PrismaClientSingleton.js';
import type {
  ReportReason,
  ReportStatus,
  ReportTargetType,
} from '@prisma/client';

export class ReportValidationError extends Error {
  constructor(message: string, public code: string = 'BAD_REQUEST') {
    super(message);
    this.name = 'ReportValidationError';
  }
}

export class ReportNotFoundError extends Error {
  constructor(message: string = 'Không tìm thấy báo cáo') {
    super(message);
    this.name = 'ReportNotFoundError';
  }
}

export class ReportForbiddenError extends Error {
  constructor(message: string = 'Chỉ quản trị viên mới có quyền này') {
    super(message);
    this.name = 'ReportForbiddenError';
  }
}

const URL_PATTERN = /https?:\/\/[^\s]+/gi;

export class ReportService {
  /**
   * Heuristic chấm điểm tự động (0-100) — nền cho PKG-15 moderation v2.
   * Nhãn gắn kèm để admin lọc nhanh.
   */
  public async computeAutoScore(
    targetType: ReportTargetType,
    targetId: string,
    reason: ReportReason,
    currentReporterId?: string
  ): Promise<{ score: number; labels: string[] }> {
    let score = 0;
    const labels: string[] = [];

    if (reason === 'SPAM') {
      score += 40;
      labels.push('spam_reason');
    } else if (reason === 'HARASSMENT' || reason === 'HATE_SPEECH') {
      score += 35;
      labels.push('abuse_reason');
    }

    if (targetType === 'POST') {
      const post = await prisma.post.findUnique({
        where: { id: targetId },
        select: { content: true, authorId: true, createdAt: true },
      });
      if (post) {
        const urlCount = (post.content.match(URL_PATTERN) || []).length;
        if (urlCount >= 3) {
          score += 30;
          labels.push('link_flood');
        }
        // Nội dung lặp: cùng author đã đăng nội dung giống hệt trong 24h qua
        const duplicates = await prisma.post.count({
          where: {
            authorId: post.authorId,
            content: post.content,
            createdAt: { gte: new Date(Date.now() - 24 * 3600 * 1000) },
          },
        });
        if (duplicates >= 3) {
          score += 30;
          labels.push('duplicate_content');
        }
      }
    }

    // Mỗi reporter khác nhau trên cùng một mục tiêu: +10
    // (tính cả người đang báo cáo — report row chưa được tạo lúc tính điểm)
    const reporterCount = await prisma.report.findMany({
      where: { targetType, targetId },
      select: { reporterId: true },
    });
    const distinctReporters = new Set(reporterCount.map((r) => r.reporterId));
    if (currentReporterId) distinctReporters.add(currentReporterId);
    if (distinctReporters.size >= 3) {
      score += Math.min(distinctReporters.size * 10, 30);
      labels.push('multiple_reporters');
    }

    return { score: Math.min(score, 100), labels };
  }

  /**
   * User tạo báo cáo. Unique constraint chặn 1 reporter báo trùng 1 mục tiêu.
   */
  public async createReport(input: {
    reporterId: string;
    targetType: ReportTargetType;
    targetId: string;
    reason: ReportReason;
    details?: string;
  }): Promise<{ report: { id: string; status: string; autoScore: number; autoLabels: string[] } }> {
    const { reporterId, targetType, targetId, reason, details } = input;

    if (!reporterId) {
      throw new ReportValidationError('Yêu cầu đăng nhập', 'UNAUTHORIZED');
    }
    if (details && details.length > 1000) {
      throw new ReportValidationError('Mô tả chi tiết tối đa 1000 ký tự', 'DETAILS_TOO_LONG');
    }

    // Target phải tồn tại
    if (targetType === 'POST') {
      const post = await prisma.post.findUnique({ where: { id: targetId }, select: { id: true } });
      if (!post || !(await prisma.post.findFirst({ where: { id: targetId, isDeleted: false }, select: { id: true } }))) {
        throw new ReportValidationError('Bài viết không tồn tại', 'TARGET_NOT_FOUND');
      }
    } else if (targetType === 'USER') {
      const user = await prisma.user.findUnique({ where: { id: targetId }, select: { id: true, isDeleted: true } });
      if (!user || user.isDeleted) {
        throw new ReportValidationError('Người dùng không tồn tại', 'TARGET_NOT_FOUND');
      }
    } else if (targetType === 'DM_MESSAGE') {
      const msg = await prisma.dmMessage.findUnique({ where: { id: targetId }, select: { id: true, deletedAt: true } });
      if (!msg || msg.deletedAt) {
        throw new ReportValidationError('Tin nhắn không tồn tại', 'TARGET_NOT_FOUND');
      }
    } else if (targetType === 'GROUP_MESSAGE') {
      const msg = await prisma.groupMessage.findUnique({ where: { id: targetId }, select: { id: true, deletedAt: true } });
      if (!msg || msg.deletedAt) {
        throw new ReportValidationError('Tin nhắn nhóm không tồn tại', 'TARGET_NOT_FOUND');
      }
    }

    const { score, labels } = await this.computeAutoScore(targetType, targetId, reason, reporterId);

    try {
      const report = await prisma.report.create({
        data: {
          reporterId,
          targetType,
          targetId,
          reason,
          details: details?.trim() || null,
          autoScore: score,
          autoLabels: labels,
        },
      });
      return {
        report: {
          id: report.id,
          status: report.status,
          autoScore: report.autoScore,
          autoLabels: report.autoLabels,
        },
      };
    } catch (err: any) {
      if (err?.code === 'P2002') {
        throw new ReportValidationError('Bạn đã báo cáo mục tiêu này rồi', 'ALREADY_REPORTED');
      }
      throw err;
    }
  }

  /**
   * Hàng đợi admin — sort theo autoScore DESC rồi createdAt DESC.
   */
  public async listReports(params: {
    status?: ReportStatus;
    limit?: number;
    offset?: number;
  }): Promise<{ reports: unknown[]; total: number }> {
    const limit = Math.min(Math.max(params.limit || 50, 1), 200);
    const offset = Math.max(params.offset || 0, 0);
    const where = params.status ? { status: params.status } : {};

    const [reports, total] = await Promise.all([
      prisma.report.findMany({
        where,
        orderBy: [{ autoScore: 'desc' }, { createdAt: 'desc' }],
        take: limit,
        skip: offset,
        include: {
          reporter: {
            select: { id: true, username: true, displayName: true },
          },
          reviewedBy: {
            select: { id: true, username: true },
          },
        },
      }),
      prisma.report.count({ where }),
    ]);

    return { reports, total };
  }

  /**
   * Admin resolve report + thi hành action.
   */
  public async resolveReport(params: {
    reportId: string;
    reviewerId: string;
    action: 'DISMISS' | 'DELETE_POST' | 'SUSPEND_USER' | 'WARN_USER';
    note?: string;
  }): Promise<{ report: unknown }> {
    const report = await prisma.report.findUnique({ where: { id: params.reportId } });
    if (!report) {
      throw new ReportNotFoundError();
    }
    if (report.status === 'RESOLVED' || report.status === 'DISMISSED') {
      throw new ReportValidationError('Báo cáo đã được xử lý', 'ALREADY_RESOLVED');
    }

    let actionTaken = params.action;
    if (params.action === 'DELETE_POST') {
      if (report.targetType !== 'POST') {
        throw new ReportValidationError('Action DELETE_POST chỉ áp cho mục tiêu POST', 'ACTION_TARGET_MISMATCH');
      }
      const post = await prisma.post.findUnique({ where: { id: report.targetId }, select: { isDeleted: true } });
      if (post && !post.isDeleted) {
        await prisma.post.update({
          where: { id: report.targetId },
          data: { isDeleted: true },
        });
        actionTaken = 'DELETE_POST: post removed';
      }
    } else if (params.action === 'SUSPEND_USER') {
      const targetAuthorId =
        report.targetType === 'USER'
          ? report.targetId
          : report.targetType === 'POST'
            ? (await prisma.post.findUnique({ where: { id: report.targetId }, select: { authorId: true } }))?.authorId
            : report.targetType === 'DM_MESSAGE'
              ? (await prisma.dmMessage.findUnique({ where: { id: report.targetId }, select: { senderId: true } }))?.senderId
              : (await prisma.groupMessage.findUnique({ where: { id: report.targetId }, select: { senderId: true } }))?.senderId;
      if (!targetAuthorId) {
        throw new ReportValidationError('Không xác định được người dùng mục tiêu', 'TARGET_NOT_FOUND');
      }
      await prisma.user.update({
        where: { id: targetAuthorId },
        data: { accountStatus: 'SUSPENDED' },
      });
      // Thu hồi mọi phiên đăng nhập của tài khoản bị đình chỉ
      await prisma.refreshToken.updateMany({
        where: { userId: targetAuthorId, isRevoked: false },
        data: { isRevoked: true },
      });
      actionTaken = 'SUSPEND_USER: account suspended';
    }

    const updated = await prisma.report.update({
      where: { id: params.reportId },
      data: {
        status: params.action === 'DISMISS' ? 'DISMISSED' : 'RESOLVED',
        reviewedById: params.reviewerId,
        actionTaken: params.note ? `${actionTaken} — ${params.note}` : actionTaken,
      },
      include: {
        reporter: { select: { id: true, username: true } },
        reviewedBy: { select: { id: true, username: true } },
      },
    });

    return { report: updated };
  }
}

export const reportService = new ReportService();

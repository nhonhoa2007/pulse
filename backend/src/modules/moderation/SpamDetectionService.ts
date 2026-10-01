/**
 * PKG-15: Moderation v2 — pre-filter heuristic khi đăng bài.
 *
 * Nếu bài viết vượt ngưỡng đáng ngờ (spam patterns), tự động tạo Report
 * với reporterId = null (auto-flag hệ thống) để admin xử lý ở hàng đợi
 * sort theo autoScore.
 *
 * Tín hiệu:
 *  - Link flood: ≥ 3 URL trong nội dung (+30)
 *  - Duplicate: nội dung giống hệt đã đăng trong 24h gần nhất (mỗi bản +15, tối đa 45)
 *  - Tốc độ: ≥ 5 bài trong 1 phút qua (+25)
 * Ngưỡng auto-flag: score ≥ 60.
 */
import { prisma } from '../../db/PrismaClientSingleton.js';

const AUTO_FLAG_THRESHOLD = 60;
const URL_PATTERN = /https?:\/\/[^\s]+/gi;

export interface SpamSignals {
  score: number;
  labels: string[];
}

export class SpamDetectionService {
  public async analyzePost(authorId: string, content: string): Promise<SpamSignals> {
    let score = 0;
    const labels: string[] = [];

    const urlCount = (content.match(URL_PATTERN) || []).length;
    if (urlCount >= 3) {
      score += 30;
      labels.push('link_flood');
    }

    if (content.trim().length > 0) {
      const duplicates = await prisma.post.count({
        where: {
          authorId,
          content,
          createdAt: { gte: new Date(Date.now() - 24 * 3600 * 1000) },
        },
      });
      if (duplicates >= 1) {
        score += Math.min(duplicates * 15, 45);
        labels.push('duplicate_content');
      }
    }

    const recentPosts = await prisma.post.count({
      where: {
        authorId,
        createdAt: { gte: new Date(Date.now() - 60 * 1000) },
      },
    });
    if (recentPosts >= 5) {
      score += 25;
      labels.push('posting_rate');
    }

    return { score: Math.min(score, 100), labels };
  }

  /**
   * Chạy sau khi PublishPostService tạo bài. Chỉ tạo Report PENDING khi vượt ngưỡng.
   * Idempotent theo (target, lý do auto): không tạo trùng trong 1 giờ.
   */
  public async maybeAutoFlag(postId: string, authorId: string, content: string): Promise<void> {
    const { score, labels } = await this.analyzePost(authorId, content);
    if (score < AUTO_FLAG_THRESHOLD) return;

    const recentAutoFlag = await prisma.report.findFirst({
      where: {
        targetType: 'POST',
        targetId: postId,
        reporterId: null,
        createdAt: { gte: new Date(Date.now() - 3600 * 1000) },
      },
      select: { id: true },
    });
    if (recentAutoFlag) return;

    await prisma.report.create({
      data: {
        reporterId: null,
        targetType: 'POST',
        targetId: postId,
        reason: 'SPAM',
        details: `Auto-flag: ${labels.join(', ')} (score ${score})`,
        autoScore: score,
        autoLabels: labels,
      },
    });
  }
}

export const spamDetectionService = new SpamDetectionService();

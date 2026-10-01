/**
 * PKG-09: Media Pipeline v2.
 *
 *  - Ảnh (jpeg/png/webp): xử lý qua sharp — auto-orient (EXIF), resize tối đa
 *    1600px (no-enlargement), convert WebP q82, STRIP toàn bộ metadata (EXIF
 *    chứa GPS là rò rỉ quyền riêng tư thực sự).
 *  - GIF (animated): giữ nguyên bản gốc.
 *  - Mỗi asset ghi vào bảng MediaAsset kèm altText (a11y) và kích thước sau xử lý.
 */
import { FastifyRequest, FastifyReply } from 'fastify';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import { prisma } from '../../db/PrismaClientSingleton.js';
import { ApiResponse, MediaUploadResult } from '../../contracts/ApiContracts.js';

const ALLOWED_MIME_TYPES: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
const MAX_DIMENSION = 1600;

export class MediaUploadController {
  private uploadsDir: string;

  constructor() {
    this.uploadsDir = process.env.UPLOADS_DIR || fileURLToPath(new URL('../../../uploads', import.meta.url));
    if (!fs.existsSync(this.uploadsDir)) {
      fs.mkdirSync(this.uploadsDir, { recursive: true });
    }
  }

  public async upload(
    req: FastifyRequest,
    reply: FastifyReply
  ): Promise<ApiResponse<MediaUploadResult>> {
    try {
      const currentUserId = (req as unknown as { currentUserId?: string | null }).currentUserId;
      if (!currentUserId) {
        reply.status(401);
        return {
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
        };
      }

      // PKG-09: duyệt MỘT vòng parts() — consume file NGAY TRONG vòng lặp
      // (busboy không advance được nếu file stream chưa đọc hết → deadlock).
      let data: any = null;
      let altText: string | null = null;
      let buffer: Buffer = Buffer.alloc(0);
      let truncated = false;

      for await (const part of req.parts({
        limits: { fileSize: MAX_FILE_SIZE_BYTES },
      })) {
        if (part.type === 'file') {
          try {
            buffer = await part.toBuffer();
          } catch (err: any) {
            if (err?.code === 'FST_REQ_FILE_TOO_LARGE') {
              truncated = true;
            } else {
              throw err;
            }
          }
          data = part;
        } else if (part.type === 'field' && part.fieldname === 'altText') {
          const value = String((part as any).value || '').trim();
          altText = value ? value.slice(0, 500) : null;
        }
      }

      if (!data) {
        reply.status(400);
        return {
          success: false,
          error: {
            code: 'BAD_REQUEST',
            message: 'No file uploaded or request is not multipart/form-data',
          },
        };
      }

      if (truncated || data.file.truncated || buffer.length > MAX_FILE_SIZE_BYTES) {
        reply.status(400);
        return {
          success: false,
          error: {
            code: 'FILE_TOO_LARGE',
            message: 'File size exceeds maximum limit of 5MB',
          },
        };
      }

      const mimeType = data.mimetype;
      const ext = ALLOWED_MIME_TYPES[mimeType];

      if (!ext) {
        reply.status(400);
        return {
          success: false,
          error: {
            code: 'INVALID_MIME_TYPE',
            message: `Unsupported file type '${mimeType}'. Allowed MIME types: image/jpeg, image/png, image/webp, image/gif.`,
          },
        };
      }

      let filename: string;
      let width: number | null = null;
      let height: number | null = null;
      let storedBuffer: Buffer = buffer;
      let storedMime = mimeType;

      if (mimeType === 'image/gif') {
        // GIF animated: giữ nguyên (sharp xử lý animated phức tạp, tốn kém)
        filename = `${crypto.randomUUID()}${ext}`;
      } else {
        try {
          const processed = await sharp(buffer)
            .rotate() // auto-orient theo EXIF trước khi strip
            .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: 'inside', withoutEnlargement: true })
            .webp({ quality: 82 })
            .toBuffer({ resolveWithObject: true });

          storedBuffer = processed.data;
          width = processed.info.width;
          height = processed.info.height;
          storedMime = 'image/webp';
          filename = `${crypto.randomUUID()}.webp`;
        } catch {
          // Ảnh hỏng/không xử lý được → fallback giữ nguyên bản gốc
          filename = `${crypto.randomUUID()}${ext}`;
        }
      }

      const filePath = path.join(this.uploadsDir, filename);
      await fs.promises.writeFile(filePath, storedBuffer);

      // Registry: altText + metadata phục vụ a11y & quản lý
      await prisma.mediaAsset.create({
        data: {
          ownerId: currentUserId,
          filename,
          mimeType: storedMime,
          sizeBytes: storedBuffer.length,
          width,
          height,
          altText,
        },
      });

      const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || '3001'}`;
      const url = `${baseUrl}/uploads/${filename}`;
      const relativeUrl = `/uploads/${filename}`;

      reply.status(200);
      return {
        success: true,
        data: {
          url,
          relativeUrl,
          ...(altText ? { altText } : {}),
          ...(width && height ? { width, height } : {}),
        } as MediaUploadResult & { altText?: string; width?: number; height?: number },
      };
    } catch (err: unknown) {
      const error = err as { code?: string; message?: string };
      if (error.code === 'FST_REQ_FILE_TOO_LARGE') {
        reply.status(400);
        return {
          success: false,
          error: {
            code: 'FILE_TOO_LARGE',
            message: 'File size exceeds maximum limit of 5MB',
          },
        };
      }

      const message = error.message || 'Failed to upload media';
      reply.status(400);
      return {
        success: false,
        error: {
          code: 'UPLOAD_FAILED',
          message,
        },
      };
    }
  }
}

export const mediaUploadController = new MediaUploadController();

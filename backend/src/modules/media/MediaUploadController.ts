import { FastifyRequest, FastifyReply } from 'fastify';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { ApiResponse, MediaUploadResult } from '../../contracts/ApiContracts.js';

const ALLOWED_MIME_TYPES: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

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
      const data = await req.file({
        limits: {
          fileSize: MAX_FILE_SIZE_BYTES,
        },
      });

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

      const buffer = await data.toBuffer();

      if (data.file.truncated || buffer.length > MAX_FILE_SIZE_BYTES) {
        reply.status(400);
        return {
          success: false,
          error: {
            code: 'FILE_TOO_LARGE',
            message: 'File size exceeds maximum limit of 5MB',
          },
        };
      }

      const filename = `${crypto.randomUUID()}${ext}`;
      const filePath = path.join(this.uploadsDir, filename);

      await fs.promises.writeFile(filePath, buffer);

      const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || '3001'}`;
      const url = `${baseUrl}/uploads/${filename}`;
      const relativeUrl = `/uploads/${filename}`;

      reply.status(200);
      return {
        success: true,
        data: {
          url,
          relativeUrl,
        },
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

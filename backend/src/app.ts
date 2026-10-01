import 'dotenv/config';
import Fastify, { FastifyInstance, FastifyServerOptions } from 'fastify';
import cors from '@fastify/cors';
import fastifyMultipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import fastifyCookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import fs from 'fs';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import { tokenRevocationManager } from './modules/auth/TokenRevocationManager.js';
import { getJwtSecret, getCookieSecret } from './config/Secrets.js';
import { registerV1Routes, registerLegacyRootAliases } from './routes/registerRoutes.js';
import { pollExpirationSchedulerService } from './modules/polls/PollExpirationSchedulerService.js';
import { activityDeliveryWorkerService } from './modules/federation/ActivityDeliveryWorkerService.js';
import { postImpressionsBufferService } from './modules/posts/PostImpressionsBufferService.js';

declare module 'fastify' {
  interface FastifyRequest {
    currentUserId?: string | null;
  }
}

export async function buildApp(options: FastifyServerOptions = {}): Promise<FastifyInstance> {
  // 0. Fail-fast secrets (SEC-03): refuse to boot without mandatory secrets.
  //    No hardcoded fallback values are allowed anywhere in the codebase.
  const JWT_SECRET = getJwtSecret();
  const COOKIE_SECRET = getCookieSecret();

  const app = Fastify({
    bodyLimit: 1048576, // 1MB payload limit to prevent resource exhaustion / DoS
    logger: process.env.NODE_ENV === 'test' ? false : {
      level: process.env.LOG_LEVEL || 'info',
    },
    ...options,
  });

  // 1. Register CORS
  await app.register(cors, {
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Signature',
      'Date',
      'Digest',
      'Accept',
    ],
  });

  // 1a. Register Fastify Cookie for HttpOnly refresh tokens
  await app.register(fastifyCookie, {
    secret: COOKIE_SECRET,
  });

  // 1b. Rate limiting (SEC-05): global per-IP ceiling plus strict per-route buckets
  //     (credential endpoints per-IP, publishing per-user). RATE_LIMIT_DISABLED=1
  //     (test preload) skips the plugin so request-heavy suites stay deterministic.
  if (process.env.RATE_LIMIT_DISABLED !== '1') {
    await app.register(rateLimit, {
      global: true,
      max: 300,
      timeWindow: '1 minute',
      // The plugin throws this value into Fastify's error pipeline, so return
      // an Error carrying statusCode/code — the centralized error handler then
      // renders the standard { success:false, error:{ code, message } } envelope.
      errorResponseBuilder: (_request, context) => {
        const err: Error & { statusCode?: number; code?: string } = new Error(
          `Quá nhiều yêu cầu. Vui lòng thử lại sau ${context.after}.`
        );
        err.statusCode = 429;
        err.code = 'RATE_LIMITED';
        return err;
      },
    });
  }

  // 1c. Initialize In-Memory Denylist Cache from PostgreSQL
  await tokenRevocationManager.initialize();

  // 1d. Content Type Parser with rawBody preservation for HTTP Signatures & Digest verification
  app.addContentTypeParser(
    ['application/json', 'application/activity+json', 'application/ld+json', 'application/jrd+json'],
    { parseAs: 'buffer' },
    (req, body, done) => {
      try {
        (req as any).rawBody = body;
        if (!body || body.length === 0) {
          done(null, {});
          return;
        }
        const json = JSON.parse(body.toString('utf-8'));
        done(null, json);
      } catch (err: any) {
        done(err, undefined);
      }
    }
  );

  // 2. Register Fastify Multipart for file uploads (max 5MB)
  await app.register(fastifyMultipart, {
    limits: {
      fileSize: 5 * 1024 * 1024,
    },
  });

  // 3. Register Fastify Static to serve uploaded media files at /uploads/*
  const uploadsDir = process.env.UPLOADS_DIR || fileURLToPath(new URL('../uploads', import.meta.url));
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  await app.register(fastifyStatic, {
    root: uploadsDir,
    prefix: '/uploads/',
    decorateReply: false,
  });

  // 4. Request context hook to extract user identity exclusively from the Bearer JWT (SEC-02)
  app.addHook('preHandler', async (request, reply) => {
    let currentUserId: string | null = null;
    const authHeader = request.headers['authorization'];
    if (typeof authHeader === 'string') {
      const match = authHeader.match(/^bearer\s+(.+)$/i);
      if (match) {
        const token = match[1].trim();

        // Zero-Trust Token Revocation Check
        if (tokenRevocationManager.isRevoked(token)) {
          reply.status(401).send({
            success: false,
            error: {
              code: 'TOKEN_REVOKED',
              message: 'Mã xác thực đã bị thu hồi. Vui lòng đăng nhập lại.',
            },
          });
          return reply;
        }

        try {
          const decoded = jwt.verify(token, JWT_SECRET) as { userId?: string };
          if (decoded && decoded.userId) {
            currentUserId = decoded.userId;
          }
        } catch {
          // Invalid or expired token, do not allow bypass
        }
      }
    }

    // Zero-Trust Guard (SEC-02): identity comes exclusively from the Bearer JWT.
    // The legacy x-user-id identity channel has been removed entirely.
    request.currentUserId = currentUserId;
  });

  // 3. Centralized Error Handler adhering to standard ApiResponse format
  app.setErrorHandler((error, request, reply) => {
    const statusCode = error.statusCode || 500;
    const code = error.code || (statusCode === 404 ? 'NOT_FOUND' : 'INTERNAL_SERVER_ERROR');

    reply.status(statusCode).send({
      success: false,
      error: {
        code,
        message: error.message || 'An unexpected error occurred',
      },
    });
  });

  // 4. Health check routes
  app.get('/health', async () => ({
    success: true,
    status: 'ok',
    timestamp: new Date().toISOString(),
  }));

  app.get('/api/v1/health', async () => ({
    success: true,
    status: 'ok',
    timestamp: new Date().toISOString(),
  }));

  // 5. Register all API routes (definitions live in src/routes/registerRoutes.ts)
  await app.register(async (v1) => {
    await registerV1Routes(v1);
  }, { prefix: '/api/v1' });

  // Deprecated root-level aliases for backward compatibility (see INF-02)
  await registerLegacyRootAliases(app);

  // Start background schedulers & workers
  pollExpirationSchedulerService.start();
  activityDeliveryWorkerService.start();
  postImpressionsBufferService.start();

  app.addHook('onClose', async () => {
    pollExpirationSchedulerService.stop();
    activityDeliveryWorkerService.stop();
    await postImpressionsBufferService.flush();
    postImpressionsBufferService.stop();
  });

  return app;
}

export const app = await buildApp();

// Direct execution entrypoint
const isMain =
  Boolean(process.argv[1]) &&
  (import.meta.url === `file://${process.argv[1]}` ||
    process.argv[1].endsWith('/app.ts') ||
    process.argv[1].endsWith('/app.js'));

if (isMain) {
  const port = parseInt(process.env.PORT || '3001', 10);
  const host = process.env.HOST || '0.0.0.0';

  try {
    await app.listen({ port, host });
    console.log(`🚀 Pulse Social backend server is running on http://${host}:${port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

export default app;

import 'dotenv/config';
import Fastify, { FastifyInstance, FastifyRequest, FastifyServerOptions } from 'fastify';
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
import { followRequestController } from './modules/users/FollowRequestController.js';
import { postController } from './modules/posts/PostController.js';
import { feedController } from './modules/feed/FeedController.js';
import { socialGraphController } from './modules/graph/SocialGraphController.js';
import { userController } from './modules/users/UserController.js';
import { authController } from './modules/auth/AuthController.js';
import { notificationController } from './modules/notifications/NotificationController.js';
import { realtimeStreamController } from './modules/notifications/RealtimeEventStreamController.js';
import { mediaUploadController } from './modules/media/MediaUploadController.js';
import { bookmarkController } from './modules/bookmarks/BookmarkController.js';
import { searchController } from './modules/search/SearchController.js';
import { pollController } from './modules/polls/PollController.js';
import { pollExpirationSchedulerService } from './modules/polls/PollExpirationSchedulerService.js';
import { dmController } from './modules/dm/DmController.js';
import { webFingerDiscoveryController } from './modules/federation/WebFingerDiscoveryController.js';
import { activityPubActorController } from './modules/federation/ActivityPubActorController.js';
import { activityPubInboxController } from './modules/federation/ActivityPubInboxController.js';
import { activityPubOutboxController } from './modules/federation/ActivityPubOutboxController.js';
import { activityDeliveryWorkerService } from './modules/federation/ActivityDeliveryWorkerService.js';
import { muteController } from './modules/mutes/MuteController.js';
import { nodeInfoController } from './modules/federation/NodeInfoController.js';
import { federationResolveController } from './modules/federation/FederationResolveController.js';
import { groupDmController } from './modules/dm/GroupDmController.js';
import { webPushController } from './modules/push/WebPushController.js';
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

  // 1b. Content Type Parser with rawBody preservation for HTTP Signatures & Digest verification
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

  // 5. Register API routes under /api/v1
  // SEC-05: strict per-route rate-limit buckets. Credential endpoints are keyed
  // by IP; publishing is keyed by authenticated user (falls back to IP).
  const AUTH_RATE_LIMIT = { max: 10, timeWindow: '1 minute' };
  const REFRESH_RATE_LIMIT = { max: 30, timeWindow: '1 minute' };
  const PUBLISH_RATE_LIMIT = {
    hook: 'preHandler' as const,
    keyGenerator: (request: FastifyRequest) => request.currentUserId || request.ip,
    max: 20,
    timeWindow: '1 minute',
  };
  const UPLOAD_RATE_LIMIT = { max: 20, timeWindow: '1 hour' };

  await app.register(
    async (v1) => {
      // Auth Endpoints
      v1.post('/auth/register', { config: { rateLimit: AUTH_RATE_LIMIT } }, authController.register.bind(authController));
      v1.post('/auth/login', { config: { rateLimit: AUTH_RATE_LIMIT } }, authController.login.bind(authController));
      v1.post('/auth/refresh', { config: { rateLimit: REFRESH_RATE_LIMIT } }, authController.refreshToken.bind(authController));
      v1.post('/auth/logout', authController.logout.bind(authController));
      v1.get('/auth/me', authController.getMe.bind(authController));

      // Post & Thread Endpoints
      v1.post('/posts', { config: { rateLimit: PUBLISH_RATE_LIMIT } }, postController.createPost.bind(postController));
      v1.get('/posts/:id', postController.getPost.bind(postController));
      v1.get('/posts/:id/thread', postController.getThread.bind(postController));
      v1.patch('/posts/:id', postController.updatePost.bind(postController));
      v1.put('/posts/:id', postController.updatePost.bind(postController));
      v1.post('/posts/:id/like', postController.toggleLike.bind(postController));
      v1.post('/posts/:id/repost', postController.toggleRepost.bind(postController));
      v1.post('/posts/:id/bookmark', bookmarkController.toggleBookmark.bind(bookmarkController));
      v1.get('/posts/:id/versions', postController.getVersions.bind(postController));
      v1.post('/posts/:id/pin', postController.pinPost.bind(postController));
      v1.delete('/posts/:id/pin', postController.unpinPost.bind(postController));

      // Bookmark Endpoints
      v1.get('/bookmarks', bookmarkController.getBookmarks.bind(bookmarkController));

      // Media Upload Endpoint
      v1.post('/media/upload', { config: { rateLimit: UPLOAD_RATE_LIMIT } }, mediaUploadController.upload.bind(mediaUploadController));

      // Feed & Timeline Endpoints
      v1.get('/feed/home', feedController.getHomeFeed.bind(feedController));
      v1.get('/feed/for-you', feedController.getForYouFeed.bind(feedController));
      v1.get('/feed/user/:username', feedController.getUserFeed.bind(feedController));

      // Post Views & Impressions Buffer Endpoints
      v1.post('/posts/views', postController.recordViews.bind(postController));
      v1.post('/posts/:id/view', postController.recordSingleView.bind(postController));

      // Social Graph Endpoints
      v1.post('/graph/follow', socialGraphController.follow.bind(socialGraphController));
      v1.post('/graph/unfollow', socialGraphController.unfollow.bind(socialGraphController));
      v1.post('/graph/block', socialGraphController.block.bind(socialGraphController));
      v1.post('/graph/unblock', socialGraphController.unblock.bind(socialGraphController));

      // Private Accounts & Follow Requests Endpoints (TASK-21)
      v1.post('/users/:id/follow', socialGraphController.followUserById.bind(socialGraphController));
      v1.post('/users/:id/unfollow', socialGraphController.unfollowUserById.bind(socialGraphController));
      v1.get('/users/follow-requests', followRequestController.getPendingRequests.bind(followRequestController));
      v1.post('/users/follow-requests/:id/accept', followRequestController.acceptRequest.bind(followRequestController));
      v1.post('/users/follow-requests/:id/reject', followRequestController.rejectRequest.bind(followRequestController));
      v1.delete('/users/:id/follow-request', followRequestController.cancelRequest.bind(followRequestController));
      v1.delete('/users/follow-requests/:id', followRequestController.cancelRequest.bind(followRequestController));
      v1.get('/users/:username/followers', userController.getUserFollowers.bind(userController));
      v1.get('/users/:username/following', userController.getUserFollowing.bind(userController));

      // User Profile Endpoints
      v1.patch('/users/profile', userController.updateProfile.bind(userController));
      v1.get('/users/me', userController.getMe.bind(userController));
      v1.get('/users/:username', userController.getProfile.bind(userController));
      v1.get('/users/:username/posts', userController.getUserPosts.bind(userController));

      // Trust & Safety Mute Endpoints (User & Keyword Mutes)
      v1.post('/users/:id/mute', muteController.muteUser.bind(muteController));
      v1.delete('/users/:id/mute', muteController.unmuteUser.bind(muteController));
      v1.get('/mutes/users', muteController.getMutedUsers.bind(muteController));
      v1.post('/mutes/keywords', muteController.muteKeyword.bind(muteController));
      v1.get('/mutes/keywords', muteController.getMutedKeywords.bind(muteController));
      v1.delete('/mutes/keywords/:id', muteController.unmuteKeyword.bind(muteController));

      // Notifications Endpoints
      v1.get('/notifications', notificationController.getNotifications.bind(notificationController));
      v1.patch('/notifications/read-all', notificationController.markAllAsRead.bind(notificationController));

      // Search & Discovery Endpoints
      v1.get('/search', searchController.search.bind(searchController));
      v1.get('/trending', searchController.getTrending.bind(searchController));

      // Real-Time SSE Stream Endpoint (SEC-01: one-time ticket auth)
      v1.post('/realtime/ticket', realtimeStreamController.requestTicket.bind(realtimeStreamController));
      v1.get('/realtime/stream', realtimeStreamController.handleStream.bind(realtimeStreamController));

      // Interactive Polls Endpoints (/api/v1/polls)
      v1.post('/polls', pollController.createPoll.bind(pollController));
      v1.get('/polls/:id', pollController.getPoll.bind(pollController));
      v1.post('/polls/:id/vote', pollController.votePoll.bind(pollController));
      v1.delete('/polls/:id', pollController.deletePoll.bind(pollController));

      // Direct Messaging (1-1 DMs) Endpoints (/api/v1/dm)
      v1.post('/dm/conversations', dmController.createConversation.bind(dmController));
      v1.get('/dm/conversations', dmController.listConversations.bind(dmController));
      v1.get('/dm/conversations/:id/messages', dmController.getMessages.bind(dmController));
      v1.post('/dm/conversations/:id/messages', dmController.sendMessage.bind(dmController));
      v1.put('/dm/conversations/:id/read', dmController.markAsRead.bind(dmController));
      v1.delete('/dm/messages/:id', dmController.deleteMessage.bind(dmController));

      // Group Direct Messaging (Group DMs) Endpoints (/api/v1/dm/groups)
      v1.post('/dm/groups', groupDmController.createGroup.bind(groupDmController));
      v1.get('/dm/groups', groupDmController.listGroups.bind(groupDmController));
      v1.get('/dm/groups/:id', groupDmController.getGroup.bind(groupDmController));
      v1.patch('/dm/groups/:id', groupDmController.updateGroup.bind(groupDmController));
      v1.post('/dm/groups/:id/members', groupDmController.addMember.bind(groupDmController));
      v1.delete('/dm/groups/:id/members/:userId', groupDmController.removeMember.bind(groupDmController));
      v1.post('/dm/groups/:id/messages', groupDmController.sendMessage.bind(groupDmController));
      v1.get('/dm/groups/:id/messages', groupDmController.getMessages.bind(groupDmController));
      v1.delete('/dm/groups/:id/messages/:messageId', groupDmController.deleteMessage.bind(groupDmController));
      v1.put('/dm/groups/:id/read', groupDmController.markAsRead.bind(groupDmController));

      // Web Push Notifications Endpoints (/api/v1/push)
      v1.get('/push/vapid-public-key', webPushController.getVapidPublicKey.bind(webPushController));
      v1.post('/push/subscriptions', webPushController.registerSubscription.bind(webPushController));
      v1.delete('/push/subscriptions', webPushController.unregisterSubscription.bind(webPushController));
      v1.post('/push/test', webPushController.sendTestNotification.bind(webPushController));

      // Federation Remote Discovery Endpoint (/api/v1/federation/resolve)
      v1.post('/federation/resolve', federationResolveController.resolve.bind(federationResolveController));
    },
    { prefix: '/api/v1' }
  );

  // Poll endpoints at root level (/polls, /polls/:id, /polls/:id/vote)
  app.post('/polls', pollController.createPoll.bind(pollController));
  app.get('/polls/:id', pollController.getPoll.bind(pollController));
  app.post('/polls/:id/vote', pollController.votePoll.bind(pollController));
  app.delete('/polls/:id', pollController.deletePoll.bind(pollController));

  // Direct Messaging endpoints at root level (/dm/...)
  app.post('/dm/conversations', dmController.createConversation.bind(dmController));
  app.get('/dm/conversations', dmController.listConversations.bind(dmController));
  app.get('/dm/conversations/:id/messages', dmController.getMessages.bind(dmController));
  app.post('/dm/conversations/:id/messages', dmController.sendMessage.bind(dmController));
  app.put('/dm/conversations/:id/read', dmController.markAsRead.bind(dmController));
  app.delete('/dm/messages/:id', dmController.deleteMessage.bind(dmController));

  // Group DM endpoints at root level (/dm/groups)
  app.post('/dm/groups', groupDmController.createGroup.bind(groupDmController));
  app.get('/dm/groups', groupDmController.listGroups.bind(groupDmController));
  app.get('/dm/groups/:id', groupDmController.getGroup.bind(groupDmController));
  app.patch('/dm/groups/:id', groupDmController.updateGroup.bind(groupDmController));
  app.post('/dm/groups/:id/members', groupDmController.addMember.bind(groupDmController));
  app.delete('/dm/groups/:id/members/:userId', groupDmController.removeMember.bind(groupDmController));
  app.post('/dm/groups/:id/messages', groupDmController.sendMessage.bind(groupDmController));
  app.get('/dm/groups/:id/messages', groupDmController.getMessages.bind(groupDmController));
  app.delete('/dm/groups/:id/messages/:messageId', groupDmController.deleteMessage.bind(groupDmController));
  app.put('/dm/groups/:id/read', groupDmController.markAsRead.bind(groupDmController));

  // Feed For-You at root level
  app.get('/feed/for-you', feedController.getForYouFeed.bind(feedController));

  // Auth endpoints at root level
  app.post('/auth/refresh', authController.refreshToken.bind(authController));
  app.post('/auth/logout', authController.logout.bind(authController));

  // Follow Request endpoints at root level
  app.post('/users/:id/follow', socialGraphController.followUserById.bind(socialGraphController));
  app.post('/users/:id/unfollow', socialGraphController.unfollowUserById.bind(socialGraphController));
  app.get('/users/follow-requests', followRequestController.getPendingRequests.bind(followRequestController));
  app.post('/users/follow-requests/:id/accept', followRequestController.acceptRequest.bind(followRequestController));
  app.post('/users/follow-requests/:id/reject', followRequestController.rejectRequest.bind(followRequestController));
  app.delete('/users/:id/follow-request', followRequestController.cancelRequest.bind(followRequestController));
  app.delete('/users/follow-requests/:id', followRequestController.cancelRequest.bind(followRequestController));
  app.get('/users/:username/followers', userController.getUserFollowers.bind(userController));
  app.get('/users/:username/following', userController.getUserFollowing.bind(userController));

  // Post Views at root level
  app.post('/posts/views', postController.recordViews.bind(postController));
  app.post('/posts/:id/view', postController.recordSingleView.bind(postController));

  // Web Push endpoints at root level
  app.get('/push/vapid-public-key', webPushController.getVapidPublicKey.bind(webPushController));
  app.post('/push/subscriptions', webPushController.registerSubscription.bind(webPushController));
  app.delete('/push/subscriptions', webPushController.unregisterSubscription.bind(webPushController));
  app.post('/push/test', webPushController.sendTestNotification.bind(webPushController));

  // Post Version History & Pinning Endpoints at root level
  app.get('/posts/:id/versions', postController.getVersions.bind(postController));
  app.post('/posts/:id/pin', postController.pinPost.bind(postController));
  app.delete('/posts/:id/pin', postController.unpinPost.bind(postController));
  app.get('/users/:username/posts', userController.getUserPosts.bind(userController));

  // Mute endpoints at root level
  app.post('/users/:id/mute', muteController.muteUser.bind(muteController));
  app.delete('/users/:id/mute', muteController.unmuteUser.bind(muteController));
  app.get('/mutes/users', muteController.getMutedUsers.bind(muteController));
  app.post('/mutes/keywords', muteController.muteKeyword.bind(muteController));
  app.get('/mutes/keywords', muteController.getMutedKeywords.bind(muteController));
  app.delete('/mutes/keywords/:id', muteController.unmuteKeyword.bind(muteController));

  // ActivityPub & WebFinger Fediverse Endpoints (W3C / Mastodon / Threads)
  app.get('/.well-known/webfinger', webFingerDiscoveryController.handle.bind(webFingerDiscoveryController));
  app.get('/actor', activityPubActorController.getInstanceActor.bind(activityPubActorController));
  app.get('/actor/outbox', activityPubOutboxController.getInstanceOutbox.bind(activityPubOutboxController));
  app.get('/users/:username', activityPubActorController.getUserActor.bind(activityPubActorController));
  app.get('/users/:username/outbox', activityPubOutboxController.getUserOutbox.bind(activityPubOutboxController));
  app.post('/inbox', activityPubInboxController.handleSharedInbox.bind(activityPubInboxController));
  app.post('/users/:username/inbox', activityPubInboxController.handlePersonalInbox.bind(activityPubInboxController));

  // NodeInfo 2.1 & FEP-0151 Discovery Endpoints
  app.get('/.well-known/nodeinfo', nodeInfoController.getWellKnown.bind(nodeInfoController));
  app.get('/nodeinfo/2.1', nodeInfoController.getNodeInfo21.bind(nodeInfoController));
  app.get('/nodeinfo/2.0', nodeInfoController.getNodeInfo20.bind(nodeInfoController));
  app.post('/federation/resolve', federationResolveController.resolve.bind(federationResolveController));

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

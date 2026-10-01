/**
 * Route registration (INF-02): toàn bộ định nghĩa route của Pulse tập trung tại đây,
 * tách khỏi bootstrap của app.ts.
 *
 *  - registerV1Routes(scope)         : bộ API chính dưới prefix /api/v1.
 *  - registerLegacyRootAliases(app)  : các alias root-level tồn tại từ trước cho
 *      tương thích ngược client cũ. KHÔNG thêm alias mới; client mới phải dùng /api/v1.
 *      Lưu ý: các alias này chia sẻ handler với bản /api/v1 và chỉ áp dụng
 *      rate-limit global (SEC-05), không có bucket nghiêm ngặt riêng.
 */
import { FastifyInstance, FastifyRequest } from 'fastify';
import { followRequestController } from '../modules/users/FollowRequestController.js';
import { postController } from '../modules/posts/PostController.js';
import { feedController } from '../modules/feed/FeedController.js';
import { socialGraphController } from '../modules/graph/SocialGraphController.js';
import { userController } from '../modules/users/UserController.js';
import { authController } from '../modules/auth/AuthController.js';
import { notificationController } from '../modules/notifications/NotificationController.js';
import { realtimeStreamController } from '../modules/notifications/RealtimeEventStreamController.js';
import { mediaUploadController } from '../modules/media/MediaUploadController.js';
import { bookmarkController } from '../modules/bookmarks/BookmarkController.js';
import { searchController } from '../modules/search/SearchController.js';
import { pollController } from '../modules/polls/PollController.js';
import { dmController } from '../modules/dm/DmController.js';
import { webFingerDiscoveryController } from '../modules/federation/WebFingerDiscoveryController.js';
import { activityPubActorController } from '../modules/federation/ActivityPubActorController.js';
import { activityPubInboxController } from '../modules/federation/ActivityPubInboxController.js';
import { activityPubOutboxController } from '../modules/federation/ActivityPubOutboxController.js';
import { muteController } from '../modules/mutes/MuteController.js';
import { nodeInfoController } from '../modules/federation/NodeInfoController.js';
import { federationResolveController } from '../modules/federation/FederationResolveController.js';
import { groupDmController } from '../modules/dm/GroupDmController.js';
import { webPushController } from '../modules/push/WebPushController.js';
import { moderationController } from '../modules/moderation/ModerationController.js';
import { linkPreviewService } from '../modules/linkpreview/LinkPreviewService.js';

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

/**
 * Đăng ký toàn bộ API chính. Gọi với scope có prefix '/api/v1'.
 */
export async function registerV1Routes(v1: FastifyInstance): Promise<void> {
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
  v1.delete('/users/me', userController.deleteMe.bind(userController));
  v1.get('/users/me/stats', userController.getMyStats.bind(userController));
  v1.get('/users/me/export', userController.exportMe.bind(userController));
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
      v1.post('/dm/conversations/:id/typing', dmController.sendTyping.bind(dmController));
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

  // PKG-01: OpenGraph Link Preview
  v1.get('/link-preview', linkPreviewService.getPreview);

  // PKG-04: Report & Moderation Endpoints
  v1.post('/reports', moderationController.createReport.bind(moderationController));
  v1.get('/admin/reports', moderationController.listReports.bind(moderationController));
  v1.patch('/admin/reports/:id/resolve', moderationController.resolveReport.bind(moderationController));
}

/**
 * Deprecated root-level aliases (tương thích client cũ). Không thêm route mới vào đây.
 */
export async function registerLegacyRootAliases(app: FastifyInstance): Promise<void> {
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
  // Đây là route chuẩn của federation (không phải alias) — luôn phục vụ ở root.
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
}

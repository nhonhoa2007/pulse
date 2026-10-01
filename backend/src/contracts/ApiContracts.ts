export interface UserDto {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  isCelebrity: boolean;
  followersCount: number;
  followingCount: number;
  postsCount: number;
  isFollowing?: boolean;
  isBlocked?: boolean;
  isPrivate?: boolean;
  hasPendingFollowRequest?: boolean;
  isLocked?: boolean;
  isRemote?: boolean;
  domain?: string | null;
  actorUri?: string | null;
  createdAt: string;
}

export type ReplyPrivacy = 'EVERYONE' | 'FOLLOWING' | 'MENTIONED';

export interface PostDto {
  id: string;
  authorId: string;
  content: string;
  mediaUrls: string[];
  replyToId: string | null;
  rootPostId: string | null;
  repostOfId: string | null;
  quoteOfId: string | null;
  reply_privacy?: ReplyPrivacy;
  replyPrivacy?: ReplyPrivacy;
  canReply?: boolean;

  isEdited?: boolean;
  editCount?: number;
  lastEditedAt?: string | null;
  isPinned?: boolean;
  isSensitive?: boolean;
  contentWarning?: string | null;

  likesCount: number;
  repliesCount: number;
  repostsCount: number;
  quotesCount: number;
  viewsCount?: number;
  hashtags: string[];
  mentions: string[];
  isLiked?: boolean;
  isReposted?: boolean;
  isBookmarked?: boolean;
  createdAt: string;
  author: {
    id: string;
    username: string;
    displayName: string;
    avatarUrl: string | null;
    isCelebrity: boolean;
  };
  poll?: PollDto | null;
  replyTo?: {
    id: string;
    author: {
      username: string;
      displayName: string;
    };
  } | null;
  quoteOf?: PostDto | null;
  repostOf?: PostDto | null;
}

export interface NotificationDto {
  id: string;
  recipientId: string;
  actorId: string;
  verb: 'LIKE' | 'REPLY' | 'REPOST' | 'QUOTE' | 'MENTION' | 'FOLLOW' | 'FOLLOW_REQUEST' | 'FOLLOW_ACCEPT';
  targetType: 'POST' | 'USER';
  targetId: string;
  aggregatedCount: number;
  actorSummary: string;
  isRead: boolean;
  createdAt: string;
  actor: {
    username: string;
    displayName: string;
    avatarUrl: string | null;
  };
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

export interface CreatePostInput {
  content: string;
  mediaUrls?: string[];
  replyToId?: string;
  quoteOfId?: string;
  reply_privacy?: ReplyPrivacy;
  replyPrivacy?: ReplyPrivacy;
  isSensitive?: boolean;
  contentWarning?: string;
}

export interface UpdatePostInput {
  content?: string;
  mediaUrls?: string[];
  reply_privacy?: ReplyPrivacy;
  replyPrivacy?: ReplyPrivacy;
  isSensitive?: boolean;
  contentWarning?: string;
}

// ----------------------------------------------------
// TASK-18 TRUST & SAFETY DTOs
// ----------------------------------------------------

export interface PostVersionDto {
  id: string;
  postId: string;
  versionNumber: number;
  content: string;
  mediaUrls: string[];
  contentWarning: string | null;
  isSensitive: boolean;
  hashtags: string[];
  mentions: string[];
  editorId: string;
  createdAt: string;
}

export interface PostVersionsResponse {
  postId: string;
  current: {
    versionNumber: number;
    content: string;
    mediaUrls: string[];
    contentWarning: string | null;
    isSensitive: boolean;
    editedAt: string | null;
  };
  versions: PostVersionDto[];
}

export interface PinPostResult {
  pinnedPostId: string | null;
  isPinned: boolean;
  message: string;
}

export interface UserMuteDto {
  id: string;
  muterId: string;
  mutedId: string;
  mutedUser: {
    id: string;
    username: string;
    displayName: string;
    avatarUrl: string | null;
  };
  createdAt: string;
}

export type MuteMatchType = 'CONTAINS' | 'EXACT_WORD';
export type MuteContext = 'ALL' | 'HOME_TIMELINE' | 'NOTIFICATIONS';

export interface KeywordMuteDto {
  id: string;
  userId: string;
  keyword: string;
  matchType: MuteMatchType;
  muteContext: MuteContext;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateKeywordMuteInput {
  keyword: string;
  matchType?: MuteMatchType;
  muteContext?: MuteContext;
  durationDays?: number; // e.g. 1, 7, 30, or undefined for forever
}

export interface ToggleLikeResult {
  liked: boolean;
  likesCount: number;
}

export interface ToggleRepostResult {
  reposted: boolean;
  repostsCount: number;
}

export interface ToggleBookmarkResult {
  bookmarked: boolean;
}

export interface MediaUploadResult {
  url: string;
  relativeUrl: string;
}

export interface FeedResponse {
  posts: PostDto[];
  nextCursor: string | null;
  isLocked?: boolean;
}

export interface ConversationThreadResponse {
  rootPost: PostDto;
  replies: PostDto[];
  thread?: PostDto[];
}

export interface SearchResultData {
  posts: PostDto[];
  users: UserDto[];
  query: string;
  federatedResult?: {
    actorUri: string;
    username: string;
    domain: string;
    displayName: string;
    bio?: string | null;
    avatarUrl?: string | null;
    isRemote: true;
    shadowUserId: string;
    inboxUrl: string;
    sharedInboxUrl?: string | null;
    isFollowing?: boolean;
  } | null;
}

export interface TrendingItemDto {
  tag: string;
  postsCount: number;
  score?: number;
}

export interface TrendingResponseData {
  trending: TrendingItemDto[];
}

export interface PollChoiceDto {
  id: string;
  index: number;
  text: string;
  voteCount: number;
  vote_count: number;
  percentage: number;
}

export interface PollDto {
  id: string;
  postId: string | null;
  post_id: string | null;
  question: string;
  choices: PollChoiceDto[];
  totalVotes: number;
  total_votes: number;
  createdAt: string;
  created_at: string;
  expiresAt: string;
  expires_at: string;
  isActive: boolean;
  is_active: boolean;
  userVotedChoiceIndex?: number | null;
  user_voted_choice_index?: number | null;
  userHasVoted?: boolean;
  user_has_voted?: boolean;
}

export interface CreatePollInput {
  postId?: string;
  post_id?: string;
  question: string;
  choices: (string | { text: string })[];
  durationMinutes?: number;
  duration_minutes?: number;
  durationSeconds?: number;
  duration_seconds?: number;
  expiresAt?: string | Date;
  expires_at?: string | Date;
}

export interface VotePollInput {
  choiceIndex?: number;
  choice_index?: number;
  choiceId?: string;
  choice_id?: string;
  userId?: string;
  user_id?: string;
}


export interface RegisterInput {
  username: string;
  email: string;
  password: string;
  displayName: string;
}

export interface LoginInput {
  identifier: string;
  password: string;
}

export interface AuthResponseData {
  user: UserDto;
  token: string;
  accessToken?: string;
  refreshToken?: string;
}

export interface UpdateProfileInput {
  displayName?: string;
  bio?: string | null;
  avatarUrl?: string | null;
  isPrivate?: boolean;
}

// ==========================================
// 1-1 DIRECT MESSAGING (DM) CONTRACTS
// ==========================================

export interface DmUserSummaryDto {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface DmReactionSummaryDto {
  emoji: string;
  count: number;
  userIds: string[];
}

export interface DmMessageDto {
  id: string;
  conversationId: string;
  senderId: string;
  content: string;
  messageType: 'TEXT' | 'IMAGE' | 'SYSTEM';
  mediaUrls: string[];
  isDeleted: boolean;
  createdAt: string;
  updatedAt: string;
  sender?: DmUserSummaryDto;
  reactions?: DmReactionSummaryDto[];
}

export interface DmConversationDto {
  id: string;
  participant1Id: string;
  participant2Id: string;
  createdAt: string;
  updatedAt: string;
  otherUser: DmUserSummaryDto;
  lastMessage: DmMessageDto | null;
  unreadCount: number;
  isBlocked?: boolean;
}

export interface DmReadReceiptDto {
  conversationId: string;
  userId: string;
  lastReadMessageId: string | null;
  readAt: string;
}

export interface CreateDmConversationInput {
  recipientId: string;
}

export interface SendDmMessageInput {
  content: string;
  messageType?: 'TEXT' | 'IMAGE';
  mediaUrls?: string[];
}

export interface MarkDmReadInput {
  messageId?: string;
}

export interface DmConversationListResponse {
  conversations: DmConversationDto[];
  nextCursor: string | null;
}

export interface DmMessageListResponse {
  conversationId: string;
  messages: DmMessageDto[];
  nextCursor: string | null;
  hasMore: boolean;
}

export type DmRealtimeEventType =
  | 'dm.message.new'
  | 'dm.message.deleted'
  | 'dm.read_receipt.updated';

export interface DmMessageNewEventData {
  conversationId: string;
  message: DmMessageDto;
}

export interface DmMessageDeletedEventData {
  conversationId: string;
  messageId: string;
  deletedAt: string;
}

export interface DmReadReceiptUpdatedEventData {
  conversationId: string;
  userId: string;
  lastReadMessageId: string | null;
  readAt: string;
}

// ==========================================
// GROUP DIRECT MESSAGING CONTRACTS (TASK-20)
// ==========================================

export type GroupMemberRole = 'ADMIN' | 'MEMBER';

export interface GroupMemberDto {
  id: string;
  conversationId: string;
  userId: string;
  role: GroupMemberRole;
  joinedAt: string;
  user: DmUserSummaryDto;
}

export interface GroupMessageDto {
  id: string;
  conversationId: string;
  senderId: string;
  content: string;
  messageType: 'TEXT' | 'IMAGE' | 'SYSTEM';
  mediaUrls: string[];
  isDeleted: boolean;
  createdAt: string;
  updatedAt: string;
  sender?: DmUserSummaryDto;
  reactions?: DmReactionSummaryDto[];
}

export interface GroupConversationDto {
  id: string;
  title: string;
  avatarUrl: string | null;
  creatorId: string;
  createdAt: string;
  updatedAt: string;
  members: GroupMemberDto[];
  lastMessage: GroupMessageDto | null;
  unreadCount: number;
  myRole?: GroupMemberRole;
}

export interface GroupReadReceiptDto {
  conversationId: string;
  userId: string;
  lastReadMessageId: string | null;
  readAt: string;
}

export interface CreateGroupConversationInput {
  title: string;
  memberIds: string[];
  avatarUrl?: string;
}

export interface UpdateGroupConversationInput {
  title?: string;
  avatarUrl?: string;
}

export interface AddGroupMemberInput {
  userId: string;
  role?: GroupMemberRole;
}

export interface SendGroupMessageInput {
  content: string;
  messageType?: 'TEXT' | 'IMAGE';
  mediaUrls?: string[];
}

export interface MarkGroupReadInput {
  messageId?: string;
}

export interface GroupConversationListResponse {
  groups: GroupConversationDto[];
  nextCursor: string | null;
}

export interface GroupMessageListResponse {
  conversationId: string;
  messages: GroupMessageDto[];
  nextCursor: string | null;
  hasMore: boolean;
}

export type GroupDmRealtimeEventType =
  | 'dm.group.message.new'
  | 'dm.group.message.deleted'
  | 'dm.group.member.joined'
  | 'dm.group.member.left'
  | 'dm.group.read_receipt.updated'
  | 'dm.group.updated';

export interface GroupMessageNewEventData {
  conversationId: string;
  message: GroupMessageDto;
}

export interface GroupMemberJoinedEventData {
  conversationId: string;
  member: GroupMemberDto;
}

export interface GroupMemberLeftEventData {
  conversationId: string;
  userId: string;
}

// ==========================================
// POST VIEWS & IMPRESSIONS BUFFER CONTRACTS
// ==========================================

export interface RecordPostViewsInput {
  postIds: string[];
}

export interface RecordPostViewsResponse {
  recorded: number;
  buffered: number;
}

// ==========================================
// WEB PUSH NOTIFICATIONS (RFC 8030 / RFC 8292)
// ==========================================

export interface WebPushSubscriptionKeys {
  p256dh: string;
  auth: string;
}

export interface WebPushSubscriptionDto {
  id: string;
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string | null;
  createdAt: string;
}

export interface RegisterWebPushSubscriptionInput {
  endpoint: string;
  keys: WebPushSubscriptionKeys;
  userAgent?: string;
}

export interface UnregisterWebPushSubscriptionInput {
  endpoint: string;
}

export interface VapidPublicKeyResponse {
  publicKey: string;
}

export interface SendPushNotificationResult {
  success: boolean;
  endpoint: string;
  statusCode?: number;
  error?: string;
}

// ----------------------------------------------------
// TASK-21: AUTH HARDENING & PRIVATE ACCOUNTS CONTRACTS
// ----------------------------------------------------

export type FollowRequestStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED';

export interface FollowRequestDto {
  id: string;
  requesterId: string;
  targetUserId: string;
  status: FollowRequestStatus;
  requester: {
    id: string;
    username: string;
    displayName: string;
    avatarUrl: string | null;
  };
  targetUser?: {
    id: string;
    username: string;
    displayName: string;
    avatarUrl: string | null;
  };
  createdAt: string;
  updatedAt: string;
}

export interface FollowActionResponse {
  status: 'FOLLOWING' | 'REQUESTED' | 'UNFOLLOWED';
  isFollowing: boolean;
  hasPendingFollowRequest: boolean;
  following?: boolean;
  followRequest?: FollowRequestDto | null;
}

export interface RefreshTokenResponseDto {
  accessToken: string;
  user: UserDto;
}

export interface LogoutResponseDto {
  success: boolean;
  message: string;
}

export * from './ActivityPubContracts.js';


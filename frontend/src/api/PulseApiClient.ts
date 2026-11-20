import type {
  ApiResponse,
  CreatePostPayload,
  NotificationDto,
  PollDto,
  PostDto,
  RealtimeEvent,
  ThreadDto,
  UserDto,
  DmConversationDto,
  DmConversationListResponse,
  DmMessageDto,
  DmMessageListResponse,
  DmReadReceiptDto,
  SendDmMessageInput,
  UpdatePostInput,
  PostVersionsResponse,
  PinPostResult,
  UserMuteDto,
  KeywordMuteDto,
  CreateKeywordMuteInput,
  SearchResultDto,
  RemoteActorDiscoveryResult,
  RecordPostViewsResponse,
  GroupConversationDto,
  GroupConversationListResponse,
  CreateGroupConversationInput,
  UpdateGroupConversationInput,
  AddGroupMemberInput,
  GroupMemberDto,
  GroupMessageDto,
  GroupMessageListResponse,
  SendGroupMessageInput,
  WebPushSubscriptionDto,
  RegisterWebPushSubscriptionInput,
  FollowRequestDto,
  FollowActionResponse,
  LogoutResponseDto,
  FeedPage,
} from '../types/PulseTypes.ts';
import { ApiError, PulseApiCore, IS_DEV } from './core.ts';
import { FeedApi } from './domains/FeedApi.ts';
import { RealtimeClient } from './domains/RealtimeClient.ts';

// SEC-06: môi trường dev detection chuyển vào api/core.ts (IS_DEV export dùng chung).

// SEC-02: Demo User Switcher đăng nhập thật qua /auth/login bằng mật khẩu seed chung.
export const DEMO_LOGIN_PASSWORD = 'PulseDemo2026!';

// Initial fallback mock users matching backend prisma seed
export const PRESET_USERS: UserDto[] = IS_DEV
  ? [
  {
    id: '11111111-1111-1111-1111-111111111111',
    username: 'hoa_dev',
    displayName: 'Hoà Phùng',
    avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150',
    bio: 'Arch Linux & Backend Enthusiast | Building high-concurrency systems 🚀',
    isCelebrity: false,
    followersCount: 2,
    followingCount: 3,
    postsCount: 2,
    createdAt: new Date().toISOString(),
  },
  {
    id: '22222222-2222-2222-2222-222222222222',
    username: 'alice',
    displayName: 'Alice Nguyễn',
    avatarUrl: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150',
    bio: 'Frontend Specialist & UX Lover 🎨',
    isCelebrity: false,
    followersCount: 1,
    followingCount: 1,
    postsCount: 1,
    createdAt: new Date().toISOString(),
  },
  {
    id: '33333333-3333-3333-3333-333333333333',
    username: 'bob',
    displayName: 'Bob Trần',
    avatarUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150',
    bio: 'Distributed Systems & Database nerd 💾',
    isCelebrity: false,
    followersCount: 1,
    followingCount: 1,
    postsCount: 0,
    createdAt: new Date().toISOString(),
  },
  {
    id: '44444444-4444-4444-4444-444444444444',
    username: 'sontungmtp',
    displayName: 'Sơn Tùng M-TP',
    avatarUrl: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150',
    bio: 'Official Pulse Account | Sky ơi 🎶',
    isCelebrity: true,
    followersCount: 5000000,
    followingCount: 0,
    postsCount: 1,
    createdAt: new Date().toISOString(),
  },
] : [
  {
    id: '',
    username: 'guest',
    displayName: 'Khách',
    avatarUrl: '',
    bio: '',
    isCelebrity: false,
    followersCount: 0,
    followingCount: 0,
    postsCount: 0,
    createdAt: new Date().toISOString(),
  },
];

class PulseApiClient extends PulseApiCore {
  private readonly feedApi = new FeedApi((endpoint, options) => this.request(endpoint, options));
  private readonly realtimeClient = new RealtimeClient({
    baseUrl: () => this.baseUrl,
    hasSession: () => Boolean(this.getToken()),
    getTicket: () => this.request('/realtime/ticket', { method: 'POST' }),
  });

  // ================= FEED APIS =================

  public async getHomeFeed(cursor?: string, limit = 20): Promise<FeedPage> {
    return this.feedApi.getHome(cursor, limit);
  }

  public async getForYouFeed(cursor?: string, limit = 20): Promise<FeedPage> {
    return this.feedApi.getForYou(cursor, limit);
  }

  public async recordPostViews(postIds: string[]): Promise<RecordPostViewsResponse> {
    return this.feedApi.recordViews(postIds || []);
  }

  public async getExploreFeed(cursor?: string, limit = 20): Promise<FeedPage> {
    return this.feedApi.getExplore(cursor, limit);
  }

  public async getUserFeed(username: string, cursor?: string, limit = 20): Promise<FeedPage> {
    return this.feedApi.getUser(username, cursor, limit);
  }

  // ================= POST APIS =================

  public async createPost(payload: CreatePostPayload): Promise<PostDto> {
    return this.request<PostDto>('/posts', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  public async updatePost(postId: string, payload: UpdatePostInput): Promise<PostDto> {
    return this.request<PostDto>(`/posts/${encodeURIComponent(postId)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  }

  public async getPostVersions(postId: string): Promise<PostVersionsResponse> {
    return this.request<PostVersionsResponse>(`/posts/${encodeURIComponent(postId)}/versions`);
  }

  public async pinPost(postId: string): Promise<PinPostResult> {
    return this.request<PinPostResult>(`/posts/${encodeURIComponent(postId)}/pin`, {
      method: 'POST',
    });
  }

  public async unpinPost(postId: string): Promise<PinPostResult> {
    return this.request<PinPostResult>(`/posts/${encodeURIComponent(postId)}/pin`, {
      method: 'DELETE',
    });
  }

  public async getPost(postId: string): Promise<PostDto> {
    return this.request<PostDto>(`/posts/${encodeURIComponent(postId)}`);
  }

  public async getPostThread(postId: string): Promise<ThreadDto> {
    const res = await this.request<any>(`/posts/${encodeURIComponent(postId)}/thread`);

    // Normalize response: backend might return { rootPost, replies } or PostDto[]
    if (Array.isArray(res)) {
      const rootPost = res.find((p: PostDto) => p.id === postId) || res[0];
      const replies = res.filter((p: PostDto) => p.id !== rootPost?.id);
      return { rootPost, replies };
    }

    if (res && res.rootPost) {
      return {
        rootPost: res.rootPost,
        replies: Array.isArray(res.replies) ? res.replies : [],
      };
    }

    // Fallback: fetch single post
    const singlePost = await this.getPost(postId);
    return {
      rootPost: singlePost,
      replies: [],
    };
  }

  // ================= INTERACTIONS =================

  public async toggleLike(postId: string): Promise<{ isLiked: boolean; likesCount: number }> {
    return this.request<{ isLiked: boolean; likesCount: number }>(`/posts/${encodeURIComponent(postId)}/like`, {
      method: 'POST',
    });
  }

  public async toggleRepost(postId: string): Promise<{ isReposted: boolean; repostsCount: number }> {
    return this.request<{ isReposted: boolean; repostsCount: number }>(`/posts/${encodeURIComponent(postId)}/repost`, {
      method: 'POST',
    });
  }

  public async toggleBookmark(postId: string): Promise<boolean> {
    const res = await this.request<{ bookmarked: boolean }>(`/posts/${encodeURIComponent(postId)}/bookmark`, {
      method: 'POST',
    });
    return res ? !!res.bookmarked : false;
  }

  // ================= PKG-01: LINK PREVIEW =================

  /** Lấy OpenGraph metadata của URL (SSRF-guarded, cache 24h server-side). */
  public async getLinkPreview(url: string): Promise<{
    url: string;
    domain: string;
    title: string;
    description: string;
    image: string | null;
    siteName: string;
    themeColor: string | null;
  } | null> {
    try {
      const res = await this.request<{ url: string; domain: string; title: string; description: string; image: string | null; siteName: string; themeColor: string | null } | null>(
        `/link-preview?url=${encodeURIComponent(url)}`
      );
      return res || null;
    } catch {
      return null;
    }
  }

  // ================= PKG-05: DM TYPING =================

  /** Heartbeat "đang soạn tin" — server throttle 2s, broadcast SSE dm.typing. */
  public async sendTypingHeartbeat(conversationId: string): Promise<{ sent: boolean }> {
    return this.request<{ sent: boolean }>(`/dm/conversations/${encodeURIComponent(conversationId)}/typing`, {
      method: 'POST',
    });
  }

  // ================= PKG-05: MESSAGE REACTIONS =================

  public async toggleDmMessageReaction(messageId: string, emoji: string): Promise<{
    messageId: string;
    toggledOn: boolean;
    reactions: Array<{ emoji: string; count: number; userIds: string[] }>;
  }> {
    return this.request(`/dm/messages/${encodeURIComponent(messageId)}/reactions`, {
      method: 'POST',
      body: JSON.stringify({ emoji }),
    });
  }

  public async toggleGroupMessageReaction(
    groupId: string,
    messageId: string,
    emoji: string
  ): Promise<{
    messageId: string;
    toggledOn: boolean;
    reactions: Array<{ emoji: string; count: number; userIds: string[] }>;
  }> {
    return this.request(
      `/dm/groups/${encodeURIComponent(groupId)}/messages/${encodeURIComponent(messageId)}/reactions`,
      { method: 'POST', body: JSON.stringify({ emoji }) }
    );
  }

  // ================= PKG-14: CREATOR STATS =================

  public async getMyStats(): Promise<unknown> {
    return this.request<unknown>('/users/me/stats');
  }

  // ================= PKG-04: REPORT & MODERATION =================

  /** Gửi báo cáo vi phạm cho POST / USER / DM_MESSAGE / GROUP_MESSAGE. */
  public async createReport(input: {
    targetType: 'POST' | 'USER' | 'DM_MESSAGE' | 'GROUP_MESSAGE';
    targetId: string;
    reason: string;
    details?: string;
  }): Promise<{ report: { id: string; status: string; autoScore: number; autoLabels: string[] } }> {
    return this.request<{ report: { id: string; status: string; autoScore: number; autoLabels: string[] } }>('/reports', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  /** Hàng đợi moderation (chỉ admin — backend chặn 403). */
  public async listAdminReports(params: { status?: string; limit?: number; offset?: number } = {}): Promise<{
    reports: unknown[];
    total: number;
  }> {
    const query = new URLSearchParams();
    if (params.status) query.append('status', params.status);
    if (params.limit) query.append('limit', String(params.limit));
    if (params.offset) query.append('offset', String(params.offset));
    const qs = query.toString() ? `?${query.toString()}` : '';
    return this.request<{ reports: unknown[]; total: number }>(`/admin/reports${qs}`);
  }

  /** Resolve một báo cáo (chỉ admin). */
  public async resolveAdminReport(
    reportId: string,
    action: 'DISMISS' | 'DELETE_POST' | 'SUSPEND_USER' | 'WARN_USER',
    note?: string
  ): Promise<{ report: unknown }> {
    return this.request<{ report: unknown }>(`/admin/reports/${encodeURIComponent(reportId)}/resolve`, {
      method: 'PATCH',
      body: JSON.stringify({ action, note }),
    });
  }

  public async getBookmarks(): Promise<PostDto[]> {
    const res = await this.request<any>('/bookmarks');
    if (Array.isArray(res)) return res;    if (res && Array.isArray(res.items)) return res.items;
    if (res && Array.isArray(res.posts)) return res.posts;
    return [];
  }

  // ================= MEDIA UPLOAD =================

  public async uploadMedia(file: File): Promise<string> {
    const formData = new FormData();
    formData.append('file', file);

    const headers: Record<string, string> = {
      ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
    };

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/media/upload`, {
        method: 'POST',
        credentials: 'include',
        headers,
        body: formData,
      });
    } catch (error) {
      throw new ApiError(
        error instanceof Error ? error.message : 'Không thể kết nối tới máy chủ',
        null,
        'NETWORK_ERROR'
      );
    }

    const contentType = res.headers.get('content-type');
    const isJson = contentType && contentType.includes('application/json');

    if (!res.ok) {
      let errorMessage = `HTTP ${res.status} - ${res.statusText}`;
      let errorCode = 'UPLOAD_FAILED';
      if (isJson) {
        try {
          const errData = await res.json();
          errorCode = errData.error?.code || errData.code || errorCode;
          if (errData.error?.message) {
            errorMessage = errData.error.message;
          } else if (errData.message) {
            errorMessage = errData.message;
          }
        } catch {
          // ignore parse failure
        }
      }
      throw new ApiError(errorMessage, res.status, errorCode);
    }

    const json = await res.json();
    if (json?.data?.relativeUrl) {
      return json.data.relativeUrl;
    }
    if (json?.data?.url) {
      return json.data.url;
    }
    if (json?.url) {
      return json.url;
    }
    throw new Error('Không thể lấy đường dẫn ảnh sau khi tải lên');
  }

  // ================= AUTH & PROFILE APIS =================

  public async register(data: {
    username: string;
    email: string;
    password: string;
    displayName: string;
  }): Promise<{ user: UserDto; token: string }> {
    const res = await this.request<{ user: UserDto; token: string }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    if (res.token) {
      this.setToken(res.token);
    }
    if (res.user?.id) {
      this.setActiveUserId(res.user.id);
    }
    return res;
  }

  public async login(
    identifier: string,
    password: string
  ): Promise<{ user: UserDto; token: string }> {
    const res = await this.request<{ user: UserDto; token: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier, password }),
    });
    if (res.token) {
      this.setToken(res.token);
    }
    if (res.user?.id) {
      this.setActiveUserId(res.user.id);
    }
    return res;
  }

  public async getMe(): Promise<UserDto> {
    const res = await this.request<any>('/auth/me');
    const user: UserDto = res && res.user ? res.user : res;
    if (user && user.id) {
      this.setActiveUserId(user.id);
    }
    return user;
  }

  /**
   * SEC-02: Demo User Switcher đăng nhập THẬT qua /auth/login bằng mật khẩu
   * seed chung thay vì tự định danh. Chỉ có ý nghĩa trong môi trường dev
   * (PRESET_USERS rỗng ở build production nên switcher không hiển thị).
   */
  public async loginAsDemoUser(user: UserDto): Promise<{ user: UserDto; token: string }> {
    // SEC-06: mật khẩu demo bị loại khỏi bundle production qua constant folding.
    if (!IS_DEV) {
      throw new Error('Account switching is unavailable in this build');
    }
    return this.login(user.username, IS_DEV ? DEMO_LOGIN_PASSWORD : '');
  }

  // ================= PKG-10: ACCOUNT LIFECYCLE =================

  /** Xuất toàn bộ dữ liệu cá nhân (JSON download). */
  public async exportMyData(): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>('/users/me/export');
  }

  /** Xóa tài khoản vĩnh viễn (soft-delete phía server + thu hồi mọi phiên). */
  public async deleteMyAccount(): Promise<{ deleted: boolean; username: string; message: string }> {
    const result = await this.request<{ deleted: boolean; username: string; message: string }>('/users/me', {
      method: 'DELETE',
    });
    // Dọn trạng thái cục bộ ngay — server đã thu hồi token.
    this.setToken(null);
    this.disconnectRealtime();
    this.setActiveUserId(PRESET_USERS[0]?.id ?? '');
    if (typeof window !== 'undefined') {
      localStorage.removeItem('pulse_auth_token');
      localStorage.removeItem('pulse_active_user_id');
    }
    return result;
  }

  public async logout(): Promise<ApiResponse<LogoutResponseDto>> {
    const response = await fetch(`${this.baseUrl}/auth/logout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        },
        credentials: 'include',
      });
    if (!response.ok) {
      let message = 'Không thể thu hồi phiên đăng nhập';
      try {
        const body = await response.json();
        message = body.error?.message || message;
      } catch { /* Keep the stable fallback message. */ }
      throw new ApiError(message, response.status, 'LOGOUT_FAILED');
    }
    this.setToken(null);
    this.disconnectRealtime();
    this.setActiveUserId(PRESET_USERS[0]?.id ?? '');
    if (typeof window !== 'undefined') {
      localStorage.removeItem('pulse_auth_token');
      localStorage.removeItem('pulse_active_user_id');
    }
    return {
      success: true,
      data: { success: true },
    };
  }

  public async updateProfile(data: {
    displayName?: string;
    bio?: string;
    avatarUrl?: string;
    isPrivate?: boolean;
  }): Promise<UserDto> {
    const res = await this.request<any>('/users/profile', {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
    return res && res.user ? res.user : res;
  }

  // ================= TASK-21: FOLLOW REQUESTS =================

  public async refreshToken(): Promise<{ accessToken: string; user?: UserDto } | null> {
    try {
      const payload = await this.request<{ accessToken: string; token?: string; user?: UserDto }>('/auth/refresh', {
        method: 'POST',
      });
      const newAccessToken = payload.accessToken || payload.token;

      if (newAccessToken) {
        this.setToken(newAccessToken);
        if (payload.user?.id) {
          this.setActiveUserId(payload.user.id);
        }
        return { accessToken: newAccessToken, user: payload.user };
      }
      return null;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return null;
      throw error;
    }
  }

  public async getPendingFollowRequests(): Promise<FollowRequestDto[]> {
    const res = await this.getFollowRequests();
    return res.data || [];
  }

  public async getFollowRequests(): Promise<ApiResponse<FollowRequestDto[]>> {
    try {
      const res = await this.request<any>('/users/follow-requests');
      const items: FollowRequestDto[] = Array.isArray(res)
        ? res
        : Array.isArray(res?.requests)
        ? res.requests
        : Array.isArray(res?.items)
        ? res.items
        : Array.isArray(res?.data)
        ? res.data
        : [];
      return {
        success: true,
        data: items,
      };
    } catch (err: any) {
      return {
        success: false,
        error: {
          code: 'FETCH_FOLLOW_REQUESTS_FAILED',
          message: err.message || 'Không thể tải danh sách yêu cầu theo dõi',
        },
      };
    }
  }

  public async acceptFollowRequest(requestId: string): Promise<ApiResponse<{ success: boolean }>> {
    try {
      const res = await this.request<any>(
        `/users/follow-requests/${encodeURIComponent(requestId)}/accept`,
        { method: 'POST' }
      );
      return {
        success: true,
        data: { success: res?.success !== false },
      };
    } catch (err: any) {
      return {
        success: false,
        error: {
          code: 'ACCEPT_FOLLOW_REQUEST_FAILED',
          message: err.message || 'Không thể chấp nhận yêu cầu theo dõi',
        },
      };
    }
  }

  public async rejectFollowRequest(requestId: string): Promise<ApiResponse<{ success: boolean }>> {
    try {
      const res = await this.request<any>(
        `/users/follow-requests/${encodeURIComponent(requestId)}/reject`,
        { method: 'POST' }
      );
      return {
        success: true,
        data: { success: res?.success !== false },
      };
    } catch (err: any) {
      return {
        success: false,
        error: {
          code: 'REJECT_FOLLOW_REQUEST_FAILED',
          message: err.message || 'Không thể từ chối yêu cầu theo dõi',
        },
      };
    }
  }

  public async cancelFollowRequest(targetUserId: string): Promise<ApiResponse<{ success: boolean }>> {
    try {
      const res = await this.request<any>(
        `/users/${encodeURIComponent(targetUserId)}/follow-request`,
        { method: 'DELETE' }
      );
      return {
        success: true,
        data: { success: res?.success !== false },
      };
    } catch (err: any) {
      return {
        success: false,
        error: {
          code: 'CANCEL_FOLLOW_REQUEST_FAILED',
          message: err.message || 'Không thể hủy yêu cầu theo dõi',
        },
      };
    }
  }

  // ================= SOCIAL GRAPH =================

  public async getUserProfile(username: string): Promise<UserDto> {
    return this.request<UserDto>(`/users/${encodeURIComponent(username)}`);
  }

  public async followUser(
    targetUserId: string
  ): Promise<FollowActionResponse | { success: boolean; isFollowing: boolean; status?: string; hasPendingFollowRequest?: boolean }> {
    return this.request<any>('/graph/follow', {
      method: 'POST',
      body: JSON.stringify({ targetUserId }),
    });
  }

  public async unfollowUser(targetUserId: string): Promise<{ success: boolean; isFollowing: boolean }> {
    return this.request<{ success: boolean; isFollowing: boolean }>('/graph/unfollow', {
      method: 'POST',
      body: JSON.stringify({ targetUserId }),
    });
  }

  public async blockUser(targetUserId: string): Promise<{ success: boolean; isBlocked: boolean }> {
    return this.request<{ success: boolean; isBlocked: boolean }>('/graph/block', {
      method: 'POST',
      body: JSON.stringify({ targetUserId }),
    });
  }

  public async unblockUser(targetUserId: string): Promise<{ success: boolean; isBlocked: boolean }> {
    return this.request<{ success: boolean; isBlocked: boolean }>('/graph/unblock', {
      method: 'POST',
      body: JSON.stringify({ targetUserId }),
    });
  }

  // ================= TRUST & SAFETY / MUTES =================

  public async muteUser(userId: string): Promise<UserMuteDto> {
    return this.request<UserMuteDto>(`/users/${encodeURIComponent(userId)}/mute`, {
      method: 'POST',
    });
  }

  public async unmuteUser(userId: string): Promise<{ mutedId: string; isMuted: boolean; message: string }> {
    return this.request<{ mutedId: string; isMuted: boolean; message: string }>(`/users/${encodeURIComponent(userId)}/mute`, {
      method: 'DELETE',
    });
  }

  public async getMutedUsers(): Promise<UserMuteDto[]> {
    const res = await this.request<any>('/mutes/users');
    if (Array.isArray(res)) return res;
    if (res && Array.isArray(res.mutes)) return res.mutes;
    return [];
  }

  public async getMutedKeywords(): Promise<KeywordMuteDto[]> {
    const res = await this.request<any>('/mutes/keywords');
    if (Array.isArray(res)) return res;
    if (res && Array.isArray(res.keywords)) return res.keywords;
    return [];
  }

  public async createMutedKeyword(payload: CreateKeywordMuteInput): Promise<KeywordMuteDto> {
    return this.request<KeywordMuteDto>('/mutes/keywords', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  public async deleteMutedKeyword(id: string): Promise<{ id: string; success: boolean }> {
    return this.request<{ id: string; success: boolean }>(`/mutes/keywords/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

  // ================= NOTIFICATIONS =================

  public async getNotifications(): Promise<NotificationDto[]> {
    const res = await this.request<any>('/notifications');
    if (Array.isArray(res)) return res;
    if (res && Array.isArray(res.notifications)) return res.notifications;
    return [];
  }

  public async markAllNotificationsRead(): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>('/notifications/read-all', {
      method: 'PATCH',
    });
  }

  // ================= SEARCH & TRENDING =================

  public async search(
    q: string,
    type: 'all' | 'posts' | 'users' = 'all'
  ): Promise<SearchResultDto> {
    const trimmed = q.trim();
    if (!trimmed) {
      return { posts: [], users: [], query: '', federatedResult: null };
    }

    const params = new URLSearchParams();
    params.append('q', trimmed);
    if (type && type !== 'all') {
      params.append('type', type);
    } else {
      params.append('type', 'all');
    }

    const res = await this.request<any>(`/search?${params.toString()}`);
    return {
      posts: Array.isArray(res?.posts) ? res.posts : [],
      users: Array.isArray(res?.users) ? res.users : [],
      query: typeof res?.query === 'string' ? res.query : trimmed,
      federatedResult: res?.federatedResult || null,
    };
  }

  // ================= FEDERATION APIS =================

  /**
   * Resolves a remote Fediverse actor by handle (@user@domain) or ActivityPub URL.
   * Calls POST /api/v1/federation/resolve
   */
  public async resolveFederatedActor(
    handle: string
  ): Promise<{ user: UserDto; actor?: RemoteActorDiscoveryResult | any } | any> {
    const trimmed = handle.trim();
    if (!trimmed) {
      throw new Error('Fediverse handle hoặc URL là bắt buộc');
    }

    return this.request<any>('/federation/resolve', {
      method: 'POST',
      body: JSON.stringify({ handle: trimmed }),
    });
  }

  public async getTrending(): Promise<Array<{ tag: string; postsCount: number; score: number }>> {
    const res = await this.request<any>('/trending');
    if (Array.isArray(res)) return res;
    if (res && Array.isArray(res.trending)) return res.trending;
    return [];
  }

  // ================= POLL APIS =================

  public async getPoll(pollId: string): Promise<PollDto> {
    return this.request<PollDto>(`/polls/${encodeURIComponent(pollId)}`);
  }

  public async createPoll(payload: {
    postId: string;
    question: string;
    choices: string[];
    durationMinutes?: number;
    expiresAt?: string;
  }): Promise<PollDto> {
    return this.request<PollDto>('/polls', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  public async castVote(pollId: string, choiceIndex: number): Promise<PollDto> {
    return this.request<PollDto>(`/polls/${encodeURIComponent(pollId)}/vote`, {
      method: 'POST',
      body: JSON.stringify({ choiceIndex, choice_index: choiceIndex }),
    });
  }

  public async expirePoll(pollId: string): Promise<PollDto> {
    return this.request<PollDto>(`/polls/${encodeURIComponent(pollId)}`, {
      method: 'DELETE',
    });
  }

  public subscribePollEvents(
    pollId: string,
    onUpdate: (poll: Partial<PollDto>) => void,
    onError?: (err: any) => void
  ): () => void {
    let ws: WebSocket | null = null;
    let sseCleaner: (() => void) | null = null;

    // Attempt WebSocket connection if available
    try {
      if (typeof window !== 'undefined' && window.WebSocket) {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/api/v1/polls/${encodeURIComponent(pollId)}/ws`;
        ws = new WebSocket(wsUrl);

        ws.onmessage = (event) => {
          try {
            const parsed = JSON.parse(event.data);
            if (parsed.pollId === pollId || parsed.id === pollId || parsed.choices) {
              onUpdate(parsed.poll || parsed);
            }
          } catch {
            // ignore
          }
        };

        ws.onerror = () => {
          // WebSocket error, fallback cleanly to SSE
        };
      }
    } catch {
      // WebSocket initialization failed, fallback to SSE
    }

    // Also register on SSE stream
    sseCleaner = this.subscribeRealtimeEvents(
      this.activeUserId,
      (event: RealtimeEvent) => {
        if (
          event.type === 'POLL_UPDATED' ||
          event.type === 'POLL_VOTED' ||
          event.type === 'POLL_EXPIRED'
        ) {
          const payload = event.data;
          if (payload && (payload.id === pollId || payload.pollId === pollId)) {
            onUpdate(payload.poll || payload);
          }
        }
      },
      onError
    );

    return () => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
      if (sseCleaner) {
        sseCleaner();
      }
    };
  }

  // ================= DIRECT MESSAGING (DM) =================

  public async getDmConversations(params?: {
    limit?: number;
    cursor?: string;
  }): Promise<DmConversationListResponse> {
    const query = new URLSearchParams();
    if (params?.limit) query.set('limit', params.limit.toString());
    if (params?.cursor) query.set('cursor', params.cursor);
    const queryString = query.toString() ? `?${query.toString()}` : '';

    return this.request<DmConversationListResponse>(`/dm/conversations${queryString}`);
  }

  public async getOrCreateDmConversation(recipientId: string): Promise<DmConversationDto> {
    return this.request<DmConversationDto>('/dm/conversations', {
      method: 'POST',
      body: JSON.stringify({ recipientId }),
    });
  }

  public async getDmMessages(
    conversationId: string,
    params?: {
      limit?: number;
      cursor?: string;
      direction?: 'before' | 'after';
    }
  ): Promise<DmMessageListResponse> {
    const query = new URLSearchParams();
    if (params?.limit) query.set('limit', params.limit.toString());
    if (params?.cursor) query.set('cursor', params.cursor);
    if (params?.direction) query.set('direction', params.direction);
    const queryString = query.toString() ? `?${query.toString()}` : '';

    return this.request<DmMessageListResponse>(`/dm/conversations/${conversationId}/messages${queryString}`);
  }

  public async sendDmMessage(
    conversationId: string,
    input: SendDmMessageInput
  ): Promise<DmMessageDto> {
    return this.request<DmMessageDto>(`/dm/conversations/${conversationId}/messages`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  public async markDmRead(
    conversationId: string,
    messageId?: string
  ): Promise<DmReadReceiptDto> {
    return this.request<DmReadReceiptDto>(`/dm/conversations/${conversationId}/read`, {
      method: 'PUT',
      body: JSON.stringify(messageId ? { messageId } : {}),
    });
  }

  public async deleteDmMessage(
    messageId: string
  ): Promise<{ messageId: string; conversationId: string; deleted: boolean; deletedAt: string }> {
    return this.request<{ messageId: string; conversationId: string; deleted: boolean; deletedAt: string }>(
      `/dm/messages/${messageId}`,
      {
        method: 'DELETE',
      }
    );
  }

  // ================= GROUP DIRECT MESSAGING (TASK-20) =================

  public async createGroupConversation(
    input: CreateGroupConversationInput
  ): Promise<GroupConversationDto> {
    const res = await this.request<any>('/dm/groups', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return res?.group || res;
  }

  public async listGroupConversations(params?: {
    limit?: number;
    cursor?: string;
  }): Promise<GroupConversationListResponse> {
    const query = new URLSearchParams();
    if (params?.limit) query.set('limit', params.limit.toString());
    if (params?.cursor) query.set('cursor', params.cursor);
    const queryString = query.toString() ? `?${query.toString()}` : '';

    const res = await this.request<any>(`/dm/groups${queryString}`);
    if (res && Array.isArray(res.groups)) {
      return res as GroupConversationListResponse;
    }
    if (Array.isArray(res)) {
      return { groups: res, nextCursor: null };
    }
    return { groups: [], nextCursor: null };
  }

  public async getGroupConversation(groupId: string): Promise<GroupConversationDto> {
    const res = await this.request<any>(`/dm/groups/${encodeURIComponent(groupId)}`);
    return res?.group || res;
  }

  public async updateGroupConversation(
    groupId: string,
    input: UpdateGroupConversationInput
  ): Promise<GroupConversationDto> {
    const res = await this.request<any>(`/dm/groups/${encodeURIComponent(groupId)}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
    return res?.group || res;
  }

  public async sendGroupMessage(
    groupId: string,
    input: SendGroupMessageInput
  ): Promise<GroupMessageDto> {
    const res = await this.request<any>(`/dm/groups/${encodeURIComponent(groupId)}/messages`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return res?.message || res;
  }

  public async getGroupMessages(
    groupId: string,
    params?: {
      limit?: number;
      cursor?: string;
      direction?: 'before' | 'after';
    }
  ): Promise<GroupMessageListResponse> {
    const query = new URLSearchParams();
    if (params?.limit) query.set('limit', params.limit.toString());
    if (params?.cursor) query.set('cursor', params.cursor);
    if (params?.direction) query.set('direction', params.direction);
    const queryString = query.toString() ? `?${query.toString()}` : '';

    const res = await this.request<any>(
      `/dm/groups/${encodeURIComponent(groupId)}/messages${queryString}`
    );
    if (res && Array.isArray(res.messages)) {
      return res as GroupMessageListResponse;
    }
    if (Array.isArray(res)) {
      return { conversationId: groupId, messages: res, nextCursor: null, hasMore: false };
    }
    return { conversationId: groupId, messages: [], nextCursor: null, hasMore: false };
  }

  public async addGroupMember(
    groupId: string,
    input: AddGroupMemberInput
  ): Promise<GroupMemberDto> {
    const res = await this.request<any>(
      `/dm/groups/${encodeURIComponent(groupId)}/members`,
      {
        method: 'POST',
        body: JSON.stringify(input),
      }
    );
    return res?.member || res;
  }

  public async removeGroupMember(
    groupId: string,
    userId: string
  ): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(
      `/dm/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(userId)}`,
      {
        method: 'DELETE',
      }
    );
  }

  public async leaveGroup(groupId: string): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(
      `/dm/groups/${encodeURIComponent(groupId)}/members/me`,
      {
        method: 'DELETE',
      }
    );
  }

  public async markGroupRead(
    groupId: string,
    messageId?: string
  ): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(
      `/dm/groups/${encodeURIComponent(groupId)}/read`,
      {
        method: 'PUT',
        body: JSON.stringify(messageId ? { messageId } : {}),
      }
    );
  }

  public async deleteGroupMessage(
    groupId: string,
    messageId: string
  ): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(
      `/dm/groups/${encodeURIComponent(groupId)}/messages/${encodeURIComponent(messageId)}`,
      {
        method: 'DELETE',
      }
    );
  }

  // ================= WEB PUSH NOTIFICATIONS (RFC 8030 / RFC 8292) =================

  public async getVapidPublicKey(): Promise<string> {
    const res = await this.request<any>('/push/vapid-public-key');
    if (typeof res === 'string') return res;
    if (res && res.publicKey) return res.publicKey;
    return '';
  }

  public async registerPushSubscription(
    input: RegisterWebPushSubscriptionInput
  ): Promise<WebPushSubscriptionDto> {
    const res = await this.request<any>('/push/subscriptions', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return res?.subscription || res;
  }

  public async unregisterPushSubscription(
    endpoint: string
  ): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>('/push/subscriptions', {
      method: 'DELETE',
      body: JSON.stringify({ endpoint }),
    });
  }

  // ================= REAL-TIME SSE STREAM =================

  /**
   * SEC-01: mở SSE stream bằng one-time ticket thay vì tự định danh qua header.
   * Ticket được lấy qua POST /realtime/ticket (JWT auth), dùng đúng 1 lần, TTL 30s.
   */
  public subscribeRealtimeEvents(
    userId: string,
    onEvent: (event: RealtimeEvent) => void,
    onError?: (error: Event) => void
  ): () => void {
    return this.realtimeClient.subscribe(userId, onEvent, onError);
  }

  public disconnectRealtime(): void {
    this.realtimeClient.disconnect();
  }
}

export const api = new PulseApiClient();

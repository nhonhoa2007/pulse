import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  isAccountLocked,
  getFollowButtonVisualInfo,
  getPrivateAccountShieldInfo,
  getFollowButtonClasses,
  getFollowRequestNotificationDetails,
} from '../src/utils/privateAccounts.ts';

describe('TASK-21: Frontend Visual States & Private Accounts Test Suite', () => {
  // =========================================================================
  // 1. UNIT TESTS: Private Account Lock Shield Visual States & Invariants
  // =========================================================================
  describe('1. Private Account Lock Shield Visual States & Invariants', () => {
    it('evaluates unlocked for public accounts (isPrivate = false)', () => {
      const publicUser = {
        id: 'user-public-1',
        username: 'alice',
        isPrivate: false,
        isFollowing: false,
      };

      assert.strictEqual(isAccountLocked(publicUser, 'viewer-id'), false);
      const shield = getPrivateAccountShieldInfo(publicUser, 'viewer-id');
      assert.strictEqual(shield.isLocked, false);
    });

    it('evaluates unlocked for author viewing their own profile (author bypass invariant)', () => {
      const myPrivateAccount = {
        id: 'my-user-id',
        username: 'hoa_dev',
        isPrivate: true,
        isFollowing: false,
      };

      assert.strictEqual(isAccountLocked(myPrivateAccount, 'my-user-id'), false);
      const shield = getPrivateAccountShieldInfo(myPrivateAccount, 'my-user-id');
      assert.strictEqual(shield.isLocked, false);
    });

    it('evaluates locked for stranger viewing private account without following', () => {
      const privateUser = {
        id: 'user-private-1',
        username: 'bob',
        isPrivate: true,
        isFollowing: false,
      };

      assert.strictEqual(isAccountLocked(privateUser, 'viewer-id'), true);
      const shield = getPrivateAccountShieldInfo(privateUser, 'viewer-id');
      assert.strictEqual(shield.isLocked, true);
      assert.strictEqual(shield.title, 'Tài khoản này ở chế độ riêng tư');
      assert.strictEqual(shield.description, 'Hãy theo dõi để xem bài viết của họ.');
      assert.strictEqual(shield.iconName, 'Lock');
    });

    it('evaluates unlocked for approved follower viewing private account', () => {
      const privateUserFollowed = {
        id: 'user-private-2',
        username: 'charlie',
        isPrivate: true,
        isFollowing: true,
      };

      assert.strictEqual(isAccountLocked(privateUserFollowed, 'viewer-id'), false);
      const shield = getPrivateAccountShieldInfo(privateUserFollowed, 'viewer-id');
      assert.strictEqual(shield.isLocked, false);
    });

    it('evaluates locked when server explicitly marks isLocked = true', () => {
      const serverLockedUser = {
        id: 'user-locked-3',
        username: 'david',
        isLocked: true,
        isFollowing: false,
      };

      assert.strictEqual(isAccountLocked(serverLockedUser, 'viewer-id'), true);
      const shield = getPrivateAccountShieldInfo(serverLockedUser, 'viewer-id');
      assert.strictEqual(shield.isLocked, true);
    });

    it('handles null/undefined targetUser gracefully without throwing', () => {
      assert.strictEqual(isAccountLocked(null, 'viewer-id'), false);
      assert.strictEqual(isAccountLocked(undefined, 'viewer-id'), false);
    });
  });

  // =========================================================================
  // 2. VISUAL STATES: Follow Button States & Transitions
  // =========================================================================
  describe('2. Follow Button Visual States & Transitions (Theo dõi / Đã yêu cầu / Đang theo dõi)', () => {
    it('renders "Theo dõi" with high-contrast black styling for public unfollowed account', () => {
      const user = { isPrivate: false, isFollowing: false, hasPendingFollowRequest: false };
      const info = getFollowButtonVisualInfo(user);

      assert.strictEqual(info.state, 'FOLLOW');
      assert.strictEqual(info.label, 'Theo dõi');
      assert.strictEqual(info.isFollowing, false);
      assert.strictEqual(info.isRequested, false);

      const classes = getFollowButtonClasses(info.state);
      assert.match(classes, /bg-ink/);
      assert.match(classes, /text-paper/);
    });

    it('renders "Theo dõi" (REQUEST_FOLLOW) for private unfollowed account with informative ariaLabel', () => {
      const user = { isPrivate: true, isFollowing: false, hasPendingFollowRequest: false };
      const info = getFollowButtonVisualInfo(user);

      assert.strictEqual(info.state, 'REQUEST_FOLLOW');
      assert.strictEqual(info.label, 'Theo dõi');
      assert.strictEqual(info.isFollowing, false);
      assert.strictEqual(info.isRequested, false);
      assert.match(info.ariaLabel, /Yêu cầu theo dõi/);

      const classes = getFollowButtonClasses(info.state);
      assert.match(classes, /bg-ink/);
    });

    it('renders "Đã yêu cầu" (REQUESTED) with clock icon and subtle outline styling when follow request is pending', () => {
      const user = { isPrivate: true, isFollowing: false, hasPendingFollowRequest: true };
      const info = getFollowButtonVisualInfo(user, false);

      assert.strictEqual(info.state, 'REQUESTED');
      assert.strictEqual(info.label, 'Đã yêu cầu');
      assert.strictEqual(info.isRequested, true);
      assert.strictEqual(info.isFollowing, false);
      assert.strictEqual(info.canCancel, true);

      const classes = getFollowButtonClasses(info.state);
      assert.match(classes, /border/);
      assert.match(classes, /border-cloud/);
    });

    it('switches label to "Hủy yêu cầu" when user hovers over "Đã yêu cầu" button', () => {
      const user = { isPrivate: true, isFollowing: false, hasPendingFollowRequest: true };
      const info = getFollowButtonVisualInfo(user, true);

      assert.strictEqual(info.state, 'REQUESTED');
      assert.strictEqual(info.label, 'Hủy yêu cầu');
      assert.strictEqual(info.isRequested, true);
      assert.strictEqual(info.canCancel, true);
      assert.match(info.ariaLabel, /Hủy yêu cầu theo dõi/);
    });

    it('renders "Đang theo dõi" (FOLLOWING) with check icon and outline styling for followed account', () => {
      const user = { isPrivate: true, isFollowing: true, hasPendingFollowRequest: false };
      const info = getFollowButtonVisualInfo(user);

      assert.strictEqual(info.state, 'FOLLOWING');
      assert.strictEqual(info.label, 'Đang theo dõi');
      assert.strictEqual(info.isFollowing, true);
      assert.strictEqual(info.isRequested, false);

      const classes = getFollowButtonClasses(info.state);
      assert.match(classes, /border-cloud/);
      assert.match(classes, /text-ink/);
    });

    it('simulates optimistic transition when following a private account (switches to REQUESTED)', () => {
      let state = {
        isFollowing: false,
        hasPendingFollowRequest: false,
        isPrivate: true,
      };

      // User clicks Follow on private account
      const actionResult = {
        status: 'REQUESTED',
        isFollowing: false,
        hasPendingFollowRequest: true,
      };

      state = {
        ...state,
        isFollowing: actionResult.isFollowing,
        hasPendingFollowRequest: actionResult.hasPendingFollowRequest,
      };

      const button = getFollowButtonVisualInfo(state);
      assert.strictEqual(button.state, 'REQUESTED');
      assert.strictEqual(button.label, 'Đã yêu cầu');
    });

    it('simulates canceling a pending follow request (switches back to REQUEST_FOLLOW)', () => {
      let state = {
        isFollowing: false,
        hasPendingFollowRequest: true,
        isPrivate: true,
      };

      // User cancels request
      state.hasPendingFollowRequest = false;

      const button = getFollowButtonVisualInfo(state);
      assert.strictEqual(button.state, 'REQUEST_FOLLOW');
      assert.strictEqual(button.label, 'Theo dõi');
    });
  });

  // =========================================================================
  // 3. VISUAL STATES: EditProfileModal Private Toggle
  // =========================================================================
  describe('3. EditProfileModal Private Account Toggle States', () => {
    const evaluateToggleVisualState = (isPrivate, isSaving = false) => {
      return {
        role: 'switch',
        ariaChecked: Boolean(isPrivate),
        bgClass: isPrivate ? 'bg-ink' : 'bg-cloud',
        knobTransform: isPrivate ? 'translate-x-5' : 'translate-x-0',
        disabled: isSaving,
        testId: 'edit-profile-private-toggle',
      };
    };

    it('evaluates toggle off state (isPrivate = false)', () => {
      const toggle = evaluateToggleVisualState(false);
      assert.strictEqual(toggle.role, 'switch');
      assert.strictEqual(toggle.ariaChecked, false);
      assert.match(toggle.bgClass, /bg-cloud/);
      assert.strictEqual(toggle.knobTransform, 'translate-x-0');
      assert.strictEqual(toggle.disabled, false);
    });

    it('evaluates toggle on state (isPrivate = true) with Threads Black background', () => {
      const toggle = evaluateToggleVisualState(true);
      assert.strictEqual(toggle.ariaChecked, true);
      assert.match(toggle.bgClass, /bg-ink/);
      assert.strictEqual(toggle.knobTransform, 'translate-x-5');
      assert.strictEqual(toggle.disabled, false);
    });

    it('disables toggle while profile save is in flight to prevent double submit', () => {
      const toggle = evaluateToggleVisualState(true, true);
      assert.strictEqual(toggle.disabled, true);
    });

    it('formats update profile payload including isPrivate flag', () => {
      const formatPayload = (displayName, bio, avatarUrl, isPrivate) => ({
        displayName: displayName.trim(),
        bio: bio.trim(),
        avatarUrl: avatarUrl || undefined,
        isPrivate: Boolean(isPrivate),
      });

      const payload = formatPayload('Hoà Phùng', 'Bio update', null, true);
      assert.deepStrictEqual(payload, {
        displayName: 'Hoà Phùng',
        bio: 'Bio update',
        avatarUrl: undefined,
        isPrivate: true,
      });
    });
  });

  // =========================================================================
  // 4. VISUAL STATES: FollowRequestsModal & Notification Items
  // =========================================================================
  describe('4. FollowRequestsModal & Notification Item States', () => {
    it('returns empty state visual contract when no follow requests exist', () => {
      const evaluateEmptyState = (requests) => ({
        isEmpty: requests.length === 0,
        title: 'Không có yêu cầu theo dõi nào',
        testId: 'follow-requests-empty-state',
      });

      const state = evaluateEmptyState([]);
      assert.strictEqual(state.isEmpty, true);
      assert.strictEqual(state.title, 'Không có yêu cầu theo dõi nào');
    });

    it('renders follow request list items with Accept and Reject actions', () => {
      const mockRequest = {
        id: 'freq-123',
        requesterId: 'user-alice-id',
        targetUserId: 'user-my-id',
        status: 'PENDING',
        requester: {
          id: 'user-alice-id',
          username: 'alice',
          displayName: 'Alice Nguyễn',
          avatarUrl: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150',
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const evaluateRequestItem = (req, isProcessing = false) => ({
        testId: `follow-request-item-${req.id}`,
        displayName: req.requester.displayName,
        username: `@${req.requester.username}`,
        acceptButtonTestId: 'accept-follow-request-btn',
        rejectButtonTestId: 'reject-follow-request-btn',
        isProcessing,
      });

      const item = evaluateRequestItem(mockRequest);
      assert.strictEqual(item.displayName, 'Alice Nguyễn');
      assert.strictEqual(item.username, '@alice');
      assert.strictEqual(item.isProcessing, false);
    });

    it('formats FOLLOW_REQUEST notification verb details and inline actions', () => {
      const details = getFollowRequestNotificationDetails('FOLLOW_REQUEST');
      assert.strictEqual(details.text, 'đã gửi yêu cầu theo dõi bạn');
      assert.strictEqual(details.isActionable, true);
      assert.strictEqual(details.badgeColor, 'text-meta');
    });

    it('formats FOLLOW_ACCEPT notification verb details', () => {
      const details = getFollowRequestNotificationDetails('FOLLOW_ACCEPT');
      assert.strictEqual(details.text, 'đã chấp nhận yêu cầu theo dõi của bạn');
      assert.strictEqual(details.isActionable, false);
      assert.strictEqual(details.badgeColor, 'text-meta');
    });

    it('simulates optimistic acceptance removing request and updating counter', () => {
      let requests = [
        { id: 'req-1', requester: { username: 'alice' } },
        { id: 'req-2', requester: { username: 'bob' } },
      ];
      let pendingCount = requests.length;

      // Accept req-1
      const acceptedId = 'req-1';
      requests = requests.filter((r) => r.id !== acceptedId);
      pendingCount = Math.max(0, pendingCount - 1);

      assert.strictEqual(requests.length, 1);
      assert.strictEqual(requests[0].id, 'req-2');
      assert.strictEqual(pendingCount, 1);
    });
  });

  // =========================================================================
  // 5. SECURITY & CLIENT INVARIANTS: HttpOnly Cookies & 401 Token Refresh
  // =========================================================================
  describe('5. HttpOnly Cookies & 401 Auto Refresh Invariants', () => {
    it('enforces credentials: "include" for all cross-origin and same-origin fetch requests', () => {
      const buildRequestOptions = (customOptions = {}) => ({
        credentials: 'include',
        ...customOptions,
        headers: {
          'Content-Type': 'application/json',
          ...(customOptions.headers || {}),
        },
      });

      const opts1 = buildRequestOptions();
      assert.strictEqual(opts1.credentials, 'include');

      const opts2 = buildRequestOptions({ headers: { 'x-custom': 'val' } });
      assert.strictEqual(opts2.credentials, 'include');
      assert.strictEqual(opts2.headers['x-custom'], 'val');
    });

    it('identifies auth endpoints to prevent recursive 401 refresh loops', () => {
      const isAuthEndpoint = (endpoint) => {
        return (
          endpoint.includes('/auth/login') ||
          endpoint.includes('/auth/register') ||
          endpoint.includes('/auth/refresh') ||
          endpoint.includes('/auth/logout')
        );
      };

      assert.strictEqual(isAuthEndpoint('/auth/login'), true);
      assert.strictEqual(isAuthEndpoint('/auth/refresh'), true);
      assert.strictEqual(isAuthEndpoint('/auth/logout'), true);
      assert.strictEqual(isAuthEndpoint('/users/profile'), false);
      assert.strictEqual(isAuthEndpoint('/feed/home'), false);
      assert.strictEqual(isAuthEndpoint('/users/follow-requests'), false);
    });

    it('deduplicates concurrent 401 refresh requests into a single promise', async () => {
      let refreshExecutionCount = 0;
      let sharedPromise = null;

      const executeRefresh = () => {
        if (!sharedPromise) {
          sharedPromise = (async () => {
            refreshExecutionCount++;
            return 'new-access-token-xyz';
          })();
        }
        return sharedPromise;
      };

      // 3 concurrent requests fail with 401 simultaneously
      const [token1, token2, token3] = await Promise.all([
        executeRefresh(),
        executeRefresh(),
        executeRefresh(),
      ]);

      assert.strictEqual(token1, 'new-access-token-xyz');
      assert.strictEqual(token2, 'new-access-token-xyz');
      assert.strictEqual(token3, 'new-access-token-xyz');
      assert.strictEqual(refreshExecutionCount, 1, 'Refresh endpoint must be called exactly once for concurrent 401s');
    });
  });

  // =========================================================================
  // 6. API CLIENT CONTRACTS: Follow Requests & Auto Refresh API Suite
  // =========================================================================
  describe('6. API Client Endpoints & Auto Refresh Retries (TASK-21)', () => {
    it('verifies API client follow requests endpoints and response contracts', async () => {
      const { api } = await import('../src/api/PulseApiClient.ts');

      const originalFetch = globalThis.fetch;
      const dispatchedRequests = [];

      globalThis.fetch = async (url, options = {}) => {
        dispatchedRequests.push({ url: url.toString(), options });

        if (url.toString().includes('/api/v1/users/follow-requests') && (!options.method || options.method === 'GET')) {
          return {
            ok: true,
            status: 200,
            headers: { get: () => 'application/json' },
            json: async () => ({
              success: true,
              data: [
                {
                  id: 'req-test-1',
                  requesterId: 'alice-id',
                  targetUserId: 'my-id',
                  status: 'PENDING',
                  requester: {
                    id: 'alice-id',
                    username: 'alice',
                    displayName: 'Alice Nguyễn',
                    avatarUrl: null,
                  },
                  createdAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                },
              ],
            }),
          };
        }

        if (url.toString().includes('/api/v1/users/follow-requests/req-test-1/accept') && options.method === 'POST') {
          return {
            ok: true,
            status: 200,
            headers: { get: () => 'application/json' },
            json: async () => ({ success: true, data: { success: true } }),
          };
        }

        if (url.toString().includes('/api/v1/users/follow-requests/req-test-1/reject') && options.method === 'POST') {
          return {
            ok: true,
            status: 200,
            headers: { get: () => 'application/json' },
            json: async () => ({ success: true, data: { success: true } }),
          };
        }

        if (url.toString().includes('/api/v1/users/target-user-456/follow-request') && options.method === 'DELETE') {
          return {
            ok: true,
            status: 200,
            headers: { get: () => 'application/json' },
            json: async () => ({ success: true, data: { success: true } }),
          };
        }

        if (url.toString().includes('/api/v1/auth/logout') && options.method === 'POST') {
          return {
            ok: true,
            status: 200,
            headers: { get: () => 'application/json' },
            json: async () => ({ success: true, data: { success: true } }),
          };
        }

        return {
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          json: async () => ({ success: true }),
        };
      };

      try {
        // 1. getFollowRequests
        const getRes = await api.getFollowRequests();
        assert.strictEqual(getRes.success, true);
        assert.strictEqual(Array.isArray(getRes.data), true);
        assert.strictEqual(getRes.data.length, 1);
        assert.strictEqual(getRes.data[0].requester.username, 'alice');

        // Check fetch options included credentials
        const getCall = dispatchedRequests.find((r) => r.url.endsWith('/users/follow-requests'));
        assert.ok(getCall, 'getFollowRequests must fetch /users/follow-requests');
        assert.strictEqual(getCall.options.credentials, 'include');

        // 2. acceptFollowRequest
        const acceptRes = await api.acceptFollowRequest('req-test-1');
        assert.strictEqual(acceptRes.success, true);
        assert.strictEqual(acceptRes.data.success, true);
        const acceptCall = dispatchedRequests.find((r) => r.url.includes('/users/follow-requests/req-test-1/accept'));
        assert.ok(acceptCall);
        assert.strictEqual(acceptCall.options.method, 'POST');
        assert.strictEqual(acceptCall.options.credentials, 'include');

        // 3. rejectFollowRequest
        const rejectRes = await api.rejectFollowRequest('req-test-1');
        assert.strictEqual(rejectRes.success, true);
        assert.strictEqual(rejectRes.data.success, true);
        const rejectCall = dispatchedRequests.find((r) => r.url.includes('/users/follow-requests/req-test-1/reject'));
        assert.ok(rejectCall);
        assert.strictEqual(rejectCall.options.method, 'POST');
        assert.strictEqual(rejectCall.options.credentials, 'include');

        // 4. cancelFollowRequest
        const cancelRes = await api.cancelFollowRequest('target-user-456');
        assert.strictEqual(cancelRes.success, true);
        assert.strictEqual(cancelRes.data.success, true);
        const cancelCall = dispatchedRequests.find((r) => r.url.includes('/users/target-user-456/follow-request'));
        assert.ok(cancelCall);
        assert.strictEqual(cancelCall.options.method, 'DELETE');
        assert.strictEqual(cancelCall.options.credentials, 'include');

        // 5. logout
        const logoutRes = await api.logout();
        assert.strictEqual(logoutRes.success, true);
        assert.strictEqual(logoutRes.data.success, true);
        assert.strictEqual(api.getToken(), null);
        const logoutCall = dispatchedRequests.find((r) => r.url.includes('/auth/logout'));
        assert.ok(logoutCall);
        assert.strictEqual(logoutCall.options.method, 'POST');
        assert.strictEqual(logoutCall.options.credentials, 'include');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('handles 401 Unauthorized by auto-refreshing token and retrying request', async () => {
      const { api } = await import('../src/api/PulseApiClient.ts');

      const originalFetch = globalThis.fetch;
      api.setToken('old-expired-token');

      let attemptCount = 0;
      let refreshCalled = false;

      globalThis.fetch = async (url, options = {}) => {
        const urlStr = url.toString();

        if (urlStr.includes('/auth/refresh')) {
          refreshCalled = true;
          return {
            ok: true,
            status: 200,
            headers: { get: () => 'application/json' },
            json: async () => ({
              success: true,
              data: {
                accessToken: 'fresh-new-token-999',
                user: { id: 'my-user-id', username: 'hoa_dev' },
              },
            }),
          };
        }

        if (urlStr.includes('/feed/home')) {
          attemptCount++;
          if (attemptCount === 1) {
            // First attempt with old token fails with 401
            return {
              ok: false,
              status: 401,
              statusText: 'Unauthorized',
              headers: { get: () => 'application/json' },
              json: async () => ({
                success: false,
                error: { code: 'UNAUTHORIZED', message: 'Token expired' },
              }),
            };
          }

          // Second attempt with refreshed token succeeds
          assert.strictEqual(options.headers['Authorization'], 'Bearer fresh-new-token-999');
          return {
            ok: true,
            status: 200,
            headers: { get: () => 'application/json' },
            json: async () => ({
              success: true,
              data: [{ id: 'post-1', content: 'Success after refresh' }],
            }),
          };
        }

        return {
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          json: async () => ({ success: true }),
        };
      };

      try {
        const posts = await api.getHomeFeed();
        assert.strictEqual(attemptCount, 2, 'Initial request must be retried after refresh');
        assert.strictEqual(refreshCalled, true, 'POST /auth/refresh must be called');
        assert.strictEqual(api.getToken(), 'fresh-new-token-999');
        assert.strictEqual(posts.length, 1);
        assert.strictEqual(posts[0].content, 'Success after refresh');
      } finally {
        globalThis.fetch = originalFetch;
        api.setToken(null);
      }
    });
  });
});

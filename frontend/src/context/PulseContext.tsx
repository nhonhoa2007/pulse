import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import { UserDto, RealtimeEvent } from '../types/PulseTypes';
import { api, PRESET_USERS } from '../api/PulseApiClient';
import { ApiError } from '../api/core';
import { parsePath, viewToPath, isLegacyQueryUrl } from '../utils/router.ts';
import type { ViewType, ViewParams } from '../utils/router.ts';
import {
  AuthSessionContext,
  UiContext,
  RealtimeContext,
} from './PulseContexts';
import type {
  AuthSessionContextValue,
  UiContextValue,
  RealtimeContextValue,
  ToastItem,
} from './PulseContexts';

export type { ViewType, ViewParams } from '../utils/router.ts';
export type { ToastItem } from './PulseContexts';

type PulseContextType = AuthSessionContextValue & UiContextValue & RealtimeContextValue;

const PulseContext = createContext<PulseContextType | undefined>(undefined);

export const PulseProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [users, setUsers] = useState<UserDto[]>(PRESET_USERS);
  const [token, setToken] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [isAuthReady, setIsAuthReady] = useState<boolean>(false);
  const [authRestoreError, setAuthRestoreError] = useState<string | null>(null);

  const [currentUser, setCurrentUser] = useState<UserDto>(() => {
    const savedId = typeof window !== 'undefined' ? localStorage.getItem('pulse_active_user_id') : null;
    const matched = PRESET_USERS.find((u) => u.id === savedId);
    return matched || PRESET_USERS[0];
  });

  // PKG-08: khởi tạo view từ URL path (/post/:id, /@user, /messages...) —
  // URL cũ dạng ?view=... vẫn được nhận diện (legacy) và sẽ được chuyển sang path sạch.
  const [currentView, setCurrentView] = useState<ViewType>(() => {
    if (typeof window !== 'undefined') {
      const parsed = parsePath(window.location.pathname, window.location.search);
      if (parsed) return parsed.view;
    }
    return 'home';
  });
  const [viewParams, setViewParams] = useState<ViewParams>(() => {
    if (typeof window !== 'undefined') {
      const parsed = parsePath(window.location.pathname, window.location.search);
      if (parsed) return parsed.params;
      const postId = new URLSearchParams(window.location.search).get('postId') || undefined;
      if (postId) return { postId };
    }
    return {};
  });
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [dmUnreadCount, setDmUnreadCount] = useState<number>(0);
  const [hasNewTimelinePosts, setHasNewTimelinePosts] = useState<boolean>(false);
  const [isComposerOpen, setIsComposerOpen] = useState<boolean>(false);

  // Modals state
  const [isAuthModalOpen, setIsAuthModalOpen] = useState<boolean>(false);
  const [authModalTab, setAuthModalTab] = useState<'login' | 'register'>('login');
  const [isEditProfileOpen, setIsEditProfileOpen] = useState<boolean>(false);
  const [isMuteModalOpen, setIsMuteModalOpen] = useState<boolean>(false);
  const [muteModalTab, setMuteModalTab] = useState<'users' | 'keywords'>('users');
  const [isFollowRequestsOpen, setIsFollowRequestsOpen] = useState<boolean>(false);
  const [pendingFollowRequestsCount, setPendingFollowRequestsCount] = useState<number>(0);

  const openFollowRequestsModal = useCallback(() => {
    setIsFollowRequestsOpen(true);
  }, []);

  const openMuteModal = useCallback((tab: 'users' | 'keywords' = 'users') => {
    setMuteModalTab(tab);
    setIsMuteModalOpen(true);
  }, []);

  const openAuthModal = useCallback((tab: 'login' | 'register' = 'login') => {
    setAuthModalTab(tab);
    setIsAuthModalOpen(true);
  }, []);

  const addToast = useCallback((message: string, type: 'info' | 'success' | 'error' = 'info') => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // PKG-08: điều hướng sync URL (pushState) — back/forward hoạt động qua popstate.
  const navigateTo = useCallback(
    (view: ViewType, params: ViewParams = {}) => {
      if (typeof window !== 'undefined' && typeof window.history?.pushState === 'function') {
        const path = viewToPath(view, params);
        const current = window.location.pathname + window.location.search;
        if (current !== path) {
          window.history.replaceState(
            { ...(window.history.state || {}), scrollY: window.scrollY },
            '',
            current
          );
          window.history.pushState({ view, params, scrollY: 0 }, '', path);
        }
      }
      setCurrentView(view);
      setViewParams(params);
      if (typeof window !== 'undefined') {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    },
    []
  );

  // PKG-08: chuyển URL legacy (?view=...) sang path sạch + seed history state.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.history?.replaceState !== 'function') return;
    const { pathname, search } = window.location;
    if (isLegacyQueryUrl(search)) {
      const parsed = parsePath(pathname, search);
      if (parsed) {
        window.history.replaceState({ view: parsed.view, params: parsed.params }, '', parsed.path);
      }
    } else {
      window.history.replaceState(
        { view: currentView, params: viewParams },
        '',
        pathname + search
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // PKG-08: back/forward browser sync vào view state.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onPopState = (event: PopStateEvent) => {
      const parsed = parsePath(window.location.pathname, window.location.search);
      if (parsed) {
        setCurrentView(parsed.view);
        setViewParams(parsed.params);
        const targetY = typeof event.state?.scrollY === 'number' ? event.state.scrollY : 0;
        requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo({ top: targetY })));
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // Sync users with backend on initial load to get real database IDs if backend is running
  const refreshUsers = useCallback(async () => {
    try {
      const updated = await Promise.all(
        users.map(async (u) => {
          try {
            const remoteUser = await api.getUserProfile(u.username);
            if (remoteUser && remoteUser.id) {
              return remoteUser;
            }
          } catch {
            // Keep existing if fetch fails
          }
          return u;
        })
      );
      setUsers(updated);

      // Refresh active user reference if not logged in via real auth
      if (!api.getToken()) {
        const foundCurrent = updated.find((u) => u.username === currentUser.username);
        if (foundCurrent) {
          setCurrentUser(foundCurrent);
          api.setActiveUserId(foundCurrent.id);
        }
      }
    } catch (error) {
      addToast(error instanceof Error ? error.message : 'Không thể đăng xuất. Hãy thử lại.', 'error');
      return;
    }
  }, [currentUser.username, users]);

  // Fetch initial notifications count
  const checkNotifications = useCallback(async () => {
    try {
      const notifs = await api.getNotifications();
      const unread = notifs.filter((n) => !n.isRead).length;
      setUnreadCount(unread);
    } catch {
      // ignore if backend not available
    }
  }, []);

  const refreshDmUnreadCount = useCallback(async () => {
    try {
      const res = await api.getDmConversations();
      if (res && res.conversations) {
        const total = res.conversations.reduce((acc, c) => acc + (c.unreadCount || 0), 0);
        setDmUnreadCount(total);
      }
    } catch (error) {
      addToast(error instanceof Error ? error.message : 'Không thể đăng xuất. Hãy thử lại.', 'error');
      return;
    }
  }, []);

  const refreshFollowRequestsCount = useCallback(async () => {
    try {
      const res = await api.getFollowRequests();
      if (res.success && Array.isArray(res.data)) {
        setPendingFollowRequestsCount(res.data.length);
      }
    } catch {
      // ignore
    }
  }, []);

  const incrementFollowersCount = useCallback(() => {
    setCurrentUser((prev) => ({
      ...prev,
      followersCount: (prev.followersCount || 0) + 1,
    }));
  }, []);

  // SEC-02: Switch user qua ĐĂNG NHẬP THẬT (không còn tự định danh qua header).
  const switchUser = useCallback(
    async (selectedUser: UserDto) => {
      try {
        const res = await api.loginAsDemoUser(selectedUser);
        setToken(res.token);
        setIsAuthenticated(true);
        setCurrentUser(res.user);
        setUsers((prev) => {
          const exists = prev.some((u) => u.id === res.user.id);
          return exists ? prev.map((u) => (u.id === res.user.id ? res.user : u)) : [res.user, ...prev];
        });
        addToast(`Đã chuyển tài khoản sang: ${res.user.displayName} (@${res.user.username})`, 'info');
        checkNotifications();
        refreshDmUnreadCount();
        refreshFollowRequestsCount();
      } catch {
        addToast(`Không thể chuyển sang tài khoản @${selectedUser.username}.`, 'error');
      }
    },
    [addToast, checkNotifications, refreshDmUnreadCount, refreshFollowRequestsCount]
  );

  // Auth: Login
  const login = useCallback(
    async (identifier: string, password: string) => {
      const res = await api.login(identifier, password);
      setToken(res.token);
      setIsAuthenticated(true);
      setCurrentUser(res.user);
      setUsers((prev) => {
        const exists = prev.some((u) => u.id === res.user.id);
        return exists ? prev.map((u) => (u.id === res.user.id ? res.user : u)) : [res.user, ...prev];
      });
      setIsAuthModalOpen(false);
      addToast(`Đăng nhập thành công! Chào mừng ${res.user.displayName}`, 'success');
      checkNotifications();
      refreshFollowRequestsCount();
    },
    [addToast, checkNotifications, refreshFollowRequestsCount]
  );

  // Auth: Register
  const register = useCallback(
    async (data: { username: string; email: string; password: string; displayName: string }) => {
      const res = await api.register(data);
      setToken(res.token);
      setIsAuthenticated(true);
      setCurrentUser(res.user);
      setUsers((prev) => [res.user, ...prev.filter((u) => u.id !== res.user.id)]);
      setIsAuthModalOpen(false);
      addToast(`Đăng ký thành công! Chào mừng ${res.user.displayName}`, 'success');
      checkNotifications();
      refreshFollowRequestsCount();
    },
    [addToast, checkNotifications, refreshFollowRequestsCount]
  );

  // Auth: Logout
  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      // ignore
    }
    setToken(null);
    setIsAuthenticated(false);
    setCurrentUser(PRESET_USERS[0]);
    addToast('Đã đăng xuất tài khoản.', 'info');
    checkNotifications();
    setPendingFollowRequestsCount(0);
  }, [addToast, checkNotifications]);

  // Profile: Update
  const updateProfile = useCallback(
    async (data: { displayName?: string; bio?: string; avatarUrl?: string; isPrivate?: boolean }) => {
      const updated = await api.updateProfile(data);
      setCurrentUser(updated);
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
      addToast('Đã cập nhật hồ sơ thành công!', 'success');
      setIsEditProfileOpen(false);
      return updated;
    },
    [addToast]
  );

  // Restore the session from the HttpOnly refresh cookie. A rejected cookie
  // means guest mode; a transport failure is kept as a separate, retryable
  // state so the UI never misreports an offline user as signed out.
  const retryRestoreSession = useCallback(async () => {
    setIsAuthReady(false);
    setAuthRestoreError(null);
    try {
      const restored = await api.refreshToken();
      if (restored?.accessToken && restored.user?.id) {
        setToken(restored.accessToken);
        setCurrentUser(restored.user);
        setIsAuthenticated(true);
        setUsers((prev) => {
          const exists = prev.some((u) => u.id === restored.user!.id);
          return exists
            ? prev.map((u) => (u.id === restored.user!.id ? restored.user! : u))
            : [restored.user!, ...prev];
        });
      } else {
        setToken(null);
        setIsAuthenticated(false);
      }
    } catch (error) {
      const isNetworkFailure = error instanceof ApiError && error.code === 'NETWORK_ERROR';
      setAuthRestoreError(
        isNetworkFailure
          ? 'Không thể kết nối để kiểm tra phiên đăng nhập.'
          : 'Máy chủ chưa thể kiểm tra phiên đăng nhập.'
      );
    } finally {
      setIsAuthReady(true);
    }
  }, []);

  useEffect(() => {
    void retryRestoreSession();
  }, [retryRestoreSession]);

  useEffect(() => {
    if (!authRestoreError || typeof window === 'undefined') return;
    const retryWhenOnline = () => void retryRestoreSession();
    window.addEventListener('online', retryWhenOnline);
    return () => window.removeEventListener('online', retryWhenOnline);
  }, [authRestoreError, retryRestoreSession]);

  useEffect(() => {
    if (!isAuthReady || !isAuthenticated) return;
    void refreshUsers();
    void checkNotifications();
    void refreshDmUnreadCount();
    void refreshFollowRequestsCount();
  }, [isAuthReady, isAuthenticated]);

  // SSE Listener for real-time events
  useEffect(() => {
    if (!isAuthReady || !isAuthenticated || !token || !currentUser.id) return;

    const unsubscribe = api.subscribeRealtimeEvents(
      currentUser.id,
      (event: RealtimeEvent) => {
        if (event.type === 'NEW_TIMELINE_POST') {
          setHasNewTimelinePosts(true);
        } else if (event.type === 'NEW_NOTIFICATION' || event.type === 'FOLLOW_REQUEST' || event.type === 'FOLLOW_ACCEPT') {
          setUnreadCount((prev) => prev + 1);
          refreshFollowRequestsCount();
          if (event.type === 'FOLLOW_REQUEST') {
            addToast('Bạn vừa nhận được một yêu cầu theo dõi mới!', 'info');
          } else {
            addToast('Bạn vừa nhận được một thông báo mới!', 'info');
          }
        } else if (event.type === 'dm.message.new') {
          setDmUnreadCount((prev) => prev + 1);
          const msg = event.data?.message;
          const senderName = msg?.sender?.displayName || msg?.sender?.username || 'Ai đó';
          const preview = msg?.content
            ? msg.content.length > 40
              ? `${msg.content.slice(0, 40)}...`
              : msg.content
            : 'đã gửi tin nhắn';
          addToast(`💬 ${senderName}: ${preview}`, 'info');
        } else if (event.type === 'dm.read_receipt.updated') {
          refreshDmUnreadCount();
        }
      },
      () => undefined
    );

    return () => {
      unsubscribe();
    };
  }, [isAuthReady, isAuthenticated, token, currentUser.id, addToast, refreshDmUnreadCount, refreshFollowRequestsCount]);

  const authSessionValue = useMemo<AuthSessionContextValue>(() => ({
    currentUser,
    users,
    token,
    isAuthenticated,
    isAuthReady,
    authRestoreError,
    retryRestoreSession,
    switchUser,
    refreshUsers,
    login,
    register,
    logout,
    updateProfile,
    incrementFollowersCount,
  }), [
    currentUser,
    users,
    token,
    isAuthenticated,
    isAuthReady,
    authRestoreError,
    retryRestoreSession,
    switchUser,
    refreshUsers,
    login,
    register,
    logout,
    updateProfile,
    incrementFollowersCount,
  ]);

  const uiValue = useMemo<UiContextValue>(() => ({
    currentView,
    viewParams,
    navigateTo,
    toasts,
    addToast,
    removeToast,
    isComposerOpen,
    setIsComposerOpen,
    isAuthModalOpen,
    setIsAuthModalOpen,
    authModalTab,
    setAuthModalTab,
    openAuthModal,
    isEditProfileOpen,
    setIsEditProfileOpen,
    isMuteModalOpen,
    setIsMuteModalOpen,
    muteModalTab,
    setMuteModalTab,
    openMuteModal,
    isFollowRequestsOpen,
    setIsFollowRequestsOpen,
    openFollowRequestsModal,
  }), [
    currentView,
    viewParams,
    navigateTo,
    toasts,
    addToast,
    removeToast,
    isComposerOpen,
    isAuthModalOpen,
    authModalTab,
    openAuthModal,
    isEditProfileOpen,
    isMuteModalOpen,
    muteModalTab,
    openMuteModal,
    isFollowRequestsOpen,
    openFollowRequestsModal,
  ]);

  const realtimeValue = useMemo<RealtimeContextValue>(() => ({
    unreadCount,
    setUnreadCount,
    dmUnreadCount,
    setDmUnreadCount,
    refreshDmUnreadCount,
    hasNewTimelinePosts,
    setHasNewTimelinePosts,
    pendingFollowRequestsCount,
    setPendingFollowRequestsCount,
    refreshFollowRequestsCount,
  }), [
    unreadCount,
    dmUnreadCount,
    refreshDmUnreadCount,
    hasNewTimelinePosts,
    pendingFollowRequestsCount,
    refreshFollowRequestsCount,
  ]);

  const pulseValue = useMemo<PulseContextType>(() => ({
    ...authSessionValue,
    ...uiValue,
    ...realtimeValue,
  }), [authSessionValue, uiValue, realtimeValue]);

  return (
    <AuthSessionContext.Provider value={authSessionValue}>
      <UiContext.Provider value={uiValue}>
        <RealtimeContext.Provider value={realtimeValue}>
          <PulseContext.Provider value={pulseValue}>{children}</PulseContext.Provider>
        </RealtimeContext.Provider>
      </UiContext.Provider>
    </AuthSessionContext.Provider>
  );
};

export const usePulse = (): PulseContextType => {
  const context = useContext(PulseContext);
  if (!context) {
    throw new Error('usePulse must be used within a PulseProvider');
  }
  return context;
};

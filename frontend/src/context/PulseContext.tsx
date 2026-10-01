import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { UserDto, RealtimeEvent } from '../types/PulseTypes';
import { api, PRESET_USERS } from '../api/PulseApiClient';

export type ViewType = 'home' | 'explore' | 'notifications' | 'profile' | 'thread' | 'messages';

export interface ViewParams {
  postId?: string;
  username?: string;
  hashtag?: string;
  tab?: string;
  conversationId?: string;
  recipientId?: string;
  groupId?: string;
}

export interface ToastItem {
  id: string;
  message: string;
  type: 'info' | 'success' | 'error';
}

interface PulseContextType {
  currentUser: UserDto;
  users: UserDto[];
  switchUser: (user: UserDto) => void;
  refreshUsers: () => Promise<void>;
  currentView: ViewType;
  viewParams: ViewParams;
  navigateTo: (view: ViewType, params?: ViewParams) => void;
  toasts: ToastItem[];
  addToast: (message: string, type?: 'info' | 'success' | 'error') => void;
  removeToast: (id: string) => void;
  unreadCount: number;
  setUnreadCount: React.Dispatch<React.SetStateAction<number>>;
  dmUnreadCount: number;
  setDmUnreadCount: React.Dispatch<React.SetStateAction<number>>;
  refreshDmUnreadCount: () => Promise<void>;
  hasNewTimelinePosts: boolean;
  setHasNewTimelinePosts: (has: boolean) => void;
  isComposerOpen: boolean;
  setIsComposerOpen: (open: boolean) => void;

  // Real Auth State & Actions
  token: string | null;
  isAuthenticated: boolean;
  isAuthModalOpen: boolean;
  setIsAuthModalOpen: (open: boolean) => void;
  authModalTab: 'login' | 'register';
  setAuthModalTab: (tab: 'login' | 'register') => void;
  openAuthModal: (tab?: 'login' | 'register') => void;
  isEditProfileOpen: boolean;
  setIsEditProfileOpen: (open: boolean) => void;
  isMuteModalOpen: boolean;
  setIsMuteModalOpen: (open: boolean) => void;
  muteModalTab: 'users' | 'keywords';
  setMuteModalTab: (tab: 'users' | 'keywords') => void;
  openMuteModal: (tab?: 'users' | 'keywords') => void;

  login: (identifier: string, password: string) => Promise<void>;
  register: (data: { username: string; email: string; password: string; displayName: string }) => Promise<void>;
  logout: () => void;
  updateProfile: (data: { displayName?: string; bio?: string; avatarUrl?: string; isPrivate?: boolean }) => Promise<UserDto>;

  // Task-21: Follow Requests
  isFollowRequestsOpen: boolean;
  setIsFollowRequestsOpen: (open: boolean) => void;
  openFollowRequestsModal: () => void;
  pendingFollowRequestsCount: number;
  setPendingFollowRequestsCount: React.Dispatch<React.SetStateAction<number>>;
  refreshFollowRequestsCount: () => Promise<void>;
  incrementFollowersCount: () => void;
}

const PulseContext = createContext<PulseContextType | undefined>(undefined);

export const PulseProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [users, setUsers] = useState<UserDto[]>(PRESET_USERS);
  const [token, setToken] = useState<string | null>(() => {
    return typeof window !== 'undefined' ? localStorage.getItem('pulse_auth_token') : null;
  });
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => {
    return typeof window !== 'undefined' ? !!localStorage.getItem('pulse_auth_token') : false;
  });

  const [currentUser, setCurrentUser] = useState<UserDto>(() => {
    const savedId = typeof window !== 'undefined' ? localStorage.getItem('pulse_active_user_id') : null;
    const matched = PRESET_USERS.find((u) => u.id === savedId);
    return matched || PRESET_USERS[0];
  });

  const [currentView, setCurrentView] = useState<ViewType>(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const view = params.get('view') as ViewType;
      if (view) return view;
    }
    return 'home';
  });
  const [viewParams, setViewParams] = useState<ViewParams>(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const postId = params.get('postId');
      const username = params.get('username');
      const tab = params.get('tab');
      if (postId || username || tab) {
        return { postId: postId || undefined, username: username || undefined, tab: tab || undefined };
      }
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

  const navigateTo = useCallback(
    (view: ViewType, params: ViewParams = {}) => {
      setCurrentView(view);
      setViewParams(params);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    []
  );

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
      const savedToken = localStorage.getItem('pulse_auth_token');
      if (!savedToken) {
        const foundCurrent = updated.find((u) => u.username === currentUser.username);
        if (foundCurrent) {
          setCurrentUser(foundCurrent);
          api.setActiveUserId(foundCurrent.id);
        }
      }
    } catch {
      // ignore
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
    } catch {
      // ignore
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

  // Switch user function for demo testing
  const switchUser = useCallback(
    (selectedUser: UserDto) => {
      // Clear real auth token when switching to demo user
      api.setToken(null);
      setToken(null);
      setIsAuthenticated(false);

      setCurrentUser(selectedUser);
      api.setActiveUserId(selectedUser.id);
      addToast(`Đã chuyển tài khoản sang: ${selectedUser.displayName} (@${selectedUser.username})`, 'info');
      checkNotifications();
      refreshDmUnreadCount();
      refreshFollowRequestsCount();
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

  // Initial load: restore real session if token exists
  useEffect(() => {
    const initAuth = async () => {
      const savedToken = typeof window !== 'undefined' ? localStorage.getItem('pulse_auth_token') : null;
      if (savedToken) {
        try {
          const me = await api.getMe();
          if (me && me.id) {
            setCurrentUser(me);
            setIsAuthenticated(true);
            setToken(savedToken);
            setUsers((prev) => {
              const exists = prev.some((u) => u.id === me.id);
              return exists ? prev.map((u) => (u.id === me.id ? me : u)) : [me, ...prev];
            });
            return;
          }
        } catch (err) {
          console.warn('Could not restore session from token:', err);
          api.logout();
          setToken(null);
          setIsAuthenticated(false);
        }
      }
    };

    initAuth();
    refreshUsers();
    checkNotifications();
    refreshDmUnreadCount();
    refreshFollowRequestsCount();
  }, [refreshDmUnreadCount, refreshFollowRequestsCount]);

  // SSE Listener for real-time events
  useEffect(() => {
    if (!currentUser.id) return;

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
      () => {
        // SSE disconnected, will retry automatically by browser
      }
    );

    return () => {
      unsubscribe();
    };
  }, [currentUser.id, addToast, refreshDmUnreadCount, refreshFollowRequestsCount]);

  return (
    <PulseContext.Provider
      value={{
        currentUser,
        users,
        switchUser,
        refreshUsers,
        currentView,
        viewParams,
        navigateTo,
        toasts,
        addToast,
        removeToast,
        unreadCount,
        setUnreadCount,
        dmUnreadCount,
        setDmUnreadCount,
        refreshDmUnreadCount,
        hasNewTimelinePosts,
        setHasNewTimelinePosts,
        isComposerOpen,
        setIsComposerOpen,
        token,
        isAuthenticated,
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
        login,
        register,
        logout,
        updateProfile,
        isFollowRequestsOpen,
        setIsFollowRequestsOpen,
        openFollowRequestsModal,
        pendingFollowRequestsCount,
        setPendingFollowRequestsCount,
        refreshFollowRequestsCount,
        incrementFollowersCount,
      }}
    >
      {children}
    </PulseContext.Provider>
  );
};

export const usePulse = (): PulseContextType => {
  const context = useContext(PulseContext);
  if (!context) {
    throw new Error('usePulse must be used within a PulseProvider');
  }
  return context;
};

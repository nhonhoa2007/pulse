import React, { createContext, useContext } from 'react';
import type { UserDto } from '../types/PulseTypes';
import type { ViewParams, ViewType } from '../utils/router';

export interface ToastItem {
  id: string;
  message: string;
  type: 'info' | 'success' | 'error';
}

export interface AuthSessionContextValue {
  currentUser: UserDto;
  users: UserDto[];
  token: string | null;
  isAuthenticated: boolean;
  isAuthReady: boolean;
  authRestoreError: string | null;
  retryRestoreSession: () => Promise<void>;
  switchUser: (user: UserDto) => void;
  refreshUsers: () => Promise<void>;
  login: (identifier: string, password: string) => Promise<void>;
  register: (data: { username: string; email: string; password: string; displayName: string }) => Promise<void>;
  logout: () => void;
  updateProfile: (data: { displayName?: string; bio?: string; avatarUrl?: string; isPrivate?: boolean }) => Promise<UserDto>;
  incrementFollowersCount: () => void;
}

export interface UiContextValue {
  currentView: ViewType;
  viewParams: ViewParams;
  navigateTo: (view: ViewType, params?: ViewParams) => void;
  toasts: ToastItem[];
  addToast: (message: string, type?: ToastItem['type']) => void;
  removeToast: (id: string) => void;
  isComposerOpen: boolean;
  setIsComposerOpen: (open: boolean) => void;
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
  isFollowRequestsOpen: boolean;
  setIsFollowRequestsOpen: (open: boolean) => void;
  openFollowRequestsModal: () => void;
}

export interface RealtimeContextValue {
  unreadCount: number;
  setUnreadCount: React.Dispatch<React.SetStateAction<number>>;
  dmUnreadCount: number;
  setDmUnreadCount: React.Dispatch<React.SetStateAction<number>>;
  refreshDmUnreadCount: () => Promise<void>;
  hasNewTimelinePosts: boolean;
  setHasNewTimelinePosts: (has: boolean) => void;
  pendingFollowRequestsCount: number;
  setPendingFollowRequestsCount: React.Dispatch<React.SetStateAction<number>>;
  refreshFollowRequestsCount: () => Promise<void>;
}

export const AuthSessionContext = createContext<AuthSessionContextValue | undefined>(undefined);
export const UiContext = createContext<UiContextValue | undefined>(undefined);
export const RealtimeContext = createContext<RealtimeContextValue | undefined>(undefined);

function useRequiredContext<T>(context: React.Context<T | undefined>, name: string): T {
  const value = useContext(context);
  if (!value) throw new Error(`${name} must be used within PulseProvider`);
  return value;
}

export const useAuthSession = (): AuthSessionContextValue =>
  useRequiredContext(AuthSessionContext, 'useAuthSession');

export const usePulseUi = (): UiContextValue =>
  useRequiredContext(UiContext, 'usePulseUi');

export const useRealtimeState = (): RealtimeContextValue =>
  useRequiredContext(RealtimeContext, 'useRealtimeState');

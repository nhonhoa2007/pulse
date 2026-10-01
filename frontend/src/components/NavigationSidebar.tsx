import React, { useState, useRef, useEffect } from 'react';
import { usePulse } from '../context/PulseContext';
import { VerifiedBadge } from './VerifiedBadge';
import { WebPushToggle } from './WebPushToggle';
import { ThemeSwitcher } from './ThemeSwitcher';
import { BarChart3, ShieldAlert } from 'lucide-react';

// SEC-06: toàn bộ UI demo chỉ tồn tại ở môi trường dev
const IS_DEV: boolean = import.meta.env.DEV;
import {
  Home,
  Search,
  Heart,
  User,
  Plus,
  Check,
  Bookmark,
  MessageSquare,
  UserCog,
  LogOut,
  Users,
  ChevronRight,
  LogIn,
  VolumeX,
  Lock,
} from 'lucide-react';

export const NavigationSidebar: React.FC = () => {
  const {
    currentUser,
    users,
    switchUser,
    currentView,
    viewParams,
    navigateTo,
    unreadCount,
    dmUnreadCount,
    setIsComposerOpen,
    isAuthenticated,
    openAuthModal,
    setIsEditProfileOpen,
    openMuteModal,
    openFollowRequestsModal,
    pendingFollowRequestsCount,
    logout,
  } = usePulse();

  const [isSwitcherOpen, setIsSwitcherOpen] = useState(false);
  const [showDemoAccounts, setShowDemoAccounts] = useState(false);
  const switcherRef = useRef<HTMLDivElement>(null);

  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const mobileMenuRef = useRef<HTMLDivElement>(null);

  // Close desktop dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (switcherRef.current && !switcherRef.current.contains(event.target as Node)) {
        setIsSwitcherOpen(false);
        setShowDemoAccounts(false);
      }
      if (mobileMenuRef.current && !mobileMenuRef.current.contains(event.target as Node)) {
        setIsMobileMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const isHomeActive = currentView === 'home';
  const isExploreActive = currentView === 'explore';
  const isNotificationsActive = currentView === 'notifications';
  const isMessagesActive = currentView === 'messages';
  const isBookmarksActive = currentView === 'bookmarks';
  const isProfileActive =
    currentView === 'profile' &&
    (!viewParams.username || viewParams.username === currentUser.username) &&
    viewParams.tab !== 'bookmarks';

  return (
    <>
      {/* Desktop & Tablet ~80px Left Icon Rail */}
      <aside className="hidden md:flex flex-col items-center justify-between w-20 h-screen sticky top-0 py-6 bg-paper select-none z-30 shrink-0">
        {/* Top: Threads Logo (~56px square) */}
        <div className="flex flex-col items-center gap-6 w-full">
          <button
            onClick={() => navigateTo('home')}
            className="w-14 h-14 flex items-center justify-center cursor-pointer transition-transform hover:scale-105 active:scale-95 group focus:outline-none"
            title="Threads / Pulse"
            aria-label="Home"
          >
            <svg
              viewBox="0 0 192 192"
              className="w-8 h-8 text-ink fill-current"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path d="M141.537 88.9883C140.71 88.5919 139.87 88.2104 139.019 87.8451C137.587 60.5305 122.244 44.0538 96.0601 44.0538C69.5277 44.0538 52.8134 61.4354 52.8134 88.6676C52.8134 116.14 69.8058 133.565 96.0601 133.565C108.825 133.565 119.593 129.544 127.351 121.849C128.847 120.364 130.134 118.665 131.218 116.782L116.921 106.828C115.962 108.318 114.779 109.68 113.388 110.871C108.868 114.743 102.778 116.969 95.8906 116.969C79.8087 116.969 69.5393 105.109 69.0558 87.6254C75.3341 89.9248 82.2644 91.246 89.6083 91.246C112.571 91.246 126.969 78.4319 126.969 61.2721C126.969 47.9152 116.275 38.6472 96.2295 38.6472C69.176 38.6472 50.1171 58.0772 50.1171 90.0072C50.1171 122.183 69.6053 141.776 96.3989 141.776C112.923 141.776 126.786 135.918 136.438 124.786C145.454 114.385 150.316 99.4673 150.316 82.1643C150.316 48.7497 129.805 28.5303 96.0601 28.5303C58.8718 28.5303 33.5654 54.4988 33.5654 90.9634C33.5654 127.818 58.7495 153.947 96.0601 153.947C114.28 153.947 130.407 147.288 141.349 135.197L153.284 145.98C138.835 161.792 118.987 170.36 96.0601 170.36C49.9961 170.36 17 136.262 17 90.9634C17 45.4851 50.1655 12 96.0601 12C140.71 12 166.881 38.8344 166.881 82.1643C166.881 103.882 160.835 122.427 149.336 135.342C136.85 149.366 118.847 157.061 96.3989 157.061C61.4332 157.061 34.6293 129.088 34.6293 89.6234C34.6293 50.5393 61.1618 22.2343 96.2295 22.2343C122.128 22.2343 143.149 35.8087 143.518 57.8288C143.518 70.8385 133.535 79.1672 117.848 79.1672C110.871 79.1672 104.996 77.2942 99.8703 73.6631C94.8872 70.1345 92.1741 65.4682 92.1741 59.8887C92.1741 53.6496 97.0984 49.6917 104.425 49.6917C110.985 49.6917 114.939 52.7937 115.352 57.8687L131.758 56.666C130.686 45.7483 120.354 36.637 104.425 36.637C89.5447 36.637 76.5847 45.5492 76.5847 60.1065C76.5847 70.1009 82.1953 78.4319 91.242 83.2501C86.7118 84.4447 82.1953 85.042 77.5684 85.042C74.6713 85.042 71.854 84.7934 69.1362 84.3059C71.3917 104.285 86.8157 116.892 103.543 116.892C113.881 116.892 122.569 112.565 128.799 104.42" />
            </svg>
          </button>

          {/* Nav Icons (48px square touch target, 24px line icon, #969696 at rest, #000000 when active) */}
          <nav className="flex flex-col items-center gap-3">
            {/* Home */}
            <button
              onClick={() => navigateTo('home')}
              className={`w-12 h-12 flex items-center justify-center rounded-xl transition-colors focus:outline-none ${
                isHomeActive ? 'text-ink' : 'text-ash hover:text-ink'
              }`}
              title="Trang chủ"
              aria-label="Trang chủ"
            >
              <Home className="w-6 h-6 stroke-[2]" />
            </button>

            {/* Explore / Search */}
            <button
              onClick={() => navigateTo('explore')}
              className={`w-12 h-12 flex items-center justify-center rounded-xl transition-colors focus:outline-none ${
                isExploreActive ? 'text-ink' : 'text-ash hover:text-ink'
              }`}
              title="Khám phá"
              aria-label="Khám phá"
            >
              <Search className="w-6 h-6 stroke-[2]" />
            </button>

            {/* Compose Button (Plus glyph, 48px target, #000000) */}
            <button
              onClick={() => setIsComposerOpen(true)}
              className="w-12 h-12 flex items-center justify-center rounded-xl text-ink hover:bg-mist transition-colors focus:outline-none my-1"
              title="Đăng bài mới"
              aria-label="Tạo bài viết"
            >
              <Plus className="w-6 h-6 stroke-[2.2]" />
            </button>

            {/* Notifications (Heart icon like Threads) */}
            <button
              onClick={() => navigateTo('notifications')}
              className={`w-12 h-12 flex items-center justify-center rounded-xl transition-colors relative focus:outline-none ${
                isNotificationsActive ? 'text-ink' : 'text-ash hover:text-ink'
              }`}
              title="Thông báo"
              aria-label="Thông báo"
            >
              <Heart
                className={`w-6 h-6 stroke-[2] ${
                  isNotificationsActive ? 'fill-ink' : ''
                }`}
              />
              {unreadCount > 0 && (
                <span className="absolute top-2.5 right-2.5 w-2 h-2 rounded-full bg-meta" />
              )}
            </button>

            {/* Direct Messages (Tin nhắn) */}
            <button
              onClick={() => navigateTo('messages')}
              className={`w-12 h-12 flex items-center justify-center rounded-xl transition-colors relative focus:outline-none ${
                isMessagesActive ? 'text-ink' : 'text-ash hover:text-ink'
              }`}
              title="Tin nhắn trực tiếp"
              aria-label="Tin nhắn trực tiếp"
            >
              <MessageSquare
                className={`w-6 h-6 stroke-[2] ${
                  isMessagesActive ? 'stroke-[2.5]' : ''
                }`}
              />
              {dmUnreadCount > 0 && (
                <span className="absolute top-2 right-2 min-w-[16px] h-4 px-1 rounded-full bg-meta text-white text-[10px] font-bold flex items-center justify-center">
                  {dmUnreadCount > 9 ? '9+' : dmUnreadCount}
                </span>
              )}
            </button>

            {/* Bookmarks / Đã lưu */}
            <button
              onClick={() =>
                navigateTo('bookmarks')
              }
              className={`w-12 h-12 flex items-center justify-center rounded-xl transition-colors focus:outline-none ${
                isBookmarksActive ? 'text-ink' : 'text-ash hover:text-ink'
              }`}
              title="Đã lưu (Bookmarks)"
              aria-label="Đã lưu"
            >
              <Bookmark
                className={`w-6 h-6 stroke-[2] ${
                  isBookmarksActive ? 'fill-ink' : ''
                }`}
              />
            </button>

            {/* Profile */}
            <button
              onClick={() => navigateTo('profile', { username: currentUser.username, tab: 'posts' })}
              className={`w-12 h-12 flex items-center justify-center rounded-xl transition-colors focus:outline-none ${
                isProfileActive ? 'text-ink' : 'text-ash hover:text-ink'
              }`}
              title="Hồ sơ cá nhân"
              aria-label="Hồ sơ"
            >
              <User
                className={`w-6 h-6 stroke-[2] ${
                  isProfileActive ? 'stroke-[2.5]' : ''
                }`}
              />
            </button>
          </nav>
        </div>

        {/* Bottom Section: Profile Avatar & Popover Menu */}
        <div className="flex flex-col items-center gap-3 w-full px-2" ref={switcherRef}>
          {/* If NOT authenticated (demo mode or guest), show Log In button */}
          {!isAuthenticated && (
            <button
              onClick={() => openAuthModal('login')}
              className="w-full py-1.5 px-2 bg-ink text-paper text-[11px] font-semibold rounded-full hover:bg-ink/85 active:scale-95 transition-all text-center focus:outline-none shadow-sm"
              title="Đăng nhập / Đăng ký"
            >
              Đăng nhập
            </button>
          )}

          {/* User Avatar Button */}
          <div className="relative">
            <button
              onClick={() => {
                setIsSwitcherOpen((prev) => !prev);
                setShowDemoAccounts(false);
              }}
              className="w-10 h-10 rounded-full overflow-hidden block focus:outline-none hover:opacity-85 active:scale-95 transition-all border border-cloud"
              title={
                isAuthenticated
                  ? `Đang đăng nhập: ${currentUser.displayName} (@${currentUser.username})`
                  : `Tài khoản demo: ${currentUser.displayName} (@${currentUser.username})`
              }
              aria-label="Menu tài khoản"
            >
              <img
                src={
                  currentUser.avatarUrl ||
                  `https://api.dicebear.com/7.x/bottts/svg?seed=${currentUser.username}`
                }
                alt={currentUser.displayName}
                className="w-10 h-10 rounded-full object-cover"
              />
            </button>

            {/* Popover Menu (Threads Light Theme: Paper White, Cloud Gray border, 18px radius) */}
            {isSwitcherOpen && (
              <div className="absolute bottom-2 left-14 mb-0 w-72 bg-paper border border-cloud rounded-[18px] shadow-[0_4px_24px_rgba(0,0,0,0.12)] p-2 z-50 animate-scale-up">
                {/* User Summary Header */}
                <div className="flex items-center gap-2.5 p-2 rounded-xl bg-mist/50">
                  <img
                    src={
                      currentUser.avatarUrl ||
                      `https://api.dicebear.com/7.x/bottts/svg?seed=${currentUser.username}`
                    }
                    alt={currentUser.displayName}
                    className="w-9 h-9 rounded-full object-cover shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1">
                      <span className="text-[13px] font-semibold text-ink truncate">
                        {currentUser.displayName}
                      </span>
                      {currentUser.isCelebrity && (
                        <VerifiedBadge size={12} title="Celebrity VIP" />
                      )}
                    </div>
                    <span className="text-[12px] text-ash block truncate">
                      @{currentUser.username}
                    </span>
                  </div>
                  {isAuthenticated ? (
                    <span className="text-[10px] uppercase font-bold text-meta bg-meta/10 px-1.5 py-0.5 rounded-full">
                      Auth
                    </span>
                  ) : (
                    <span className="text-[10px] uppercase font-bold text-ash bg-cloud/50 px-1.5 py-0.5 rounded-full">
                      Demo
                    </span>
                  )}
                </div>

                <div className="h-px bg-cloud/80 my-1.5" />

                {/* Popover Action Items */}
                <div className="flex flex-col gap-0.5">
                  {isAuthenticated ? (
                    <>
                      {/* Chỉnh sửa hồ sơ */}
                      <button
                        onClick={() => {
                          setIsSwitcherOpen(false);
                          setIsEditProfileOpen(true);
                        }}
                        className="flex items-center gap-2.5 px-3 py-2 text-[13px] font-medium text-ink hover:bg-mist rounded-xl transition-colors text-left"
                      >
                        <UserCog className="w-4 h-4 text-graphite" />
                        <span>Chỉnh sửa hồ sơ</span>
                      </button>

                      {/* Quản lý tắt tiếng */}
                      <button
                        onClick={() => {
                          setIsSwitcherOpen(false);
                          openMuteModal('users');
                        }}
                        className="flex items-center gap-2.5 px-3 py-2 text-[13px] font-medium text-ink hover:bg-mist rounded-xl transition-colors text-left"
                      >
                        <VolumeX className="w-4 h-4 text-graphite" />
                        <span>Quản lý tắt tiếng</span>
                      </button>

                      {/* Yêu cầu theo dõi (TASK-21) */}
                      {(currentUser.isPrivate || pendingFollowRequestsCount > 0) && (
                        <button
                          onClick={() => {
                            setIsSwitcherOpen(false);
                            openFollowRequestsModal();
                          }}
                          className="flex items-center justify-between px-3 py-2 text-[13px] font-medium text-ink hover:bg-mist rounded-xl transition-colors text-left"
                          data-testid="sidebar-follow-requests-btn"
                        >
                          <div className="flex items-center gap-2.5">
                            <Lock className="w-4 h-4 text-graphite" />
                            <span>Yêu cầu theo dõi</span>
                          </div>
                          {pendingFollowRequestsCount > 0 && (
                            <span className="px-1.5 py-0.2 bg-ink text-paper text-[10px] rounded-full font-bold">
                              {pendingFollowRequestsCount}
                            </span>
                          )}
                        </button>
                      )}

                      {/* Thông báo đẩy Web Push (TASK-20) */}
                      <WebPushToggle compact />

                      {/* PKG-02: chuyển giao diện Light/Dark/Black/System */}
                      <ThemeSwitcher />

                      {/* PKG-15: Trung tâm kiểm duyệt — chỉ admin */}
                      {currentUser.isAdmin && (
                        <button
                          onClick={() => {
                            setIsSwitcherOpen(false);
                            navigateTo('moderation');
                          }}
                          className="flex items-center gap-2.5 px-3 py-2 text-[13px] font-medium text-ink hover:bg-mist rounded-xl transition-colors text-left"
                          data-testid="sidebar-moderation-btn"
                        >
                          <ShieldAlert className="w-4 h-4 text-graphite" />
                          <span>Kiểm duyệt</span>
                        </button>
                      )}

                      {/* PKG-14: Creator Dashboard */}
                      <button
                        onClick={() => {
                          setIsSwitcherOpen(false);
                          navigateTo('stats');
                        }}
                        className="flex items-center gap-2.5 px-3 py-2 text-[13px] font-medium text-ink hover:bg-mist rounded-xl transition-colors text-left"
                        data-testid="sidebar-stats-btn"
                      >
                        <BarChart3 className="w-4 h-4 text-graphite" />
                        <span>Thống kê của tôi</span>
                      </button>

                      {/* Đổi tài khoản demo — chỉ hiển thị ở môi trường dev (SEC-06) */}
                      {IS_DEV && (
                        <>
                          <button
                            onClick={() => setShowDemoAccounts((prev) => !prev)}
                            className="flex items-center justify-between px-3 py-2 text-[13px] font-medium text-ink hover:bg-mist rounded-xl transition-colors text-left"
                          >
                            <div className="flex items-center gap-2.5">
                              <Users className="w-4 h-4 text-graphite" />
                              <span>Đổi tài khoản demo</span>
                            </div>
                            <ChevronRight
                              className={`w-4 h-4 text-ash transition-transform ${
                                showDemoAccounts ? 'rotate-90' : ''
                              }`}
                            />
                          </button>

                          {/* Demo accounts sublist if expanded */}
                          {showDemoAccounts && (
                            <div className="pl-2 pr-1 py-1 flex flex-col gap-1 max-h-48 overflow-y-auto border-l-2 border-cloud ml-3 my-1">
                              {users.map((user) => {
                                const isSelected = user.id === currentUser.id;
                                return (
                                  <button
                                    key={user.id}
                                    onClick={() => {
                                      switchUser(user);
                                      setIsSwitcherOpen(false);
                                      setShowDemoAccounts(false);
                                    }}
                                    className={`flex items-center justify-between p-1.5 rounded-lg text-left transition-colors ${
                                      isSelected
                                        ? 'bg-mist text-ink'
                                        : 'hover:bg-mist/60 text-graphite'
                                    }`}
                                  >
                                    <div className="flex items-center gap-2 min-w-0">
                                      <img
                                        src={
                                          user.avatarUrl ||
                                          `https://api.dicebear.com/7.x/bottts/svg?seed=${user.username}`
                                        }
                                        alt={user.displayName}
                                        className="w-6 h-6 rounded-full object-cover shrink-0"
                                      />
                                      <span className="text-[12px] font-medium truncate">
                                        {user.displayName}
                                      </span>
                                    </div>
                                    {isSelected && (
                                      <Check className="w-3.5 h-3.5 text-meta shrink-0" />
                                    )}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </>
                      )}

                      <div className="h-px bg-cloud/80 my-1" />

                      {/* Đăng xuất */}
                      <button
                        onClick={() => {
                          setIsSwitcherOpen(false);
                          logout();
                        }}
                        className="flex items-center gap-2.5 px-3 py-2 text-[13px] font-medium text-ink hover:bg-mist rounded-xl transition-colors text-left"
                      >
                        <LogOut className="w-4 h-4 text-graphite" />
                        <span>Đăng xuất</span>
                      </button>
                    </>
                  ) : (
                    <>
                      {/* Guest / Demo Mode Popover */}
                      <button
                        onClick={() => {
                          setIsSwitcherOpen(false);
                          openAuthModal('login');
                        }}
                        className="flex items-center gap-2.5 px-3 py-2 text-[13px] font-semibold text-ink hover:bg-mist rounded-xl transition-colors text-left"
                      >
                        <LogIn className="w-4 h-4 text-ink" />
                        <span>Đăng nhập / Đăng ký</span>
                      </button>

                      <button
                        onClick={() => {
                          setIsSwitcherOpen(false);
                          openMuteModal('users');
                        }}
                        className="flex items-center gap-2.5 px-3 py-2 text-[13px] font-medium text-ink hover:bg-mist rounded-xl transition-colors text-left"
                      >
                        <VolumeX className="w-4 h-4 text-graphite" />
                        <span>Quản lý tắt tiếng</span>
                      </button>

                      {(currentUser.isPrivate || pendingFollowRequestsCount > 0) && (
                        <button
                          onClick={() => {
                            setIsSwitcherOpen(false);
                            openFollowRequestsModal();
                          }}
                          className="flex items-center justify-between px-3 py-2 text-[13px] font-medium text-ink hover:bg-mist rounded-xl transition-colors text-left"
                          data-testid="sidebar-demo-follow-requests-btn"
                        >
                          <div className="flex items-center gap-2.5">
                            <Lock className="w-4 h-4 text-graphite" />
                            <span>Yêu cầu theo dõi</span>
                          </div>
                          {pendingFollowRequestsCount > 0 && (
                            <span className="px-1.5 py-0.2 bg-ink text-paper text-[10px] rounded-full font-bold">
                              {pendingFollowRequestsCount}
                            </span>
                          )}
                        </button>
                      )}

                      {/* Chuyển tài khoản demo — chỉ hiển thị ở môi trường dev (SEC-06) */}
                      {IS_DEV && (
                        <>
                          <div className="px-3 py-1.5 text-[11px] font-semibold tracking-wider text-ash uppercase">
                            Chuyển tài khoản demo
                          </div>

                          <div className="flex flex-col gap-1 max-h-56 overflow-y-auto">
                            {users.map((user) => {
                              const isSelected = user.id === currentUser.id;
                              return (
                                <button
                                  key={user.id}
                                  onClick={() => {
                                    switchUser(user);
                                    setIsSwitcherOpen(false);
                                  }}
                                  className={`flex items-center justify-between p-2 rounded-xl text-left transition-colors ${
                                    isSelected
                                      ? 'bg-mist text-ink'
                                      : 'hover:bg-mist/60 text-ink'
                                  }`}
                                >
                                  <div className="flex items-center gap-2.5 min-w-0">
                                    <img
                                      src={
                                        user.avatarUrl ||
                                        `https://api.dicebear.com/7.x/bottts/svg?seed=${user.username}`
                                      }
                                      alt={user.displayName}
                                      className="w-7 h-7 rounded-full object-cover shrink-0"
                                    />
                                    <div className="min-w-0">
                                      <div className="flex items-center gap-1">
                                        <span className="text-[13px] font-semibold text-ink truncate">
                                          {user.displayName}
                                        </span>
                                        {user.isCelebrity && (
                                          <VerifiedBadge size={11} title="Celebrity VIP" />
                                        )}
                                      </div>
                                      <span className="text-[11px] text-ash block truncate">
                                        @{user.username}
                                      </span>
                                    </div>
                                  </div>
                                  {isSelected && (
                                    <Check className="w-4 h-4 text-meta shrink-0" />
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        </>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* Mobile Bottom Navigation Bar */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 h-14 bg-paper/95 backdrop-blur-md border-t border-cloud flex items-center justify-around px-2 z-40">
        <button
          onClick={() => navigateTo('home')}
          className={`p-2 transition-colors ${
            isHomeActive ? 'text-ink' : 'text-ash'
          }`}
          aria-label="Trang chủ"
        >
          <Home className="w-6 h-6 stroke-[2]" />
        </button>

        <button
          onClick={() => navigateTo('explore')}
          className={`p-2 transition-colors ${
            isExploreActive ? 'text-ink' : 'text-ash'
          }`}
          aria-label="Khám phá"
        >
          <Search className="w-6 h-6 stroke-[2]" />
        </button>

        <button
          onClick={() => setIsComposerOpen(true)}
          className="p-2 text-ink hover:bg-mist rounded-xl transition-colors"
          aria-label="Đăng bài mới"
        >
          <Plus className="w-6 h-6 stroke-[2.2]" />
        </button>

        <button
          onClick={() => navigateTo('notifications')}
          className={`p-2 relative transition-colors ${
            isNotificationsActive ? 'text-ink' : 'text-ash'
          }`}
          aria-label="Thông báo"
        >
          <Heart
            className={`w-6 h-6 stroke-[2] ${
              isNotificationsActive ? 'fill-ink' : ''
            }`}
          />
          {unreadCount > 0 && (
            <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-meta" />
          )}
        </button>

        <button
          onClick={() => navigateTo('messages')}
          className={`p-2 relative transition-colors ${
            isMessagesActive ? 'text-ink' : 'text-ash'
          }`}
          aria-label="Tin nhắn"
          title="Tin nhắn"
        >
          <MessageSquare
            className={`w-6 h-6 stroke-[2] ${
              isMessagesActive ? 'stroke-[2.5]' : ''
            }`}
          />
          {dmUnreadCount > 0 && (
            <span className="absolute top-1.5 right-1.5 min-w-[14px] h-3.5 px-1 rounded-full bg-meta text-white text-[9px] font-bold flex items-center justify-center">
              {dmUnreadCount > 9 ? '9+' : dmUnreadCount}
            </span>
          )}
        </button>

        <button
          onClick={() =>
            navigateTo('bookmarks')
          }
          className={`p-2 transition-colors ${
            isBookmarksActive ? 'text-ink' : 'text-ash'
          }`}
          aria-label="Đã lưu"
          title="Đã lưu"
        >
          <Bookmark
            className={`w-6 h-6 stroke-[2] ${
              isBookmarksActive ? 'fill-ink' : ''
            }`}
          />
        </button>

        {/* Mobile Profile / Auth Button */}
        <div className="relative" ref={mobileMenuRef}>
          <button
            onClick={() => setIsMobileMenuOpen((prev) => !prev)}
            className="p-1 rounded-full focus:outline-none"
            title="Menu tài khoản"
          >
            <img
              src={
                currentUser.avatarUrl ||
                `https://api.dicebear.com/7.x/bottts/svg?seed=${currentUser.username}`
              }
              alt={currentUser.displayName}
              className="w-7 h-7 rounded-full object-cover border border-cloud"
            />
          </button>

          {/* Mobile Popover Menu */}
          {isMobileMenuOpen && (
            <div className="fixed bottom-16 right-2 w-64 bg-paper border border-cloud rounded-[18px] shadow-2xl p-2 z-50 animate-scale-up">
              <div className="flex items-center gap-2 p-2 border-b border-cloud/80">
                <img
                  src={
                    currentUser.avatarUrl ||
                    `https://api.dicebear.com/7.x/bottts/svg?seed=${currentUser.username}`
                  }
                  alt={currentUser.displayName}
                  className="w-8 h-8 rounded-full object-cover"
                />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-semibold text-ink truncate">
                    {currentUser.displayName}
                  </div>
                  <div className="text-[11px] text-ash truncate">
                    @{currentUser.username}
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-1 mt-1">
                {isAuthenticated ? (
                  <>
                    <button
                      onClick={() => {
                        setIsMobileMenuOpen(false);
                        setIsEditProfileOpen(true);
                      }}
                      className="flex items-center gap-2 px-3 py-2 text-[13px] font-medium text-ink hover:bg-mist rounded-xl text-left"
                    >
                      <UserCog className="w-4 h-4 text-graphite" />
                      <span>Chỉnh sửa hồ sơ</span>
                    </button>

                    {(currentUser.isPrivate || pendingFollowRequestsCount > 0) && (
                      <button
                        onClick={() => {
                          setIsMobileMenuOpen(false);
                          openFollowRequestsModal();
                        }}
                        className="flex items-center justify-between px-3 py-2 text-[13px] font-medium text-ink hover:bg-mist rounded-xl text-left"
                        data-testid="mobile-follow-requests-btn"
                      >
                        <div className="flex items-center gap-2">
                          <Lock className="w-4 h-4 text-graphite" />
                          <span>Yêu cầu theo dõi</span>
                        </div>
                        {pendingFollowRequestsCount > 0 && (
                          <span className="px-1.5 py-0.2 bg-ink text-paper text-[10px] rounded-full font-bold">
                            {pendingFollowRequestsCount}
                          </span>
                        )}
                      </button>
                    )}
                    <button
                      onClick={() => {
                        setIsMobileMenuOpen(false);
                        logout();
                      }}
                      className="flex items-center gap-2 px-3 py-2 text-[13px] font-medium text-ink hover:bg-mist rounded-xl text-left"
                    >
                      <LogOut className="w-4 h-4 text-graphite" />
                      <span>Đăng xuất</span>
                    </button>

                    <WebPushToggle compact />
                  </>
                ) : (
                  <button
                    onClick={() => {
                      setIsMobileMenuOpen(false);
                      openAuthModal('login');
                    }}
                    className="flex items-center gap-2 px-3 py-2 text-[13px] font-semibold text-ink hover:bg-mist rounded-xl text-left"
                  >
                    <LogIn className="w-4 h-4 text-ink" />
                    <span>Đăng nhập / Đăng ký</span>
                  </button>
                )}

                <button
                  onClick={() => {
                    const currentIndex = users.findIndex((u) => u.id === currentUser.id);
                    const nextIndex = (currentIndex + 1) % users.length;
                    switchUser(users[nextIndex]);
                    setIsMobileMenuOpen(false);
                  }}
                  className="flex items-center gap-2 px-3 py-2 text-[13px] font-medium text-ink hover:bg-mist rounded-xl text-left"
                >
                  <Users className="w-4 h-4 text-graphite" />
                  <span>Đổi tài khoản demo tiếp theo</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
};

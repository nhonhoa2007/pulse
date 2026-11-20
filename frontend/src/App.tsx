import React, { Suspense, lazy } from 'react';
import { PulseProvider } from './context/PulseContext';
import { useAuthSession, usePulseUi } from './context/PulseContexts';
import { NavigationSidebar } from './components/NavigationSidebar';
import { TrendingSidebar } from './components/TrendingSidebar';
import { PostComposerModal } from './components/PostComposerModal';
import { AuthModal } from './components/AuthModal';
import { EditProfileModal } from './components/EditProfileModal';
import { MuteManagementModal } from './components/MuteManagementModal';
import { FollowRequestsModal } from './components/FollowRequestsModal';
import { ToastContainer } from './components/ToastContainer';
const HomeTimelineView = lazy(() => import('./views/HomeTimelineView').then((module) => ({ default: module.HomeTimelineView })));
const ExploreView = lazy(() => import('./views/ExploreView').then((module) => ({ default: module.ExploreView })));
const NotificationCenterView = lazy(() => import('./views/NotificationCenterView').then((module) => ({ default: module.NotificationCenterView })));
const UserProfileView = lazy(() => import('./views/UserProfileView').then((module) => ({ default: module.UserProfileView })));
const ConversationThreadView = lazy(() => import('./views/ConversationThreadView').then((module) => ({ default: module.ConversationThreadView })));
const DirectMessagingView = lazy(() => import('./views/DirectMessagingView').then((module) => ({ default: module.DirectMessagingView })));
const BookmarksView = lazy(() => import('./views/BookmarksView').then((module) => ({ default: module.BookmarksView })));
const StatsView = lazy(() => import('./views/StatsView').then((module) => ({ default: module.StatsView })));
const ModerationCenterView = lazy(() => import('./views/ModerationCenterView').then((module) => ({ default: module.ModerationCenterView })));

const MainContentRouter: React.FC = () => {
  const { currentView } = usePulseUi();

  switch (currentView) {
    case 'home':
      return <HomeTimelineView />;
    case 'explore':
      return <ExploreView />;
    case 'notifications':
      return <NotificationCenterView />;
    case 'profile':
      return <UserProfileView />;
    case 'thread':
      return <ConversationThreadView />;
    case 'messages':
      return <DirectMessagingView />;
    case 'bookmarks':
      return <BookmarksView />;
    case 'stats':
      return <StatsView />;
    case 'moderation':
      return <ModerationCenterView />;
    default:
      return <HomeTimelineView />;
  }
};

export const AppContent: React.FC = () => {
  const { isAuthReady, authRestoreError, retryRestoreSession } = useAuthSession();
  const {
    currentView,
    isMuteModalOpen,
    setIsMuteModalOpen,
    muteModalTab,
    isFollowRequestsOpen,
    setIsFollowRequestsOpen,
  } = usePulseUi();
  const isMessages = currentView === 'messages';

  if (!isAuthReady) {
    return (
      <div className="min-h-screen bg-paper text-ink flex items-center justify-center" role="status" aria-live="polite">
        <span className="text-sm text-graphite">Đang khôi phục phiên đăng nhập…</span>
      </div>
    );
  }

  if (authRestoreError) {
    return (
      <div className="min-h-screen bg-paper text-ink flex items-center justify-center px-6">
        <div className="max-w-sm text-center" role="alert">
          <h1 className="text-lg font-semibold mb-2">Chưa thể khôi phục phiên</h1>
          <p className="text-sm text-graphite mb-5">{authRestoreError}</p>
          <button
            type="button"
            onClick={() => void retryRestoreSession()}
            className="px-5 py-2.5 rounded-full bg-ink text-paper text-sm font-semibold"
          >
            Thử lại
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-paper text-ink flex justify-center selection:bg-meta/15 selection:text-ink">
      {/* Three-column layout: ~80px left rail, centered feed container, right rail/gutter */}
      <div className="w-full max-w-[1240px] flex min-h-screen justify-between">
        {/* Navigation Sidebar (~80px Left Rail) */}
        <NavigationSidebar />

        {/* Centered Feed Column (Adapts to max-w-[940px] for 2-column Direct Messaging on desktop) */}
        <main
          className={`flex-1 min-w-0 mx-auto px-0 sm:px-2 md:px-3 py-0 md:py-4 transition-all duration-200 ${
            isMessages ? 'max-w-[940px]' : 'max-w-[640px]'
          }`}
        >
          <div className="w-full bg-paper md:rounded-[18px] border-x md:border border-cloud shadow-feed overflow-hidden min-h-screen md:min-h-[calc(100vh-2rem)]">
            <Suspense fallback={<div className="min-h-64 grid place-items-center text-[13px] text-graphite" role="status">Đang tải nội dung…</div>}>
              <MainContentRouter />
            </Suspense>
          </div>
        </main>

        {/* Right Rail (Hidden on small desktop if on messages view to give room to chat) */}
        <div className={isMessages ? 'hidden xl:block' : 'block'}>
          <TrendingSidebar />
        </div>
      </div>

      {/* Global Post Creation Modal */}
      <PostComposerModal />

      {/* Global Auth Modal */}
      <AuthModal />

      {/* Global Edit Profile Modal */}
      <EditProfileModal />

      {/* Global Mute Management Modal */}
      <MuteManagementModal
        isOpen={isMuteModalOpen}
        onClose={() => setIsMuteModalOpen(false)}
        defaultTab={muteModalTab}
      />

      {/* Global Follow Requests Modal (TASK-21) */}
      <FollowRequestsModal
        isOpen={isFollowRequestsOpen}
        onClose={() => setIsFollowRequestsOpen(false)}
      />

      {/* Global Toast Notification System */}
      <ToastContainer />
    </div>
  );
};

export const App: React.FC = () => {
  return (
    <PulseProvider>
      <AppContent />
    </PulseProvider>
  );
};

export default App;

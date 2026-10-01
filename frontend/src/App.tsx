import React from 'react';
import { PulseProvider, usePulse } from './context/PulseContext';
import { NavigationSidebar } from './components/NavigationSidebar';
import { TrendingSidebar } from './components/TrendingSidebar';
import { PostComposerModal } from './components/PostComposerModal';
import { AuthModal } from './components/AuthModal';
import { EditProfileModal } from './components/EditProfileModal';
import { MuteManagementModal } from './components/MuteManagementModal';
import { FollowRequestsModal } from './components/FollowRequestsModal';
import { ToastContainer } from './components/ToastContainer';
import { HomeTimelineView } from './views/HomeTimelineView';
import { ExploreView } from './views/ExploreView';
import { NotificationCenterView } from './views/NotificationCenterView';
import { UserProfileView } from './views/UserProfileView';
import { ConversationThreadView } from './views/ConversationThreadView';
import { DirectMessagingView } from './views/DirectMessagingView';
import { BookmarksView } from './views/BookmarksView';
import { StatsView } from './views/StatsView';

const MainContentRouter: React.FC = () => {
  const { currentView } = usePulse();

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
    default:
      return <HomeTimelineView />;
  }
};

export const AppContent: React.FC = () => {
  const {
    currentView,
    isMuteModalOpen,
    setIsMuteModalOpen,
    muteModalTab,
    isFollowRequestsOpen,
    setIsFollowRequestsOpen,
  } = usePulse();
  const isMessages = currentView === 'messages';

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
          <div className="w-full bg-paper md:rounded-[18px] border-x md:border border-cloud shadow-[0_0_12px_rgba(0,0,0,0.04),0_0_0_48px_#fafafa] overflow-hidden min-h-screen md:min-h-[calc(100vh-2rem)]">
            <MainContentRouter />
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

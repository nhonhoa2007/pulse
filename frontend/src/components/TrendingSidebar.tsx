import React from 'react';
import { usePulse } from '../context/PulseContext';
import { VerifiedBadge } from './VerifiedBadge';
import { Zap, Database, ShieldCheck, MessageSquare } from 'lucide-react';

export const TrendingSidebar: React.FC = () => {
  const { users, currentUser, navigateTo, switchUser } = usePulse();

  const invariants = [
    {
      icon: Zap,
      title: 'Hybrid Fan-out',
      desc: 'Push cho user thường, Pull cho VIP KOL',
    },
    {
      icon: Database,
      title: 'Atomic Counters',
      desc: 'Concurrency chống race condition',
    },
    {
      icon: ShieldCheck,
      title: '2-Way Block Invariant',
      desc: 'Hủy follow & dọn sạch inbox 2 chiều',
    },
    {
      icon: MessageSquare,
      title: 'Flattened Threading',
      desc: 'Truy vấn toàn bộ thread với 1 query',
    },
  ];

  return (
    <aside className="hidden lg:flex flex-col gap-5 w-72 xl:w-80 p-4 sticky top-0 h-screen overflow-y-auto select-none">
      {/* Architecture Highlights Card (border 1px #d5d5d5, radius 8px or 12px) */}
      <div className="p-4 bg-paper border border-cloud rounded-[12px]">
        <div className="flex items-center justify-between mb-2.5">
          <h3 className="text-[12px] font-semibold uppercase tracking-wider text-graphite">
            Kiến trúc hệ thống
          </h3>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-mist text-graphite font-medium">
            Pulse Engine
          </span>
        </div>
        <p className="text-[12px] text-graphite mb-3 leading-normal">
          Tối ưu hóa Write Amplification và tính nhất quán với 4 Invariants.
        </p>

        <div className="space-y-2">
          {invariants.map((inv, idx) => {
            const Icon = inv.icon;
            return (
              <div
                key={idx}
                className="flex items-start gap-2.5 p-2.5 rounded-[8px] bg-paper border border-cloud hover:bg-mist/60 transition-colors"
              >
                <div className="p-1 rounded-full text-meta shrink-0 mt-0.5">
                  <Icon className="w-3.5 h-3.5 stroke-[2]" />
                </div>
                <div>
                  <span className="text-[13px] font-semibold text-ink block">
                    {inv.title}
                  </span>
                  <span className="text-[12px] text-graphite leading-snug block">
                    {inv.desc}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Role / Perspective Switcher */}
      <div className="p-4 bg-paper border border-cloud rounded-[12px]">
        <h3 className="text-[12px] font-semibold uppercase tracking-wider text-graphite mb-3">
          Tài khoản kiểm thử
        </h3>

        <div className="space-y-2">
          {users.map((user) => {
            const isActive = user.id === currentUser.id;
            return (
              <div
                key={user.id}
                className={`flex items-center justify-between p-2 rounded-[8px] border transition-colors ${
                  isActive
                    ? 'border-ink bg-mist/50'
                    : 'border-cloud bg-paper hover:bg-mist/40'
                }`}
              >
                <div
                  onClick={() => navigateTo('profile', { username: user.username })}
                  className="flex items-center gap-2 min-w-0 cursor-pointer"
                >
                  <img
                    src={
                      user.avatarUrl ||
                      `https://api.dicebear.com/7.x/bottts/svg?seed=${user.username}`
                    }
                    alt={user.displayName}
                    className="w-8 h-8 rounded-full object-cover shrink-0"
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
                    <span className="text-[11px] text-graphite block truncate">
                      @{user.username}
                    </span>
                  </div>
                </div>

                {isActive ? (
                  <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-ink text-paper">
                    Đang chọn
                  </span>
                ) : (
                  <button
                    onClick={() => switchUser(user)}
                    className="text-[11px] font-semibold px-2.5 py-1 rounded-full border border-cloud hover:border-ink hover:bg-mist text-ink transition-colors"
                  >
                    Đổi sang
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Footer Info */}
      <footer className="px-2 text-[12px] text-ash space-y-1">
        <div>Pulse Microblogging Engine © 2026</div>
        <div>Newspaper column on frosted glass</div>
      </footer>
    </aside>
  );
};

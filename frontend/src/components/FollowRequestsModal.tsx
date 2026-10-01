import React, { useState, useEffect, useCallback } from 'react';
import { usePulse } from '../context/PulseContext';
import { api } from '../api/PulseApiClient';
import { FollowRequestDto } from '../types/PulseTypes';
import { formatRelativeTime } from '../utils/formatters';
import { X, UserCheck, UserX, Loader2, Users } from 'lucide-react';

export interface FollowRequestsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRequestProcessed?: (requestId: string, status: 'ACCEPTED' | 'REJECTED') => void;
}

export const FollowRequestsModal: React.FC<FollowRequestsModalProps> = ({
  isOpen,
  onClose,
  onRequestProcessed,
}) => {
  const { addToast, refreshUsers, setPendingFollowRequestsCount, incrementFollowersCount } = usePulse();

  const [requests, setRequests] = useState<FollowRequestDto[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [processingIds, setProcessingIds] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  const fetchRequests = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.getFollowRequests();
      if (res.success && Array.isArray(res.data)) {
        setRequests(res.data);
        setPendingFollowRequestsCount(res.data.length);
      } else {
        setRequests([]);
        setPendingFollowRequestsCount(0);
      }
    } catch (err: any) {
      console.error('Failed to load follow requests:', err);
      setError(err.message || 'Không thể tải danh sách yêu cầu theo dõi');
      setRequests([]);
    } finally {
      setIsLoading(false);
    }
  }, [setPendingFollowRequestsCount]);

  useEffect(() => {
    if (isOpen) {
      fetchRequests();
    }
  }, [isOpen, fetchRequests]);

  // Close on ESC key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleAccept = async (request: FollowRequestDto) => {
    if (processingIds[request.id]) return;

    setProcessingIds((prev) => ({ ...prev, [request.id]: true }));
    // Optimistic removal from list
    setRequests((prev) => prev.filter((r) => r.id !== request.id));
    setPendingFollowRequestsCount((prev) => Math.max(0, prev - 1));

    try {
      const res = await api.acceptFollowRequest(request.id);
      if (res.success) {
        incrementFollowersCount();
        addToast(`Đã chấp nhận yêu cầu theo dõi từ @${request.requester.username}`, 'success');
        refreshUsers();
        onRequestProcessed?.(request.id, 'ACCEPTED');
      } else {
        // Rollback
        setRequests((prev) => [request, ...prev]);
        setPendingFollowRequestsCount((prev) => prev + 1);
        addToast(res.error?.message || 'Chấp nhận yêu cầu theo dõi thất bại', 'error');
      }
    } catch (err: any) {
      // Rollback
      setRequests((prev) => [request, ...prev]);
      setPendingFollowRequestsCount((prev) => prev + 1);
      addToast(err.message || 'Chấp nhận yêu cầu theo dõi thất bại', 'error');
    } finally {
      setProcessingIds((prev) => {
        const next = { ...prev };
        delete next[request.id];
        return next;
      });
    }
  };

  const handleReject = async (request: FollowRequestDto) => {
    if (processingIds[request.id]) return;

    setProcessingIds((prev) => ({ ...prev, [request.id]: true }));
    // Optimistic removal from list
    setRequests((prev) => prev.filter((r) => r.id !== request.id));
    setPendingFollowRequestsCount((prev) => Math.max(0, prev - 1));

    try {
      const res = await api.rejectFollowRequest(request.id);
      if (res.success) {
        addToast(`Đã xóa yêu cầu theo dõi từ @${request.requester.username}`, 'info');
        onRequestProcessed?.(request.id, 'REJECTED');
      } else {
        // Rollback
        setRequests((prev) => [request, ...prev]);
        setPendingFollowRequestsCount((prev) => prev + 1);
        addToast(res.error?.message || 'Xóa yêu cầu theo dõi thất bại', 'error');
      }
    } catch (err: any) {
      // Rollback
      setRequests((prev) => [request, ...prev]);
      setPendingFollowRequestsCount((prev) => prev + 1);
      addToast(err.message || 'Xóa yêu cầu theo dõi thất bại', 'error');
    } finally {
      setProcessingIds((prev) => {
        const next = { ...prev };
        delete next[request.id];
        return next;
      });
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="follow-requests-title"
    >
      <div className="w-full max-w-lg bg-paper border border-cloud rounded-[18px] shadow-[0_0_24px_rgba(0,0,0,0.12)] overflow-hidden animate-scale-up flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between h-[53px] px-4 border-b border-cloud bg-paper shrink-0">
          <div className="w-8" />
          <h2 id="follow-requests-title" className="text-[15px] font-semibold text-ink">
            Yêu cầu theo dõi
          </h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center text-ash hover:text-ink rounded-full hover:bg-mist transition-colors focus:outline-none"
            aria-label="Đóng"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* List Content */}
        <div className="flex-1 overflow-y-auto divide-y divide-cloud">
          {isLoading ? (
            <div className="py-16 text-center text-ash">
              <Loader2 className="w-6 h-6 border-2 border-transparent text-ink animate-spin mx-auto mb-2" />
              <p className="text-[13px]">Đang tải yêu cầu theo dõi...</p>
            </div>
          ) : error ? (
            <div className="py-16 text-center text-graphite px-6">
              <p className="text-[13px]">{error}</p>
            </div>
          ) : requests.length === 0 ? (
            <div className="py-16 text-center px-6" data-testid="follow-requests-empty-state">
              <Users className="w-10 h-10 mx-auto mb-3 text-ash" />
              <h3 className="text-[15px] font-semibold text-ink mb-1">
                Không có yêu cầu theo dõi nào
              </h3>
              <p className="text-[13px] text-graphite max-w-xs mx-auto">
                Khi người khác gửi yêu cầu theo dõi tài khoản riêng tư của bạn, yêu cầu sẽ xuất hiện ở đây.
              </p>
            </div>
          ) : (
            requests.map((req) => (
              <div
                key={req.id}
                className="p-4 flex items-center justify-between gap-3 bg-paper hover:bg-mist/30 transition-colors"
                data-testid={`follow-request-item-${req.id}`}
              >
                {/* Requester Profile Info */}
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <img
                    src={
                      req.requester.avatarUrl ||
                      `https://api.dicebear.com/7.x/bottts/svg?seed=${req.requester.username}`
                    }
                    alt={req.requester.displayName}
                    className="w-10 h-10 rounded-full object-cover border border-cloud bg-mist shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] font-semibold text-ink truncate">
                      {req.requester.displayName}
                    </div>
                    <div className="text-[12px] text-graphite truncate">
                      @{req.requester.username} • {formatRelativeTime(req.createdAt)}
                    </div>
                  </div>
                </div>

                {/* Actions: Accept / Reject */}
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => handleAccept(req)}
                    disabled={processingIds[req.id]}
                    data-testid="accept-follow-request-btn"
                    data-request-id={req.id}
                    className="flex items-center gap-1 px-3.5 py-1.5 rounded-full bg-ink text-paper text-[12px] font-semibold hover:bg-ink/85 transition-colors disabled:opacity-50 focus:outline-none"
                  >
                    {processingIds[req.id] ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <UserCheck className="w-3.5 h-3.5" />
                    )}
                    <span>Chấp nhận</span>
                  </button>
                  <button
                    onClick={() => handleReject(req)}
                    disabled={processingIds[req.id]}
                    data-testid="reject-follow-request-btn"
                    data-request-id={req.id}
                    className="flex items-center gap-1 px-3.5 py-1.5 rounded-full bg-mist border border-cloud hover:bg-cloud text-ink text-[12px] font-semibold transition-colors disabled:opacity-50 focus:outline-none"
                  >
                    {processingIds[req.id] ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <UserX className="w-3.5 h-3.5" />
                    )}
                    <span>Xóa</span>
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
